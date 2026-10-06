import {
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
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

export const TITLE_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const TAGS_MAX_COUNT = 15;
export const TAG_MAX_LENGTH = 50;

export class UpdateMetadataDto {
  @IsString({ message: 'El título debe ser un texto' })
  @IsNotEmpty({ message: 'El título es obligatorio' })
  @Matches(/\S/, { message: 'El título no puede contener solo espacios' })
  @MaxLength(TITLE_MAX_LENGTH, {
    message: `El título no puede exceder los ${TITLE_MAX_LENGTH} caracteres`,
  })
  title: string;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser un texto' })
  @MaxLength(DESCRIPTION_MAX_LENGTH, {
    message: `La descripción no puede exceder los ${DESCRIPTION_MAX_LENGTH} caracteres`,
  })
  description?: string;

  @IsOptional()
  @IsArray({ message: 'Las etiquetas deben enviarse como un arreglo' })
  @ArrayUnique({ message: 'Las etiquetas no pueden repetirse' })
  @ArrayMaxSize(TAGS_MAX_COUNT, {
    message: `No puedes agregar más de ${TAGS_MAX_COUNT} etiquetas`,
  })
  @IsString({ each: true, message: 'Cada etiqueta debe ser un texto' })
  @IsNotEmpty({ each: true, message: 'Las etiquetas no pueden estar vacías' })
  @MaxLength(TAG_MAX_LENGTH, {
    each: true,
    message: `Cada etiqueta no puede exceder los ${TAG_MAX_LENGTH} caracteres`,
  })
  tags?: string[];

  @IsNotEmpty({ message: 'La visibilidad es obligatoria' })
  @IsEnum(VideoVisibility, { message: 'Visibilidad inválida' })
  visibility: VideoVisibility;
}
