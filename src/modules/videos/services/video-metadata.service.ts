import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { metadataVersions, videos } from '../../../db/schema.js';
import type { DrizzleDb } from '../../../db/types.js';
import { MessageBrokerService } from '../../../infrastructure/messaging/message-broker.service.js';
import { UpdateMetadataDto } from '../dto/update-metadata.dto.js';
import { VideoMetadata, VideoVisibility } from '../video.entity.js';

type FilaMetadata = typeof metadataVersions.$inferSelect;
type DatabaseVisibility = 'public' | 'private' | 'unlisted';

@Injectable()
export class VideoMetadataService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly db: DrizzleDb,
    @Inject('MESSAGE_BROKER') private readonly broker: MessageBrokerService,
  ) {}

  /**
   * Persiste una nueva versión de metadatos (auto-incremental por video) y
   * emite el evento de dominio `metadata.updated`.
   */
  async actualizarMetadatos(
    contentId: string,
    metadata: UpdateMetadataDto,
    correlationId?: string,
  ) {
    const fila = await this.db.transaction(async (tx) => {
      const [video] = await tx
        .select()
        .from(videos)
        .where(eq(videos.id, contentId))
        .for('update')
        .limit(1);

      if (!video) {
        throw new NotFoundException('Video no encontrado');
      }

      const [ultima] = await tx
        .select({ version: metadataVersions.version })
        .from(metadataVersions)
        .where(eq(metadataVersions.videoId, contentId))
        .orderBy(desc(metadataVersions.version))
        .limit(1);

      const nuevaVersion = (ultima?.version ?? 0) + 1;

      const [fila] = await tx
        .insert(metadataVersions)
        .values({
          videoId: contentId,
          version: nuevaVersion,
          title: metadata.title,
          description: metadata.description ?? null,
          tags: metadata.tags ?? null,
          visibility: metadata.visibility as DatabaseVisibility,
        })
        .returning();

      return fila;
    });

    await this.broker.publish(
      'metadata.updated',
      {
        contentId,
        version: fila.version,
        title: fila.title,
        tags: fila.tags ?? [],
        visibility: fila.visibility,
      },
      { correlationId },
    );

    return {
      status: 200,
      contentId,
      metadata: this.aEntidad(fila),
    };
  }

  /** Lee la última versión de metadatos de un video (null si aún no tiene). */
  async obtenerMetadatos(contentId: string) {
    const [video] = await this.db
      .select({ id: videos.id })
      .from(videos)
      .where(eq(videos.id, contentId))
      .limit(1);

    if (!video) {
      throw new NotFoundException('Video no encontrado');
    }

    const [fila] = await this.db
      .select()
      .from(metadataVersions)
      .where(eq(metadataVersions.videoId, contentId))
      .orderBy(desc(metadataVersions.version))
      .limit(1);

    return {
      status: 200,
      contentId,
      metadata: fila ? this.aEntidad(fila) : null,
    };
  }

  /**
   * Devuelve la versión vigente de metadatos junto con el historial completo
   * de versiones del video, de la más reciente a la más antigua.
   */
  async obtenerMetadatosConHistorial(contentId: string) {
    const [video] = await this.db
      .select({ id: videos.id })
      .from(videos)
      .where(eq(videos.id, contentId))
      .limit(1);

    if (!video) {
      throw new NotFoundException('Video no encontrado');
    }

    const filas = await this.db
      .select()
      .from(metadataVersions)
      .where(eq(metadataVersions.videoId, contentId))
      .orderBy(desc(metadataVersions.version));

    return {
      status: 200,
      contentId,
      metadata: filas[0] ? this.aEntidad(filas[0]) : null,
      historial: filas.map((fila) => this.aEntidad(fila)),
    };
  }

  /** Lee una versión puntual de metadatos. */
  async obtenerVersion(contentId: string, version: number) {
    const [fila] = await this.db
      .select()
      .from(metadataVersions)
      .where(
        and(
          eq(metadataVersions.videoId, contentId),
          eq(metadataVersions.version, version),
        ),
      )
      .limit(1);

    if (!fila) {
      throw new NotFoundException('Versión de metadatos no encontrada');
    }

    return {
      status: 200,
      contentId,
      metadata: this.aEntidad(fila),
    };
  }

  private aEntidad(fila: FilaMetadata): VideoMetadata {
    return {
      id: fila.id,
      version: fila.version,
      title: fila.title,
      description: fila.description,
      tags: fila.tags,
      visibility: fila.visibility as VideoVisibility,
      createdAt: fila.createdAt,
    };
  }
}
