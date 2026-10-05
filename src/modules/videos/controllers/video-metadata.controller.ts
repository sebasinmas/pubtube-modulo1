import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SessionValidator } from '../../../infrastructure/auth/session-validator.interface.js';
import { UpdateMetadataDto } from '../dto/update-metadata.dto.js';
import { VideoMetadataService } from '../services/video-metadata.service.js';

/**
 * Endpoints de lectura y escritura de metadatos versionados (US-A2).
 * La validación de payload (longitudes y campos obligatorios) la realiza el
 * DTO `UpdateMetadataDto` a través del ValidationPipe global de la app.
 */
@Controller('api/content')
export class VideoMetadataController {
  private readonly logger = new Logger(VideoMetadataController.name);

  constructor(
    private readonly videoMetadataService: VideoMetadataService,
    @Inject('SESSION_VALIDATOR')
    private readonly sessionValidator: SessionValidator,
  ) {}

  /** PUT que genera una nueva versión de metadatos y emite metadata.updated. */
  @Put(':contentId/metadata')
  @HttpCode(200)
  async actualizarMetadata(
    @Param('contentId') contentId: string,
    @Body() dto: UpdateMetadataDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    await this.sessionValidator.validar();

    const finalCorrelationId = correlationId || randomUUID();
    this.logger.log(
      `Actualizando metadatos [ContentID: ${contentId}] [CorrelationID: ${finalCorrelationId}]`,
    );

    return this.videoMetadataService.actualizarMetadatos(
      contentId,
      dto,
      finalCorrelationId,
    );
  }

  /** Lee la última versión de metadatos del video. */
  @Get(':contentId/metadata')
  async obtenerMetadata(
    @Param('contentId') contentId: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    this.logger.log(
      `Consultando metadatos [ContentID: ${contentId}] [CorrelationID: ${correlationId || 'N/A'}]`,
    );

    return this.videoMetadataService.obtenerMetadatos(contentId);
  }

  /**
   * Devuelve la versión vigente de metadatos junto con el historial completo
   * de versiones del video (de la más reciente a la más antigua).
   */
  @Get(':contentId')
  async obtenerMetadatosConHistorial(
    @Param('contentId') contentId: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    this.logger.log(
      `Consultando metadatos e historial [ContentID: ${contentId}] [CorrelationID: ${correlationId || 'N/A'}]`,
    );

    return this.videoMetadataService.obtenerMetadatosConHistorial(contentId);
  }

  /** Lee una versión puntual de metadatos del video. */
  @Get(':contentId/metadata/versions/:version')
  async obtenerVersion(
    @Param('contentId') contentId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.videoMetadataService.obtenerVersion(contentId, version);
  }
}
