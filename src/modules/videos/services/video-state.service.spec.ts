import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VideoStateService } from './video-state.service.js';
import { BadRequestException } from '@nestjs/common';

/**
 * Simula una transacción de Drizzle: expone un "tx" con la misma cadena
 * select().from().where().for('update').limit() y update().set().where()
 * que usa el servicio real dentro de db.transaction(async (tx) => {...}).
 */
function createMockTx(videoEncontrado: any) {
  const updateChain = {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          for: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue(videoEncontrado ? [videoEncontrado] : []),
          }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue(updateChain),
  };
}

function createMockDb(videoEncontrado: any) {
  const tx = createMockTx(videoEncontrado);
  return {
    transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => {
      return callback(tx);
    }),
    __tx: tx,
  };
}

describe('VideoStateService.marcarComoProgramado', () => {
  it('rechaza si el video está en borrador', async () => {
    const videoFalso = { id: 'abc', status: 'borrador' };
    const mockDb = createMockDb(videoFalso);
    const mockBroker = { publish: vi.fn() };
    const service = new VideoStateService(mockDb as any, mockBroker as any);

    await expect(
      service.marcarComoProgramado('abc', new Date('2027-01-01')),
    ).rejects.toThrow(BadRequestException);

    expect(mockBroker.publish).not.toHaveBeenCalled();
    expect(mockDb.__tx.update).not.toHaveBeenCalled();
  });

  it('rechaza si la fecha no es futura', async () => {
    const videoFalso = { id: 'abc', status: 'listo' };
    const mockDb = createMockDb(videoFalso);
    const mockBroker = { publish: vi.fn() };
    const service = new VideoStateService(mockDb as any, mockBroker as any);

    const fechaPasada = new Date('2020-01-01');
    await expect(
      service.marcarComoProgramado('abc', fechaPasada),
    ).rejects.toThrow(BadRequestException);

    // La validación de fecha ocurre antes de abrir la transacción.
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('actualiza el estado a "programado" y guarda la fecha si los datos son válidos', async () => {
    const videoFalso = { id: 'abc', status: 'listo' };
    const mockDb = createMockDb(videoFalso);
    const mockBroker = { publish: vi.fn() };
    const service = new VideoStateService(mockDb as any, mockBroker as any);
    const fechaFutura = new Date('2030-12-31T12:00:00Z');

    await service.marcarComoProgramado('abc', fechaFutura);

    expect(mockDb.__tx.update).toHaveBeenCalled();
    const updateChain = mockDb.__tx.update();
    expect(updateChain.set).toHaveBeenCalledWith({
      status: 'programado',
      scheduled_at: fechaFutura,
    });
    expect(updateChain.set().where).toHaveBeenCalled();
  });
});

describe('VideoStateService - Transición Borrador a Listo', () => {
  let service: VideoStateService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockBroker: any;

  beforeEach(() => {
    mockDb = createMockDb({
      id: '123e4567-e89b-12d3-a456-426614174000',
      status: 'borrador',
    });
    mockBroker = {
      publish: vi.fn().mockResolvedValue(true),
    };
    service = new VideoStateService(mockDb as any, mockBroker);
  });

  it('Debe fallar si se intenta transicionar sin metadata (Camino Triste)', async () => {
    const videoId = '123e4567-e89b-12d3-a456-426614174000';
    const metadataInvalida = null as any;

    await expect(
      service.marcarComoListo(videoId, metadataInvalida),
    ).rejects.toThrow('Metadata incompleta para pasar a estado listo');

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('Debe transicionar a "listo" y emitir evento si metadata es válida (Camino Feliz)', async () => {
    const videoId = '123e4567-e89b-12d3-a456-426614174000';
    const metadataValida = {
      title: 'Mi video',
      visibility: 'public',
      tags: ['educación'],
    };

    const result = await service.marcarComoListo(videoId, metadataValida);

    expect(result.status).toBe('listo');
    expect(mockDb.__tx.update).toHaveBeenCalled();
    const updateChain = mockDb.__tx.update();
    expect(updateChain.set).toHaveBeenCalledWith({ status: 'listo' });

    expect(mockBroker.publish).toHaveBeenCalledWith('metadata.updated', {
      contentId: videoId,
      version: 1,
      title: 'Mi video',
      tags: ['educación'],
      visibility: 'public',
    });
  });
});
