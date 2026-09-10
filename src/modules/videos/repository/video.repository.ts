import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { videos, VideoStatusValue } from '../../../db/schema.js';
import type { DrizzleDb } from '../../../db/types.js';

export interface CrearBorradorInput {
  id: string;
  filename: string;
  object_key: string;
  minio_upload_id: string;
}

@Injectable()
export class VideoRepository {
  constructor(@Inject('DATABASE_CONNECTION') private readonly db: DrizzleDb) {}

  async crearBorrador(input: CrearBorradorInput) {
    const [row] = await this.db
      .insert(videos)
      .values({
        id: input.id,
        filename: input.filename,
        object_key: input.object_key,
        minio_upload_id: input.minio_upload_id,
        status: 'borrador',
      })
      .returning();
    return row;
  }

  async buscarPorId(id: string) {
    const [row] = await this.db
      .select()
      .from(videos)
      .where(eq(videos.id, id))
      .limit(1);
    return row ?? null;
  }

  async marcarComoSubido(id: string) {
    const [row] = await this.db
      .update(videos)
      .set({ status: 'borrador' })
      .where(eq(videos.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Update atómico condicionado al estado actual (UPDATE ... WHERE id = ? AND status = ?).
   * Devuelve null si no matcheó (video no existe o no estaba en el estado esperado),
   * sin necesidad de un SELECT previo separado.
   */
  async actualizarEstadoSiCoincide(
    id: string,
    estadoEsperado: VideoStatusValue,
    nuevoEstado: VideoStatusValue,
  ) {
    const [row] = await this.db
      .update(videos)
      .set({ status: nuevoEstado })
      .where(and(eq(videos.id, id), eq(videos.status, estadoEsperado)))
      .returning();
    return row ?? null;
  }
}
