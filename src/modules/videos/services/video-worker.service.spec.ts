import { describe, it, expect, vi, type Mock } from 'vitest';
import { VideoWorkerService } from './video-worker.service.js';
import type { YoutubeService } from '../../../infrastructure/youtube/youtube.service.js';

interface ScheduledVideo {
  id: string;
  status: 'programado';
  youtube_url: string | null;
}

function scheduledVideo(id: string): ScheduledVideo {
  return {
    id,
    status: 'programado',
    youtube_url: `https://youtube.com/watch?v=${id}`,
  };
}

/** BD falsa: select().from().where() devuelve `rows`; update().set().where(). */
function createMockDb(rows: ScheduledVideo[] | Error) {
  const selectWhere =
    rows instanceof Error
      ? vi.fn().mockRejectedValue(rows)
      : vi.fn().mockResolvedValue(rows);
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: selectWhere }),
      }),
      update: vi.fn().mockReturnValue({ set: updateSet }),
    },
    updateSet,
  };
}

function createWorker(
  rows: ScheduledVideo[] | Error,
  verificar: Mock<YoutubeService['verificarDisponibilidad']>,
) {
  const { db, updateSet } = createMockDb(rows);
  const worker = new VideoWorkerService(db, {
    verificarDisponibilidad: verificar,
  });
  return { worker, db, updateSet };
}

const respondWith = (status: number) =>
  vi
    .fn<YoutubeService['verificarDisponibilidad']>()
    .mockResolvedValue({ status });

describe('VideoWorkerService.procesarVideosProgramados (programado → publicado)', () => {
  it('publica el video cuando YouTube confirma disponibilidad (200)', async () => {
    const verificar = respondWith(200);
    const { worker, updateSet } = createWorker(
      [scheduledVideo('v1')],
      verificar,
    );

    await worker.procesarVideosProgramados();

    expect(verificar).toHaveBeenCalledWith('https://youtube.com/watch?v=v1');
    expect(updateSet).toHaveBeenCalledExactlyOnceWith({ status: 'publicado' });
  });

  it.each([401, 404, 500])(
    'no publica si YouTube responde %i',
    async (status) => {
      const { worker, db } = createWorker(
        [scheduledVideo('v1')],
        respondWith(status),
      );

      await worker.procesarVideosProgramados();

      expect(db.update).not.toHaveBeenCalled();
    },
  );

  it('no consulta YouTube si no hay videos pendientes', async () => {
    const verificar = respondWith(200);
    const { worker, db } = createWorker([], verificar);

    await worker.procesarVideosProgramados();

    expect(verificar).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('sigue procesando el resto del lote cuando un video falla por red', async () => {
    const verificar = vi
      .fn<YoutubeService['verificarDisponibilidad']>()
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce(new Error('Timeout de conexión'))
      .mockResolvedValueOnce({ status: 200 });
    const { worker, updateSet } = createWorker(
      [scheduledVideo('v1'), scheduledVideo('v2'), scheduledVideo('v3')],
      verificar,
    );

    await expect(worker.procesarVideosProgramados()).resolves.toBeUndefined();

    expect(verificar).toHaveBeenCalledTimes(3);
    expect(updateSet).toHaveBeenCalledTimes(2);
  });

  it('no propaga errores de la consulta a BD (el cron no debe caerse)', async () => {
    const verificar = respondWith(200);
    const { worker } = createWorker(new Error('conexión perdida'), verificar);

    await expect(worker.procesarVideosProgramados()).resolves.toBeUndefined();
    expect(verificar).not.toHaveBeenCalled();
  });

  it.todo(
    'omite los videos sin youtube_url (hoy ningún flujo lo escribe y se consulta YouTube con null)',
  );
  it.todo(
    'publica solo si el video sigue en "programado" al actualizar (update condicional)',
  );
});
