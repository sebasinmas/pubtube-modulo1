import { Module } from '@nestjs/common';
import { SessionValidatorService } from './session-validator.service.js';

@Module({
  providers: [
    { provide: 'SESSION_VALIDATOR', useClass: SessionValidatorService },
  ],
  exports: ['SESSION_VALIDATOR'],
})
export class AuthModule {}
