import {describe, it, expect, vi} from 'vitest';
import { VideoWorkerService } from './video-worker.service.js';

function createMockDb(videosEncontrados: any[]) {
  const mockUpdateChain = {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(true),
    }),
  };

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(videosEncontrados), 
      }),
    }),
    update: vi.fn().mockReturnValue(mockUpdateChain),
  };
}

function createMockYoutubeService(statusCode: number) {
  return {
    verificarDisponibilidad: vi.fn().mockResolvedValue({ status: statusCode }),
  };
}

describe('VideoWorkerService - Transición Programado -> Publicado', () => {

  it('debería actualizar el estado a "publicado" si YouTube devuelve 200', async () => {
    const videosProgramados = [{ id: 'vid-123', status: 'programado', youtube_url: 'https://youtube.com/watch?v=123' }];
    const mockDb = createMockDb(videosProgramados);
    const mockYoutube = createMockYoutubeService(200); 
    
    const worker = new VideoWorkerService(mockDb as any, mockYoutube as any);
    await worker.procesarVideosProgramados();

    expect(mockYoutube.verificarDisponibilidad).toHaveBeenCalledWith('https://youtube.com/watch?v=123');
    expect(mockDb.update).toHaveBeenCalled();
    const updateChain = mockDb.update();
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'publicado' }));
  });

  it('no debería actualizar el estado si YouTube devuelve un error 404 (no encontrado)', async () => {
    const videosProgramados = [{ 
        id: 'vid-456', 
        status: 'programado', 
        youtube_url: 'https://youtube.com/watch?v=456' 
    }];
    const mockDb = createMockDb(videosProgramados);
    const mockYoutube = createMockYoutubeService(404);
    const worker = new VideoWorkerService(mockDb as any, mockYoutube as any);
    await worker.procesarVideosProgramados();

    expect(mockYoutube.verificarDisponibilidad).toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('no debería llamar a la API de YouTube si no hay videos programados', async () => {
    const mockDb = createMockDb([]); 
    const mockYoutube = createMockYoutubeService(200);
    const worker = new VideoWorkerService(mockDb as any, mockYoutube as any);
    await worker.procesarVideosProgramados();

    expect(mockYoutube.verificarDisponibilidad).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('debería manejar errores de red de la API de YouTube sin colapsar', async () => {
    const videosProgramados = [{ 
        id: 'vid-789', 
        status: 'programado', 
        youtube_url: 'https://youtube.com/watch?v=789' 
    }];
    const mockDb = createMockDb(videosProgramados);
    const mockYoutubeFalla = {
      verificarDisponibilidad: vi.fn().mockRejectedValue(new Error('Timeout de conexión')),
    };
    const worker = new VideoWorkerService(mockDb as any, mockYoutubeFalla as any);
    
    await expect(worker.procesarVideosProgramados()).resolves.not.toThrow();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

});