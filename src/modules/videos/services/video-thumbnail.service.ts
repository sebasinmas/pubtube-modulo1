import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { VideoRow } from '../../../db/schema.js';
import { MinioService } from '../../../infrastructure/minio/minio.service.js';
import { VideoRepository } from '../repository/video.repository.js';

export type FormatoMiniatura = 'jpg' | 'png';

export interface ArchivoMiniatura {
  buffer: Buffer;
  mimetype: string;
}

export interface MiniaturaGuardada {
  contentId: string;
  thumbnailUrl: string;
}

/*
  Formatos aceptados. El Content-Type lo declara el cliente y no es confiable,
  por eso además se verifica la firma (magic bytes) del contenido real.
*/
const FORMATOS: Record<FormatoMiniatura, { mimeType: string; firma: Buffer }> =
  {
    jpg: { mimeType: 'image/jpeg', firma: Buffer.from([0xff, 0xd8, 0xff]) },
    png: {
      mimeType: 'image/png',
      firma: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
  };

export function detectarFormatoMiniatura(
  contenido: Buffer,
): FormatoMiniatura | null {
  for (const formato of Object.keys(FORMATOS) as FormatoMiniatura[]) {
    const { firma } = FORMATOS[formato];
    if (contenido.subarray(0, firma.length).equals(firma)) return formato;
  }
  return null;
}

@Injectable()
export class VideoThumbnailService {
  private readonly logger = new Logger(VideoThumbnailService.name);

  constructor(
    private readonly minioService: MinioService,
    private readonly videoRepository: VideoRepository,
  ) {}

  /*
    Miniatura adjuntada por el usuario (POST /api/content/:id/thumbnail).
    Orden de validación: primero lo barato (formato), luego la base de datos
    (existencia y estado del video).
  */
  async subirMiniatura(
    videoId: string,
    archivo: ArchivoMiniatura,
  ): Promise<MiniaturaGuardada> {
    const formato = this.validarImagen(archivo);

    const video = await this.videoRepository.buscarPorId(videoId);
    if (!video) throw new NotFoundException('Video no encontrado');
    if (video.status === 'publicado') {
      throw new ConflictException(
        'No se puede cambiar la miniatura de un video publicado',
      );
    }

    const thumbnailUrl = await this.guardarMiniatura(
      video,
      archivo.buffer,
      formato,
    );
    return { contentId: video.id, thumbnailUrl };
  }

  /*
    Sube la imagen al bucket de miniaturas y actualiza videos.thumbnail_url.
    Es el punto común para la miniatura del usuario y, más adelante, para el
    frame extraído del video.

    Si la base de datos falla después de subir, se borra el objeto nuevo para
    no dejar huérfanos; y si la clave cambió (p. ej. de png a jpg), se borra la
    miniatura anterior una vez confirmado el nuevo valor.
  */
  async guardarMiniatura(
    video: VideoRow,
    imagen: Buffer,
    formato: FormatoMiniatura,
  ): Promise<string> {
    const bucket = this.bucketMiniaturas();
    const clave = `${video.id}/thumbnail.${formato}`;
    const claveAnterior = this.claveDe(video.thumbnail_url, bucket);

    await this.minioService.subirObjeto(
      bucket,
      clave,
      imagen,
      FORMATOS[formato].mimeType,
    );

    const thumbnailUrl = this.minioService.obtenerStorageUrl(bucket, clave);
    try {
      const fila = await this.videoRepository.actualizarMiniatura(
        video.id,
        thumbnailUrl,
      );
      // El video pudo eliminarse mientras se subía (limpieza de borradores).
      if (!fila) throw new NotFoundException('Video no encontrado');
    } catch (error) {
      if (claveAnterior !== clave) await this.eliminarSilencioso(bucket, clave);
      throw error;
    }

    if (claveAnterior !== null && claveAnterior !== clave) {
      await this.eliminarSilencioso(bucket, claveAnterior);
    }
    return thumbnailUrl;
  }

  private validarImagen(archivo: ArchivoMiniatura): FormatoMiniatura {
    const formato = detectarFormatoMiniatura(archivo.buffer);
    if (!formato || FORMATOS[formato].mimeType !== archivo.mimetype) {
      throw new UnsupportedMediaTypeException(
        'Formato inválido. Solo se permite jpg y png',
      );
    }
    return formato;
  }

  private bucketMiniaturas(): string {
    const bucket = process.env.MINIO_BUCKET_THUMBNAILS;
    if (!bucket) throw new Error('MINIO_BUCKET_THUMBNAILS no está definida');
    return bucket;
  }

  /* Extrae la clave de un s3://<bucket>/<clave>; null si no es de este bucket. */
  private claveDe(storageUrl: string | null, bucket: string): string | null {
    const prefijo = `s3://${bucket}/`;
    return storageUrl?.startsWith(prefijo)
      ? storageUrl.slice(prefijo.length)
      : null;
  }

  private async eliminarSilencioso(
    bucket: string,
    clave: string,
  ): Promise<void> {
    try {
      await this.minioService.eliminarObjeto(bucket, clave);
    } catch (error) {
      this.logger.warn(
        `No se pudo eliminar la miniatura ${clave} del bucket ${bucket}: ${String(error)}`,
      );
    }
  }
}
