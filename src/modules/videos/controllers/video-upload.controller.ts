import {
  Controller,
  Post,
  Body,
  BadRequestException,
  NotFoundException,
  UnsupportedMediaTypeException,
  PayloadTooLargeException,
  HttpCode,
  Logger,
  Headers,
  Get,
  Param,
  Inject,
  ParseIntPipe,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { Part } from '@aws-sdk/client-s3';
import { MinioService } from '../../../infrastructure/minio/minio.service.js';
import { MessageBrokerService } from '../../../infrastructure/messaging/message-broker.service.js';
import { VideoRepository } from '../repository/video.repository.js';
import type { SessionValidator } from '../../../infrastructure/auth/session-validator.interface.js';
import type { VideoRow } from '../../../db/schema.js';
import { ChecksumDuplicadoError } from '../video.errors.js';
import {
  InitUploadDto,
  InitUploadResponseDto,
} from '../dto/init-upload.dto.js';
import {
  CompleteUploadDto,
  CompleteUploadResponseDto,
} from '../dto/complete-upload.dto.js';
import {
  DuplicateContentErrorDto,
  IntegrityCheckFailedErrorDto,
} from '../dto/upload-errors.dto.js';

const MAX_UPLOAD_SIZE_BYTES = Number(
  process.env.MAX_UPLOAD_SIZE_BYTES ?? 2 * 1024 * 1024 * 1024, // 2GB por defecto
);

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/*
  Normaliza el checksum declarado por el cliente (opcional en init).
  Devuelve null si no viene; lanza 400 si viene con formato inválido.
*/
function normalizarChecksumDeclarado(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string' || !SHA256_HEX.test(valor)) {
    throw new BadRequestException(
      'checksum debe ser un SHA-256 en hexadecimal (64 caracteres)',
    );
  }
  return valor.toLowerCase();
}

function contenidoDuplicado(existingContentId: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'DUPLICATE_CONTENT',
    message: 'Ya existe contenido con el mismo checksum',
    existingContentId,
  });
}

