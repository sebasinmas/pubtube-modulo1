import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EventEnvelope, PublishContext } from './event-envelope.js';

const EVENT_SOURCE = 'module1-content';
const EVENT_VERSION = 1;

// reemplazar este archivo por una conexion real a RabbitMQ o lo que sea
@Injectable()
export class MessageBrokerService {
  private readonly logger = new Logger(MessageBrokerService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async publish<T extends Record<string, unknown>>(
    eventType: string,
    payload: T,
    context: PublishContext = {},
  ): Promise<EventEnvelope<T>> {
    const correlationId = context.correlationId ?? randomUUID();
    const envelope: EventEnvelope<T> = {
      id: randomUUID(),
      type: eventType,
      version: EVENT_VERSION,
      timestamp: new Date().toISOString(),
      correlationId,
      causationId: context.causationId ?? correlationId,
      source: EVENT_SOURCE,
      payload,
    };

    this.logger.log(
      `Publicando evento "${eventType}" [id: ${envelope.id}] [correlationId: ${correlationId}]`,
    );
    await this.eventEmitter.emitAsync(eventType, envelope);
    return envelope;
  }
}
