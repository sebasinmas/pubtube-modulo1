import { Controller, Post, Body, BadRequestException } from '@nestjs/common';


@Controller('api/content') 
export class VideoUploadController {
  
 
  constructor(
    private readonly minioService: any,
    private readonly dbService: any,
  ) {}

  @Post('init')
  async initUpload(@Body() payload: any) {
   

    return {
      status: 201,
      uploadSessionId: '',
    };
  }
}