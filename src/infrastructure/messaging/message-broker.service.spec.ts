import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MessageBrokerService } from './message-broker.service.js';
import type { EventEnvelope } from './event-envelope.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('MessageBrokerService', () => {
  let emitter: EventEmitter2;
  let broker: MessageBrokerService;
  let received: EventEnvelope[];

  beforeEach(() => {
    // EventEmitter2 real: se prueba el contrato publicado, no un mock.
    emitter = new EventEmitter2();
    broker = new MessageBrokerService(emitter);
    received = [];
    emitter.on('video.uploaded', (envelope: EventEnvelope) => {
      received.push(envelope);
    });
  });

  it('envuelve el payload en un EventEnvelope completo y lo emite', async () => {
    const envelope = await broker.publish('video.uploaded', {
      contentId: 'c1',
    });

    expect(envelope).toEqual({
      id: expect.stringMatching(UUID_REGEX) as string,
      type: 'video.uploaded',
      version: 1,
      timestamp: expect.any(String) as string,
      correlationId: expect.stringMatching(UUID_REGEX) as string,
      causationId: envelope.correlationId,
      source: 'module1-content',
      payload: { contentId: 'c1' },
    });
    expect(new Date(envelope.timestamp).toISOString()).toBe(envelope.timestamp);
    expect(received).toEqual([envelope]);
  });

  it('propaga el correlationId recibido y lo usa como causationId por defecto', async () => {
    const envelope = await broker.publish(
      'video.uploaded',
      {},
      { correlationId: 'corr-1' },
    );

    expect(envelope.correlationId).toBe('corr-1');
    expect(envelope.causationId).toBe('corr-1');
  });

  it('respeta un causationId explícito', async () => {
    const envelope = await broker.publish(
      'video.uploaded',
      {},
      { correlationId: 'corr-1', causationId: 'evt-0' },
    );

    expect(envelope.causationId).toBe('evt-0');
  });

  it('genera ids distintos para cada evento', async () => {
    const a = await broker.publish('video.uploaded', {});
    const b = await broker.publish('video.uploaded', {});

    expect(a.id).not.toBe(b.id);
    expect(a.correlationId).not.toBe(b.correlationId);
  });

  it('espera a los listeners asíncronos antes de resolver', async () => {
    let listenerDone = false;
    // Listener async a propósito: se verifica que publish usa emitAsync.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    emitter.on('metadata.updated', async () => {
      await Promise.resolve();
      listenerDone = true;
    });

    await broker.publish('metadata.updated', {});

    expect(listenerDone).toBe(true);
  });
});
