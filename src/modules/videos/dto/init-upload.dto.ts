import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InitUploadDto {
  @ApiProperty({ example: 'clase1.mp4' })
  @IsString()
  @IsNotEmpty()
  filename: string;

  @ApiProperty({ enum: ['video/mp4', 'video/quicktime'] })
  @IsString()
  @IsIn(['video/mp4', 'video/quicktime'])
  mimeType: string;

  @ApiProperty({
    description: 'Tamaño del archivo en bytes',
    example: 524288000,
  })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  sizeBytes: number;

  @ApiPropertyOptional({
    description:
      'SHA-256 del archivo completo en hex (64 caracteres), calculado por el cliente. ' +
      'Si ya existe contenido con ese hash se responde 409 sin iniciar la carga; ' +
      'al completar se verifica contra el hash calculado por el servidor (422 si difiere).',
    pattern: '^[0-9a-fA-F]{64}$',
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'checksum debe ser un SHA-256 en hexadecimal (64 caracteres)',
  })
  checksum?: string;
}

export class InitUploadResponseDto {
  @ApiProperty({ example: 201 })
  status: number;

  @ApiProperty({
    description: 'ID de la sesión de carga; coincide con el contentId',
    format: 'uuid',
  })
  uploadSessionId: string;
}
