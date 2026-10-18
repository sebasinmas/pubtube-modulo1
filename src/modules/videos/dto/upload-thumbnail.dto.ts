import { ApiProperty } from '@nestjs/swagger';

export class UploadThumbnailResponseDto {
  @ApiProperty({ description: 'ID del video', format: 'uuid' })
  contentId: string;

  @ApiProperty({
    description: 'Ubicación persistente de la miniatura en el storage',
    example:
      's3://thumbnails/123e4567-e89b-12d3-a456-426614174000/thumbnail.png',
  })
  thumbnailUrl: string;
}
