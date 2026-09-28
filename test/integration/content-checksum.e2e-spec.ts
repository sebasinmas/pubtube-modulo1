import '@dotenvx/dotenvx/config';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { AppModule } from '../../src/app.module.js';
import { videos } from '../../src/db/schema.js';
import type { DrizzleDb } from '../../src/db/types.js';
import type { EventEnvelope } from '../../src/infrastructure/messaging/event-envelope.js';
import { MinioService } from '../../src/infrastructure/minio/minio.service.js';

/*
  Integración real de US-A5 (idempotencia por checksum + integridad) contra
  PostgreSQL y Garage reales. Cada test sube bytes aleatorios para que los
  checksums no colisionen entre tests ni con otras suites.
 */

const BUCKET = process.env.MINIO_BUCKET_CONTENT ?? 'videos';

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

const validarVideoUploaded = new Ajv({ allErrors: true }).compile(
  JSON.parse(
    readFileSync('docs/contratos/video.uploaded.schema.json', 'utf8'),
  ) as object,
);

describe('US-A5 — checksum e integridad de carga', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let minio: MinioService;
  let eventEmitter: EventEmitter2;
  let eventos: EventEnvelope<Record<string, unknown>>[];
  const registrarEvento = (e: EventEnvelope<Record<string, unknown>>): void => {
    eventos.push(e);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get('DATABASE_CONNECTION');
    minio = app.get(MinioService);
    eventEmitter = app.get(EventEmitter2);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    eventos = [];
    eventEmitter.on('video.uploaded', registrarEvento);
  });

  afterEach(() => {
    eventEmitter.off('video.uploaded', registrarEvento);
  });

  const server = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  function iniciar(contenido: Buffer, checksum?: string) {
    return request(server()).post('/api/content/init').send({
      filename: 'clase1.mp4',
      mimeType: 'video/mp4',
      sizeBytes: contenido.length,
      checksum,
    });
  }

  /** Sube el contenido como una única parte y devuelve su ETag. */
  async function subirParte(
    sessionId: string,
    contenido: Buffer,
  ): Promise<string> {
    const urlRes = await request(server())
      .get(`/api/content/${sessionId}/part/1`)
      .expect(200);
    const putRes = await fetch((urlRes.body as { url: string }).url, {
      method: 'PUT',
      body: new Uint8Array(contenido),
    });
    expect(putRes.status).toBe(200);
    return putRes.headers.get('etag')!;
  }

  function completar(sessionId: string, etag: string) {
    return request(server())
      .post(`/api/content/upload/${sessionId}/complete`)
      .send({ parts: [{ PartNumber: 1, ETag: etag }] });
  }

  async function subirCompleto(contenido: Buffer): Promise<string> {
    const initRes = await iniciar(contenido, sha256(contenido)).expect(201);
    const { uploadSessionId } = initRes.body as { uploadSessionId: string };
    const etag = await subirParte(uploadSessionId, contenido);
    await completar(uploadSessionId, etag).expect(200);
    return uploadSessionId;
  }

  async function objetoExiste(key: string): Promise<boolean> {
    try {
      await minio.client.send(
        new HeadObjectCommand({ Bucket: BUCKET, Key: key }),
      );
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') return false;
      throw error;
    }
  }

  async function fila(id: string) {
    const [row] = await db.select().from(videos).where(eq(videos.id, id));
    return row ?? null;
  }

  it('checksum nuevo → 201, queda en borrador y publica video.uploaded una vez conforme al esquema', async () => {
    const contenido = randomBytes(256 * 1024);
    const checksum = sha256(contenido);
    const correlationId = randomUUID();

    const initRes = await iniciar(contenido, checksum).expect(201);
    const { uploadSessionId } = initRes.body as { uploadSessionId: string };
    expect(await fila(uploadSessionId)).toMatchObject({
      status: 'borrador',
      checksum_declarado: checksum,
      checksum_sha256: null,
    });

    const etag = await subirParte(uploadSessionId, contenido);
    const completeRes = await completar(uploadSessionId, etag)
      .set('x-correlation-id', correlationId)
      .expect(200);

    expect(completeRes.body).toMatchObject({
      contentId: uploadSessionId,
      checksumSha256: checksum,
    });
    expect(await fila(uploadSessionId)).toMatchObject({
      status: 'borrador',
      checksum_sha256: checksum,
    });

    expect(eventos).toHaveLength(1);
    const [evento] = eventos;
    expect(validarVideoUploaded(evento)).toBe(true);
    expect(validarVideoUploaded.errors ?? []).toEqual([]);
    expect(evento).toMatchObject({
      type: 'video.uploaded',
      correlationId,
      payload: {
        contentId: uploadSessionId,
        checksum,
        storageUrl: `s3://${BUCKET}/${uploadSessionId}/clase1.mp4`,
      },
    });
  }, 30_000);

  it('checksum existente al iniciar → 409 DUPLICATE_CONTENT con existingContentId, sin crear sesión', async () => {
    const contenido = randomBytes(64 * 1024);
    const existente = await subirCompleto(contenido);
    const filasAntes = await db.$count(videos);

    const res = await iniciar(contenido, sha256(contenido).toUpperCase());

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'DUPLICATE_CONTENT',
      existingContentId: existente,
    });
    expect(await db.$count(videos)).toBe(filasAntes);
  }, 30_000);

  it('hash calculado distinto del declarado → 422, objeto eliminado de Garage, sin sesión ni evento', async () => {
    const contenido = randomBytes(64 * 1024);
    const declarado = sha256(randomBytes(64 * 1024));

    const initRes = await iniciar(contenido, declarado).expect(201);
    const { uploadSessionId } = initRes.body as { uploadSessionId: string };
    const objectKey = `${uploadSessionId}/clase1.mp4`;
    const etag = await subirParte(uploadSessionId, contenido);

    const res = await completar(uploadSessionId, etag);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: 'INTEGRITY_CHECK_FAILED',
      expected: declarado,
      actual: sha256(contenido),
    });
    expect(await objetoExiste(objectKey)).toBe(false);
    expect(await fila(uploadSessionId)).toBeNull();
    expect(eventos).toHaveLength(0);
  }, 30_000);

  it('dos cargas concurrentes del mismo archivo → exactamente una 200 y una 409, sin huérfanos', async () => {
    const contenido = randomBytes(256 * 1024);
    const checksum = sha256(contenido);

    // Ambas pasan el rechazo temprano porque ninguna se completó todavía.
    const inits = await Promise.all([
      iniciar(contenido, checksum).expect(201),
      iniciar(contenido, checksum).expect(201),
    ]);
    const sesiones = inits.map(
      (r) => (r.body as { uploadSessionId: string }).uploadSessionId,
    );
    const etags = await Promise.all(
      sesiones.map((id) => subirParte(id, contenido)),
    );

    const respuestas = await Promise.all(
      sesiones.map((id, i) => completar(id, etags[i])),
    );

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
    const ganadora = sesiones[respuestas.findIndex((r) => r.status === 200)];
    const perdedora = sesiones[respuestas.findIndex((r) => r.status === 409)];
    expect(respuestas.find((r) => r.status === 409)!.body).toMatchObject({
      error: 'DUPLICATE_CONTENT',
      existingContentId: ganadora,
    });

    expect(await fila(ganadora)).toMatchObject({ checksum_sha256: checksum });
    expect(await fila(perdedora)).toBeNull();
    expect(await objetoExiste(`${ganadora}/clase1.mp4`)).toBe(true);
    expect(await objetoExiste(`${perdedora}/clase1.mp4`)).toBe(false);

    expect(eventos).toHaveLength(1);
    expect(eventos[0].payload).toMatchObject({ contentId: ganadora, checksum });
  }, 30_000);

  it.each([
    ['no hexadecimal', 'g'.repeat(64)],
    ['largo 63', 'a'.repeat(63)],
    ['largo 65', 'a'.repeat(65)],
  ])('checksum %s → 400', async (_caso, checksum) => {
    await iniciar(Buffer.alloc(1024), checksum).expect(400);
  });
});
