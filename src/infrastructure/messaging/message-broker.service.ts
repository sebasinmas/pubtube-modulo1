import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

// remplazar este archivo por una conexion real a RabittMQ lo que sea
@Injectable()
export class MessageBrokerService {
  private readonly logger = new Logger(MessageBrokerService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async publish(
    eventName: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.logger.log(`Publicando evento "${eventName}"`);
    await this.eventEmitter.emitAsync(eventName, payload);
  }
}
