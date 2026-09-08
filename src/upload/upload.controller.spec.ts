import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { UploadController } from './upload.controller.js';

function createMockMinioService(urlRetorno: string) {
  return {
    getPresignedUrl: vi.fn().mockResolvedValue(urlRetorno),
  };
}

function createMockSessionValidator(sesionExiste: boolean) {
  return {
    verificarSesion: vi.fn().mockResolvedValue(sesionExiste),
  };
}

describe('UploadController - GET /upload/:sessionId/part/:partNumber', () => {
  let controller: UploadController;
  let mockMinioService: any;
  let mockSessionValidator: any;

  const sessionIdValida = 'sess-123';
  const sessionIdInvalida = 'sess-falsa';
  const partNumber = 1;
  const urlEsperada =
    'https://minio.local/bucket/sess-123/part-1?signature=xyz';

  it('debería retornar la URL prefirmada si el sessionId existe', async () => {
    mockMinioService = createMockMinioService(urlEsperada);
    mockSessionValidator = createMockSessionValidator(true);
    controller = new UploadController(mockMinioService, mockSessionValidator);

    const resultado = await controller.getPresignedUrl(
      sessionIdValida,
      partNumber,
    );

    expect(mockSessionValidator.verificarSesion).toHaveBeenCalledWith(
      sessionIdValida,
    );
    expect(mockMinioService.getPresignedUrl).toHaveBeenCalled();
    expect(resultado).toEqual({ url: urlEsperada });
  });

  it('debería arrojar NotFoundException si el sessionId no existe', async () => {
    mockMinioService = createMockMinioService(urlEsperada);
    mockSessionValidator = createMockSessionValidator(false);
    controller = new UploadController(mockMinioService, mockSessionValidator);

    await expect(
      controller.getPresignedUrl(sessionIdInvalida, partNumber),
    ).rejects.toThrow(NotFoundException);

    expect(mockSessionValidator.verificarSesion).toHaveBeenCalledWith(
      sessionIdInvalida,
    );
    expect(mockMinioService.getPresignedUrl).not.toHaveBeenCalled();
  });
});
