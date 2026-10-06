import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller()
export class HealthController {
  @Get(['health', 'api/content/health'])
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Estado de salud del Módulo 1 (Gestión de Contenidos)',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        service: { type: 'string', example: 'pubtube-modulo1' },
        timestamp: { type: 'string', example: '2026-10-06T19:00:00.000Z' },
      },
    },
  })
  check(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'pubtube-modulo1',
      timestamp: new Date().toISOString(),
    };
  }
}
