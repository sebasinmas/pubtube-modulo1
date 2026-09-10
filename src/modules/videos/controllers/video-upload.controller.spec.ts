import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VideoUploadController } from './video-upload.controller.js';
import { BadRequestException } from '@nestjs/common';

vi.mock('node:crypto', () => ({
  randomUUID: () => 'uuid-fixed-1234',
}));

describe('VideoUploadController', () => {
  let controller: VideoUploadController;
  let mockMinio: any;
  let mockVideoRepository: any;
  let mockBroker: any;
  let mockSessionValidator: any;

  beforeEach(() => {
    mockMinio = {
      getPresignedUrl: vi
        .fn()
        .mockResolvedValue(
          'https://minio.local/bucket/sess-123/part-1?signature=xyz',
        ),
      createMultipartUpload: vi.fn().mockResolvedValue('minio-upload-id-777'),
      listParts: vi.fn().mockResolvedValue([]),
      completeMultipartUpload: vi.fn().mockResolvedValue(true),
    };

    mockVideoRepository = {
      crearBorrador: vi.fn().mockResolvedValue({
        id: 'uuid-fixed-1234',
        status: 'borrador',
      }),
      buscarPorId: vi.fn().mockResolvedValue({
        id: 'sesion-abc-123',
        object_key: 'sesion-abc-123/video.mp4',
        minio_upload_id: 'minio-upload-id-777',
        status: 'borrador',
      }),
      marcarComoSubido: vi.fn().mockResolvedValue({
        id: 'uuid-final-1234',
        status: 'borrador',
      }),
    };

    mockBroker = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    mockSessionValidator = {
      validar: vi.fn().mockResolvedValue(true),
    };

    // Orden real del constructor: minioService, videoRepository, broker (MESSAGE_BROKER), sessionValidator (SESSION_VALIDATOR)
    controller = new VideoUploadController(
      mockMinio,
      mockVideoRepository,
      mockBroker,
      mockSessionValidator,
    );
  });

  describe('GET /upload/:sessionId/part/:partNumber', () => {
    it('debería retornar la URL prefirmada llamando a MinIO', async () => {
      const sessionId = 'sess-123';
      const partNumber = 1;

      mockVideoRepository.buscarPorId.mockResolvedValueOnce({
        id: sessionId,
        object_key: 'sess-123/part-1',
        minio_upload_id: 'minio-upload-id-777',
        status: 'borrador',
      });

      const resultado = await controller.getPresignedUrl(sessionId, partNumber);

      expect(mockVideoRepository.buscarPorId).toHaveBeenCalledWith(sessionId);
      expect(mockMinio.getPresignedUrl).toHaveBeenCalledWith(
        'videos-upload',
        'sess-123/part-1',
        'minio-upload-id-777',
        1,
      );
      expect(resultado).toEqual({
        url: 'https://minio.local/bucket/sess-123/part-1?signature=xyz',
      });
    });
  });

  describe('POST /init (Inicializacion de subida)', () => {
    it('debe rechazar formatos invalidos (.avi) con error 400', async () => {
      const payloadInvalido = {
        filename: 'vacaciones.avi',
        mimeType: 'video/x-msvideo',
      };

      await expect(
        controller.initUpload(payloadInvalido, 'test-corr-id-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockSessionValidator.validar).toHaveBeenCalled();
      expect(mockVideoRepository.crearBorrador).not.toHaveBeenCalled();
    });

    it('debe aceptar formatos validos (.mp4) y crear el borrador', async () => {
      const payloadValido = { filename: 'tutorial.mp4', mimeType: 'video/mp4' };

      const result = await controller.initUpload(
        payloadValido,
        'test-corr-id-123',
      );

      expect(result.status).toBe(201);
      // uploadSessionId ahora es el id de negocio (randomUUID mockeado),
      // no el uploadId crudo de Minio -- ver nota al inicio de la respuesta.
      expect(result.uploadSessionId).toBe('uuid-fixed-1234');

      expect(mockMinio.createMultipartUpload).toHaveBeenCalledWith(
        'uuid-fixed-1234/tutorial.mp4',
      );
      expect(mockVideoRepository.crearBorrador).toHaveBeenCalledWith({
        id: 'uuid-fixed-1234',
        filename: 'tutorial.mp4',
        object_key: 'uuid-fixed-1234/tutorial.mp4',
        minio_upload_id: 'minio-upload-id-777',
      });
    });
  });

  describe('GET /upload/:sessionId/status (Consulta de progreso)', () => {
    it('debe retornar la lista de partes completadas', async () => {
      mockMinio.listParts.mockResolvedValue([
        { PartNumber: 1, ETag: '"etag-1"', Size: 5242880 },
        { PartNumber: 2, ETag: '"etag-2"', Size: 5242880 },
        { PartNumber: 3, ETag: '"etag-3"', Size: 2500000 },
      ]);

      const result = await controller.getUploadStatus(
        'sesion-abc-123',
        'corr-id-999',
      );

      expect(result.status).toBe(200);
      expect(result.parts.length).toBe(3);
      expect(result.parts[0].PartNumber).toBe(1);
      expect(mockVideoRepository.buscarPorId).toHaveBeenCalledWith(
        'sesion-abc-123',
      );
      expect(mockMinio.listParts).toHaveBeenCalledWith(
        'videos-upload',
        'sesion-abc-123/video.mp4',
        'minio-upload-id-777',
      );
    });
  });

  describe('POST /upload/:sessionId/complete (Ensamblaje)', () => {
    it('debe ensamblar en MinIO, actualizar BD y publicar evento', async () => {
      const payloadFinal = {
        parts: [
          { PartNumber: 1, ETag: '"etag-1"' },
          { PartNumber: 2, ETag: '"etag-2"' },
        ],
      };

      const result = await controller.completeUpload(
        'sesion-abc-123',
        payloadFinal,
        'test-corr-id-777',
      );

      expect(result.status).toBe(200);
      expect(result.contentId).toBe('uuid-final-1234');

      expect(mockMinio.completeMultipartUpload).toHaveBeenCalledWith(
        'videos-upload',
        'sesion-abc-123/video.mp4',
        'minio-upload-id-777',
        [
          { partNumber: 1, etag: '"etag-1"' },
          { partNumber: 2, etag: '"etag-2"' },
        ],
      );
      expect(mockVideoRepository.marcarComoSubido).toHaveBeenCalledWith(
        'sesion-abc-123',
      );

      expect(mockBroker.publish).toHaveBeenCalledWith(
        'video.uploaded',
        expect.objectContaining({
          contentId: 'uuid-final-1234',
          sessionId: 'sesion-abc-123',
        }),
      );
    });
  });
});
