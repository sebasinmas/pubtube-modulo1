import { ApiProperty } from '@nestjs/swagger';

export class UploadedPartDto {
  @ApiProperty({ minimum: 1, maximum: 10000 })
  PartNumber: number;

  @ApiProperty({
    description: 'ETag devuelto por el storage al subir la parte',
  })
  ETag: string;
}

export class CompleteUploadDto {
  @ApiProperty({ type: [UploadedPartDto] })
  parts: UploadedPartDto[];
}

export class CompleteUploadResponseDto {
  @ApiProperty({ example: 200 })
  status: number;

  @ApiProperty({ format: 'uuid' })
  contentId: string;

  @ApiProperty({
    description: 'SHA-256 del objeto completo calculado por el servidor',
  })
  checksumSha256: string;
}
