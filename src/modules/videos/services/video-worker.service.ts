import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import type { VideoRow } from '../../../db/schema.js';
import { MessageBrokerService } from '../../../infrastructure/messaging/message-broker.service.js';
import { YoutubeService } from '../../../infrastructure/youtube/youtube.service.js';
import { VideoRepository } from '../repository/video.repository.js';

export const CRON_PUBLICACION_PROGRAMADA = 'publicar-videos-programados';
export const EVENTO_VIDEO_PUBLICADO = 'video.published';

@Injectable()
export class VideoWorkerService {
  private readonly logger = new Logger(VideoWorkerService.name);
  private enEjecucion = false;

  constructor(
    private readonly videoRepository: VideoRepository,
    private readonly youtubeService: YoutubeService,
    @Inject('MESSAGE_BROKER') private readonly broker: MessageBrokerService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: CRON_PUBLICACION_PROGRAMADA })
  async procesarVideosProgramados(): Promise<void> {
    // Evita que un tick lento se solape con el siguiente (misma instancia).
    if (this.enEjecucion) {
      this.logger.warn(
        'Ejecución omitida: la anterior sigue en curso (YouTube lento).',
      );
      return;
    }
    this.enEjecucion = true;

    try {
      const pendientes = await this.videoRepository.buscarProgramadosVencidos(
        new Date(),
      );
      if (pendientes.length === 0) return;

      this.logger.log(
        `Se encontraron ${pendientes.length} videos para procesar.`,
      );
      const correlationId = randomUUID();
      for (const video of pendientes) {
        await this.procesarVideo(video, correlationId);
      }
    } catch (error) {
      this.logger.error(
        'Error crítico en la ejecución del Cronjob',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.enEjecucion = false;
    }
  }

  /*
    Aísla cada video: ningún fallo individual (red, BD, listener del evento)
    corta el lote. Si no se publica, el video sigue en "programado" y el
    siguiente tick lo reintenta.
  */
  private async procesarVideo(
    video: VideoRow,
    correlationId: string,
  ): Promise<void> {
    try {
      if (!video.youtube_url) {
        this.logger.warn(
          `Video ${video.id} programado sin youtube_url: no se puede verificar.`,
        );
        return;
      }

      const { status } = await this.youtubeService.verificarDisponibilidad(
        video.youtube_url,
      );
      if (status !== 200) {
        this.logger.warn(
          `Video ${video.id} aún no es público en YouTube (HTTP ${status}); se reintentará.`,
        );
        return;
      }

      // Transición atómica: solo si sigue "programado" (otro tick/instancia
      // o una edición concurrente pudo moverlo mientras se consultaba YouTube).
      const publicado = await this.videoRepository.actualizarEstadoSiCoincide(
        video.id,
        'programado',
        'publicado',
      );
      if (!publicado) {
        this.logger.warn(
          `Video ${video.id} ya no estaba en "programado"; se omite la publicación.`,
        );
        return;
      }
      this.logger.log(`Video ${video.id} publicado con éxito.`);

      await this.emitirVideoPublicado(publicado, correlationId);
    } catch (error) {
      this.logger.error(
        `Error procesando el video ${video.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // El evento se emite DESPUÉS del commit: los consumidores ven siempre el
  // estado ya persistido. Si el broker falla, la BD sigue siendo la fuente de
  // verdad (ver recomendación de outbox transaccional en la auditoría).
  private async emitirVideoPublicado(
    video: VideoRow,
    correlationId: string,
  ): Promise<void> {
    await this.broker.publish(
      EVENTO_VIDEO_PUBLICADO,
      {
        contentId: video.id,
        youtubeUrl: video.youtube_url,
        scheduledAt: video.scheduled_at?.toISOString() ?? null,
        publishedAt: new Date().toISOString(),
      },
      { correlationId },
    );
  }
}
