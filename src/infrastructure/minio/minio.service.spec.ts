import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { MinioService } from './minio.service.js';

const S3_ENV_VARS = [
  'MINIO_ENDPOINT',
  'MINIO_PORT',
  'MINIO_API_PORT',
  'MINIO_USE_SSL',
  'MINIO_BUCKET_CONTENT',
] as const;

/** Limpia la config S3 del entorno para que cada test declare la suya. */
function clearS3Env() {
  for (const name of S3_ENV_VARS) vi.stubEnv(name, undefined);
}

async function resolvedEndpoint(service: MinioService) {
  const endpoint = await service.client.config.endpoint!();
  return `${endpoint.protocol}//${endpoint.hostname}:${endpoint.port}`;
}

describe('MinioService', () => {
  beforeEach(() => {
    clearS3Env();
  });

  describe('configuración del cliente S3 (Garage)', () => {
    it('usa localhost:9000 por HTTP sin configuración', async () => {
      expect(await resolvedEndpoint(new MinioService())).toBe(
        'http://localhost:9000',
      );
    });

    it('MINIO_PORT tiene prioridad sobre MINIO_API_PORT', async () => {
      vi.stubEnv('MINIO_ENDPOINT', 'garage');
      vi.stubEnv('MINIO_PORT', '3900');
      vi.stubEnv('MINIO_API_PORT', '9000');

      expect(await resolvedEndpoint(new MinioService())).toBe(
        'http://garage:3900',
      );
    });

    it('cae a MINIO_API_PORT cuando MINIO_PORT no está definido', async () => {
      vi.stubEnv('MINIO_API_PORT', '9100');

      expect(await resolvedEndpoint(new MinioService())).toBe(
        'http://localhost:9100',
      );
    });

    it('usa HTTPS solo con MINIO_USE_SSL=true', async () => {
      vi.stubEnv('MINIO_USE_SSL', 'true');

      expect(await resolvedEndpoint(new MinioService())).toMatch(/^https:/);
    });

    it('usa path-style (bucket en la ruta, no en el subdominio)', () => {
      expect(new MinioService().client.config.forcePathStyle).toBe(true);
    });
  });

  describe('operaciones', () => {
    let service: MinioService;
    let send: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.stubEnv('MINIO_BUCKET_CONTENT', 'videos');
      service = new MinioService();
      send = vi.spyOn(service.client, 'send');
    });

    it('createMultipartUpload usa el bucket de contenido y devuelve el UploadId', async () => {
      send.mockResolvedValueOnce({ UploadId: 'upload-1' });

      await expect(service.createMultipartUpload('id/video.mp4')).resolves.toBe(
        'upload-1',
      );

      const command = send.mock.calls[0][0] as CreateMultipartUploadCommand;
      expect(command).toBeInstanceOf(CreateMultipartUploadCommand);
      expect(command.input).toEqual({ Bucket: 'videos', Key: 'id/video.mp4' });
    });

    it('completeMultipartUpload traduce las partes al formato S3', async () => {
      send.mockResolvedValueOnce({});

      await service.completeMultipartUpload('videos', 'k', 'u', [
        { partNumber: 1, etag: '"a"' },
        { partNumber: 2, etag: '"b"' },
      ]);

      const command = send.mock.calls[0][0] as CompleteMultipartUploadCommand;
      expect(command).toBeInstanceOf(CompleteMultipartUploadCommand);
      expect(command.input.MultipartUpload).toEqual({
        Parts: [
          { PartNumber: 1, ETag: '"a"' },
          { PartNumber: 2, ETag: '"b"' },
        ],
      });
    });

    it('listParts devuelve [] cuando S3 no informa partes', async () => {
      send.mockResolvedValueOnce({});

      await expect(service.listParts('videos', 'k', 'u')).resolves.toEqual([]);
    });

    it('calcularChecksumSha256 hashea el objeto completo leído en streaming', async () => {
      const chunks = [
        Buffer.from('hola '),
        Buffer.from('mundo'),
        Buffer.alloc(0),
      ];
      send.mockResolvedValueOnce({ Body: Readable.from(chunks) });

      const checksum = await service.calcularChecksumSha256('videos', 'k');

      expect(checksum).toBe(
        createHash('sha256').update('hola mundo').digest('hex'),
      );
      const command = send.mock.calls[0][0] as GetObjectCommand;
      expect(command.input).toEqual({ Bucket: 'videos', Key: 'k' });
    });

    it('calcularChecksumSha256 de un objeto vacío es el hash de cadena vacía', async () => {
      send.mockResolvedValueOnce({ Body: Readable.from([]) });

      await expect(service.calcularChecksumSha256('videos', 'k')).resolves.toBe(
        createHash('sha256').digest('hex'),
      );
    });

    it('abortarMultipartUpload aborta el multipart indicado', async () => {
      send.mockResolvedValueOnce({});

      await service.abortarMultipartUpload('videos', 'id/video.mp4', 'up-1');

      const command = send.mock.calls[0][0] as AbortMultipartUploadCommand;
      expect(command).toBeInstanceOf(AbortMultipartUploadCommand);
      expect(command.input).toEqual({
        Bucket: 'videos',
        Key: 'id/video.mp4',
        UploadId: 'up-1',
      });
    });

    it('eliminarObjeto envía un DeleteObject al bucket y clave indicados', async () => {
      send.mockResolvedValueOnce({});

      await service.eliminarObjeto('videos', 'id/video.mp4');

      const command = send.mock.calls[0][0] as DeleteObjectCommand;
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toEqual({ Bucket: 'videos', Key: 'id/video.mp4' });
    });

    it('obtenerStorageUrl devuelve una URL s3:// persistente (no prefirmada)', () => {
      expect(service.obtenerStorageUrl('videos', 'id/video.mp4')).toBe(
        's3://videos/id/video.mp4',
      );
    });

    it('getPresignedUrl firma un UploadPart para la parte y expira en 15 min por defecto', async () => {
      vi.stubEnv('MINIO_ACCESS_KEY', 'test-access-key');
      vi.stubEnv('MINIO_SECRET_KEY', 'test-secret-key-123');
      const signer = new MinioService();

      const url = new URL(
        await signer.getPresignedUrl('videos', 'id/video.mp4', 'upload-1', 7),
      );

      expect(url.pathname).toBe('/videos/id/video.mp4');
      expect(url.searchParams.get('partNumber')).toBe('7');
      expect(url.searchParams.get('uploadId')).toBe('upload-1');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    });
  });
});
