import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VideoUploadController } from './video-upload.controller.js';
import { BadRequestException } from '@nestjs/common';

describe('VideoUploadController - Inicializacion de subida', () => {
  let controller: VideoUploadController;
  let mockMinio: any;
  let mockDb: any;

  beforeEach(() => {
    mockMinio = {
      createMultipartUpload: vi.fn().mockResolvedValue('minio-session-id-777'),
    };

    mockDb = {
      crearBorrador: vi
        .fn()
        .mockResolvedValue({ contentId: 'uuid-1234', status: 'borrador' }),
    };

    controller = new VideoUploadController(mockMinio, mockDb);
  });

  it('debe rechazar formatos invalidos (.avi) con error 400', async () => {
    const payloadInvalido = {
      filename: 'vacaciones.avi',
      mimeType: 'video/x-msvideo',
    };

    await expect(
      controller.initUpload(payloadInvalido, 'test-corr-id-123'),
    ).rejects.toThrow(BadRequestException);
  });

  it('debe aceptar formatos validos (.mp4) y crear el borrador', async () => {
    const payloadValido = { filename: 'tutorial.mp4', mimeType: 'video/mp4' };

    const result = await controller.initUpload(
      payloadValido,
      'test-corr-id-123',
    );

    // revisa que retorne 201 y el id
    expect(result.status).toBe(201);
    expect(result.uploadSessionId).toBe('minio-session-id-777');

    // revisa que guarde en bd como borrador
    expect(mockDb.crearBorrador).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'borrador' }),
    );
  });

  describe('Consulta de progreso de subida', () => {
    it('debe retornar la lista de partes completadas (3 partes)', async () => {
      mockMinio.listParts = vi.fn().mockResolvedValue([
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

      expect(mockMinio.listParts).toHaveBeenCalledWith('sesion-abc-123');
    });
  });

  describe('Finalizacion de subida (Ensamblaje)', () => {
    it('debe ensamblar en MinIO, actualizar Drizzle y mantener estado borrador', async () => {
      mockMinio.completeMultipartUpload = vi.fn().mockResolvedValue(true);
      mockDb.actualizarVideo = vi.fn().mockResolvedValue({
        contentId: 'uuid-final-1234',
        status: 'borrador',
      });

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
        'sesion-abc-123',
        payloadFinal.parts,
      );

      expect(mockDb.actualizarVideo).toHaveBeenCalledWith(
        'sesion-abc-123',
        expect.objectContaining({ status: 'borrador' }),
      );
    });
  });
});
