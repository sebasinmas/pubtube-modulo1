import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'minio';

@Injectable()
export class MinioService {
  private readonly logger = new Logger(MinioService.name);
  public readonly client: Client;

  constructor() {
    this.client = new Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    });

    this.logger.log('Cliente MinIO inicializado correctamente.');
  }

  async getPresignedUrl(
    bucketName: string,
    objectName: string,
    expiryInSeconds: number = 900,
  ): Promise<string> {
    try {
      return await this.client.presignedPutObject(
        bucketName,
        objectName,
        expiryInSeconds,
      );
    } catch (error) {
      console.error('Problema detectado: ', error);
      throw error;
    }
  }
}
