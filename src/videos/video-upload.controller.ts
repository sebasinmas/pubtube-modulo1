import { Controller, Post, Body, BadRequestException, HttpCode } from '@nestjs/common';

@Controller('api/content') 
export class VideoUploadController {
  
  constructor(
    private readonly minioService: any,
    private readonly dbService: any,
  ) {}

  @Post('init')
  @HttpCode(201)
  async initUpload(@Body() payload: any) {

    const formatosValidos = ['video/mp4', 'video/quicktime'];
    
    if (!payload.mimeType || !formatosValidos.includes(payload.mimeType)) {
      throw new BadRequestException('Formato invalido. Solo se permite mp4 y mov');
    }

    const uploadSessionId = await this.minioService.createMultipartUpload(payload.filename);

    await this.dbService.crearBorrador({
      filename: payload.filename,
      status: 'borrador' 
    });

    return {
      status: 201,
      uploadSessionId,
    };
  }
}