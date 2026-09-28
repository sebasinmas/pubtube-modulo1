import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  ListPartsCommand,
  UploadPartCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  AbortMultipartUploadCommand,
  type CompleteMultipartUploadCommandOutput,
  type Part,
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
    const port = process.env.MINIO_PORT || process.env.MINIO_API_PORT || '9000';
    const endpoint = `${protocol}://${process.env.MINIO_ENDPOINT || 'localhost'}:${port}`;

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

  async listParts(
    bucket: string,
    object: string,
    uploadId: string,
  ): Promise<Part[]> {
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
  ): Promise<CompleteMultipartUploadCommandOutput> {
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

  /*
    Aborta un multipart en curso y libera en Garage las partes ya subidas.
  */
  async abortarMultipartUpload(
    bucket: string,
    object: string,
    uploadId: string,
  ): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: object,
        UploadId: uploadId,
      }),
    );
  }

  /*
    Borra un objeto ya ensamblado (duplicado o con integridad fallida) para no
    dejar huérfanos en el bucket. DeleteObject es idempotente en S3/Garage:
    si la clave no existe responde 204 igual.
  */
  async eliminarObjeto(bucket: string, object: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: object }),
    );
  }

  /*
    URL persistente del objeto para el contrato video.uploaded. Se usa el
    esquema s3:// (bucket + key) en vez de una URL HTTP: no caduca como una
    prefirmada y no depende del endpoint con el que se firmó la API.
  */
  obtenerStorageUrl(bucket: string, object: string): string {
    return `s3://${bucket}/${object}`;
  }
}
