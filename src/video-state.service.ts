import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { videos } from './db/schema.js'; 

@Injectable()
export class VideoStateService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly db: any,
    @Inject('MESSAGE_BROKER') private readonly broker: any,
  ) {}

  // marcarComoListo va aqui

  async marcarComoProgramado(contentId: string, scheduledAt: Date) {
    const [video] = await this.db.select().from(videos).where(eq(videos.id, contentId)).limit(1);

    if (video.status !== 'listo') {
      throw new BadRequestException('Solo se puede programar un video que esté listo');
    }


    if (scheduledAt < new Date()) {
      throw new BadRequestException('La fecha de programación debe ser futura');
    }


  }
}