import '@dotenvx/dotenvx/config';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { AppModule } from '../../src/app.module.js';
import * as schema from '../../src/db/schema.js';
import type { EventEnvelope } from '../../src/infrastructure/messaging/event-envelope.js';

/**
 * US-A2 · Edición de metadatos — pruebas de integración E2E.
 *
 * Levanta la AppModule REAL (sin mocks) contra la infraestructura de
 * `docker-compose.test.yml` (PostgreSQL en tmpfs + Garage). Las aserciones sobre
 * la base de datos se hacen con un pool independiente del de la aplicación, de
 * modo que se lee lo realmente confirmado (commit) en PostgreSQL.
 */

const EVENTO_METADATA_ACTUALIZADA = 'metadata.updated';
const CLAVES_PAYLOAD_ESPERADAS = [
  'contentId',
  'tags',
  'title',
  'version',
  'visibility',
];

type Visibilidad = 'public' | 'private' | 'unlisted';

interface MetadataPayload {
  title: string;
  description?: string;
  tags?: string[];
  visibility: Visibilidad;
}

type EnvelopeMetadata = EventEnvelope<Record<string, unknown>>;

const METADATA_V1: MetadataPayload = {
  title: 'Introducción a NestJS',
  description: 'Primera descripción del video',
  tags: ['nestjs', 'backend'],
  visibility: 'private',
};

const METADATA_V2: MetadataPayload = {
  title: 'Introducción a NestJS (versión corregida)',
  description: 'Descripción corregida tras la revisión',
  tags: ['nestjs', 'backend', 'typescript'],
  visibility: 'public',
};

