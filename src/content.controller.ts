import { randomUUID } from 'crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

class UpdateMetadataDto {
  title!: string;
  description?: string;
  tags?: string[];
  visibility?: string;
}

@Controller('api/content')
export class ContentController {
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'file', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ]),
  )
  uploadContent(@UploadedFiles() _files: Express.Multer.File[]) {
    return { status: 'ok', contentId: randomUUID() };
  }

  @Put(':id/metadata')
  @HttpCode(HttpStatus.OK)
  updateMetadata(@Param('id') _id: string, @Body() _body: UpdateMetadataDto) {
    return { status: 'ok', version: 1 };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  listContent(
    @Query('status') _status?: string,
    @Query('page') page = 1,
    @Query('size') _size = 10,
  ) {
    return { status: 'ok', items: [], page: Number(page) };
  }
}
