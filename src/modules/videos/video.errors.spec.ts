import { describe, it, expect } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { esViolacionDeUnicidad } from './video.errors.js';

const INDICE = 'videos_checksum_sha256_unique';

function errorPg(code: string, constraint?: string): Error {
  return Object.assign(new Error('pg'), { code, constraint });
}

describe('esViolacionDeUnicidad', () => {
  it('detecta el 23505 envuelto por Drizzle en DrizzleQueryError.cause', () => {
    const error = new DrizzleQueryError(
      'update ...',
      [],
      errorPg('23505', INDICE),
    );

    expect(esViolacionDeUnicidad(error, INDICE)).toBe(true);
  });

  it('detecta el 23505 sin envolver', () => {
    expect(esViolacionDeUnicidad(errorPg('23505', INDICE))).toBe(true);
  });

  it('ignora violaciones de unicidad de otra restricción', () => {
    expect(esViolacionDeUnicidad(errorPg('23505', 'videos_pkey'), INDICE)).toBe(
      false,
    );
  });

  it.each([
    ['otro código', errorPg('23503', INDICE)],
    ['error sin código', new Error('x')],
    ['null', null],
    ['string', '23505'],
  ])('devuelve false para %s', (_caso, error) => {
    expect(esViolacionDeUnicidad(error, INDICE)).toBe(false);
  });
});
