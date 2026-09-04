import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VideoStateService } from './video-state.service';

describe('VideoStateService - Transición Borrador a Listo', () => {
  let service: VideoStateService;
  let mockDb: any;
  let mockBroker: any;

  beforeEach(() => {
    mockDb = {
      updateEstado: vi.fn().mockResolvedValue(true),
    };
    mockBroker = {
      publish: vi.fn().mockResolvedValue(true),
    };
    
    service = new VideoStateService(mockDb, mockBroker);
  });

  it('Debe fallar si se intenta transicionar sin metadata (Camino Triste)', async () => {
    const videoId = '123e4567-e89b-12d3-a456-426614174000';
    const metadataInvalida = null as any;

    await expect(service.marcarComoListo(videoId, metadataInvalida))
      .rejects.toThrow('Metadata incompleta para pasar a estado listo');
  });

  it('Debe transicionar a "listo" y emitir evento si metadata es válida (Camino Feliz)', async () => {
    const videoId = '123e4567-e89b-12d3-a456-426614174000';
    const metadataValida = { title: 'Mi video', visibility: 'public', tags: ['educación'] }; 

    const result = await service.marcarComoListo(videoId, metadataValida);

    // Validacion cambios de etsado 
    expect(result.status).toBe('listo');
    expect(mockDb.updateEstado).toHaveBeenCalledWith(videoId, 'listo');
    
    // Validacion evento de dominio 
    expect(mockBroker.publish).toHaveBeenCalledWith('metadata.updated', {
      contentId: videoId,
      version: 1,
      title: 'Mi video',
      tags: ['educación'],
      visibility: 'public'
    });
  });
});