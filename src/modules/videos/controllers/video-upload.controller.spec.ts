import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { VideoUploadController } from './video-upload.controller.js';
import type { MinioService } from '../../../infrastructure/minio/minio.service.js';
import type { MessageBrokerService } from '../../../infrastructure/messaging/message-broker.service.js';
import type { SessionValidator } from '../../../infrastructure/auth/session-validator.interface.js';
import type { VideoRepository } from '../repository/video.repository.js';
import type { VideoRow } from '../../../db/schema.js';

const { GENERATED_UUID } = vi.hoisted(() => ({
  GENERATED_UUID: '00000000-0000-4000-8000-000000000001',
}));

// Solo se fija randomUUID; el resto de node:crypto sigue siendo el real.
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUID: () => GENERATED_UUID,
}));

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const BUCKET = 'videos';
// Valor por defecto de MAX_UPLOAD_SIZE_BYTES (el test no define la variable).
const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

/** Fila de BD completa y consistente con lo que crea initUpload. */
function videoRow(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    id: SESSION_ID,
    status: 'borrador',
    metadata: null,
    scheduled_at: null,
    youtube_url: null,
    filename: 'tutorial.mp4',
    object_key: `${SESSION_ID}/tutorial.mp4`,
    minio_upload_id: 'upload-id-777',
    size_bytes: 10_485_760,
    checksum_sha256: null,
    ...overrides,
  };
}

function validInitPayload(overrides: Record<string, unknown> = {}) {
  return {
    filename: 'tutorial.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 10_485_760,
    ...overrides,
  };
}

