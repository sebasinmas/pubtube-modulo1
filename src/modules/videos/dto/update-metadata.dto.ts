import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsEnum,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
} from 'class-validator';

export enum VideoVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
  UNLISTED = 'unlisted',
}

export class UpdateMetadataDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100, { message: 'El título no puede exceder los 100 caracteres' })
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(15, { message: 'No puedes agregar más de 15 etiquetas' })
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsEnum(VideoVisibility, { message: 'Visibilidad inválida' })
  @IsNotEmpty()
  visibility: VideoVisibility;
}
