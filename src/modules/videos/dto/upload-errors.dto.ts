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
