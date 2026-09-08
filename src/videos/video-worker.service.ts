import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, and, lte } from 'drizzle-orm';
import { videos } from '../db/schema.js';

@Injectable()
export class VideoWorkerService {
  private readonly logger = new Logger(VideoWorkerService.name);

  constructor(
    @Inject('DATABASE_CONNECTION') private readonly db: any,
    @Inject('YOUTUBE_SERVICE') private readonly youtubeService: any,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async procesarVideosProgramados() {
    try {
      const ahora = new Date();
      const videosPendientes = await this.db
        .select()
        .from(videos)
        .where(
          and(
            eq(videos.status, 'programado'),
            lte(videos.scheduled_at, ahora) 
          )
        );
      if (!videosPendientes || videosPendientes.length === 0) { return; }
      this.logger.log(`Se encontraron ${videosPendientes.length} videos para procesar.`);

      for (const video of videosPendientes) {
        try {
          const response = await this.youtubeService.verificarDisponibilidad(video.youtube_url);

          if (response.status === 200) {
            await this.db
              .update(videos)
              .set({ status: 'publicado' })
              .where(eq(videos.id, video.id));
              
            this.logger.log(`Video ${video.id} publicado con éxito en la base de datos.`);
          }
        } catch (error) {
          this.logger.error(`Error de red al consultar YouTube para el video ${video.id}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error crítico en la ejecución del Cronjob`);
    }
  }
}