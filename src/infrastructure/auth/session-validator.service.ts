import { Injectable } from '@nestjs/common';
import type { SessionValidator } from './session-validator.interface.js';

// De momento se deja externalziada la atenticación para los endpoints
@Injectable()
export class SessionValidatorService implements SessionValidator {
  async validar(): Promise<true> {
    return Promise.resolve(true);
  }
}
