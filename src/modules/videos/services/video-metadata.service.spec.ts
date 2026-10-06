import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { VideoMetadataService } from './video-metadata.service.js';
import { VideoVisibility } from '../video.entity.js';
import { UpdateMetadataDto } from '../dto/update-metadata.dto.js';

interface MockDbOptions {
  /** Resultados de cada SELECT en orden de ejecución (se resuelven en .limit()) */
  selects?: unknown[][];
  /** Resultado del INSERT ... RETURNING */
  insertReturn?: unknown[];
}

function createMockDb(options: MockDbOptions = {}) {
  const { selects = [], insertReturn = [] } = options;
  const limitResults = selects.slice();

  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.for = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(limitResults.shift() ?? []));
  chain.insert = vi.fn(() => chain);
  chain.values = vi.fn(() => chain);
  chain.returning = vi.fn(() => Promise.resolve(insertReturn));
  // Permite awaitear la query sin limit() (p. ej. historial completo).
  chain.then = (
    resolve: (value: unknown[]) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(limitResults.shift() ?? []).then(resolve, reject);
  chain.transaction = vi.fn(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(chain),
  );

  return chain;
}

function filaBase(overrides: Partial<any> = {}) {
  return {
    id: 'mv-1',
    videoId: 'abc',
    version: 1,
    title: 'Mi video',
    description: null,
    tags: null,
    visibility: 'public',
    createdAt: new Date('2026-09-28T12:00:00Z'),
    ...overrides,
  };
}

