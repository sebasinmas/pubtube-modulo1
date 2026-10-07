import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';

const YOUTUBE_OEMBED_URL = 'https://www.youtube.com/oembed';
const YOUTUBE_TIMEOUT_MS = 10_000;

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);
  constructor(private readonly httpService: HttpService) {}

  async verificarDisponibilidad(
    youtubeUrl: string,
  ): Promise<{ status: number }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(YOUTUBE_OEMBED_URL, {
          params: { url: youtubeUrl, format: 'json' },
          timeout: YOUTUBE_TIMEOUT_MS,
        }),
      );

      return { status: response.status };
    } catch (error) {
      if (isAxiosError(error) && error.response) {
        this.logger.warn(
          `El video no está disponible. Código: ${error.response.status}`,
        );
        return { status: error.response.status };
      }
      this.logger.error('Fallo grave de red al contactar a YouTube');
      throw error;
    }
  }
}
