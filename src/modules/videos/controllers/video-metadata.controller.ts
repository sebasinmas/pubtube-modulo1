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
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SessionValidator } from '../../../infrastructure/auth/session-validator.interface.js';
import type { VideoRow } from '../../../db/schema.js';
import { UpdateMetadataDto } from '../dto/update-metadata.dto.js';
import {
  GetContentQueryDto,
  GetContentResponseDto,
} from '../dto/get-content.dto.js';
import { VideoMetadataService } from '../services/video-metadata.service.js';
import { VideoStateService } from '../services/video-state.service.js';
import { ContentQueryService } from '../services/content-query.service.js';
import { VideoMetadata } from '../video.entity.js';

/**
 * Endpoints de lectura y escritura de metadatos versionados (US-A2) y
 * consulta paginada de catálogo (US-A6).
 */
@Controller('api/content')
export class VideoMetadataController {
  private readonly logger = new Logger(VideoMetadataController.name);

  constructor(
    private readonly videoMetadataService: VideoMetadataService,
    @Inject('SESSION_VALIDATOR')
    private readonly sessionValidator: SessionValidator,
    private readonly videoStateService: VideoStateService,
    private readonly contentQueryService: ContentQueryService,
  ) {}

  /** Consulta paginada y filtrada del catálogo de contenidos (US-A6). */
  @Get()
  async consultarCatalogo(
    @Query() query: GetContentQueryDto,
  ): Promise<GetContentResponseDto<VideoRow>> {
    return this.contentQueryService.obtenerContenidos(query);
  }

  /** Transiciona un video en borrador a listo y persiste metadata inicial. */
  @Post(':contentId/listo')
  @HttpCode(200)
  async marcarComoListo(
    @Param('contentId') contentId: string,
    @Body() dto: UpdateMetadataDto,
    @Headers('x-correlation-id') correlationId?: string,
  ): Promise<{ contentId: string; status: 'listo' }> {
    await this.sessionValidator.validar();

    const finalCorrelationId = correlationId || randomUUID();
    this.logger.log(
      `Marcando como listo [ContentID: ${contentId}] [CorrelationID: ${finalCorrelationId}]`,
    );

    return this.videoStateService.marcarComoListo(
      contentId,
      dto,
      finalCorrelationId,
    );
  }

  /** PUT que genera una nueva versión de metadatos y emite metadata.updated. */
  @Put(':contentId/metadata')
  @HttpCode(200)
  async actualizarMetadata(
    @Param('contentId') contentId: string,
    @Body() dto: UpdateMetadataDto,
    @Headers('x-correlation-id') correlationId?: string,
  ): Promise<{
    status: number;
    contentId: string;
    metadata: VideoMetadata;
  }> {
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
  ): Promise<{
    status: number;
    contentId: string;
    metadata: VideoMetadata | null;
  }> {
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
  ): Promise<{
    status: number;
    contentId: string;
    metadata: VideoMetadata | null;
    historial: VideoMetadata[];
  }> {
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
  ): Promise<{
    status: number;
    contentId: string;
    metadata: VideoMetadata;
  }> {
    return this.videoMetadataService.obtenerVersion(contentId, version);
  }
}
