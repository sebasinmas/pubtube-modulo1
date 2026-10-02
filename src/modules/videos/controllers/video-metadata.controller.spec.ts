import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VideoMetadataController } from './video-metadata.controller.js';
import {
  UpdateMetadataDto,
  VideoVisibility,
} from '../dto/update-metadata.dto.js';

describe('VideoMetadataController', () => {
  let controller: VideoMetadataController;
  let mockMetadataService: any;
  let mockSessionValidator: any;

  beforeEach(() => {
    mockMetadataService = {
      actualizarMetadatos: vi.fn().mockResolvedValue({
        status: 200,
        contentId: 'abc',
        metadata: { id: 'mv-1', version: 2 },
      }),
      obtenerMetadatos: vi.fn().mockResolvedValue({
        status: 200,
        contentId: 'abc',
        metadata: { id: 'mv-1', version: 2 },
      }),
      obtenerMetadatosConHistorial: vi.fn().mockResolvedValue({
        status: 200,
        contentId: 'abc',
        metadata: { id: 'mv-1', version: 2 },
        historial: [{ id: 'mv-1', version: 2 }],
      }),
      obtenerVersion: vi.fn().mockResolvedValue({
        status: 200,
        contentId: 'abc',
        metadata: { id: 'mv-1', version: 1 },
      }),
    };

    mockSessionValidator = {
      validar: vi.fn().mockResolvedValue(true),
    };

    controller = new VideoMetadataController(
      mockMetadataService,
      mockSessionValidator,
    );
  });

  describe('PUT /api/content/:contentId/metadata', () => {
    it('valida sesión, delega en el servicio y preserva el correlationId', async () => {
      const dto: UpdateMetadataDto = {
        title: 'Título nuevo',
        description: 'Descripción',
        tags: ['educación'],
        visibility: VideoVisibility.PUBLIC,
      };

      const result = await controller.actualizarMetadata(
        'abc',
        dto,
        'corr-id-1',
      );

      expect(mockSessionValidator.validar).toHaveBeenCalled();
      expect(mockMetadataService.actualizarMetadatos).toHaveBeenCalledWith(
        'abc',
        dto,
        'corr-id-1',
      );
      expect(result.metadata.version).toBe(2);
    });

    it('genera un correlationId si el header no viene', async () => {
      await controller.actualizarMetadata(
        'abc',
        { title: 'T', visibility: VideoVisibility.PUBLIC },
        undefined,
      );

      expect(mockMetadataService.actualizarMetadatos).toHaveBeenCalledWith(
        'abc',
        expect.objectContaining({ title: 'T' }),
        expect.any(String),
      );
    });
  });

  describe('GET /api/content/:contentId/metadata', () => {
    it('devuelve la última versión de metadatos', async () => {
      const result = await controller.obtenerMetadata('abc', 'corr-id-2');

      expect(mockMetadataService.obtenerMetadatos).toHaveBeenCalledWith('abc');
      expect(result.metadata?.version).toBe(2);
    });
  });

  describe('GET /api/content/:contentId', () => {
    it('devuelve la versión vigente junto con el historial completo', async () => {
      mockMetadataService.obtenerMetadatosConHistorial.mockResolvedValue({
        status: 200,
        contentId: 'abc',
        metadata: { id: 'mv-2', version: 2 },
        historial: [
          { id: 'mv-2', version: 2 },
          { id: 'mv-1', version: 1 },
        ],
      });

      const result = await controller.obtenerMetadatosConHistorial(
        'abc',
        'corr-id-3',
      );

      expect(
        mockMetadataService.obtenerMetadatosConHistorial,
      ).toHaveBeenCalledWith('abc');
      expect(result.metadata?.version).toBe(2);
      expect(result.historial).toHaveLength(2);
      expect(result.historial[0].version).toBe(2);
      expect(result.historial[1].version).toBe(1);
    });

    it('devuelve historial vacío y metadata null si el video no tiene metadatos', async () => {
      mockMetadataService.obtenerMetadatosConHistorial.mockResolvedValue({
        status: 200,
        contentId: 'abc',
        metadata: null,
        historial: [],
      });

      const result = await controller.obtenerMetadatosConHistorial('abc');

      expect(result.metadata).toBeNull();
      expect(result.historial).toEqual([]);
    });
  });

  describe('GET /api/content/:contentId/metadata/versions/:version', () => {
    it('devuelve la versión puntual solicitada', async () => {
      const result = await controller.obtenerVersion('abc', 1);

      expect(mockMetadataService.obtenerVersion).toHaveBeenCalledWith('abc', 1);
      expect(result.metadata.version).toBe(1);
    });
  });
});