/**
 * Valores por defecto idénticos a los de `docker-compose.test.yml`. Solo se
 * aplican si la variable no vino ya del entorno / `.env` (cargado por dotenvx),
 * así que funcionan igual con `localhost:5434` que dentro de la red de Docker.
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

describe('US-A2 · Edición de metadatos (E2E con PostgreSQL real)', () => {
  let app: INestApplication;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let emitter: EventEmitter2;
  let emitAsyncSpy: MockInstance<EventEmitter2['emitAsync']>;

  const eventosCapturados: EnvelopeMetadata[] = [];
  const capturarEvento = (envelope: EnvelopeMetadata) => {
    eventosCapturados.push(envelope);
  };
  const videosCreados: string[] = [];

  /** Video "borrador" insertado directo con Drizzle (respeta la FK de metadata_versions). */
  async function crearVideoBorrador() {
    const sufijo = randomUUID();
    const [video] = await db
      .insert(schema.videos)
      .values({
        status: 'borrador',
        filename: `e2e-${sufijo}.mp4`,
        object_key: `e2e/${sufijo}.mp4`,
        minio_upload_id: `upload-${sufijo}`,
        size_bytes: 1_048_576,
      })
      .returning();
    videosCreados.push(video.id);
    return video;
  }

  function putMetadata(
    contentId: string,
    body: object,
    correlationId?: string,
  ) {
    const peticion = request(app.getHttpServer())
      .put(`/api/content/${contentId}/metadata`)
      .send(body);
    return correlationId
      ? peticion.set('x-correlation-id', correlationId)
      : peticion;
  }

  function getContenido(contentId: string) {
    return request(app.getHttpServer()).get(`/api/content/${contentId}`);
  }

  /** Todas las versiones persistidas del video, de la más antigua a la más reciente. */
  function obtenerVersiones(videoId: string) {
    return db
      .select()
      .from(schema.metadataVersions)
      .where(eq(schema.metadataVersions.videoId, videoId))
      .orderBy(asc(schema.metadataVersions.version));
  }

  function eventosMetadataActualizada() {
    return eventosCapturados.filter(
      (envelope) => envelope.type === EVENTO_METADATA_ACTUALIZADA,
    );
  }

  function emisionesDeMetadataActualizada() {
    return emitAsyncSpy.mock.calls.filter(
      ([evento]) => evento === EVENTO_METADATA_ACTUALIZADA,
    );
  }

  /** Una petición rechazada (400) no debe persistir nada ni publicar eventos. */
  async function afirmarSinEfectosSecundarios(videoId: string) {
    expect(await obtenerVersiones(videoId)).toHaveLength(0);
    expect(eventosMetadataActualizada()).toHaveLength(0);
    expect(emisionesDeMetadataActualizada()).toHaveLength(0);
  }

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

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.listen(0, '127.0.0.1');

    emitter = app.get(EventEmitter2, { strict: false });
    emitAsyncSpy = vi.spyOn(emitter, 'emitAsync');
    emitter.on(EVENTO_METADATA_ACTUALIZADA, capturarEvento);
  });

  beforeEach(() => {
    eventosCapturados.length = 0;
    emitAsyncSpy.mockClear();
  });

  afterAll(async () => {
    emitter?.off(EVENTO_METADATA_ACTUALIZADA, capturarEvento);
    emitAsyncSpy?.mockRestore();

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
  // 1. Validaciones de DTO (400)
  // ═════════════════════════════════════════════════════════════
  describe('1. Validaciones de DTO · PUT /api/content/:id/metadata', () => {
    it.each([
      {
        caso: 'falta el título',
        body: { visibility: 'public' },
        mensajes: ['El título es obligatorio'],
      },
      {
        caso: 'falta la visibilidad',
        body: { title: 'Título válido' },
        mensajes: ['La visibilidad es obligatoria'],
      },
      {
        caso: 'faltan título y visibilidad (cuerpo vacío)',
        body: {},
        mensajes: ['El título es obligatorio', 'La visibilidad es obligatoria'],
      },
      {
        caso: 'el título es una cadena vacía',
        body: { title: '', visibility: 'public' },
        mensajes: ['El título es obligatorio'],
      },
    ])('rechaza con 400 cuando $caso', async ({ body, mensajes }) => {
      const video = await crearVideoBorrador();

      const respuesta = await putMetadata(video.id, body);

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.statusCode).toBe(400);
      expect(respuesta.body.message).toEqual(expect.arrayContaining(mensajes));
      await afirmarSinEfectosSecundarios(video.id);
    });

    it('rechaza con 400 una visibilidad fuera del enum permitido', async () => {
      const video = await crearVideoBorrador();

      const respuesta = await putMetadata(video.id, {
        title: 'Título válido',
        visibility: 'secreto',
      });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toEqual(
        expect.arrayContaining(['Visibilidad inválida']),
      );
      await afirmarSinEfectosSecundarios(video.id);
    });

    it('rechaza con 400 un título de 101 caracteres (máximo 100)', async () => {
      const video = await crearVideoBorrador();

      const respuesta = await putMetadata(video.id, {
        title: 'a'.repeat(101),
        visibility: 'public',
      });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toEqual(
        expect.arrayContaining([
          'El título no puede exceder los 100 caracteres',
        ]),
      );
      await afirmarSinEfectosSecundarios(video.id);
    });

    it('acepta con 200 un título de exactamente 100 caracteres (límite)', async () => {
      const video = await crearVideoBorrador();
      const titulo = 'b'.repeat(100);

      const respuesta = await putMetadata(video.id, {
        title: titulo,
        visibility: 'public',
      });

      expect(respuesta.status).toBe(200);
      const [fila] = await obtenerVersiones(video.id);
      expect(fila.title).toBe(titulo);
    });

    it('rechaza con 400 más de 15 etiquetas (16 enviadas)', async () => {
      const video = await crearVideoBorrador();
      const etiquetas = Array.from(
        { length: 16 },
        (_, i) => `etiqueta-${i + 1}`,
      );

      const respuesta = await putMetadata(video.id, {
        title: 'Título válido',
        tags: etiquetas,
        visibility: 'public',
      });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body.message).toEqual(
        expect.arrayContaining(['No puedes agregar más de 15 etiquetas']),
      );
      await afirmarSinEfectosSecundarios(video.id);
    });

    it('acepta con 200 exactamente 15 etiquetas (límite)', async () => {
      const video = await crearVideoBorrador();
      const etiquetas = Array.from(
        { length: 15 },
        (_, i) => `etiqueta-${i + 1}`,
      );

      const respuesta = await putMetadata(video.id, {
        title: 'Título válido',
        tags: etiquetas,
        visibility: 'public',
      });

      expect(respuesta.status).toBe(200);
      const [fila] = await obtenerVersiones(video.id);
      expect(fila.tags).toEqual(etiquetas);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 2. Inmutabilidad y versionado (flujo PUT)
  // ═════════════════════════════════════════════════════════════
  describe('2. Inmutabilidad y versionado · PUT /api/content/:id/metadata', () => {
    it('el primer PUT válido inserta en metadata_versions una fila con version = 1', async () => {
      const video = await crearVideoBorrador();
      expect(await obtenerVersiones(video.id)).toHaveLength(0);

      const respuesta = await putMetadata(video.id, METADATA_V1);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({
        status: 200,
        contentId: video.id,
        metadata: {
          version: 1,
          title: METADATA_V1.title,
          description: METADATA_V1.description,
          tags: METADATA_V1.tags,
          visibility: METADATA_V1.visibility,
        },
      });

      const filas = await obtenerVersiones(video.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        id: respuesta.body.metadata.id,
        videoId: video.id,
        version: 1,
        title: METADATA_V1.title,
        description: METADATA_V1.description,
        tags: METADATA_V1.tags,
        visibility: METADATA_V1.visibility,
      });
    });

    it('el segundo PUT inserta version = 2 y deja intacta la fila de la version = 1', async () => {
      const video = await crearVideoBorrador();

      await putMetadata(video.id, METADATA_V1).expect(200);
      const [v1Antes] = await obtenerVersiones(video.id);
      expect(v1Antes.version).toBe(1);

      const respuesta = await putMetadata(video.id, METADATA_V2);
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.metadata.version).toBe(2);

      const filas = await obtenerVersiones(video.id);
      expect(filas.map((fila) => fila.version)).toEqual([1, 2]);

      const [v1Despues, v2] = filas;
      expect(v1Despues).toEqual(v1Antes);
      expect(v1Despues.title).toBe(METADATA_V1.title);
      expect(v1Despues.tags).toEqual(METADATA_V1.tags);
      expect(v1Despues.visibility).toBe(METADATA_V1.visibility);

      expect(v2.id).not.toBe(v1Antes.id);
      expect(v2).toMatchObject({
        videoId: video.id,
        version: 2,
        title: METADATA_V2.title,
        description: METADATA_V2.description,
        tags: METADATA_V2.tags,
        visibility: METADATA_V2.visibility,
      });
    });

    it('bajo concurrencia asigna versiones consecutivas sin huecos ni duplicados', async () => {
      const video = await crearVideoBorrador();

      const respuestas = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          putMetadata(video.id, {
            title: `Edición concurrente ${i + 1}`,
            visibility: 'public',
          }),
        ),
      );

      expect(respuestas.map((r) => r.status)).toEqual([
        200, 200, 200, 200, 200,
      ]);
      expect(
        respuestas.map((r) => r.body.metadata.version as number).sort(),
      ).toEqual([1, 2, 3, 4, 5]);

      const filas = await obtenerVersiones(video.id);
      expect(filas.map((fila) => fila.version)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 3. Lectura de historial (flujo GET)
  // ═════════════════════════════════════════════════════════════
  describe('3. Lectura de historial · GET /api/content/:id', () => {
    it('devuelve la versión vigente (v2) junto con el historial completo (v2 y v1)', async () => {
      const video = await crearVideoBorrador();
      await putMetadata(video.id, METADATA_V1).expect(200);
      await putMetadata(video.id, METADATA_V2).expect(200);
      const [filaV1, filaV2] = await obtenerVersiones(video.id);

      const respuesta = await getContenido(video.id);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.contentId).toBe(video.id);

      expect(respuesta.body.metadata).toMatchObject({
        id: filaV2.id,
        version: 2,
        title: METADATA_V2.title,
        description: METADATA_V2.description,
        tags: METADATA_V2.tags,
        visibility: METADATA_V2.visibility,
      });

      expect(respuesta.body.historial).toHaveLength(2);
      expect(
        respuesta.body.historial.map((v: { version: number }) => v.version),
      ).toEqual([2, 1]);
      expect(respuesta.body.historial[0]).toEqual(respuesta.body.metadata);
      expect(respuesta.body.historial[1]).toMatchObject({
        id: filaV1.id,
        version: 1,
        title: METADATA_V1.title,
        description: METADATA_V1.description,
        tags: METADATA_V1.tags,
        visibility: METADATA_V1.visibility,
      });
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 4. Contrato de eventos de dominio
  // ═════════════════════════════════════════════════════════════
  describe('4. Contrato de eventos · metadata.updated', () => {
    it('publica metadata.updated en el EventEmitter2 con el payload exacto', async () => {
      const video = await crearVideoBorrador();
      const correlationId = randomUUID();
      const versionPersistidaAlPublicar: number[] = [];
      emitAsyncSpy.mockImplementationOnce(async (evento, ...valores) => {
        const envelope = valores[0] as EnvelopeMetadata;
        const filas = await db
          .select({ version: schema.metadataVersions.version })
          .from(schema.metadataVersions)
          .where(
            and(
              eq(schema.metadataVersions.videoId, video.id),
              eq(
                schema.metadataVersions.version,
                envelope.payload.version as number,
              ),
            ),
          );
        versionPersistidaAlPublicar.push(...filas.map((fila) => fila.version));
        return EventEmitter2.prototype.emitAsync.call(
          emitter,
          evento,
          ...valores,
        );
      });

      const respuesta = await putMetadata(video.id, METADATA_V1, correlationId);
      expect(respuesta.status).toBe(200);

      expect(emisionesDeMetadataActualizada()).toHaveLength(1);
      expect(emitAsyncSpy).toHaveBeenCalledWith(
        EVENTO_METADATA_ACTUALIZADA,
        expect.objectContaining({ type: EVENTO_METADATA_ACTUALIZADA }),
      );
      expect(eventosMetadataActualizada()).toHaveLength(1);
      const [envelope] = eventosMetadataActualizada();

      expect(Object.keys(envelope.payload).sort()).toEqual(
        CLAVES_PAYLOAD_ESPERADAS,
      );
      expect(envelope.payload).toStrictEqual({
        contentId: video.id,
        version: 1,
        title: METADATA_V1.title,
        tags: METADATA_V1.tags,
        visibility: METADATA_V1.visibility,
      });

      expect(envelope).toMatchObject({
        type: EVENTO_METADATA_ACTUALIZADA,
        source: 'module1-content',
        correlationId,
        causationId: correlationId,
      });
      expect(envelope.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(envelope.timestamp).toISOString()).toBe(
        envelope.timestamp,
      );

      expect(versionPersistidaAlPublicar).toEqual([1]);
    });

    it('cada PUT publica su propio evento con la version incrementada', async () => {
      const video = await crearVideoBorrador();

      await putMetadata(video.id, METADATA_V1).expect(200);
      await putMetadata(video.id, METADATA_V2).expect(200);

      const eventos = eventosMetadataActualizada();
      expect(eventos).toHaveLength(2);
      expect(eventos.map((e) => e.payload.version)).toEqual([1, 2]);
      expect(eventos[1].payload).toStrictEqual({
        contentId: video.id,
        version: 2,
        title: METADATA_V2.title,
        tags: METADATA_V2.tags,
        visibility: METADATA_V2.visibility,
      });
      for (const evento of eventos) {
        expect(Object.keys(evento.payload).sort()).toEqual(
          CLAVES_PAYLOAD_ESPERADAS,
        );
      }
    });

    it('sin etiquetas ni descripción el payload conserva las cinco propiedades (tags = [])', async () => {
      const video = await crearVideoBorrador();

      await putMetadata(video.id, {
        title: 'Solo lo obligatorio',
        visibility: 'unlisted',
      }).expect(200);

      const [envelope] = eventosMetadataActualizada();
      expect(Object.keys(envelope.payload).sort()).toEqual(
        CLAVES_PAYLOAD_ESPERADAS,
      );
      expect(envelope.payload).toStrictEqual({
        contentId: video.id,
        version: 1,
        title: 'Solo lo obligatorio',
        tags: [],
        visibility: 'unlisted',
      });
    });
  });
});
