import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { metadataVersions, videos } from '../../../db/schema.js';
import type { DrizzleDb } from '../../../db/types.js';
import { MessageBrokerService } from '../../../infrastructure/messaging/message-broker.service.js';

export interface MetadataPayload {
  title: string;
  visibility: string;
  description?: string;
  tags?: string[];
}

const VISIBILIDADES_VALIDAS = ['public', 'private', 'unlisted'];

@Injectable()
export class VideoStateService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly db: DrizzleDb,
    @Inject('MESSAGE_BROKER') private readonly broker: MessageBrokerService,
  ) {}

  async marcarComoListo(
    contentId: string,
    metadata: MetadataPayload,
    correlationId?: string,
  ): Promise<{ contentId: string; status: 'listo' }> {
    if (!metadata || !metadata.title || !metadata.visibility) {
      throw new BadRequestException(
        'Metadata incompleta para pasar a estado listo',
      );
    }

    if (!VISIBILIDADES_VALIDAS.includes(metadata.visibility)) {
      throw new BadRequestException(
        `Visibilidad inválida: debe ser una de ${VISIBILIDADES_VALIDAS.join(', ')}`,
      );
    }

    await this.db.transaction(async (tx) => {
      const [video] = await tx
        .select()
        .from(videos)
        .where(eq(videos.id, contentId))
        .for('update')
        .limit(1);

      if (!video) throw new NotFoundException('Video no encontrado');
      if (video.status !== 'borrador') {
        throw new BadRequestException(
          'Solo se puede marcar como listo un video en borrador',
        );
      }

      await tx
        .update(videos)
        .set({ status: 'listo' })
        .where(eq(videos.id, contentId));

      await tx.insert(metadataVersions).values({
        videoId: contentId,
        version: 1,
        title: metadata.title,
        description: metadata.description ?? null,
        tags: metadata.tags ?? null,
        visibility: metadata.visibility as 'public' | 'private' | 'unlisted',
      });
    });

    await this.broker.publish(
      'metadata.updated',
      {
        contentId,
        version: 1,
        title: metadata.title,
        tags: metadata.tags || [],
        visibility: metadata.visibility,
      },
      { correlationId },
    );

    return {
      contentId,
      status: 'listo',
    };
  }

  async marcarComoProgramado(
    contentId: string,
    scheduledAt: Date,
  ): Promise<void> {
    if (!(scheduledAt instanceof Date) || isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('Fecha de programación inválida');
    }

    if (scheduledAt < new Date()) {
      throw new BadRequestException('La fecha de programación debe ser futura');
    }

    await this.db.transaction(async (tx) => {
      const [video] = await tx
        .select()
        .from(videos)
        .where(eq(videos.id, contentId))
        .for('update')
        .limit(1);

      if (!video)
        throw new NotFoundException(`Video ${contentId} no encontrado`);
      if (video.status !== 'listo') {
        throw new BadRequestException(
          'Solo se puede programar un video que esté en estado "listo"',
        );
      }

      await tx
        .update(videos)
        .set({ status: 'programado', scheduled_at: scheduledAt })
        .where(eq(videos.id, contentId));
    });
  }
}
