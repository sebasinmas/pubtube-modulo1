import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VideoStatus } from '../video.entity.js';
import {
  GetContentQueryDto,
  GetContentResponseDto,
} from './get-content.dto.js';

// Utilitario para consultar restricciones directas de class-validator
async function obtenerRestricciones(payload: unknown, campo: string) {
  const dto = plainToInstance(
    GetContentQueryDto,
    payload as Record<string, unknown>,
  );
  const errores = await validate(dto);
  return errores.find((e) => e.property === campo)?.constraints ?? {};
}

// Pipe de validacion configurado igual que en el entorno de ejecucion NestJS
const pipe = new ValidationPipe({ transform: true });
const metaQuery = { type: 'query' as const, metatype: GetContentQueryDto };

async function transformarQuery(query: unknown): Promise<GetContentQueryDto> {
  return pipe.transform(query, metaQuery) as Promise<GetContentQueryDto>;
}

async function obtenerErroresDelPipe(query: unknown): Promise<string[]> {
  try {
    await pipe.transform(query, metaQuery);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const badRequest = error as BadRequestException;
    expect(badRequest.getStatus()).toBe(400);
    const respuesta = badRequest.getResponse() as { message: string[] };
    return Array.isArray(respuesta.message)
      ? respuesta.message
      : [respuesta.message];
  }
  throw new Error('Se esperaba BadRequestException');
}

describe('GetContentQueryDto (DTO de entrada)', () => {
  describe('valores validos y defaults', () => {
    it('acepta query vacio y aplica valores por defecto (page=1, size=10)', async () => {
      const resultado = await transformarQuery({});

      expect(resultado).toBeInstanceOf(GetContentQueryDto);
      expect(resultado.page).toBe(1);
      expect(resultado.size).toBe(10);
      expect(resultado.status).toBeUndefined();
    });

    it('acepta parametros explicitos validos con status', async () => {
      const resultado = await transformarQuery({
        page: 2,
        size: 25,
        status: VideoStatus.LISTO,
      });

      expect(resultado.page).toBe(2);
      expect(resultado.size).toBe(25);
      expect(resultado.status).toBe(VideoStatus.LISTO);
    });

    it('transforma strings de query params a numeros', async () => {
      const resultado = await transformarQuery({
        page: '3',
        size: '50',
      });

      expect(resultado.page).toBe(3);
      expect(resultado.size).toBe(50);
    });

    it.each(Object.values(VideoStatus))(
      'acepta cada status permitido: %s',
      async (status) => {
        const resultado = await transformarQuery({ status });
        expect(resultado.status).toBe(status);
      },
    );

    it('acepta limites exactos de size (1 y 100) y page (1)', async () => {
      const min = await transformarQuery({ page: 1, size: 1 });
      expect(min.page).toBe(1);
      expect(min.size).toBe(1);

      const max = await transformarQuery({ page: 1, size: 100 });
      expect(max.size).toBe(100);
    });
  });

  describe('validaciones de status', () => {
    it('rechaza status con valor no permitido', async () => {
      const restricciones = await obtenerRestricciones(
        { status: 'invalido' },
        'status',
      );
      expect(restricciones.isEnum).toBeDefined();

      const errores = await obtenerErroresDelPipe({ status: 'invalido' });
      expect(errores.length).toBeGreaterThan(0);
    });
  });

  describe('validaciones de page', () => {
    it.each([0, -1, -10])('rechaza page menor a 1 (%d)', async (page) => {
      const restricciones = await obtenerRestricciones({ page }, 'page');
      expect(restricciones.min).toBeDefined();

      const errores = await obtenerErroresDelPipe({ page });
      expect(errores.length).toBeGreaterThan(0);
    });

    it('rechaza page decimal', async () => {
      const restricciones = await obtenerRestricciones({ page: 1.5 }, 'page');
      expect(restricciones.isInt).toBeDefined();

      const errores = await obtenerErroresDelPipe({ page: '1.5' });
      expect(errores.length).toBeGreaterThan(0);
    });

    it('rechaza page no numerico', async () => {
      const restricciones = await obtenerRestricciones({ page: 'abc' }, 'page');
      expect(restricciones.isInt).toBeDefined();

      const errores = await obtenerErroresDelPipe({ page: 'abc' });
      expect(errores.length).toBeGreaterThan(0);
    });
  });

  describe('validaciones de size', () => {
    it.each([0, -1])('rechaza size menor a 1 (%d)', async (size) => {
      const restricciones = await obtenerRestricciones({ size }, 'size');
      expect(restricciones.min).toBeDefined();

      const errores = await obtenerErroresDelPipe({ size });
      expect(errores.length).toBeGreaterThan(0);
    });

    it.each([101, 150])('rechaza size mayor a 100 (%d)', async (size) => {
      const restricciones = await obtenerRestricciones({ size }, 'size');
      expect(restricciones.max).toBeDefined();

      const errores = await obtenerErroresDelPipe({ size });
      expect(errores.length).toBeGreaterThan(0);
    });

    it('rechaza size decimal', async () => {
      const restricciones = await obtenerRestricciones({ size: 10.5 }, 'size');
      expect(restricciones.isInt).toBeDefined();

      const errores = await obtenerErroresDelPipe({ size: '10.5' });
      expect(errores.length).toBeGreaterThan(0);
    });

    it('rechaza size no numerico', async () => {
      const restricciones = await obtenerRestricciones(
        { size: 'cien' },
        'size',
      );
      expect(restricciones.isInt).toBeDefined();

      const errores = await obtenerErroresDelPipe({ size: 'cien' });
      expect(errores.length).toBeGreaterThan(0);
    });
  });
});

describe('GetContentResponseDto (DTO de salida)', () => {
  it('instancia correctamente la estructura de respuesta paginada', () => {
    const items = [{ id: 'video-1' }, { id: 'video-2' }];
    const respuesta = new GetContentResponseDto({
      items,
      totalItems: 20,
      totalPages: 2,
      currentPage: 2,
    });

    expect(respuesta.items).toEqual(items);
    expect(respuesta.totalItems).toBe(20);
    expect(respuesta.currentPage).toBe(2);
    expect(respuesta.totalPages).toBe(2);
  });

  it.each([
    { total: 0, size: 10, esperadas: 0 },
    { total: 5, size: 10, esperadas: 1 },
    { total: 10, size: 10, esperadas: 1 },
    { total: 11, size: 10, esperadas: 2 },
    { total: 25, size: 10, esperadas: 3 },
    { total: 100, size: 25, esperadas: 4 },
  ])(
    'calcula totalPages=$esperadas para totalItems=$total con size=$size',
    ({ total, size, esperadas }) => {
      const totalPages = total === 0 ? 0 : Math.ceil(total / size);
      const respuesta = new GetContentResponseDto({
        items: [],
        totalItems: total,
        totalPages,
        currentPage: 1,
      });

      expect(respuesta.totalPages).toBe(esperadas);
    },
  );
});
