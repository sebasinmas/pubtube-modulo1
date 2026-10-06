import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('debe responder status ok y metadata del servicio', () => {
    const controller = new HealthController();
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('pubtube-modulo1');
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });
});
