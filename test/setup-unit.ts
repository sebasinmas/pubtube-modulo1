import { Logger } from '@nestjs/common';
import { afterEach, vi } from 'vitest';

// Los logs de Nest no aportan nada en la salida de los tests unitarios.
Logger.overrideLogger(false);

afterEach(() => {
  vi.useRealTimers();
});