describe('VideoMetadataService.actualizarMetadatos', () => {
  let mockBroker: any;

  beforeEach(() => {
    mockBroker = { publish: vi.fn().mockResolvedValue(undefined) };
  });

  it('crea la versión 1 cuando el video no tiene metadatos previos', async () => {
    const fila = filaBase({
      version: 1,
      description: 'Una descripción',
      tags: ['educación', 'tutorial'],
    });
    const mockDb = createMockDb({
      selects: [[{ id: 'abc', status: 'borrador' }], []],
      insertReturn: [fila],
    });
    const service = new VideoMetadataService(mockDb, mockBroker);

    const dto: UpdateMetadataDto = {
      title: 'Mi video',
      description: 'Una descripción',
      tags: ['educación', 'tutorial'],
      visibility: VideoVisibility.PUBLIC,
    };

    const result = await service.actualizarMetadatos('abc', dto, 'corr-1');

    expect(result.status).toBe(200);
    expect(result.contentId).toBe('abc');
    expect(result.metadata.version).toBe(1);

    expect(mockDb.insert().values).toHaveBeenCalledWith({
      videoId: 'abc',
      version: 1,
      title: 'Mi video',
      description: 'Una descripción',
      tags: ['educación', 'tutorial'],
      visibility: 'public',
    });

    expect(mockBroker.publish).toHaveBeenCalledWith(
      'metadata.updated',
      {
        contentId: 'abc',
        version: 1,
        title: 'Mi video',
        tags: ['educación', 'tutorial'],
        visibility: 'public',
      },
      { correlationId: 'corr-1' },
    );
  });

  it('incrementa la versión cuando ya existen metadatos', async () => {
    const fila = filaBase({ version: 3 });
    const mockDb = createMockDb({
      selects: [[{ id: 'abc' }], [{ version: 2 }]],
      insertReturn: [fila],
    });
    const service = new VideoMetadataService(mockDb, mockBroker);

    const result = await service.actualizarMetadatos('abc', {
      title: 'Mi video',
      visibility: VideoVisibility.PRIVATE,
    });

    expect(result.metadata.version).toBe(3);
    expect(mockDb.insert().values).toHaveBeenCalledWith({
      videoId: 'abc',
      version: 3,
      title: 'Mi video',
      description: null,
      tags: null,
      visibility: 'private',
    });
    expect(mockBroker.publish).toHaveBeenCalledWith(
      'metadata.updated',
      expect.objectContaining({ version: 3 }),
      expect.any(Object),
    );
  });

  it('lanza NotFoundException si el video no existe', async () => {
    const mockDb = createMockDb({ selects: [[]] });
    const service = new VideoMetadataService(mockDb, mockBroker);

    await expect(
      service.actualizarMetadatos('no-existe', {
        title: 'Mi video',
        visibility: VideoVisibility.PUBLIC,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(mockBroker.publish).not.toHaveBeenCalled();
  });
});

describe('VideoMetadataService.obtenerMetadatos', () => {
  it('devuelve la última versión de metadatos', async () => {
    const fila = filaBase({ version: 3, tags: ['a'], visibility: 'private' });
    const mockDb = createMockDb({
      selects: [[{ id: 'abc' }], [fila]],
    });
    const mockBroker: any = { publish: vi.fn() };
    const service = new VideoMetadataService(mockDb, mockBroker);

    const result = await service.obtenerMetadatos('abc');

    expect(result.contentId).toBe('abc');
    expect(result.metadata).toEqual({
      id: 'mv-1',
      version: 3,
      title: 'Mi video',
      description: null,
      tags: ['a'],
      visibility: 'private',
      createdAt: new Date('2026-09-28T12:00:00Z'),
    });
  });

  it('devuelve metadata null si el video no tiene metadatos', async () => {
    const mockDb = createMockDb({ selects: [[{ id: 'abc' }], []] });
    const mockBroker: any = { publish: vi.fn() };
    const service = new VideoMetadataService(mockDb, mockBroker);

    const result = await service.obtenerMetadatos('abc');

    expect(result.metadata).toBeNull();
  });

  it('lanza NotFoundException si el video no existe', async () => {
    const mockDb = createMockDb({ selects: [[]] });
    const mockBroker: any = { publish: vi.fn() };
    const service = new VideoMetadataService(mockDb, mockBroker);

    await expect(service.obtenerMetadatos('no-existe')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('VideoMetadataService.obtenerMetadatosConHistorial', () => {
  it('devuelve la versión vigente y el historial completo, de la más reciente a la más antigua', async () => {
    const v3 = filaBase({ id: 'mv-3', version: 3, title: 'Tercera' });
    const v2 = filaBase({ id: 'mv-2', version: 2, title: 'Segunda' });
    const v1 = filaBase({ id: 'mv-1', version: 1, title: 'Primera' });
    const mockDb = createMockDb({ selects: [[{ id: 'abc' }], [v3, v2, v1]] });
    const mockBroker: any = { publish: vi.fn() };
    const service = new VideoMetadataService(mockDb, mockBroker);

    const result = await service.obtenerMetadatosConHistorial('abc');

    expect(result.contentId).toBe('abc');
    expect(result.metadata?.id).toBe('mv-3');
    expect(result.metadata?.version).toBe(3);
    expect(result.historial.map((m) => m.version)).toEqual([3, 2, 1]);
    expect(result.historial[2].title).toBe('Primera');
  });

  it('devuelve metadata null e historial vacío si el video no tiene metadatos', async () => {
    const mockDb = createMockDb({ selects: [[{ id: 'abc' }], []] });
    const mockBroker: any = { publish: vi.fn() };
    const service = new VideoMetadataService(mockDb, mockBroker);

    const result = await service.obtenerMetadatosConHistorial('abc');

    expect(result.metadata).toBeNull();
    expect(result.historial).toEqual([]);
  });

  it('lanza NotFoundException si el video no existe', async () => {
    const mockDb = createMockDb({ selects: [[]] });
    const mockBroker: any = { publish: vi.fn() };
    const service = new VideoMetadataService(mockDb, mockBroker);

    await expect(
      service.obtenerMetadatosConHistorial('no-existe'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('VideoMetadataService.obtenerVersion', () => {
  it('devuelve la versión puntual solicitada', async () => {
    const fila = filaBase({ version: 3 });
    const mockDb = createMockDb({ selects: [[fila]] });
    const mockBroker: any = { publish: vi.fn() };
    const service = new VideoMetadataService(mockDb, mockBroker);

    const result = await service.obtenerVersion('abc', 3);

    expect(result.metadata.version).toBe(3);
  });

  it('lanza NotFoundException si la versión no existe', async () => {
    const mockDb = createMockDb({ selects: [[]] });
    const mockBroker: any = { publish: vi.fn() };
    const service = new VideoMetadataService(mockDb, mockBroker);

    await expect(service.obtenerVersion('abc', 99)).rejects.toThrow(
      NotFoundException,
    );
  });
});
