import '@dotenvx/dotenvx/config';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../../src/app.module.js';
import * as schema from '../../src/db/schema.js';
import type { EventEnvelope } from '../../src/infrastructure/messaging/event-envelope.js';
import { YoutubeService } from '../../src/infrastructure/youtube/youtube.service.js';
import {
  CRON_PUBLICACION_PROGRAMADA,
  EVENTO_VIDEO_PUBLICADO,
  VideoWorkerService,
} from '../../src/modules/videos/services/video-worker.service.js';

/**
 * US-A4 · Tarea programada para publicación en YouTube — E2E de integración.
 *
 * Levanta la AppModule REAL contra PostgreSQL real (`docker-compose.test.yml`)
 * y MOCKEA únicamente el cliente de YouTube (`YoutubeService`), de modo que se
 * simulan respuestas exitosas, videos aún procesándose (404/401) y errores de
 * red sin salir a internet. El tick del cron se invoca a mano
 * (`worker.procesarVideosProgramados()`); los cron jobs reales se detienen para
 * que ningún tick automático interfiera con las aserciones.
 *
 * Las aserciones sobre la BD usan un pool independiente del de la aplicación:
 * lo que se lee es lo realmente confirmado (commit) en PostgreSQL.
 */

const MINUTO_MS = 60_000;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAVES_PAYLOAD_ESPERADAS = [
  'contentId',
  'publishedAt',
  'scheduledAt',
  'youtubeUrl',
];

type EstadoVideo = schema.VideoStatusValue;
type RespuestaYoutube = { status: number } | Error;

interface PayloadVideoPublicado {
  contentId: string;
  youtubeUrl: string | null;
  scheduledAt: string | null;
  publishedAt: string;
}
type EnvelopeVideoPublicado = EventEnvelope<PayloadVideoPublicado>;

interface OpcionesVideo {
  status?: EstadoVideo;
  /** `undefined` = vencido hace 10 min; `null` = sin fecha. */
  scheduledAt?: Date | null;
  /** `undefined` = URL única generada; `null` = sin URL. */
  youtubeUrl?: string | null;
}

/**
 * Valores por defecto idénticos a los de `docker-compose.test.yml`. Solo se
 * aplican si la variable no vino ya del entorno / `.env` (cargado por dotenvx).
 */
function aplicarDefaultsDeEntornoDePrueba(): void {
  process.env.POSTGRES_USER ??= 'test_pubtube';
  process.env.POSTGRES_PASSWORD ??= 'test_pubtube_secret';
  process.env.POSTGRES_HOST ??= 'localhost';
  process.env.POSTGRES_PORT ??= '5434';
  process.env.POSTGRES_DB ??= 'test_pubtube_db';

  process.env.MINIO_ENDPOINT ??= 'localhost';
  process.env.MINIO_API_PORT ??= '9100';
  process.env.MINIO_ACCESS_KEY ??= 'testminioadmin';
  process.env.MINIO_SECRET_KEY ??= 'testminioadminsecret';
  process.env.MINIO_BUCKET_CONTENT ??= 'videos';
  process.env.MINIO_BUCKET_THUMBNAILS ??= 'thumbnails';
}

function construirDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST } = process.env;
  const { POSTGRES_PORT, POSTGRES_DB } = process.env;
  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;
}

async function esperarBaseDeDatos(pool: Pool, timeoutMs = 45_000) {
  const limite = Date.now() + timeoutMs;
  let ultimoError: unknown;
  while (Date.now() < limite) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      ultimoError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  const { host, pathname } = new URL(construirDatabaseUrl());
  const codigo =
    (ultimoError as { code?: string } | undefined)?.code ?? String(ultimoError);
  throw new Error(
    `PostgreSQL de pruebas no disponible en ${host}${pathname} tras ${timeoutMs} ms (${codigo}). ` +
      '¿Está levantado docker-compose.test.yml y se cargó .env.test?',
  );
}

