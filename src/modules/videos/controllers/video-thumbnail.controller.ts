import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { SessionValidator } from '../../../infrastructure/auth/session-validator.interface.js';
import { VideoThumbnailService } from '../services/video-thumbnail.service.js';
import { UploadThumbnailResponseDto } from '../dto/upload-thumbnail.dto.js';

const MAX_THUMBNAIL_SIZE_BYTES = Number(
  process.env.MAX_THUMBNAIL_SIZE_BYTES ?? 2 * 1024 * 1024, // 2MB por defecto
);

@ApiTags('content')
@Controller('api/content')
export class VideoThumbnailController {
  constructor(
    private readonly thumbnailService: VideoThumbnailService,
    @Inject('SESSION_VALIDATOR')
    private readonly sessionValidator: SessionValidator,
  ) {}

  /*
    El límite de tamaño lo aplica multer mientras lee el cuerpo: al excederlo
    Nest responde 413 sin guardar el archivo completo en memoria.
  */
  @Post(':id/thumbnail')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_THUMBNAIL_SIZE_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Imagen jpg o png',
        },
      },
    },
  })
  @ApiOkResponse({ type: UploadThumbnailResponseDto })
  @ApiBadRequestResponse({
    description: 'Falta el archivo (campo "file") o el id no es un UUID',
  })
  @ApiNotFoundResponse({ description: 'El video no existe' })
  @ApiConflictResponse({
    description: 'El video ya está publicado: su miniatura no se puede cambiar',
  })
  @ApiUnsupportedMediaTypeResponse({ description: 'Solo jpg y png' })
  @ApiPayloadTooLargeResponse({
    description: 'La imagen excede MAX_THUMBNAIL_SIZE_BYTES',
  })
  async subirMiniatura(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() archivo: Express.Multer.File | undefined,
  ): Promise<UploadThumbnailResponseDto> {
    await this.sessionValidator.validar();

    if (!archivo) {
      throw new BadRequestException(
        'Falta el archivo de la miniatura (campo "file", multipart/form-data)',
      );
    }

    return this.thumbnailService.subirMiniatura(id, archivo);
  }
}
