import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './db/database.module.js';
import { AuthModule } from './infrastructure/auth/auth.module.js';
import { MinioModule } from './infrastructure/minio/minio.module.js';
import { YoutubeService } from './infrastructure/youtube/youtube.service.js';
import { VideoRepository } from './modules/videos/repository/video.repository.js';
import { VideoStateService } from './modules/videos/services/video-state.service.js';
import { VideoWorkerService } from './modules/videos/services/video-worker.service.js';
import { MessageBrokerModule } from './infrastructure/messaging/message-broker.module.js';
import { VideoUploadController } from './modules/videos/controllers/video-upload.controller.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule,
    MinioModule,
    DatabaseModule,
    MessageBrokerModule,
    AuthModule,
  ],
  controllers: [VideoUploadController],
  providers: [
    VideoStateService,
    VideoWorkerService,
    VideoRepository,
    YoutubeService,
    { provide: 'YOUTUBE_SERVICE', useClass: YoutubeService },
  ],
})
export class AppModule {}
