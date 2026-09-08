import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { VideoWorkerService } from './videos/video-worker.service.js';
import { YoutubeService } from './videos/youtube.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), HttpModule],
  controllers: [AppController],
  providers: [
    VideoWorkerService,
    { provide: 'YOUTUBE_SERVICE', useClass: YoutubeService },
  ],
})
export class AppModule {}