describe('VideoUploadController', () => {
  let minio: {
    createMultipartUpload: Mock<MinioService['createMultipartUpload']>;
    getPresignedUrl: Mock<MinioService['getPresignedUrl']>;
    listParts: Mock<MinioService['listParts']>;
    completeMultipartUpload: Mock<MinioService['completeMultipartUpload']>;
    calcularChecksumSha256: Mock<MinioService['calcularChecksumSha256']>;
  };
  let repository: {
    crearBorrador: Mock<VideoRepository['crearBorrador']>;
    buscarPorId: Mock<VideoRepository['buscarPorId']>;
    marcarComoSubido: Mock<VideoRepository['marcarComoSubido']>;
  };
  let broker: {
    publish: Mock<MessageBrokerService['publish']>;
  };
  let sessionValidator: {
    validar: Mock<SessionValidator['validar']>;
  };
  let controller: VideoUploadController;

  beforeEach(() => {
    // El bucket se lee al construir el controlador: se fija explícitamente
    // para no depender del entorno de quien corre los tests.
    vi.stubEnv('MINIO_BUCKET_CONTENT', BUCKET);

    minio = {
      createMultipartUpload: vi
        .fn<MinioService['createMultipartUpload']>()
        .mockResolvedValue('upload-id-777'),
      getPresignedUrl: vi
        .fn<MinioService['getPresignedUrl']>()
        .mockResolvedValue(
          'http://localhost:9000/videos/key?X-Amz-Signature=x',
        ),
      listParts: vi.fn<MinioService['listParts']>().mockResolvedValue([]),
      completeMultipartUpload: vi
        .fn<MinioService['completeMultipartUpload']>()
        .mockResolvedValue({
          $metadata: {},
        }),
      calcularChecksumSha256: vi
        .fn<MinioService['calcularChecksumSha256']>()
        .mockResolvedValue('a'.repeat(64)),
    };
    repository = {
      crearBorrador: vi
        .fn<VideoRepository['crearBorrador']>()
        .mockImplementation((input) => Promise.resolve(videoRow(input))),
      buscarPorId: vi
        .fn<VideoRepository['buscarPorId']>()
        .mockResolvedValue(videoRow()),
      marcarComoSubido: vi
        .fn<VideoRepository['marcarComoSubido']>()
        .mockImplementation((id, checksum) =>
          Promise.resolve(videoRow({ id, checksum_sha256: checksum })),
        ),
    };
    broker = {
      publish: vi.fn<MessageBrokerService['publish']>(),
    };
    sessionValidator = {
      validar: vi.fn<SessionValidator['validar']>().mockResolvedValue(true),
    };

    controller = new VideoUploadController(
      minio as unknown as MinioService,
      repository as unknown as VideoRepository,
      broker as unknown as MessageBrokerService,
      sessionValidator,
    );
  });

  describe('POST /api/content/init', () => {
    it('crea el multipart upload y el borrador con clave <videoId>/<filename>', async () => {
      const result = await controller.initUpload(validInitPayload(), 'corr-id');

      expect(result).toEqual({ status: 201, uploadSessionId: GENERATED_UUID });
      expect(minio.createMultipartUpload).toHaveBeenCalledWith(
        `${GENERATED_UUID}/tutorial.mp4`,
      );
      expect(repository.crearBorrador).toHaveBeenCalledWith({
        id: GENERATED_UUID,
        filename: 'tutorial.mp4',
        object_key: `${GENERATED_UUID}/tutorial.mp4`,
        minio_upload_id: 'upload-id-777',
        size_bytes: 10_485_760,
      });
    });

    it('acepta video/quicktime (.mov)', async () => {
      await expect(
        controller.initUpload(
          validInitPayload({
            filename: 'clip.mov',
            mimeType: 'video/quicktime',
          }),
          '',
        ),
      ).resolves.toMatchObject({ status: 201 });
    });

    it('valida la sesión antes de cualquier otra cosa', async () => {
      sessionValidator.validar.mockRejectedValueOnce(new Error('sin sesión'));

      await expect(
        controller.initUpload(validInitPayload(), ''),
      ).rejects.toThrow('sin sesión');
      expect(minio.createMultipartUpload).not.toHaveBeenCalled();
    });

    it.each([
      ['ausente', undefined],
      ['avi', 'video/x-msvideo'],
      ['imagen', 'image/png'],
    ])('rechaza mimeType %s con 415', async (_caso, mimeType) => {
      await expect(
        controller.initUpload(validInitPayload({ mimeType }), ''),
      ).rejects.toThrow(UnsupportedMediaTypeException);
      expect(minio.createMultipartUpload).not.toHaveBeenCalled();
      expect(repository.crearBorrador).not.toHaveBeenCalled();
    });

    it.each([
      ['ausente', undefined],
      ['vacío', ''],
    ])('rechaza filename %s con 400', async (_caso, filename) => {
      await expect(
        controller.initUpload(validInitPayload({ filename }), ''),
      ).rejects.toThrow(BadRequestException);
      expect(minio.createMultipartUpload).not.toHaveBeenCalled();
    });

    it.each([
      ['ausente', undefined],
      ['cero', 0],
      ['negativo', -1],
      ['string numérico', '1024'],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('rechaza sizeBytes %s con 400', async (_caso, sizeBytes) => {
      await expect(
        controller.initUpload(validInitPayload({ sizeBytes }), ''),
      ).rejects.toThrow(BadRequestException);
      expect(minio.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('acepta exactamente el tamaño máximo', async () => {
      await expect(
        controller.initUpload(
          validInitPayload({ sizeBytes: MAX_UPLOAD_SIZE_BYTES }),
          '',
        ),
      ).resolves.toMatchObject({ status: 201 });
    });

    it('rechaza un byte por encima del máximo con 413', async () => {
      await expect(
        controller.initUpload(
          validInitPayload({ sizeBytes: MAX_UPLOAD_SIZE_BYTES + 1 }),
          '',
        ),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(minio.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('no crea el borrador si el storage falla al iniciar el multipart', async () => {
      minio.createMultipartUpload.mockRejectedValueOnce(new Error('S3 caído'));

      await expect(
        controller.initUpload(validInitPayload(), ''),
      ).rejects.toThrow('S3 caído');
      expect(repository.crearBorrador).not.toHaveBeenCalled();
    });

    it.todo(
      'rechaza filenames con separadores de ruta (../, /) que alteran la object key',
    );
    it.todo(
      'aborta el multipart upload si falla la creación del borrador en BD (hoy queda huérfano)',
    );
  });

  describe('GET /api/content/:sessionId/part/:partNumber', () => {
    it('devuelve una URL prefirmada para la parte en el bucket configurado', async () => {
      const result = await controller.getPresignedUrl(SESSION_ID, 3);

      expect(result).toEqual({
        url: 'http://localhost:9000/videos/key?X-Amz-Signature=x',
      });
      expect(minio.getPresignedUrl).toHaveBeenCalledWith(
        BUCKET,
        `${SESSION_ID}/tutorial.mp4`,
        'upload-id-777',
        3,
      );
    });

    it('responde 404 si la sesión no existe, sin firmar nada', async () => {
      repository.buscarPorId.mockResolvedValueOnce(null);

      await expect(controller.getPresignedUrl(SESSION_ID, 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(minio.getPresignedUrl).not.toHaveBeenCalled();
    });

    it.todo('rechaza partNumber fuera del rango S3 (1..10000)');
  });

  describe('GET /api/content/upload/:sessionId/status', () => {
    it('devuelve las partes ya subidas para poder reanudar', async () => {
      const parts = [
        { PartNumber: 1, ETag: '"etag-1"', Size: 5_242_880 },
        { PartNumber: 2, ETag: '"etag-2"', Size: 5_242_880 },
      ];
      minio.listParts.mockResolvedValueOnce(parts);

      const result = await controller.getUploadStatus(SESSION_ID, '');

      expect(result).toEqual({ status: 200, parts });
      expect(minio.listParts).toHaveBeenCalledWith(
        BUCKET,
        `${SESSION_ID}/tutorial.mp4`,
        'upload-id-777',
      );
    });

    it('responde 404 si la sesión no existe', async () => {
      repository.buscarPorId.mockResolvedValueOnce(null);

      await expect(controller.getUploadStatus(SESSION_ID, '')).rejects.toThrow(
        NotFoundException,
      );
      expect(minio.listParts).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/content/upload/:sessionId/complete', () => {
    const body = {
      parts: [
        { PartNumber: 1, ETag: '"etag-1"' },
        { PartNumber: 2, ETag: '"etag-2"' },
      ],
    };

    it('ensambla, calcula el checksum, persiste y publica video.uploaded, en ese orden', async () => {
      const result = await controller.completeUpload(
        SESSION_ID,
        body,
        'corr-id',
      );

      expect(result).toEqual({
        status: 200,
        contentId: SESSION_ID,
        checksumSha256: 'a'.repeat(64),
      });
      expect(minio.completeMultipartUpload).toHaveBeenCalledWith(
        BUCKET,
        `${SESSION_ID}/tutorial.mp4`,
        'upload-id-777',
        [
          { partNumber: 1, etag: '"etag-1"' },
          { partNumber: 2, etag: '"etag-2"' },
        ],
      );
      expect(repository.marcarComoSubido).toHaveBeenCalledWith(
        SESSION_ID,
        'a'.repeat(64),
      );
      expect(broker.publish).toHaveBeenCalledWith(
        'video.uploaded',
        {
          contentId: SESSION_ID,
          sessionId: SESSION_ID,
          sizeBytes: 10_485_760,
          checksumSha256: 'a'.repeat(64),
          uploadedAt: expect.any(String) as string,
        },
        { correlationId: 'corr-id' },
      );

      const order = [
        minio.completeMultipartUpload,
        minio.calcularChecksumSha256,
        repository.marcarComoSubido,
        broker.publish,
      ].map((fn) => fn.mock.invocationCallOrder[0]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('genera un correlationId si el header no viene', async () => {
      await controller.completeUpload(SESSION_ID, body, '');

      expect(broker.publish).toHaveBeenCalledWith(
        'video.uploaded',
        expect.anything(),
        { correlationId: GENERATED_UUID },
      );
    });

    it('responde 404 si la sesión no existe, sin tocar el storage', async () => {
      repository.buscarPorId.mockResolvedValueOnce(null);

      await expect(
        controller.completeUpload(SESSION_ID, body, ''),
      ).rejects.toThrow(NotFoundException);
      expect(minio.completeMultipartUpload).not.toHaveBeenCalled();
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('no publica el evento si el video desaparece antes de persistir el checksum', async () => {
      repository.marcarComoSubido.mockResolvedValueOnce(null);

      await expect(
        controller.completeUpload(SESSION_ID, body, ''),
      ).rejects.toThrow(NotFoundException);
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('no persiste ni publica si falla el cálculo del checksum', async () => {
      minio.calcularChecksumSha256.mockRejectedValueOnce(new Error('stream'));

      await expect(
        controller.completeUpload(SESSION_ID, body, ''),
      ).rejects.toThrow('stream');
      expect(repository.marcarComoSubido).not.toHaveBeenCalled();
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it.todo(
      'responde 400 si el body no trae parts o viene vacío (hoy lanza TypeError -> 500)',
    );
    it.todo(
      'rechaza el objeto ensamblado si su tamaño real no coincide con sizeBytes declarado',
    );
    it.todo(
      'es idempotente si se llama dos veces con la misma sesión (hoy el segundo complete falla en S3)',
    );
    it.todo(
      'el payload de video.uploaded cumple docs/contratos/video.uploaded.schema.json (hoy difiere: checksum/storageUrl)',
    );
  });
});
