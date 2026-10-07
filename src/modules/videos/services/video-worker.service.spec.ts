import { describe, it, expect, vi } from 'vitest';
import type { VideoRow } from '../../../db/schema.js';
import type { MessageBrokerService } from '../../../infrastructure/messaging/message-broker.service.js';
import type { YoutubeService } from '../../../infrastructure/youtube/youtube.service.js';
import type { VideoRepository } from '../repository/video.repository.js';
import {
  EVENTO_VIDEO_PUBLICADO,
  VideoWorkerService,
} from './video-worker.service.js';

function scheduledVideo(
  id: string,
  youtubeUrl: string | null = `https://youtube.com/watch?v=${id}`,
): VideoRow {
  return {
    id,
    status: 'programado',
    scheduled_at: new Date('2026-10-01T10:00:00.000Z'),
    youtube_url: youtubeUrl,
    filename: `${id}.mp4`,
    object_key: `${id}/${id}.mp4`,
    minio_upload_id: `upload-${id}`,
    size_bytes: 1024,
    checksum_sha256: null,
    checksum_declarado: null,
    created_at: new Date('2026-09-01T10:00:00.000Z'),
  };
}

interface Escenario {
  pendientes?: VideoRow[] | Error;
  verificar?: ReturnType<
    typeof vi.fn<YoutubeService['verificarDisponibilidad']>
  >;
  /** Por defecto el CAS devuelve la fila publicada. */
  transicion?: (id: string) => VideoRow | null | Error;
  publicar?: ReturnType<typeof vi.fn<MessageBrokerService['publish']>>;
}

function crearWorker(escenario: Escenario = {}) {
  const pendientes = escenario.pendientes ?? [];
  const buscarProgramadosVencidos = vi.fn<
    VideoRepository['buscarProgramadosVencidos']
  >(() =>
    pendientes instanceof Error
      ? Promise.reject(pendientes)
      : Promise.resolve(pendientes),
  );
  const actualizarEstadoSiCoincide = vi.fn<
    VideoRepository['actualizarEstadoSiCoincide']
  >((id) => {
    const resultado = escenario.transicion
      ? escenario.transicion(id)
      : { ...scheduledVideo(id), status: 'publicado' as const };
    return resultado instanceof Error
      ? Promise.reject(resultado)
      : Promise.resolve(resultado);
  });
  const verificar =
    escenario.verificar ??
    vi
      .fn<YoutubeService['verificarDisponibilidad']>()
      .mockResolvedValue({ status: 200 });
  const publicar =
    escenario.publicar ??
    vi.fn<MessageBrokerService['publish']>().mockResolvedValue({
      id: 'evt',
      type: EVENTO_VIDEO_PUBLICADO,
      version: 1,
      timestamp: new Date().toISOString(),
      correlationId: 'c',
      causationId: 'c',
      source: 'module1-content',
      payload: {},
    });

  const worker = new VideoWorkerService(
    {
      buscarProgramadosVencidos,
      actualizarEstadoSiCoincide,
    } as unknown as VideoRepository,
    { verificarDisponibilidad: verificar } as unknown as YoutubeService,
    { publish: publicar } as unknown as MessageBrokerService,
  );
  return {
    worker,
    buscarProgramadosVencidos,
    actualizarEstadoSiCoincide,
    verificar,
    publicar,
  };
}

const respondWith = (status: number) =>
  vi
    .fn<YoutubeService['verificarDisponibilidad']>()
    .mockResolvedValue({ status });

