import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  ListPartsCommand,
  UploadPartCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

@Injectable()
export class MinioService {
  private readonly logger = new Logger(MinioService.name);
  public readonly client: S3Client;

  constructor() {
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    const endpoint = `${protocol}://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`;

    this.client = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      },
      forcePathStyle: true,
    });

    this.logger.log('Cliente S3/MinIO inicializado correctamente.');
  }

  async getPresignedUrl(
    bucketName: string,
    objectName: string,
    uploadId: string,
    partNumber: number,
    expiryInSeconds: number = 900,
  ): Promise<string> {
    try {
      const command = new UploadPartCommand({
        Bucket: bucketName,
        Key: objectName,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      return await getSignedUrl(this.client, command, {
        expiresIn: expiryInSeconds,
      });
    } catch (error) {
      this.logger.error('Error al generar URL prefirmada: ', error);
      throw error;
    }
  }

  async createMultipartUpload(objectName: string): Promise<string> {
    const command = new CreateMultipartUploadCommand({
      Bucket: process.env.MINIO_BUCKET_CONTENT!,
      Key: objectName,
    });

    const response = await this.client.send(command);
    return response.UploadId!;
  }

  async listParts(bucket: string, object: string, uploadId: string) {
    const command = new ListPartsCommand({
      Bucket: bucket,
      Key: object,
      UploadId: uploadId,
    });

    const response = await this.client.send(command);
    return response.Parts || [];
  }

  async completeMultipartUpload(
    bucket: string,
    object: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ) {
    const formattedParts = parts.map((p) => ({
      PartNumber: p.partNumber,
      ETag: p.etag,
    }));

    const command = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: object,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: formattedParts,
      },
    });

    return this.client.send(command);
  }

  /*
    Calcula el SHA-256 del objeto ya ensamblado, releyéndolo desde MinIO.
    El backend nunca ve los bytes durante la subida (van del cliente a MinIO
    directo por URL prefirmada), así que esto solo puede hacerse DESPUÉS de
    completar el multipart. 
  */
  async calcularChecksumSha256(
    bucket: string,
    object: string,
  ): Promise<string> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: object }),
    );

    const hash = createHash('sha256');
    const stream = response.Body as Readable;

    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }

    return hash.digest('hex');
  }
}