@ApiTags('content')
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
  @ApiCreatedResponse({ type: InitUploadResponseDto })
  @ApiBadRequestResponse({
    description: 'Falta filename/sizeBytes o checksum con formato inválido',
  })
  @ApiConflictResponse({
    description: 'Ya existe contenido con el checksum declarado (US-A5)',
    type: DuplicateContentErrorDto,
  })
  @ApiUnsupportedMediaTypeResponse({ description: 'Solo mp4 y mov' })
  @ApiPayloadTooLargeResponse({ description: 'sizeBytes excede el máximo' })
  async initUpload(
    @Body() payload: InitUploadDto,
    @Headers('x-correlation-id') correlationId: string,
  ): Promise<{ status: number; uploadSessionId: string }> {
    await this.sessionValidator.validar();

    const finalCorrelationId = correlationId || randomUUID();
    this.logger.log(`Iniciando subida [CorrelationID: ${finalCorrelationId}]`);

    const formatosValidos = ['video/mp4', 'video/quicktime'];

    if (!payload.mimeType || !formatosValidos.includes(payload.mimeType)) {
      throw new UnsupportedMediaTypeException(
        'Formato invalido. Solo se permite mp4 y mov',
      );
    }
    if (!payload.filename) {
      throw new BadRequestException('Falta el nombre del archivo (filename)');
    }
    if (!Number.isFinite(payload.sizeBytes) || payload.sizeBytes <= 0) {
      throw new BadRequestException(
        'Falta declarar el tamaño del archivo (sizeBytes), en bytes',
      );
    }
    if (payload.sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
      throw new PayloadTooLargeException(
        `El archivo excede el tamaño máximo permitido (${MAX_UPLOAD_SIZE_BYTES} bytes)`,
      );
    }

    // US-A5: rechazo temprano, antes de reservar el multipart en el storage.
    const checksumDeclarado = normalizarChecksumDeclarado(payload.checksum);
    if (checksumDeclarado) {
      const existente =
        await this.videoRepository.buscarPorChecksum(checksumDeclarado);
      if (existente) {
        this.logger.warn(
          `Carga duplicada rechazada [ExistingContentID: ${existente.id}] [CorrelationID: ${finalCorrelationId}]`,
        );
        throw contenidoDuplicado(existente.id);
      }
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
      size_bytes: payload.sizeBytes,
      checksum_declarado: checksumDeclarado,
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
  ): Promise<{ url: string }> {
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
  ): Promise<{ status: number; parts: Part[] }> {
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
  @ApiOkResponse({ type: CompleteUploadResponseDto })
  @ApiNotFoundResponse({ description: 'Sesión de subida no encontrada' })
  @ApiConflictResponse({
    description:
      'Otro contenido con el mismo checksum se completó antes (carga concurrente). ' +
      'El objeto y la sesión duplicados se eliminan.',
    type: DuplicateContentErrorDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'El SHA-256 calculado no coincide con el checksum declarado. ' +
      'El objeto y la sesión se eliminan.',
    type: IntegrityCheckFailedErrorDto,
  })
  async completeUpload(
    @Param('sessionId') sessionId: string,
    @Body() payload: CompleteUploadDto,
    @Headers('x-correlation-id') correlationId: string,
  ): Promise<{
    status: number;
    contentId: string;
    checksumSha256: string;
  }> {
    const finalCorrelationId = correlationId || randomUUID();
    this.logger.log(
      `Iniciando ensamblaje de chunks [SessionID: ${sessionId}] [CorrelationID: ${finalCorrelationId}]`,
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

    // Hash del objeto completo leído por stream. No se usa el ETag: en
    // multipart no es el hash del archivo.
    const checksumSha256 = await this.minioService.calcularChecksumSha256(
      this.bucketName,
      video.object_key,
    );

    if (
      video.checksum_declarado &&
      checksumSha256 !== video.checksum_declarado
    ) {
      this.logger.warn(
        `Integridad fallida [SessionID: ${sessionId}] [CorrelationID: ${finalCorrelationId}]`,
      );
      await this.descartarCarga(video);
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'INTEGRITY_CHECK_FAILED',
        message:
          'El SHA-256 del archivo recibido no coincide con el checksum declarado',
        expected: video.checksum_declarado,
        actual: checksumSha256,
      });
    }

    let videoActualizado: VideoRow | null;
    try {
      videoActualizado = await this.videoRepository.marcarComoSubido(
        sessionId,
        checksumSha256,
      );
    } catch (error) {
      if (!(error instanceof ChecksumDuplicadoError)) throw error;
      // Carrera: otra carga del mismo archivo se completó primero y el
      // índice único rechazó esta.
      this.logger.warn(
        `Carga duplicada al completar [SessionID: ${sessionId}] [ExistingContentID: ${error.existingContentId}] [CorrelationID: ${finalCorrelationId}]`,
      );
      await this.descartarCarga(video);
      throw contenidoDuplicado(error.existingContentId);
    }
    if (!videoActualizado) {
      throw new NotFoundException('Sesión de subida no encontrada');
    }

    await this.broker.publish(
      'video.uploaded',
      {
        // Campos del contrato docs/contratos/video.uploaded.schema.json (v1).
        contentId: videoActualizado.id,
        checksum: checksumSha256,
        storageUrl: this.minioService.obtenerStorageUrl(
          this.bucketName,
          videoActualizado.object_key,
        ),
        // Campos previos al contrato, conservados por compatibilidad: el
        // esquema v1 admite propiedades adicionales.
        sessionId,
        sizeBytes: videoActualizado.size_bytes,
        checksumSha256,
        uploadedAt: new Date().toISOString(),
      },
      { correlationId: finalCorrelationId },
    );
    this.logger.log(`Ensamblaje exitoso. [ContentID: ${videoActualizado.id}]`);

    return {
      status: 200,
      contentId: videoActualizado.id,
      checksumSha256,
    };
  }

  /*
    Elimina el objeto ensamblado y la sesión (fila en borrador) de una carga
    rechazada, para no dejar huérfanos. Un fallo aquí se loguea pero no oculta
    el error original de la carga.
  */
  private async descartarCarga(video: VideoRow): Promise<void> {
    try {
      await this.minioService.eliminarObjeto(this.bucketName, video.object_key);
    } catch (error) {
      this.logger.error(
        `No se pudo eliminar el objeto huérfano ${video.object_key}`,
        error,
      );
    }
    try {
      await this.videoRepository.eliminar(video.id);
    } catch (error) {
      this.logger.error(`No se pudo eliminar la sesión ${video.id}`, error);
    }
  }
}