describe('VideoWorkerService.procesarVideosProgramados (programado → publicado)', () => {
  it('publica con CAS programado→publicado y emite video.published cuando YouTube responde 200', async () => {
    const { worker, verificar, actualizarEstadoSiCoincide, publicar } =
      crearWorker({ pendientes: [scheduledVideo('v1')] });

    await worker.procesarVideosProgramados();

    expect(verificar).toHaveBeenCalledWith('https://youtube.com/watch?v=v1');
    expect(actualizarEstadoSiCoincide).toHaveBeenCalledExactlyOnceWith(
      'v1',
      'programado',
      'publicado',
    );
    expect(publicar).toHaveBeenCalledExactlyOnceWith(
      EVENTO_VIDEO_PUBLICADO,
      expect.objectContaining({
        contentId: 'v1',
        youtubeUrl: 'https://youtube.com/watch?v=v1',
        scheduledAt: '2026-10-01T10:00:00.000Z',
      }),
      { correlationId: expect.any(String) as string },
    );
  });

  it.each([401, 404, 500])(
    'no publica ni emite evento si YouTube responde %i',
    async (status) => {
      const { worker, actualizarEstadoSiCoincide, publicar } = crearWorker({
        pendientes: [scheduledVideo('v1')],
        verificar: respondWith(status),
      });

      await worker.procesarVideosProgramados();

      expect(actualizarEstadoSiCoincide).not.toHaveBeenCalled();
      expect(publicar).not.toHaveBeenCalled();
    },
  );

  it('no consulta YouTube si no hay videos pendientes', async () => {
    const { worker, verificar, actualizarEstadoSiCoincide } = crearWorker();

    await worker.procesarVideosProgramados();

    expect(verificar).not.toHaveBeenCalled();
    expect(actualizarEstadoSiCoincide).not.toHaveBeenCalled();
  });

  it('omite los videos sin youtube_url sin consultar a YouTube', async () => {
    const { worker, verificar, actualizarEstadoSiCoincide } = crearWorker({
      pendientes: [scheduledVideo('v1', null)],
    });

    await worker.procesarVideosProgramados();

    expect(verificar).not.toHaveBeenCalled();
    expect(actualizarEstadoSiCoincide).not.toHaveBeenCalled();
  });

  it('no emite evento si otro proceso ya movió el video (CAS devuelve null)', async () => {
    const { worker, publicar } = crearWorker({
      pendientes: [scheduledVideo('v1')],
      transicion: () => null,
    });

    await worker.procesarVideosProgramados();

    expect(publicar).not.toHaveBeenCalled();
  });

  it('sigue procesando el resto del lote cuando un video falla por red', async () => {
    const verificar = vi
      .fn<YoutubeService['verificarDisponibilidad']>()
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce(new Error('Timeout de conexión'))
      .mockResolvedValueOnce({ status: 200 });
    const { worker, actualizarEstadoSiCoincide, publicar } = crearWorker({
      pendientes: [
        scheduledVideo('v1'),
        scheduledVideo('v2'),
        scheduledVideo('v3'),
      ],
      verificar,
    });

    await expect(worker.procesarVideosProgramados()).resolves.toBeUndefined();

    expect(verificar).toHaveBeenCalledTimes(3);
    expect(actualizarEstadoSiCoincide).toHaveBeenCalledTimes(2);
    expect(publicar).toHaveBeenCalledTimes(2);
  });

  it('un fallo al escribir en BD o al emitir el evento no corta el lote', async () => {
    const publicar = vi
      .fn<MessageBrokerService['publish']>()
      .mockRejectedValueOnce(new Error('consumidor caído'));
    const { worker, actualizarEstadoSiCoincide } = crearWorker({
      pendientes: [scheduledVideo('v1'), scheduledVideo('v2')],
      publicar,
    });

    await expect(worker.procesarVideosProgramados()).resolves.toBeUndefined();

    expect(actualizarEstadoSiCoincide).toHaveBeenCalledTimes(2);
    expect(publicar).toHaveBeenCalledTimes(2);
  });

  it('no propaga errores de la consulta a BD (el cron no debe caerse)', async () => {
    const { worker, verificar } = crearWorker({
      pendientes: new Error('conexión perdida'),
    });

    await expect(worker.procesarVideosProgramados()).resolves.toBeUndefined();
    expect(verificar).not.toHaveBeenCalled();
  });

  it('no solapa ejecuciones: un segundo tick mientras el primero sigue en curso se omite', async () => {
    let liberar!: () => void;
    const bloqueada = new Promise<{ status: number }>((resolve) => {
      liberar = () => resolve({ status: 200 });
    });
    const verificar = vi
      .fn<YoutubeService['verificarDisponibilidad']>()
      .mockReturnValue(bloqueada);
    const { worker, buscarProgramadosVencidos } = crearWorker({
      pendientes: [scheduledVideo('v1')],
      verificar,
    });

    const primero = worker.procesarVideosProgramados();
    await worker.procesarVideosProgramados(); // se omite
    liberar();
    await primero;

    expect(buscarProgramadosVencidos).toHaveBeenCalledTimes(1);

    // Terminado el primero, el siguiente tick vuelve a ejecutarse.
    await worker.procesarVideosProgramados();
    expect(buscarProgramadosVencidos).toHaveBeenCalledTimes(2);
  });
});
