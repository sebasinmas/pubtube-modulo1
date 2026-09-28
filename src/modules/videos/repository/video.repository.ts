import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import {
  videos,
  type VideoRow,
  type VideoStatusValue,
} from '../../../db/schema.js';
import type { DrizzleDb } from '../../../db/types.js';

export interface CrearBorradorInput {
  id: string;
  filename: string;
  object_key: string;
  minio_upload_id: string;
  size_bytes: number;
}

@Injectable()
export class VideoRepository {
  constructor(@Inject('DATABASE_CONNECTION') private readonly db: DrizzleDb) {}

  async crearBorrador(input: CrearBorradorInput): Promise<VideoRow> {
    const [row] = await this.db
      .insert(videos)
      .values({
        id: input.id,
        filename: input.filename,
        object_key: input.object_key,
        minio_upload_id: input.minio_upload_id,
        size_bytes: input.size_bytes,
        status: 'borrador',
      })
      .returning();
    return row;
  }

  async buscarPorId(id: string): Promise<VideoRow | null> {
    const [row] = await this.db
      .select()
      .from(videos)
      .where(eq(videos.id, id))
      .limit(1);
    return row ?? null;
  }

  async marcarComoSubido(
    id: string,
    checksumSha256: string,
  ): Promise<VideoRow | null> {
    const [row] = await this.db
      .update(videos)
      .set({ status: 'borrador', checksum_sha256: checksumSha256 })
      .where(eq(videos.id, id))
      .returning();
    return row ?? null;
  }

  async actualizarEstadoSiCoincide(
    id: string,
    estadoEsperado: VideoStatusValue,
    nuevoEstado: VideoStatusValue,
  ): Promise<VideoRow | null> {
    const [row] = await this.db
      .update(videos)
      .set({ status: nuevoEstado })
      .where(and(eq(videos.id, id), eq(videos.status, estadoEsperado)))
      .returning();
    return row ?? null;
  }
}
