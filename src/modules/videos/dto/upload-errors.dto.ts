import { ApiProperty } from '@nestjs/swagger';

export class DuplicateContentErrorDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({ example: 'DUPLICATE_CONTENT' })
  error: 'DUPLICATE_CONTENT';

  @ApiProperty()
  message: string;

  @ApiProperty({
    description: 'ID del contenido que ya tiene ese checksum',
    format: 'uuid',
  })
  existingContentId: string;
}

export class IntegrityCheckFailedErrorDto {
  @ApiProperty({ example: 422 })
  statusCode: number;

  @ApiProperty({ example: 'INTEGRITY_CHECK_FAILED' })
  error: 'INTEGRITY_CHECK_FAILED';

  @ApiProperty()
  message: string;

  @ApiProperty({ description: 'Checksum declarado por el cliente en init' })
  expected: string;

  @ApiProperty({ description: 'Checksum calculado por el servidor' })
  actual: string;
}

export class SizeMismatchErrorDto {
  @ApiProperty({ example: 422 })
  statusCode: number;

  @ApiProperty({ example: 'SIZE_MISMATCH' })
  error: 'SIZE_MISMATCH';

  @ApiProperty()
  message: string;

  @ApiProperty({ description: 'sizeBytes declarado en init' })
  expected: number;

  @ApiProperty({ description: 'Tamaño real del objeto ensamblado' })
  actual: number;
}

export class UploadSessionExpiredErrorDto {
  @ApiProperty({ example: 410 })
  statusCode: number;

  @ApiProperty({ example: 'UPLOAD_SESSION_EXPIRED' })
  error: 'UPLOAD_SESSION_EXPIRED';

  @ApiProperty()
  message: string;
}
