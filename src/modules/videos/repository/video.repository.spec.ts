import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { VideoRepository } from './video.repository.js';
import { ChecksumDuplicadoError } from '../video.errors.js';
import type { DrizzleDb } from '../../../db/types.js';

const CHECKSUM = 'a'.repeat(64);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const EXISTENTE_ID = '22222222-2222-4222-8222-222222222222';

function violacionDeUnicidad(constraint: string): DrizzleQueryError {
  return new DrizzleQueryError(
    'update "videos" ...',
    [],
    Object.assign(new Error('duplicate key'), { code: '23505', constraint }),
  );
}

/*
  Doble mínimo del query builder de Drizzle: solo las cadenas que usa
  marcarComoSubido (update→set→where→returning), buscarPorChecksum
  (select→from→where→limit) y eliminarAbandonados (delete→where→returning).
*/
function crearDb() {
  const returning = vi.fn<() => Promise<unknown[]>>();
  const limit = vi.fn<() => Promise<unknown[]>>();
  const db = {
    update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    delete: () => ({ where: () => ({ returning }) }),
  };
  return { db: db as unknown as DrizzleDb, returning, limit };
}

describe('VideoRepository.marcarComoSubido', () => {
  let fake: ReturnType<typeof crearDb>;
  let repository: VideoRepository;

  beforeEach(() => {
    fake = crearDb();
    repository = new VideoRepository(fake.db);
  });

  it('devuelve la fila actualizada', async () => {
    fake.returning.mockResolvedValueOnce([{ id: SESSION_ID }]);

    await expect(
      repository.marcarComoSubido(SESSION_ID, CHECKSUM),
    ).resolves.toEqual({ id: SESSION_ID });
  });

  it('traduce la violación del índice único a ChecksumDuplicadoError con el contenido previo', async () => {
    fake.returning.mockRejectedValueOnce(
      violacionDeUnicidad('videos_checksum_sha256_unique'),
    );
    fake.limit.mockResolvedValueOnce([{ id: EXISTENTE_ID }]);

    const error: unknown = await repository
      .marcarComoSubido(SESSION_ID, CHECKSUM)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ChecksumDuplicadoError);
    expect(error).toMatchObject({
      existingContentId: EXISTENTE_ID,
      checksum: CHECKSUM,
    });
  });

  it('relanza el error original si el contenido previo ya no existe', async () => {
    const original = violacionDeUnicidad('videos_checksum_sha256_unique');
    fake.returning.mockRejectedValueOnce(original);
    fake.limit.mockResolvedValueOnce([]);

    await expect(
      repository.marcarComoSubido(SESSION_ID, CHECKSUM),
    ).rejects.toBe(original);
  });

  it('relanza violaciones de otras restricciones sin consultar', async () => {
    const original = violacionDeUnicidad('videos_pkey');
    fake.returning.mockRejectedValueOnce(original);

    await expect(
      repository.marcarComoSubido(SESSION_ID, CHECKSUM),
    ).rejects.toBe(original);
    expect(fake.limit).not.toHaveBeenCalled();
  });
});

/*
  El filtro (borrador, sin checksum, más antiguo que el umbral) lo cubre la
  prueba de integración contra Postgres: este doble no evalúa SQL.
*/
describe('VideoRepository.eliminarAbandonados', () => {
  it('devuelve las filas eliminadas para que el servicio libere su multipart', async () => {
    const fake = crearDb();
    fake.returning.mockResolvedValueOnce([{ id: SESSION_ID }]);

    await expect(
      new VideoRepository(fake.db).eliminarAbandonados(new Date()),
    ).resolves.toEqual([{ id: SESSION_ID }]);
  });

  it('devuelve [] si no hay borradores abandonados', async () => {
    const fake = crearDb();
    fake.returning.mockResolvedValueOnce([]);

    await expect(
      new VideoRepository(fake.db).eliminarAbandonados(new Date()),
    ).resolves.toEqual([]);
  });
});
