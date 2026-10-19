import { describe, it, expect, vi } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { videos } from '../../../db/schema.js';
import { VideoStatus } from '../video.entity.js';
import { ContentQueryService } from './content-query.service.js';
import type { DrizzleDb } from '../../../db/types.js';

interface MockDbOptions {
  items?: unknown[];
  total?: number;
}

// Doble del query builder de Drizzle para select, where dinamico, limit, offset y count paralelo
function createMockDb(options: MockDbOptions = {}) {
  const items = options.items ?? [];
  const total = options.total ?? items.length;

  const queries: Array<{
    isCount: boolean;
    whereClause: unknown;
    limitValue?: number;
    offsetValue?: number;
  }> = [];

  const selectMock = vi.fn((fields?: unknown) => {
    const isCount = fields !== undefined;
    const currentQuery = {
      isCount,
      whereClause: undefined as unknown,
      limitValue: undefined as number | undefined,
      offsetValue: undefined as number | undefined,
    };

    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn((condition: unknown) => {
        currentQuery.whereClause = condition;
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn((limitVal: number) => {
        currentQuery.limitValue = limitVal;
        return chain;
      }),
      offset: vi.fn((offsetVal: number) => {
        currentQuery.offsetValue = offsetVal;
        return chain;
      }),
      then: vi.fn((onFulfilled: any, onRejected: any) => {
        const result = isCount ? [{ count: total, total }] : items;
        return Promise.resolve(result).then(onFulfilled, onRejected);
      }),
    };

    queries.push(currentQuery);
    return chain;
  });

  const db = {
    select: selectMock,
  };

  return { db: db as unknown as DrizzleDb, selectMock, queries };
}

describe('ContentQueryService.obtenerContenidos', () => {
  it('aplica limit y offset correctos para la primera pagina', async () => {
    const { db, queries } = createMockDb({
      items: [{ id: 'video-1' }],
      total: 1,
    });
    const service = new ContentQueryService(db);

    const resultado = await service.obtenerContenidos({ page: 1, size: 10 });

    expect(resultado.currentPage).toBe(1);
    expect(resultado.totalItems).toBe(1);
    expect(resultado.totalPages).toBe(1);

    const itemsQuery = queries.find((q) => !q.isCount);
    expect(itemsQuery?.limitValue).toBe(10);
    expect(itemsQuery?.offsetValue).toBe(0);
  });

  it('calcula offset correctamente para paginas posteriores', async () => {
    const { db, queries } = createMockDb({
      items: [{ id: 'video-31' }],
      total: 50,
    });
    const service = new ContentQueryService(db);

    const resultado = await service.obtenerContenidos({ page: 3, size: 15 });

    expect(resultado.currentPage).toBe(3);
    expect(resultado.totalItems).toBe(50);
    expect(resultado.totalPages).toBe(4);

    const itemsQuery = queries.find((q) => !q.isCount);
    expect(itemsQuery?.limitValue).toBe(15);
    expect(itemsQuery?.offsetValue).toBe(30);
  });

  it('aplica filtro where por status cuando se proporciona en el query', async () => {
    const { db, queries } = createMockDb({ items: [], total: 0 });
    const service = new ContentQueryService(db);

    await service.obtenerContenidos({
      page: 1,
      size: 10,
      status: VideoStatus.LISTO,
    });

    const itemsQuery = queries.find((q) => !q.isCount);
    const countQuery = queries.find((q) => q.isCount);

    expect(itemsQuery?.whereClause).toBeDefined();
    expect(countQuery?.whereClause).toBeDefined();
  });

  it('no aplica filtro where por status cuando es omitido', async () => {
    const { db, queries } = createMockDb({ items: [], total: 0 });
    const service = new ContentQueryService(db);

    await service.obtenerContenidos({ page: 1, size: 10 });

    const itemsQuery = queries.find((q) => !q.isCount);
    const countQuery = queries.find((q) => q.isCount);

    expect(itemsQuery?.whereClause).toBeUndefined();
    expect(countQuery?.whereClause).toBeUndefined();
  });

  it('ejecuta la consulta de items y el count en paralelo', async () => {
    const { db, selectMock, queries } = createMockDb({
      items: [{ id: 'v-1' }],
      total: 1,
    });
    const service = new ContentQueryService(db);

    await service.obtenerContenidos({ page: 1, size: 10 });

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(queries).toHaveLength(2);
    expect(queries.some((q) => q.isCount)).toBe(true);
    expect(queries.some((q) => !q.isCount)).toBe(true);
  });

  it('devuelve estructura vacia y 0 paginas cuando no hay resultados', async () => {
    const { db } = createMockDb({ items: [], total: 0 });
    const service = new ContentQueryService(db);

    const resultado = await service.obtenerContenidos({
      page: 1,
      size: 10,
      status: VideoStatus.PUBLICADO,
    });

    expect(resultado).toEqual({
      items: [],
      totalItems: 0,
      totalPages: 0,
      currentPage: 1,
    });
  });
});

describe('Indice en base de datos (PostgreSQL)', () => {
  it('define un indice sobre la columna status en la tabla videos', () => {
    const config = getTableConfig(videos);
    const indiceStatus = config.indexes.find(
      (idx) =>
        idx.config.name === 'videos_status_idx' ||
        idx.config.columns.some((col: any) => col.name === 'status'),
    );

    expect(indiceStatus).toBeDefined();
  });
});