const hace = (minutos: number) => new Date(Date.now() - minutos * MINUTO_MS);
const dentroDe = (minutos: number) =>
  new Date(Date.now() + minutos * MINUTO_MS);
const esperar = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('US-A4 · Worker de publicación programada en YouTube (E2E con PostgreSQL real)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let emitter: EventEmitter2;
  let worker: VideoWorkerService;

  // ───────────── Doble del cliente de YouTube (única dependencia mockeada) ─────────────
  // Respuesta por URL; las URLs sin configurar responden 404 ("aún no disponible").
  const respuestasPorUrl = new Map<string, RespuestaYoutube>();
  const respuestaPorDefecto = (url: string): Promise<{ status: number }> => {
    const respuesta = respuestasPorUrl.get(url);
    if (respuesta instanceof Error) return Promise.reject(respuesta);
    return Promise.resolve(respuesta ?? { status: 404 });
  };
  const verificarDisponibilidad =
    vi.fn<YoutubeService['verificarDisponibilidad']>(respuestaPorDefecto);
  const clienteYoutubeMock = { verificarDisponibilidad };

  // ───────────── Captura de eventos de dominio ─────────────
  const eventos: EnvelopeVideoPublicado[] = [];
  const estadoEnBdAlRecibirEvento = new Map<
    string,
    EstadoVideo | 'inexistente'
  >();
  const registrarEvento = async (envelope: EnvelopeVideoPublicado) => {
    eventos.push(envelope);
    // Lee con el pool independiente: si el estado ya es 'publicado' aquí, el
    // commit ocurrió ANTES de emitir el evento.
    const fila = await obtenerVideo(envelope.payload.contentId);
    estadoEnBdAlRecibirEvento.set(
      envelope.payload.contentId,
      fila?.status ?? 'inexistente',
    );
  };
  // EventEmitter2.emitAsync espera la promesa que devuelva el listener.
  const capturarEvento = (
    envelope: EnvelopeVideoPublicado,
  ): void | Promise<void> => registrarEvento(envelope);

  const videosCreados: string[] = [];

  // ───────────── Helpers ─────────────
  async function crearVideo(opciones: OpcionesVideo = {}) {
    const id = randomUUID();
    const [video] = await db
      .insert(schema.videos)
      .values({
        id,
        status: opciones.status ?? 'programado',
        scheduled_at:
          opciones.scheduledAt === undefined ? hace(10) : opciones.scheduledAt,
        youtube_url:
          opciones.youtubeUrl === undefined
            ? `https://www.youtube.com/watch?v=e2e-${id}`
            : opciones.youtubeUrl,
        filename: `e2e-${id}.mp4`,
        object_key: `e2e/${id}.mp4`,
        minio_upload_id: `upload-${id}`,
        size_bytes: 1_048_576,
      })
      .returning();
    videosCreados.push(video.id);
    return video;
  }

  async function obtenerVideo(id: string) {
    const [fila] = await db
      .select()
      .from(schema.videos)
      .where(eq(schema.videos.id, id));
    return fila;
  }

  async function estadoDe(id: string) {
    return (await obtenerVideo(id))?.status;
  }

  /** Cuántas veces el worker consultó a YouTube por esta URL. */
  const consultasA = (url: string | null) =>
    verificarDisponibilidad.mock.calls.filter(
      ([consultada]) => consultada === url,
    ).length;

  const eventosDe = (contentId: string) =>
    eventos.filter((envelope) => envelope.payload.contentId === contentId);

  const ejecutarTick = () => worker.procesarVideosProgramados();

  // ───────────────────────── ciclo de vida ─────────────────────────

  beforeAll(async () => {
    aplicarDefaultsDeEntornoDePrueba();

    pool = new Pool({ connectionString: construirDatabaseUrl() });
    await esperarBaseDeDatos(pool);
    db = drizzle(pool, { schema });

    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL('../../src/db/migrations', import.meta.url),
      ),
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YoutubeService)
      .useValue(clienteYoutubeMock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // Los cron jobs reales (cada 5 min y limpieza de las 3 AM) se detienen:
    // el único que ejecuta el worker en estos tests es el propio test.
    const registro = app.get(SchedulerRegistry);
    for (const job of registro.getCronJobs().values()) {
      void job.stop();
    }

    worker = app.get(VideoWorkerService);
    emitter = app.get(EventEmitter2, { strict: false });
    // EventEmitter2.emitAsync espera la promesa del listener (ver capturarEvento).
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    emitter.on(EVENTO_VIDEO_PUBLICADO, capturarEvento);
  }, 60_000);

  beforeEach(() => {
    eventos.length = 0;
    estadoEnBdAlRecibirEvento.clear();
    respuestasPorUrl.clear();
    verificarDisponibilidad.mockReset();
    verificarDisponibilidad.mockImplementation(respuestaPorDefecto);
  });

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    emitter?.off(EVENTO_VIDEO_PUBLICADO, capturarEvento);

    if (db && videosCreados.length > 0) {
      await db
        .delete(schema.videos)
        .where(inArray(schema.videos.id, videosCreados));
    }

    const dbApp = app?.get<{ $client?: Pool }>('DATABASE_CONNECTION', {
      strict: false,
    });
    await app?.close();
    await dbApp?.$client?.end();
    await pool?.end();
  });

  // ═════════════════════════════════════════════════════════════
  // 1. Configuración del cliente de YouTube y del cron job
  // ═════════════════════════════════════════════════════════════
  describe('1. Configuración del cliente y registro del cron', () => {
    it('el cliente de YouTube es un único provider inyectado (el worker usa el doble, sin red real)', async () => {
      const video = await crearVideo();
      respuestasPorUrl.set(video.youtube_url!, { status: 200 });

      expect(app.get(YoutubeService)).toBe(clienteYoutubeMock);

      await ejecutarTick();

      expect(consultasA(video.youtube_url)).toBe(1);
    });

    it('el worker está registrado como cron job que corre cada 5 minutos', () => {
      const job = app
        .get(SchedulerRegistry)
        .getCronJob(CRON_PUBLICACION_PROGRAMADA);

      expect(job.cronTime.source).toBe(CronExpression.EVERY_5_MINUTES);

      const [primera, segunda] = job.nextDates(2);
      expect(segunda.toMillis() - primera.toMillis()).toBe(5 * MINUTO_MS);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 2. Selección: status = 'programado' AND scheduled_at <= NOW()
  // ═════════════════════════════════════════════════════════════
  describe("2. Selección de videos (status = 'programado' y scheduled_at <= NOW())", () => {
    it('procesa un video programado cuya fecha ya venció', async () => {
      const video = await crearVideo({ scheduledAt: hace(1) });
      respuestasPorUrl.set(video.youtube_url!, { status: 200 });

      await ejecutarTick();

      expect(consultasA(video.youtube_url)).toBe(1);
      expect(await estadoDe(video.id)).toBe('publicado');
    });

    it('NO procesa un video programado con scheduled_at en el futuro', async () => {
      const video = await crearVideo({ scheduledAt: dentroDe(30) });
      respuestasPorUrl.set(video.youtube_url!, { status: 200 });

      await ejecutarTick();

      expect(consultasA(video.youtube_url)).toBe(0);
      expect(await estadoDe(video.id)).toBe('programado');
      expect(eventosDe(video.id)).toHaveLength(0);
    });

    it.each(['borrador', 'listo', 'publicado'] as const)(
      "NO procesa un video en estado '%s' aunque tenga scheduled_at vencido",
      async (status) => {
        const video = await crearVideo({ status, scheduledAt: hace(60) });
        respuestasPorUrl.set(video.youtube_url!, { status: 200 });

        await ejecutarTick();

        expect(consultasA(video.youtube_url)).toBe(0);
        expect(await estadoDe(video.id)).toBe(status);
        expect(eventosDe(video.id)).toHaveLength(0);
      },
    );

    it('en un lote mixto publica únicamente los elegibles', async () => {
      const elegibleA = await crearVideo({ scheduledAt: hace(30) });
      const elegibleB = await crearVideo({ scheduledAt: hace(5) });
      const futuro = await crearVideo({ scheduledAt: dentroDe(15) });
      const listo = await crearVideo({
        status: 'listo',
        scheduledAt: hace(30),
      });
      for (const video of [elegibleA, elegibleB, futuro, listo]) {
        respuestasPorUrl.set(video.youtube_url!, { status: 200 });
      }

      await ejecutarTick();

      expect(await estadoDe(elegibleA.id)).toBe('publicado');
      expect(await estadoDe(elegibleB.id)).toBe('publicado');
      expect(await estadoDe(futuro.id)).toBe('programado');
      expect(await estadoDe(listo.id)).toBe('listo');
      expect(consultasA(futuro.youtube_url)).toBe(0);
      expect(consultasA(listo.youtube_url)).toBe(0);
    });

    it('omite (sin consultar YouTube) los programados que no tienen youtube_url', async () => {
      const sinUrl = await crearVideo({ youtubeUrl: null });

      await ejecutarTick();

      expect(consultasA(null)).toBe(0);
      expect(await estadoDe(sinUrl.id)).toBe('programado');
      expect(eventosDe(sinUrl.id)).toHaveLength(0);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 3. Validación de disponibilidad en YouTube antes de publicar
  // ═════════════════════════════════════════════════════════════
  describe('3. Validación de disponibilidad en YouTube', () => {
    it("consulta YouTube con la youtube_url del video ANTES de transicionar (sigue 'programado' durante la consulta)", async () => {
      const video = await crearVideo();
      let estadoDuranteLaConsulta: EstadoVideo | undefined;
      verificarDisponibilidad.mockImplementation(async (url) => {
        if (url !== video.youtube_url) return respuestaPorDefecto(url);
        estadoDuranteLaConsulta = await estadoDe(video.id);
        return { status: 200 };
      });

      await ejecutarTick();

      expect(verificarDisponibilidad).toHaveBeenCalledWith(video.youtube_url);
      expect(estadoDuranteLaConsulta).toBe('programado');
      expect(await estadoDe(video.id)).toBe('publicado');
    });

    it('publica cuando YouTube confirma que el video es público (200)', async () => {
      const video = await crearVideo();
      respuestasPorUrl.set(video.youtube_url!, { status: 200 });

      await ejecutarTick();

      expect(await estadoDe(video.id)).toBe('publicado');
    });

    it.each([
      {
        status: 404,
        significado: 'aún se está procesando / no existe todavía',
      },
      { status: 401, significado: 'todavía no es público (privado)' },
      { status: 403, significado: 'acceso denegado' },
      { status: 500, significado: 'error interno de YouTube' },
      { status: 503, significado: 'YouTube no disponible' },
    ])(
      "NO publica y lo deja 'programado' cuando YouTube responde $status ($significado)",
      async ({ status }) => {
        const video = await crearVideo();
        respuestasPorUrl.set(video.youtube_url!, { status });

        await ejecutarTick();

        expect(consultasA(video.youtube_url)).toBe(1);
        const fila = await obtenerVideo(video.id);
        expect(fila.status).toBe('programado');
        expect(fila.scheduled_at).toEqual(video.scheduled_at);
        expect(eventosDe(video.id)).toHaveLength(0);
      },
    );
  });

  // ═════════════════════════════════════════════════════════════
  // 4. Transición atómica y evento de dominio
  // ═════════════════════════════════════════════════════════════
  describe('4. Transición atómica y evento video.published', () => {
    it('emite exactamente un video.published con envelope y payload válidos', async () => {
      const video = await crearVideo();
      respuestasPorUrl.set(video.youtube_url!, { status: 200 });

      await ejecutarTick();

      const emitidos = eventosDe(video.id);
      expect(emitidos).toHaveLength(1);
      const [envelope] = emitidos;

      expect(envelope).toMatchObject({
        type: 'video.published',
        version: 1,
        source: 'module1-content',
        payload: {
          contentId: video.id,
          youtubeUrl: video.youtube_url,
          scheduledAt: video.scheduled_at!.toISOString(),
        },
      });
      expect(envelope.id).toMatch(UUID_V4);
      expect(envelope.correlationId).toMatch(UUID_V4);
      expect(envelope.causationId).toBe(envelope.correlationId);
      expect(Number.isNaN(Date.parse(envelope.timestamp))).toBe(false);
      expect(Number.isNaN(Date.parse(envelope.payload.publishedAt))).toBe(
        false,
      );
      expect(Object.keys(envelope.payload).sort()).toEqual(
        CLAVES_PAYLOAD_ESPERADAS,
      );
    });

    it('el evento se emite DESPUÉS del commit: al recibirlo, la BD ya muestra "publicado"', async () => {
      const video = await crearVideo();
      respuestasPorUrl.set(video.youtube_url!, { status: 200 });

      await ejecutarTick();

      expect(eventosDe(video.id)).toHaveLength(1);
      expect(estadoEnBdAlRecibirEvento.get(video.id)).toBe('publicado');
    });

    it('no emite evento cuando el video no se publica', async () => {
      const procesandose = await crearVideo();
      const conErrorDeRed = await crearVideo();
      respuestasPorUrl.set(procesandose.youtube_url!, { status: 404 });
      respuestasPorUrl.set(conErrorDeRed.youtube_url!, new Error('ECONNRESET'));

      await ejecutarTick();

      expect(eventosDe(procesandose.id)).toHaveLength(0);
      expect(eventosDe(conErrorDeRed.id)).toHaveLength(0);
    });

    it('la transición es atómica (compare-and-swap): si el video sale de "programado" mientras se consulta YouTube, no se pisa ni se emite evento', async () => {
      const video = await crearVideo();
      verificarDisponibilidad.mockImplementation(async (url) => {
        if (url !== video.youtube_url) return respuestaPorDefecto(url);
        // Edición concurrente: el usuario des-programa el video durante la consulta.
        await db
          .update(schema.videos)
          .set({ status: 'listo', scheduled_at: null })
          .where(eq(schema.videos.id, video.id));
        return { status: 200 };
      });

      await ejecutarTick();

      const fila = await obtenerVideo(video.id);
      expect(fila.status).toBe('listo');
      expect(fila.scheduled_at).toBeNull();
      expect(eventosDe(video.id)).toHaveLength(0);
    });

    it('dos ticks simultáneos publican el video una sola vez (un único evento)', async () => {
      const video = await crearVideo();
      verificarDisponibilidad.mockImplementation(async (url) => {
        if (url !== video.youtube_url) return respuestaPorDefecto(url);
        await esperar(150); // garantiza que los dos ticks se solapen
        return { status: 200 };
      });

      await Promise.all([ejecutarTick(), ejecutarTick()]);

      expect(await estadoDe(video.id)).toBe('publicado');
      expect(eventosDe(video.id)).toHaveLength(1);
    });

    it('es idempotente: un video ya publicado no se vuelve a consultar ni a notificar en ticks posteriores', async () => {
      const video = await crearVideo();
      respuestasPorUrl.set(video.youtube_url!, { status: 200 });

      await ejecutarTick();
      await ejecutarTick();
      await ejecutarTick();

      expect(consultasA(video.youtube_url)).toBe(1);
      expect(eventosDe(video.id)).toHaveLength(1);
      expect(await estadoDe(video.id)).toBe('publicado');
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 5. Resiliencia: errores de red, videos aún procesándose y reintentos
  // ═════════════════════════════════════════════════════════════
  describe('5. Resiliencia y reintentos', () => {
    it.each([
      { caso: 'conexión reiniciada', error: new Error('ECONNRESET') },
      {
        caso: 'timeout',
        error: Object.assign(new Error('timeout of 10000ms exceeded'), {
          code: 'ECONNABORTED',
        }),
      },
    ])(
      "un error de red ($caso) no tumba el worker y deja el video 'programado'",
      async ({ error }) => {
        const video = await crearVideo();
        respuestasPorUrl.set(video.youtube_url!, error);

        await expect(ejecutarTick()).resolves.toBeUndefined();

        expect(consultasA(video.youtube_url)).toBe(1);
        expect(await estadoDe(video.id)).toBe('programado');
        expect(eventosDe(video.id)).toHaveLength(0);
      },
    );

    it('un fallo en un video no impide procesar el resto del lote', async () => {
      const primero = await crearVideo({ scheduledAt: hace(30) });
      const conErrorDeRed = await crearVideo({ scheduledAt: hace(20) });
      const procesandose = await crearVideo({ scheduledAt: hace(15) });
      const ultimo = await crearVideo({ scheduledAt: hace(10) });
      respuestasPorUrl.set(primero.youtube_url!, { status: 200 });
      respuestasPorUrl.set(conErrorDeRed.youtube_url!, new Error('ETIMEDOUT'));
      respuestasPorUrl.set(procesandose.youtube_url!, { status: 404 });
      respuestasPorUrl.set(ultimo.youtube_url!, { status: 200 });

      await expect(ejecutarTick()).resolves.toBeUndefined();

      expect(await estadoDe(primero.id)).toBe('publicado');
      expect(await estadoDe(conErrorDeRed.id)).toBe('programado');
      expect(await estadoDe(procesandose.id)).toBe('programado');
      expect(await estadoDe(ultimo.id)).toBe('publicado');
      expect(eventosDe(primero.id)).toHaveLength(1);
      expect(eventosDe(ultimo.id)).toHaveLength(1);
      expect(eventosDe(conErrorDeRed.id)).toHaveLength(0);
      expect(eventosDe(procesandose.id)).toHaveLength(0);
    });

    it('reintenta en cada tick hasta que YouTube lo expone: error de red → aún procesándose → público', async () => {
      const video = await crearVideo();
      const url = video.youtube_url!;

      respuestasPorUrl.set(url, new Error('ECONNRESET'));
      await ejecutarTick();
      expect(await estadoDe(video.id)).toBe('programado');

      respuestasPorUrl.set(url, { status: 404 });
      await ejecutarTick();
      expect(await estadoDe(video.id)).toBe('programado');
      expect(eventosDe(video.id)).toHaveLength(0);

      respuestasPorUrl.set(url, { status: 200 });
      await ejecutarTick();
      expect(await estadoDe(video.id)).toBe('publicado');
      expect(eventosDe(video.id)).toHaveLength(1);

      expect(consultasA(url)).toBe(3);
    });

    it('si el consumidor del evento falla, la publicación ya confirmada se conserva y el lote continúa', async () => {
      const fallido = await crearVideo({ scheduledAt: hace(20) });
      const siguiente = await crearVideo({ scheduledAt: hace(10) });
      respuestasPorUrl.set(fallido.youtube_url!, { status: 200 });
      respuestasPorUrl.set(siguiente.youtube_url!, { status: 200 });

      const consumidorCaido = (envelope: EnvelopeVideoPublicado) => {
        if (envelope.payload.contentId === fallido.id) {
          throw new Error('consumidor caído');
        }
      };
      emitter.on(EVENTO_VIDEO_PUBLICADO, consumidorCaido);
      try {
        await expect(ejecutarTick()).resolves.toBeUndefined();
      } finally {
        emitter.off(EVENTO_VIDEO_PUBLICADO, consumidorCaido);
      }

      expect(await estadoDe(fallido.id)).toBe('publicado');
      expect(await estadoDe(siguiente.id)).toBe('publicado');
      expect(eventosDe(siguiente.id)).toHaveLength(1);
    });
  });
});
