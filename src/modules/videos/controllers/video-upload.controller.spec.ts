import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VideoUploadController } from './video-upload.controller.js';
import {
  BadRequestException,
  UnsupportedMediaTypeException,
  PayloadTooLargeException,
} from '@nestjs/common';

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
      calcularChecksumSha256: vi.fn().mockResolvedValue('checksum-fake-abc123'),
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
        size_bytes: 10_485_760,
      }),
      marcarComoSubido: vi.fn().mockResolvedValue({
        id: 'uuid-final-1234',
        status: 'borrador',
        size_bytes: 10_485_760,
      }),
    };

    mockBroker = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    mockSessionValidator = {
      validar: vi.fn().mockResolvedValue(true),
    };

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
        size_bytes: 5000,
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
    it('debe rechazar formatos invalidos (.avi) con error 415', async () => {
      const payloadInvalido = {
        filename: 'vacaciones.avi',
        mimeType: 'video/x-msvideo',
        sizeBytes: 1024,
      };

      await expect(
        controller.initUpload(payloadInvalido, 'test-corr-id-123'),
      ).rejects.toThrow(UnsupportedMediaTypeException);

      expect(mockSessionValidator.validar).toHaveBeenCalled();
      expect(mockVideoRepository.crearBorrador).not.toHaveBeenCalled();
    });

    it('debe rechazar un archivo que excede el tamaño máximo con error 413', async () => {
      const payloadEnorme = {
        filename: 'pelicula-completa.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 3 * 1024 * 1024 * 1024,
      };

      await expect(
        controller.initUpload(payloadEnorme, 'test-corr-id-123'),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(mockVideoRepository.crearBorrador).not.toHaveBeenCalled();
    });

    it('debe rechazar si falta declarar sizeBytes', async () => {
      const payloadSinSize = {
        filename: 'tutorial.mp4',
        mimeType: 'video/mp4',
      };

      await expect(
        controller.initUpload(payloadSinSize, 'test-corr-id-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe aceptar formatos validos (.mp4) y crear el borrador', async () => {
      const payloadValido = {
        filename: 'tutorial.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 10_485_760,
      };

      const result = await controller.initUpload(
        payloadValido,
        'test-corr-id-123',
      );

      expect(result.status).toBe(201);
      expect(result.uploadSessionId).toBe('uuid-fixed-1234');

      expect(mockMinio.createMultipartUpload).toHaveBeenCalledWith(
        'uuid-fixed-1234/tutorial.mp4',
      );
      expect(mockVideoRepository.crearBorrador).toHaveBeenCalledWith({
        id: 'uuid-fixed-1234',
        filename: 'tutorial.mp4',
        object_key: 'uuid-fixed-1234/tutorial.mp4',
        minio_upload_id: 'minio-upload-id-777',
        size_bytes: 10_485_760,
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
    it('debe ensamblar en MinIO, calcular checksum, actualizar BD y publicar evento con envelope', async () => {
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
      expect(result.checksumSha256).toBe('checksum-fake-abc123');

      expect(mockMinio.completeMultipartUpload).toHaveBeenCalledWith(
        'videos-upload',
        'sesion-abc-123/video.mp4',
        'minio-upload-id-777',
        [
          { partNumber: 1, etag: '"etag-1"' },
          { partNumber: 2, etag: '"etag-2"' },
        ],
      );
      expect(mockMinio.calcularChecksumSha256).toHaveBeenCalledWith(
        'videos-upload',
        'sesion-abc-123/video.mp4',
      );
      expect(mockVideoRepository.marcarComoSubido).toHaveBeenCalledWith(
        'sesion-abc-123',
        'checksum-fake-abc123',
      );

      expect(mockBroker.publish).toHaveBeenCalledWith(
        'video.uploaded',
        expect.objectContaining({
          contentId: 'uuid-final-1234',
          sessionId: 'sesion-abc-123',
          checksumSha256: 'checksum-fake-abc123',
        }),
        { correlationId: 'test-corr-id-777' },
      );
    });
  });
});
