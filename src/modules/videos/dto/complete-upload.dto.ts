import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UploadedPartDto {
  @ApiProperty({ minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  @Type(() => Number)
  PartNumber: number;

  @ApiProperty({
    description: 'ETag devuelto por el storage al subir la parte',
  })
  @IsString()
  @IsNotEmpty()
  ETag: string;
}

export class CompleteUploadDto {
  @ApiProperty({ type: [UploadedPartDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UploadedPartDto)
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
