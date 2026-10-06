import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  UpdateMetadataDto,
  VideoVisibility,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  TAGS_MAX_COUNT,
  TAG_MAX_LENGTH,
} from './update-metadata.dto.js';

const base = { title: 'Mi video', visibility: 'public' };

async function restricciones(payload: unknown, campo: string) {
  const errores = await validate(plainToInstance(UpdateMetadataDto, payload));
  return errores.find((e) => e.property === campo)?.constraints ?? {};
}

async function erroresTotales(payload: unknown) {
  return validate(plainToInstance(UpdateMetadataDto, payload));
}

const pipe = new ValidationPipe({ transform: true });
const meta = { type: 'body' as const, metatype: UpdateMetadataDto };

async function mensajesDelPipe(payload: unknown): Promise<string[]> {
  try {
    await pipe.transform(payload, meta);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const err = e as BadRequestException;
    expect(err.getStatus()).toBe(400);
    return (err.getResponse() as { message: string[] }).message;
  }
  throw new Error('Se esperaba que el pipe lanzara BadRequestException');
}

describe('UpdateMetadataDto', () => {
  describe('payloads válidos', () => {
    it('acepta solo los campos obligatorios', async () => {
      expect(await erroresTotales(base)).toHaveLength(0);
    });

    it('acepta payload completo', async () => {
      const payload = {
        ...base,
        description: 'Una descripción',
        tags: ['educación', 'tutorial'],
      };
      expect(await erroresTotales(payload)).toHaveLength(0);
    });

    it.each(Object.values(VideoVisibility))(
      'acepta visibilidad "%s"',
      async (visibility) => {
        expect(await erroresTotales({ ...base, visibility })).toHaveLength(0);
      },
    );

    it('acepta valores exactamente en el límite', async () => {
      const payload = {
        title: 'a'.repeat(TITLE_MAX_LENGTH),
        description: 'd'.repeat(DESCRIPTION_MAX_LENGTH),
        tags: Array.from({ length: TAGS_MAX_COUNT }, (_, i) =>
          `${i}`.padEnd(TAG_MAX_LENGTH, 'x'),
        ),
        visibility: 'private',
      };
      expect(await erroresTotales(payload)).toHaveLength(0);
    });

    it('acepta description y tags ausentes o null', async () => {
      const payload = { ...base, description: null, tags: null };
      expect(await erroresTotales(payload)).toHaveLength(0);
    });
  });

  describe('campos obligatorios', () => {
    it.each([
      ['ausente', undefined],
      ['null', null],
      ['cadena vacía', ''],
    ])('title %s → error "El título es obligatorio"', async (_d, title) => {
      const c = await restricciones({ ...base, title }, 'title');
      expect(c.isNotEmpty).toBe('El título es obligatorio');
    });

    it.each(['   ', '\t\n '])(
      'title solo con espacios (%j) → error',
      async (title) => {
        const c = await restricciones({ ...base, title }, 'title');
        expect(c.matches).toBe('El título no puede contener solo espacios');
      },
    );

    it('title no string → error de tipo', async () => {
      const c = await restricciones({ ...base, title: 123 }, 'title');
      expect(c.isString).toBe('El título debe ser un texto');
    });

    it.each([
      ['ausente', undefined],
      ['null', null],
      ['cadena vacía', ''],
    ])(
      'visibility %s → error "La visibilidad es obligatoria"',
      async (_d, visibility) => {
        const c = await restricciones({ ...base, visibility }, 'visibility');
        expect(c.isNotEmpty).toBe('La visibilidad es obligatoria');
      },
    );

    it.each(['secret', 'PUBLIC', 'publico', 1])(
      'visibility inválida (%j) → "Visibilidad inválida"',
      async (visibility) => {
        const c = await restricciones({ ...base, visibility }, 'visibility');
        expect(c.isEnum).toBe('Visibilidad inválida');
      },
    );

    it('description y tags NO son obligatorios', async () => {
      expect(await restricciones(base, 'description')).toEqual({});
      expect(await restricciones(base, 'tags')).toEqual({});
    });
  });

  describe('límites de longitud', () => {
    it('title de 100 caracteres es válido y de 101 falla', async () => {
      const ok = await restricciones(
        { ...base, title: 'a'.repeat(TITLE_MAX_LENGTH) },
        'title',
      );
      expect(ok).toEqual({});

      const c = await restricciones(
        { ...base, title: 'a'.repeat(TITLE_MAX_LENGTH + 1) },
        'title',
      );
      expect(c.maxLength).toBe('El título no puede exceder los 100 caracteres');
    });

    it('description de 5000 es válida y de 5001 falla', async () => {
      const ok = await restricciones(
        { ...base, description: 'd'.repeat(DESCRIPTION_MAX_LENGTH) },
        'description',
      );
      expect(ok).toEqual({});

      const c = await restricciones(
        { ...base, description: 'd'.repeat(DESCRIPTION_MAX_LENGTH + 1) },
        'description',
      );
      expect(c.maxLength).toBe(
        'La descripción no puede exceder los 5000 caracteres',
      );
    });

    it('description no string → error de tipo', async () => {
      const c = await restricciones(
        { ...base, description: 42 },
        'description',
      );
      expect(c.isString).toBe('La descripción debe ser un texto');
    });

    it('15 etiquetas es válido y 16 falla', async () => {
      const crear = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

      expect(
        await restricciones({ ...base, tags: crear(TAGS_MAX_COUNT) }, 'tags'),
      ).toEqual({});

      const c = await restricciones(
        { ...base, tags: crear(TAGS_MAX_COUNT + 1) },
        'tags',
      );
      expect(c.arrayMaxSize).toBe('No puedes agregar más de 15 etiquetas');
    });

    it('etiqueta individual de 50 es válida y de 51 falla', async () => {
      expect(
        await restricciones(
          { ...base, tags: ['a'.repeat(TAG_MAX_LENGTH)] },
          'tags',
        ),
      ).toEqual({});

      const c = await restricciones(
        { ...base, tags: ['a'.repeat(TAG_MAX_LENGTH + 1)] },
        'tags',
      );
      expect(c.maxLength).toBe(
        'Cada etiqueta no puede exceder los 50 caracteres',
      );
    });
  });

  describe('validación de etiquetas', () => {
    it('rechaza tags que no es arreglo', async () => {
      const c = await restricciones({ ...base, tags: 'a,b' }, 'tags');
      expect(c.isArray).toBe('Las etiquetas deben enviarse como un arreglo');
    });

    it('rechaza etiquetas repetidas', async () => {
      const c = await restricciones({ ...base, tags: ['a', 'a'] }, 'tags');
      expect(c.arrayUnique).toBe('Las etiquetas no pueden repetirse');
    });

    it('rechaza etiquetas vacías', async () => {
      const c = await restricciones({ ...base, tags: [''] }, 'tags');
      expect(c.isNotEmpty).toBe('Las etiquetas no pueden estar vacías');
    });

    it('rechaza etiquetas que no son texto', async () => {
      const c = await restricciones({ ...base, tags: [123] }, 'tags');
      expect(c.isString).toBe('Cada etiqueta debe ser un texto');
    });
  });

  describe('integración con ValidationPipe → 400 Bad Request', () => {
    it('payload válido pasa y devuelve una instancia del DTO', async () => {
      const result = await pipe.transform(base, meta);
      expect(result).toBeInstanceOf(UpdateMetadataDto);
      expect(result).toMatchObject(base);
    });

    it('title ausente → 400 con mensaje de obligatorio', async () => {
      const mensajes = await mensajesDelPipe({ visibility: 'public' });
      expect(mensajes).toContain('El título es obligatorio');
    });

    it('title > 100 → 400 con mensaje de longitud', async () => {
      const mensajes = await mensajesDelPipe({
        ...base,
        title: 'a'.repeat(TITLE_MAX_LENGTH + 1),
      });
      expect(mensajes).toEqual([
        'El título no puede exceder los 100 caracteres',
      ]);
    });

    it('visibility ausente → 400 con mensaje de obligatoria', async () => {
      const mensajes = await mensajesDelPipe({ title: 'Mi video' });
      expect(mensajes).toContain('La visibilidad es obligatoria');
    });

    it('acumula los errores de varios campos en una sola respuesta', async () => {
      const mensajes = await mensajesDelPipe({
        title: 'a'.repeat(TITLE_MAX_LENGTH + 1),
        description: 'd'.repeat(DESCRIPTION_MAX_LENGTH + 1),
        tags: Array.from({ length: TAGS_MAX_COUNT + 1 }, (_, i) => `t${i}`),
        visibility: 'secret',
      });
      expect(mensajes).toEqual(
        expect.arrayContaining([
          'El título no puede exceder los 100 caracteres',
          'La descripción no puede exceder los 5000 caracteres',
          'No puedes agregar más de 15 etiquetas',
          'Visibilidad inválida',
        ]),
      );
    });
  });
});
