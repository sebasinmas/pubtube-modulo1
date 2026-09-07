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
      crearBorrador: vi.fn().mockResolvedValue({ contentId: 'uuid-1234', status: 'borrador' }),
    };

    controller = new VideoUploadController(mockMinio, mockDb);
  });

  it('debe rechazar formatos invalidos (.avi) con error 400', async () => {
    const payloadInvalido = { filename: 'vacaciones.avi', mimeType: 'video/x-msvideo' };

    await expect(controller.initUpload(payloadInvalido))
      .rejects.toThrow(BadRequestException);
  });

  it('debe aceptar formatos validos (.mp4) y crear el borrador', async () => {
    const payloadValido = { filename: 'tutorial.mp4', mimeType: 'video/mp4' };

    const result = await controller.initUpload(payloadValido);

    // revisa que retorne 201 y el id
    expect(result.status).toBe(201);
    expect(result.uploadSessionId).toBe('minio-session-id-777');

    // revisa que guarde en bd como borrador
    expect(mockDb.crearBorrador).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'borrador' })
    );
  });
});