import {
  Controller,
  Post,
  Body,
  BadRequestException,
  HttpCode,
  Logger,
  Headers,
  Get,
  Param,
} from '@nestjs/common';

@Controller('api/content')
export class VideoUploadController {
  private readonly logger = new Logger(VideoUploadController.name);

  constructor(
    private readonly minioService: any,
    private readonly dbService: any,
  ) {}

  @Post('init')
  @HttpCode(201)
  async initUpload(
    @Body() payload: any,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    this.logger.log(
      `Iniciando subida [CorrelationID: ${correlationId || 'N/A'}]`,
    );

    const formatosValidos = ['video/mp4', 'video/quicktime'];

    if (!payload.mimeType || !formatosValidos.includes(payload.mimeType)) {
      throw new BadRequestException(
        'Formato invalido. Solo se permite mp4 y mov',
      );
    }

    const uploadSessionId = await this.minioService.createMultipartUpload(
      payload.filename,
    );

    await this.dbService.crearBorrador({
      filename: payload.filename,
      status: 'borrador',
    });
    this.logger.log(`Borrador creado [SessionID: ${uploadSessionId}]`);
    return {
      status: 201,
      uploadSessionId,
    };
  }

  @Get('upload/:sessionId/status')
  async getUploadStatus(
    @Param('sessionId') sessionId: string,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    this.logger.log(
      `Consultando progreso de sesion: ${sessionId} [CorrelationID: ${correlationId || 'N/A'}]`,
    );

    const parts = await this.minioService.listParts(sessionId);

    return {
      status: 200,
      parts,
    };
  }
}
