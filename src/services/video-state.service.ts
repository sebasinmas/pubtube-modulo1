import { Injectable, BadRequestException, Inject } from '@nestjs/common';

export interface MetadataPayload {
  title: string;
  visibility: string;
  description?: string;
  tags?: string[];
}

@Injectable()
export class VideoStateService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly db: any,
    @Inject('MESSAGE_BROKER') private readonly broker: any,
  ) {}

  async marcarComoListo(contentId: string, metadata: MetadataPayload) {
    // Validacion estricta : falla
    if (!metadata || !metadata.title || !metadata.visibility) {
      throw new BadRequestException('Metadata incompleta para pasar a estado listo');
    }

    const nuevoEstado = 'listo';

    await this.db.updateEstado(contentId, nuevoEstado);
    await this.broker.publish('metadata.updated', {
      contentId,
      version: 1,
      title: metadata.title,
      tags: metadata.tags || [],
      visibility: metadata.visibility,
    });

    return {
      contentId,
      status: nuevoEstado,
    };
  }
}