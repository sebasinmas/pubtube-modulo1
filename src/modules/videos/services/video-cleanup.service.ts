import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MinioService } from '../../../infrastructure/minio/minio.service.js';
import { VideoRepository } from '../repository/video.repository.js';

const DIA_MS = 24 * 60 * 60 * 1000;
// Mayor que los 7 días del lifecycle de Garage (GARAGE_MULTIPART_ABORT_DAYS).
const DIAS_POR_DEFECTO = 8;

function diasDeAbandono(): number {
  const dias = Number(process.env.BORRADOR_ABANDONADO_DIAS);
  return Number.isFinite(dias) && dias > 0 ? dias : DIAS_POR_DEFECTO;
}

/*
  Elimina las sesiones de carga que nunca se completaron (borrador sin
  checksum) y tienen más de N días. Garage ya abortó su multipart por el
  lifecycle, pero la fila quedaba en la BD.
*/
@Injectable()
export class VideoCleanupService {
  private readonly logger = new Logger(VideoCleanupService.name);
  private readonly bucketName =
    process.env.MINIO_BUCKET_CONTENT ?? 'videos-upload';

  constructor(
    private readonly videoRepository: VideoRepository,
    private readonly minioService: MinioService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async limpiarBorradoresAbandonados(): Promise<number> {
    try {
      const antesDe = new Date(Date.now() - diasDeAbandono() * DIA_MS);
      const eliminados =
        await this.videoRepository.eliminarAbandonados(antesDe);

      for (const video of eliminados) {
        try {
          await this.minioService.abortarMultipartUpload(
            this.bucketName,
            video.object_key,
            video.minio_upload_id,
          );
        } catch (error) {
          // Lo normal es NoSuchUpload: Garage ya lo abortó.
          this.logger.debug(
            `Multipart de ${video.id} ya liberado o no abortable: ${String(error)}`,
          );
        }
      }

      if (eliminados.length > 0) {
        this.logger.log(
          `Se eliminaron ${eliminados.length} borradores abandonados.`,
        );
      }
      return eliminados.length;
    } catch (error) {
      this.logger.error(
        'Error limpiando borradores abandonados',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }
}
