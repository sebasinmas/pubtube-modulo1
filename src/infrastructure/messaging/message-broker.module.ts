import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MessageBrokerService } from './message-broker.service.js';

// Se expone MessageBroker con el token MESSAGE_BROKER
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    MessageBrokerService,
    { provide: 'MESSAGE_BROKER', useExisting: MessageBrokerService },
  ],
  exports: ['MESSAGE_BROKER'],
})
export class MessageBrokerModule {}
