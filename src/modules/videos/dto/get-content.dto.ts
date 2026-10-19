import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { VideoStatus } from '../video.entity.js';

export class GetContentQueryDto {
  @ApiPropertyOptional({
    enum: VideoStatus,
    description: 'Filtrar por estado del video',
  })
  @IsOptional()
  @IsEnum(VideoStatus, {
    message: `status debe ser uno de: ${Object.values(VideoStatus).join(', ')}`,
  })
  status?: VideoStatus;

  @ApiPropertyOptional({
    description: 'Número de página (1-based)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Tamaño de la página',
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size: number = 10;
}

export class GetContentResponseDto<T = unknown> {
  @ApiProperty({ description: 'Lista de videos' })
  items: T[];

  @ApiProperty({ description: 'Total de items que cumplen el filtro' })
  totalItems: number;

  @ApiProperty({ description: 'Total de páginas' })
  totalPages: number;

  @ApiProperty({ description: 'Página actual' })
  currentPage: number;

  constructor(init?: Partial<GetContentResponseDto<T>>) {
    this.items = init?.items ?? [];
    this.totalItems = init?.totalItems ?? 0;
    this.totalPages = init?.totalPages ?? 0;
    this.currentPage = init?.currentPage ?? 1;
  }
}
