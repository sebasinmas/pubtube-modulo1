import {
  Controller,
  Post,
  Body,
  BadRequestException,
  NotFoundException,
  HttpCode,
  Logger,
  Headers,
  Get,
  Param,
  Inject,
  ParseIntPipe,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MinioService } from '../../../infrastructure/minio/minio.service.js';
import { MessageBrokerService } from '../../../infrastructure/messaging/message-broker.service.js';
import { VideoRepository } from '../repository/video.repository.js';
import type { SessionValidator } from '../../../infrastructure/auth/session-validator.interface.js';

@Controller('api/content')
export class VideoUploadController {
  private readonly logger = new Logger(VideoUploadController.name);
  private readonly bucketName =
    process.env.MINIO_BUCKET_CONTENT ?? 'videos-upload';

  constructor(
    private readonly minioService: MinioService,
    private readonly videoRepository: VideoRepository,
    @Inject('MESSAGE_BROKER') private readonly broker: MessageBrokerService,
    @Inject('SESSION_VALIDATOR')
    private readonly sessionValidator: SessionValidator,
  ) {}

  @Post('init')
  @HttpCode(201)
  async initUpload(
    @Body() payload: any,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    // Delegado al API Gateway: no se inspecciona ningún token acá.
    await this.sessionValidator.validar();

    this.logger.log(
      `Iniciando subida [CorrelationID: ${correlationId || 'N/A'}]`,
    );

    const formatosValidos = ['video/mp4', 'video/quicktime'];

    if (!payload.mimeType || !formatosValidos.includes(payload.mimeType)) {
      throw new BadRequestException(
        'Formato invalido. Solo se permite mp4 y mov',
      );
    }
    if (!payload.filename) {
      throw new BadRequestException('Falta el nombre del archivo (filename)');
    }

    const videoId = randomUUID();
    const objectKey = `${videoId}/${payload.filename}`;
    const minioUploadId =
      await this.minioService.createMultipartUpload(objectKey);

    await this.videoRepository.crearBorrador({
      id: videoId,
      filename: payload.filename,
      object_key: objectKey,
      minio_upload_id: minioUploadId,
    });

    this.logger.log(
      `Borrador creado [VideoID: ${videoId}] [MinioUploadID: ${minioUploadId}]`,
    );
    return {
      status: 201,
      uploadSessionId: videoId,
    };
  }

  @Get(':sessionId/part/:partNumber')
  async getPresignedUrl(
    @Param('sessionId') sessionId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
  ) {
    const video = await this.videoRepository.buscarPorId(sessionId);
    if (!video) throw new NotFoundException('Sesión de subida no encontrada');

    const url = await this.minioService.getPresignedUrl(
      this.bucketName,
      video.object_key,
      video.minio_upload_id,
      partNumber,
    );

    return { url };
  }

  @Get('upload/:sessionId/status')
  async getUploadStatus(
    @Param('sessionId') sessionId: string,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    this.logger.log(
      `Consultando progreso de sesion: ${sessionId} [CorrelationID: ${correlationId || 'N/A'}]`,
    );

    const video = await this.videoRepository.buscarPorId(sessionId);
    if (!video) throw new NotFoundException('Sesión de subida no encontrada');

    const parts = await this.minioService.listParts(
      this.bucketName,
      video.object_key,
      video.minio_upload_id,
    );

    return {
      status: 200,
      parts,
    };
  }

  @Post('upload/:sessionId/complete')
  @HttpCode(200)
  async completeUpload(
    @Param('sessionId') sessionId: string,
    @Body() payload: { parts: { PartNumber: number; ETag: string }[] },
    @Headers('x-correlation-id') correlationId: string,
  ) {
    this.logger.log(
      `Iniciando ensamblaje de chunks [SessionID: ${sessionId}] [CorrelationID: ${correlationId || 'N/A'}]`,
    );

    const video = await this.videoRepository.buscarPorId(sessionId);
    if (!video) throw new NotFoundException('Sesión de subida no encontrada');

    const partesFormateadas = payload.parts.map((p) => ({
      partNumber: p.PartNumber,
      etag: p.ETag,
    }));

    await this.minioService.completeMultipartUpload(
      this.bucketName,
      video.object_key,
      video.minio_upload_id,
      partesFormateadas,
    );

    const videoActualizado =
      await this.videoRepository.marcarComoSubido(sessionId);
    if (!videoActualizado) {
      throw new NotFoundException('Sesión de subida no encontrada');
    }

    await this.broker.publish('video.uploaded', {
      contentId: videoActualizado.id,
      sessionId,
      uploadedAt: new Date().toISOString(),
    });
    this.logger.log(`Ensamblaje exitoso. [ContentID: ${videoActualizado.id}]`);

    return {
      status: 200,
      contentId: videoActualizado.id,
    };
  }
}
