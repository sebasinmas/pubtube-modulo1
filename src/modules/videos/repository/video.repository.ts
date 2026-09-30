import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull, lt } from 'drizzle-orm';
import {
  videos,
  type VideoRow,
  type VideoStatusValue,
} from '../../../db/schema.js';
import type { DrizzleDb } from '../../../db/types.js';
import {
  ChecksumDuplicadoError,
  esViolacionDeUnicidad,
} from '../video.errors.js';

const CHECKSUM_UNIQUE_INDEX = 'videos_checksum_sha256_unique';

export interface CrearBorradorInput {
  id: string;
  filename: string;
  object_key: string;
  minio_upload_id: string;
  size_bytes: number;
  checksum_declarado?: string | null;
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
        checksum_declarado: input.checksum_declarado ?? null,
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

  async buscarPorChecksum(checksumSha256: string): Promise<VideoRow | null> {
    const [row] = await this.db
      .select()
      .from(videos)
      .where(eq(videos.checksum_sha256, checksumSha256))
      .limit(1);
    return row ?? null;
  }

  /*
    Persiste el checksum verificado. El índice único es la garantía final ante
    cargas concurrentes del mismo archivo (US-A5): si otro video ya lo tiene,
    se lanza ChecksumDuplicadoError con la referencia al contenido previo.
  */
  async marcarComoSubido(
    id: string,
    checksumSha256: string,
  ): Promise<VideoRow | null> {
    try {
      const [row] = await this.db
        .update(videos)
        .set({ status: 'borrador', checksum_sha256: checksumSha256 })
        .where(eq(videos.id, id))
        .returning();
      return row ?? null;
    } catch (error) {
      if (!esViolacionDeUnicidad(error, CHECKSUM_UNIQUE_INDEX)) throw error;

      const existente = await this.buscarPorChecksum(checksumSha256);
      if (!existente) throw error;
      throw new ChecksumDuplicadoError(checksumSha256, existente.id);
    }
  }

  async eliminar(id: string): Promise<void> {
    await this.db.delete(videos).where(eq(videos.id, id));
  }

  /*
    Elimina las cargas que nunca se completaron (sin checksum) y se crearon
    antes de `antesDe`. Un solo DELETE condicional: si una carga se completa
    justo ahora, su checksum ya no es NULL y no se toca.
  */
  async eliminarAbandonados(antesDe: Date): Promise<VideoRow[]> {
    return this.db
      .delete(videos)
      .where(
        and(
          eq(videos.status, 'borrador'),
          isNull(videos.checksum_sha256),
          lt(videos.created_at, antesDe),
        ),
      )
      .returning();
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
