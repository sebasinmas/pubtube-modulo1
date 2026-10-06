import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  VideoStateService,
  type MetadataPayload,
} from './video-state.service.js';
import type { DrizzleDb } from '../../../db/types.js';
import type { VideoStatusValue } from '../../../db/schema.js';
import type { MessageBrokerService } from '../../../infrastructure/messaging/message-broker.service.js';

// Reloj fijo: las fechas "futuras" y "pasadas" se calculan relativas a NOW,
// así los tests no caducan con el calendario.
const NOW = new Date('2026-06-15T12:00:00.000Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const VIDEO_ID = '123e4567-e89b-12d3-a456-426614174000';

/**
 * Transacción Drizzle falsa que expone cada eslabón de las cadenas
 * select().from().where().for().limit() y update().set().where().
 */
function createMockDb(video: { id: string; status: VideoStatusValue } | null) {
  const selectLimit = vi.fn().mockResolvedValue(video ? [video] : []);
  const selectFor = vi.fn().mockReturnValue({ limit: selectLimit });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const tx = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ for: selectFor }),
      }),
    }),
    update,
  };

  const transaction = vi.fn((callback: (t: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );

  return {
    db: { transaction } as unknown as DrizzleDb,
    transaction,
    selectFor,
    update,
    updateSet,
  };
}

function createService(video: { id: string; status: VideoStatusValue } | null) {
  const mocks = createMockDb(video);
  const publish: Mock<MessageBrokerService['publish']> = vi.fn();
  const service = new VideoStateService(mocks.db, {
    publish,
  } as unknown as MessageBrokerService);
  return { service, publish, ...mocks };
}

const validMetadata: MetadataPayload = {
  title: 'Mi video',
  visibility: 'public',
  tags: ['educación'],
};

describe('VideoStateService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  describe('marcarComoListo (borrador → listo)', () => {
    it('actualiza el estado bloqueando la fila y publica metadata.updated', async () => {
      const { service, publish, selectFor, updateSet } = createService({
        id: VIDEO_ID,
        status: 'borrador',
      });

      const result = await service.marcarComoListo(
        VIDEO_ID,
        validMetadata,
        'corr-id',
      );

      expect(result).toEqual({ contentId: VIDEO_ID, status: 'listo' });
      expect(selectFor).toHaveBeenCalledWith('update');
      expect(updateSet).toHaveBeenCalledWith({ status: 'listo' });
      expect(publish).toHaveBeenCalledWith(
        'metadata.updated',
        {
          contentId: VIDEO_ID,
          version: 1,
          title: 'Mi video',
          tags: ['educación'],
          visibility: 'public',
        },
        { correlationId: 'corr-id' },
      );
    });

    it('publica tags vacíos cuando la metadata no trae tags', async () => {
      const { service, publish } = createService({
        id: VIDEO_ID,
        status: 'borrador',
      });

      await service.marcarComoListo(VIDEO_ID, {
        title: 'Sin tags',
        visibility: 'private',
      });

      expect(publish).toHaveBeenCalledWith(
        'metadata.updated',
        expect.objectContaining({ tags: [] }),
        { correlationId: undefined },
      );
    });

    it.each([
      ['null', null],
      ['vacía', {}],
      ['sin visibility', { title: 'x' }],
      ['sin title', { visibility: 'public' }],
      ['con title vacío', { title: '', visibility: 'public' }],
    ])(
      'rechaza metadata %s antes de abrir la transacción',
      async (_caso, metadata) => {
        const { service, transaction, publish } = createService({
          id: VIDEO_ID,
          status: 'borrador',
        });

        await expect(
          service.marcarComoListo(VIDEO_ID, metadata as MetadataPayload),
        ).rejects.toThrow('Metadata incompleta para pasar a estado listo');
        expect(transaction).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      },
    );

    it('responde 404 si el video no existe', async () => {
      const { service, update, publish } = createService(null);

      await expect(
        service.marcarComoListo(VIDEO_ID, validMetadata),
      ).rejects.toThrow(NotFoundException);
      expect(update).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it.each<VideoStatusValue>(['listo', 'programado', 'publicado'])(
      'rechaza la transición desde "%s"',
      async (status) => {
        const { service, update, publish } = createService({
          id: VIDEO_ID,
          status,
        });

        await expect(
          service.marcarComoListo(VIDEO_ID, validMetadata),
        ).rejects.toThrow(
          'Solo se puede marcar como listo un video en borrador',
        );
        expect(update).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      },
    );

    it.todo(
      'persiste la metadata en videos.metadata (hoy solo se publica en el evento)',
    );
    it.todo('rechaza una visibility fuera de los valores permitidos');
  });

  describe('marcarComoProgramado (listo → programado)', () => {
    const tomorrow = () => new Date(NOW.getTime() + ONE_DAY_MS);

    it('programa un video listo con fecha futura, bloqueando la fila', async () => {
      const { service, selectFor, updateSet } = createService({
        id: VIDEO_ID,
        status: 'listo',
      });
      const fecha = tomorrow();

      await service.marcarComoProgramado(VIDEO_ID, fecha);

      expect(selectFor).toHaveBeenCalledWith('update');
      expect(updateSet).toHaveBeenCalledWith({
        status: 'programado',
        scheduled_at: fecha,
      });
    });

    it('rechaza una fecha pasada sin abrir la transacción', async () => {
      const { service, transaction } = createService({
        id: VIDEO_ID,
        status: 'listo',
      });

      await expect(
        service.marcarComoProgramado(VIDEO_ID, new Date(NOW.getTime() - 1)),
      ).rejects.toThrow('La fecha de programación debe ser futura');
      expect(transaction).not.toHaveBeenCalled();
    });

    it.each<VideoStatusValue>(['borrador', 'programado', 'publicado'])(
      'rechaza programar un video en "%s" (por su estado, no por la fecha)',
      async (status) => {
        const { service, update } = createService({ id: VIDEO_ID, status });

        await expect(
          service.marcarComoProgramado(VIDEO_ID, tomorrow()),
        ).rejects.toThrow(
          'Solo se puede programar un video que esté en estado "listo"',
        );
        expect(update).not.toHaveBeenCalled();
      },
    );

    it('responde 404 si el video no existe', async () => {
      const { service, update } = createService(null);

      await expect(
        service.marcarComoProgramado(VIDEO_ID, tomorrow()),
      ).rejects.toThrow(NotFoundException);
      expect(update).not.toHaveBeenCalled();
    });

    it('lanza BadRequest (no NotFound) para fechas pasadas aunque el video no exista', async () => {
      const { service } = createService(null);

      await expect(
        service.marcarComoProgramado(VIDEO_ID, new Date(NOW.getTime() - 1)),
      ).rejects.toThrow(BadRequestException);
    });

    it.todo(
      'rechaza una fecha inválida (new Date("x")) — hoy pasa la validación',
    );
  });
});
