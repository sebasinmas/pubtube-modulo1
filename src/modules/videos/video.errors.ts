/** Código SQLSTATE de PostgreSQL para violación de restricción única. */
const PG_UNIQUE_VIOLATION = '23505';

/*
  Se lanza cuando el checksum de un contenido ya pertenece a otro video.
  Es un error de dominio: el controlador lo traduce a HTTP 409.
*/
export class ChecksumDuplicadoError extends Error {
  constructor(
    public readonly checksum: string,
    public readonly existingContentId: string,
  ) {
    super(`Ya existe contenido con el checksum ${checksum}`);
    this.name = 'ChecksumDuplicadoError';
  }
}

/*
  Drizzle envuelve los errores de `pg` en DrizzleQueryError (el original queda
  en `cause`), así que se revisa el error y toda su cadena de causas.
*/
export function esViolacionDeUnicidad(
  error: unknown,
  constraint?: string,
): boolean {
  let actual: unknown = error;
  while (actual instanceof Error || isObject(actual)) {
    const { code, constraint: nombre } = actual as {
      code?: unknown;
      constraint?: unknown;
    };
    if (code === PG_UNIQUE_VIOLATION) {
      return constraint === undefined || nombre === constraint;
    }
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
