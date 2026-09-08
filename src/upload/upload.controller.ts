import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Inject,
  ParseIntPipe,
} from '@nestjs/common';
import { MinioService } from '../minio/minio.service.js';

@Controller('upload')
export class UploadController {
  constructor(
    private readonly minioService: MinioService,
    @Inject('SESSION_VALIDATOR') private readonly sessionValidator: any,
  ) {}

  @Get(':sessionId/part/:partNumber')
  async getPresignedUrl(
    @Param('sessionId') sessionId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
  ) {
    const sesionExiste = await this.sessionValidator.verificarSesion(sessionId);

    if (!sesionExiste) {
      throw new NotFoundException(
        `La sesión de subida con ID ${sessionId} no existe`,
      );
    }

    const bucketName = 'videos-upload';
    const objectName = `${sessionId}/part-${partNumber}`;
    const url = await this.minioService.getPresignedUrl(bucketName, objectName);

    return { url };
  }
}
