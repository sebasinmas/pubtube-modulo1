import '@dotenvx/dotenvx/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { AppModule } from '../../src/app.module.js';
import { videos } from '../../src/db/schema.js';
import type { DrizzleDb } from '../../src/db/types.js';
import { VideoCleanupService } from '../../src/modules/videos/services/video-cleanup.service.js';

/*
  Limpieza de borradores abandonados contra PostgreSQL y Garage reales.
  El multipart de las filas de prueba no existe en Garage: abortarlo falla
  con NoSuchUpload y el job debe seguir igual (es el caso real tras el
  lifecycle).
 */

const DIA_MS = 24 * 60 * 60 * 1000;

describe('Limpieza de borradores abandonados', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let limpieza: VideoCleanupService;
  const ids: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get('DATABASE_CONNECTION');
    limpieza = app.get(VideoCleanupService);
  }, 30_000);

  afterAll(async () => {
    if (ids.length > 0) await db.delete(videos).where(inArray(videos.id, ids));
    await app?.close();
  });

  async function insertar(
    diasDeAntiguedad: number,
    extra: Partial<typeof videos.$inferInsert> = {},
  ): Promise<string> {
    const id = randomUUID();
    ids.push(id);
    await db.insert(videos).values({
      id,
      filename: 'clase.mp4',
      object_key: `${id}/clase.mp4`,
      minio_upload_id: 'upload-inexistente',
      size_bytes: 1024,
      created_at: new Date(Date.now() - diasDeAntiguedad * DIA_MS),
      ...extra,
    });
    return id;
  }

  async function existe(id: string): Promise<boolean> {
    const rows = await db.select().from(videos).where(eq(videos.id, id));
    return rows.length > 0;
  }

  it('elimina solo los borradores sin completar con más de 8 días', async () => {
    const abandonado = await insertar(9);
    const reciente = await insertar(1);
    const completado = await insertar(9, {
      checksum_sha256: randomBytes(32).toString('hex'),
    });
    const listo = await insertar(9, { status: 'listo' });

    const total = await limpieza.limpiarBorradoresAbandonados();

    expect(total).toBeGreaterThanOrEqual(1);
    expect(await existe(abandonado)).toBe(false);
    expect(await existe(reciente)).toBe(true);
    expect(await existe(completado)).toBe(true);
    expect(await existe(listo)).toBe(true);
  }, 30_000);

  it('es idempotente: una segunda pasada no elimina nada más de lo ya limpiado', async () => {
    const abandonado = await insertar(30);

    await limpieza.limpiarBorradoresAbandonados();
    await limpieza.limpiarBorradoresAbandonados();

    expect(await existe(abandonado)).toBe(false);
  }, 30_000);
});
