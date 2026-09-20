import '@dotenvx/dotenvx/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { AppModule } from '../../src/app.module.js';
import { videos } from '../../src/db/schema.js';
import type { DrizzleDb } from '../../src/db/types.js';
import type { EventEnvelope } from '../../src/infrastructure/messaging/event-envelope.js';

/*
  Integración real de US-A1: sin mocks. Levanta la app de Nest completa
  contra el PostgreSQL y MinIO reales definidos por las variables de
  entorno del proceso.

  Correr dentro de la red de Docker:
    docker compose up -d --wait
    pnpm test:integration

  Usa un buffer en memoria, no depende de YouTube ni de la red externa.
 */

function esperarEvento<T = unknown>(
  emitter: EventEmitter2,
  eventType: string,
  timeoutMs = 5000,
): Promise<EventEnvelope<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout esperando el evento "${eventType}"`)),
      timeoutMs,
    );
    emitter.once(eventType, (envelope: EventEnvelope<T>) => {
      clearTimeout(timer);
      resolve(envelope);
    });
  });
}

describe('POST /api/content — flujo real de subida (US-A1)', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let eventEmitter: EventEmitter2;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get('DATABASE_CONNECTION');
    eventEmitter = app.get(EventEmitter2);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('sube un archivo de 1MB, lo persiste en "borrador" y publica video.uploaded con el envelope completo', async () => {
    const contenidoFalso = Buffer.alloc(1024 * 1024, 'a');
    const checksumEsperado = createHash('sha256')
      .update(contenidoFalso)
      .digest('hex');
    const correlationId = randomUUID();

    const eventoPromise = esperarEvento(eventEmitter, 'video.uploaded');

    const initRes = await request(app.getHttpServer())
      .post('/api/content/init')
      .set('x-correlation-id', correlationId)
      .send({
        filename: 'integration-test.mp4',
        mimeType: 'video/mp4',
        sizeBytes: contenidoFalso.length,
      })
      .expect(201);

    const { uploadSessionId } = initRes.body;
    expect(uploadSessionId).toBeTruthy();

    const urlRes = await request(app.getHttpServer())
      .get(`/api/content/${uploadSessionId}/part/1`)
      .expect(200);

    const putRes = await fetch(urlRes.body.url, {
      method: 'PUT',
      body: new Uint8Array(contenidoFalso),
    });
    expect(putRes.status).toBe(200);
    const etag = putRes.headers.get('etag');
    expect(etag).toBeTruthy();

    const completeRes = await request(app.getHttpServer())
      .post(`/api/content/upload/${uploadSessionId}/complete`)
      .set('x-correlation-id', correlationId)
      .send({ parts: [{ PartNumber: 1, ETag: etag }] })
      .expect(200);

    expect(completeRes.body.contentId).toBe(uploadSessionId);
    expect(completeRes.body.checksumSha256).toBe(checksumEsperado);

    const envelope = await eventoPromise;
    expect(envelope).toMatchObject({
      type: 'video.uploaded',
      version: 1,
      correlationId,
      source: 'module1-content',
      payload: {
        contentId: uploadSessionId,
        sizeBytes: contenidoFalso.length,
        checksumSha256: checksumEsperado,
      },
    });
    expect(envelope.id).toBeTruthy();
    expect(envelope.causationId).toBeTruthy();
    expect(envelope.timestamp).toBeTruthy();

    const [row] = await db
      .select()
      .from(videos)
      .where(eq(videos.id, uploadSessionId));

    expect(row).toBeTruthy();
    expect(row.status).toBe('borrador');
    expect(row.size_bytes).toBe(contenidoFalso.length);
    expect(row.checksum_sha256).toBe(checksumEsperado);
  }, 30_000);

  it('rechaza un mimeType no soportado con 415', async () => {
    await request(app.getHttpServer())
      .post('/api/content/init')
      .send({
        filename: 'clip.avi',
        mimeType: 'video/x-msvideo',
        sizeBytes: 1024,
      })
      .expect(415);
  });

  it('rechaza un archivo que excede el tamaño máximo con 413', async () => {
    const maxBytes = Number(
      process.env.MAX_UPLOAD_SIZE_BYTES ?? 2 * 1024 * 1024 * 1024,
    );

    await request(app.getHttpServer())
      .post('/api/content/init')
      .send({
        filename: 'video-enorme.mp4',
        mimeType: 'video/mp4',
        sizeBytes: maxBytes + 1,
      })
      .expect(413);
  });
});
