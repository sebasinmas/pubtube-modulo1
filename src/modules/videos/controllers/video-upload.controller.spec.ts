import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  MENSAJE_DUPLICADO,
  VideoUploadController,
} from './video-upload.controller.js';
import type { MinioService } from '../../../infrastructure/minio/minio.service.js';
import type { MessageBrokerService } from '../../../infrastructure/messaging/message-broker.service.js';
import type { SessionValidator } from '../../../infrastructure/auth/session-validator.interface.js';
import type { VideoRepository } from '../repository/video.repository.js';
import type { VideoRow } from '../../../db/schema.js';
import { ChecksumDuplicadoError } from '../video.errors.js';

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
const OTHER_CONTENT_ID = '22222222-2222-4222-8222-222222222222';
const CHECKSUM_CALCULADO = 'a'.repeat(64);
const CHECKSUM_DISTINTO = 'b'.repeat(64);

/** Error que lanza el SDK de S3 cuando el multipart ya no existe. */
function noSuchUpload(): Error {
  return Object.assign(new Error('The specified upload does not exist'), {
    name: 'NoSuchUpload',
  });
}

/** Cuerpo JSON que Nest enviaría para una HttpException. */
async function cuerpoDelError(promesa: Promise<unknown>): Promise<unknown> {
  const error: unknown = await promesa.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

/** Fila de BD completa y consistente con lo que crea initUpload. */
function videoRow(overrides: Partial<VideoRow> = {}): VideoRow {
  return {
    id: SESSION_ID,
    status: 'borrador',
    scheduled_at: null,
    youtube_url: null,
    filename: 'tutorial.mp4',
    object_key: `${SESSION_ID}/tutorial.mp4`,
    minio_upload_id: 'upload-id-777',
    size_bytes: 10_485_760,
    checksum_sha256: null,
    checksum_declarado: null,
    created_at: new Date(0),
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
    eliminarObjeto: Mock<MinioService['eliminarObjeto']>;
    obtenerTamanoObjeto: Mock<MinioService['obtenerTamanoObjeto']>;
    abortarMultipartUpload: Mock<MinioService['abortarMultipartUpload']>;
    obtenerStorageUrl: Mock<MinioService['obtenerStorageUrl']>;
  };
  let repository: {
    crearBorrador: Mock<VideoRepository['crearBorrador']>;
    buscarPorId: Mock<VideoRepository['buscarPorId']>;
    buscarPorChecksum: Mock<VideoRepository['buscarPorChecksum']>;
    marcarComoSubido: Mock<VideoRepository['marcarComoSubido']>;
    eliminar: Mock<VideoRepository['eliminar']>;
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
        .mockResolvedValue(CHECKSUM_CALCULADO),
      eliminarObjeto: vi
        .fn<MinioService['eliminarObjeto']>()
        .mockResolvedValue(undefined),
      obtenerTamanoObjeto: vi
        .fn<MinioService['obtenerTamanoObjeto']>()
        .mockResolvedValue(10_485_760),
      abortarMultipartUpload: vi
        .fn<MinioService['abortarMultipartUpload']>()
        .mockResolvedValue(undefined),
      obtenerStorageUrl: vi
        .fn<MinioService['obtenerStorageUrl']>()
        .mockImplementation((bucket, key) => `s3://${bucket}/${key}`),
    };
    repository = {
      crearBorrador: vi
        .fn<VideoRepository['crearBorrador']>()
        .mockImplementation(({ checksum_declarado = null, ...input }) =>
          Promise.resolve(videoRow({ ...input, checksum_declarado })),
        ),
      buscarPorId: vi
        .fn<VideoRepository['buscarPorId']>()
        .mockResolvedValue(videoRow()),
      buscarPorChecksum: vi
        .fn<VideoRepository['buscarPorChecksum']>()
        .mockResolvedValue(null),
      eliminar: vi.fn<VideoRepository['eliminar']>().mockResolvedValue(),
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
        checksum_declarado: null,
      });
      expect(repository.buscarPorChecksum).not.toHaveBeenCalled();
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

    describe('checksum declarado (US-A5)', () => {
      it('guarda el checksum normalizado a minúsculas si no existe contenido con ese hash', async () => {
        await expect(
          controller.initUpload(
            validInitPayload({ checksum: 'ABCDEF'.padEnd(64, '0') }),
            '',
          ),
        ).resolves.toMatchObject({ status: 201 });

        const normalizado = 'abcdef'.padEnd(64, '0');
        expect(repository.buscarPorChecksum).toHaveBeenCalledWith(normalizado);
        expect(repository.crearBorrador).toHaveBeenCalledWith(
          expect.objectContaining({ checksum_declarado: normalizado }),
        );
      });

      it('responde 409 DUPLICATE_CONTENT con el contenido previo sin iniciar el multipart', async () => {
        repository.buscarPorChecksum.mockResolvedValueOnce(
          videoRow({
            id: OTHER_CONTENT_ID,
            checksum_sha256: CHECKSUM_CALCULADO,
          }),
        );

        const body = await cuerpoDelError(
          controller.initUpload(
            validInitPayload({ checksum: CHECKSUM_CALCULADO }),
            '',
          ),
        );

        expect(body).toEqual({
          statusCode: 409,
          error: 'DUPLICATE_CONTENT',
          message: 'Este video ya existe en el catálogo',
          existingContentId: OTHER_CONTENT_ID,
        });
        expect(minio.createMultipartUpload).not.toHaveBeenCalled();
        expect(repository.crearBorrador).not.toHaveBeenCalled();
      });

      it.each([
        ['no hexadecimal', 'z'.repeat(64)],
        ['63 caracteres', 'a'.repeat(63)],
        ['65 caracteres', 'a'.repeat(65)],
        ['vacío', ''],
        ['número', 12345],
      ])('rechaza checksum %s con 400', async (_caso, checksum) => {
        await expect(
          controller.initUpload(validInitPayload({ checksum }), ''),
        ).rejects.toThrow(BadRequestException);
        expect(repository.buscarPorChecksum).not.toHaveBeenCalled();
        expect(minio.createMultipartUpload).not.toHaveBeenCalled();
      });
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

    it('responde 410 y elimina la sesión si el multipart ya no existe en el storage', async () => {
      minio.listParts.mockRejectedValueOnce(noSuchUpload());

      await expect(controller.getUploadStatus(SESSION_ID, '')).rejects.toThrow(
        GoneException,
      );
      expect(repository.eliminar).toHaveBeenCalledWith(SESSION_ID);
    });

    it('propaga los errores de storage distintos de NoSuchUpload', async () => {
      minio.listParts.mockRejectedValueOnce(new Error('boom'));

      await expect(controller.getUploadStatus(SESSION_ID, '')).rejects.toThrow(
        'boom',
      );
      expect(repository.eliminar).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/content/upload/:sessionId/complete', () => {
    const body = {
      parts: [
        { PartNumber: 1, ETag: '"etag-1"' },
        { PartNumber: 2, ETag: '"etag-2"' },
      ],
    };

    it('responde 410, elimina la sesión y no publica si el multipart ya no existe', async () => {
      minio.completeMultipartUpload.mockRejectedValueOnce(noSuchUpload());

      await expect(
        controller.completeUpload(SESSION_ID, body, 'corr-id'),
      ).rejects.toThrow(GoneException);
      expect(repository.eliminar).toHaveBeenCalledWith(SESSION_ID);
      expect(minio.calcularChecksumSha256).not.toHaveBeenCalled();
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('ensambla, calcula el checksum, persiste y publica video.uploaded, en ese orden', async () => {
      const result = await controller.completeUpload(
        SESSION_ID,
        body,
        'corr-id',
      );

      expect(result).toEqual({
        status: 200,
        contentId: SESSION_ID,
        checksumSha256: CHECKSUM_CALCULADO,
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
        CHECKSUM_CALCULADO,
      );
      expect(broker.publish).toHaveBeenCalledWith(
        'video.uploaded',
        {
          contentId: SESSION_ID,
          checksum: CHECKSUM_CALCULADO,
          storageUrl: `s3://${BUCKET}/${SESSION_ID}/tutorial.mp4`,
          sessionId: SESSION_ID,
          sizeBytes: 10_485_760,
          checksumSha256: CHECKSUM_CALCULADO,
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
    it('responde 422 SIZE_MISMATCH sin hashear si el tamaño real no coincide con sizeBytes', async () => {
      minio.obtenerTamanoObjeto.mockResolvedValueOnce(1);

      const cuerpo = await cuerpoDelError(
        controller.completeUpload(SESSION_ID, body, 'corr-id'),
      );

      expect(cuerpo).toMatchObject({
        statusCode: 422,
        error: 'SIZE_MISMATCH',
        expected: 10_485_760,
        actual: 1,
      });
      expect(minio.calcularChecksumSha256).not.toHaveBeenCalled();
      expect(minio.eliminarObjeto).toHaveBeenCalledWith(
        BUCKET,
        `${SESSION_ID}/tutorial.mp4`,
      );
      expect(repository.eliminar).toHaveBeenCalledWith(SESSION_ID);
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('es idempotente: si la sesión ya se completó devuelve el mismo resultado sin tocar S3 ni republicar', async () => {
      repository.buscarPorId.mockResolvedValueOnce(
        videoRow({ checksum_sha256: CHECKSUM_CALCULADO }),
      );

      const result = await controller.completeUpload(
        SESSION_ID,
        body,
        'corr-id',
      );

      expect(result).toEqual({
        status: 200,
        contentId: SESSION_ID,
        checksumSha256: CHECKSUM_CALCULADO,
      });
      expect(minio.completeMultipartUpload).not.toHaveBeenCalled();
      expect(minio.calcularChecksumSha256).not.toHaveBeenCalled();
      expect(broker.publish).not.toHaveBeenCalled();
    });

    it('el payload de video.uploaded cumple docs/contratos/video.uploaded.schema.json', async () => {
      const schema: object = JSON.parse(
        readFileSync('docs/contratos/video.uploaded.schema.json', 'utf8'),
      ) as object;
      const validar = new Ajv({ allErrors: true }).compile(schema);
      // El sobre lo arma el broker; aquí se valida el payload dentro de un
      // sobre mínimo válido.
      await controller.completeUpload(SESSION_ID, body, 'corr-id');
      const [[type, payload]] = broker.publish.mock.calls;

      const valido = validar({
        id: 'evt-1',
        type,
        version: 1,
        timestamp: new Date(0).toISOString(),
        correlationId: 'corr-id',
        causationId: 'corr-id',
        source: 'module1-content',
        payload,
      });
      expect(validar.errors ?? []).toEqual([]);
      expect(valido).toBe(true);
    });

    describe('verificación de integridad (US-A5)', () => {
      it('publica si el hash calculado coincide con el declarado', async () => {
        repository.buscarPorId.mockResolvedValueOnce(
          videoRow({ checksum_declarado: CHECKSUM_CALCULADO }),
        );

        await expect(
          controller.completeUpload(SESSION_ID, body, ''),
        ).resolves.toMatchObject({ checksumSha256: CHECKSUM_CALCULADO });
        expect(broker.publish).toHaveBeenCalledOnce();
        expect(minio.eliminarObjeto).not.toHaveBeenCalled();
      });

      it('responde 422 INTEGRITY_CHECK_FAILED, elimina objeto y sesión y no publica', async () => {
        repository.buscarPorId.mockResolvedValueOnce(
          videoRow({ checksum_declarado: CHECKSUM_DISTINTO }),
        );

        const error = controller.completeUpload(SESSION_ID, body, '');
        await expect(error).rejects.toThrow(UnprocessableEntityException);
        expect(await cuerpoDelError(error)).toMatchObject({
          statusCode: 422,
          error: 'INTEGRITY_CHECK_FAILED',
          expected: CHECKSUM_DISTINTO,
          actual: CHECKSUM_CALCULADO,
        });
        expect(minio.eliminarObjeto).toHaveBeenCalledWith(
          BUCKET,
          `${SESSION_ID}/tutorial.mp4`,
        );
        expect(repository.eliminar).toHaveBeenCalledWith(SESSION_ID);
        expect(repository.marcarComoSubido).not.toHaveBeenCalled();
        expect(broker.publish).not.toHaveBeenCalled();
      });

      it('responde 422 aunque falle la limpieza del objeto', async () => {
        repository.buscarPorId.mockResolvedValueOnce(
          videoRow({ checksum_declarado: CHECKSUM_DISTINTO }),
        );
        minio.eliminarObjeto.mockRejectedValueOnce(new Error('S3 caído'));

        await expect(
          controller.completeUpload(SESSION_ID, body, ''),
        ).rejects.toThrow(UnprocessableEntityException);
        expect(repository.eliminar).toHaveBeenCalledWith(SESSION_ID);
      });

      it('sin checksum declarado no compara y persiste el calculado', async () => {
        await controller.completeUpload(SESSION_ID, body, '');

        expect(repository.marcarComoSubido).toHaveBeenCalledWith(
          SESSION_ID,
          CHECKSUM_CALCULADO,
        );
        expect(minio.eliminarObjeto).not.toHaveBeenCalled();
      });
    });

    describe('duplicado concurrente (índice único, US-A5)', () => {
      it('traduce ChecksumDuplicadoError a 409 con el contenido previo, limpia y no publica', async () => {
        repository.marcarComoSubido.mockRejectedValueOnce(
          new ChecksumDuplicadoError(CHECKSUM_CALCULADO, OTHER_CONTENT_ID),
        );

        const error = controller.completeUpload(SESSION_ID, body, '');
        await expect(error).rejects.toThrow(ConflictException);
        expect(await cuerpoDelError(error)).toMatchObject({
          statusCode: 409,
          error: 'DUPLICATE_CONTENT',
          existingContentId: OTHER_CONTENT_ID,
        });
        expect(minio.eliminarObjeto).toHaveBeenCalledWith(
          BUCKET,
          `${SESSION_ID}/tutorial.mp4`,
        );
        expect(repository.eliminar).toHaveBeenCalledWith(SESSION_ID);
        expect(broker.publish).not.toHaveBeenCalled();
      });

      it('propaga otros errores de BD sin borrar la carga', async () => {
        repository.marcarComoSubido.mockRejectedValueOnce(
          new Error('BD caída'),
        );

        await expect(
          controller.completeUpload(SESSION_ID, body, ''),
        ).rejects.toThrow('BD caída');
        expect(minio.eliminarObjeto).not.toHaveBeenCalled();
        expect(repository.eliminar).not.toHaveBeenCalled();
        expect(broker.publish).not.toHaveBeenCalled();
      });
    });
  });

  describe('detención de una subida en curso por duplicado (US-A5)', () => {
    const body = { parts: [{ PartNumber: 1, ETag: '"etag-1"' }] };
    const sesionConChecksum = (): VideoRow =>
      videoRow({ checksum_declarado: CHECKSUM_CALCULADO });
    const otroYaCompletado = (): VideoRow =>
      videoRow({ id: OTHER_CONTENT_ID, checksum_sha256: CHECKSUM_CALCULADO });

    const endpoints: [string, () => Promise<unknown>][] = [
      ['GET part', () => controller.getPresignedUrl(SESSION_ID, 2)],
      ['GET status', () => controller.getUploadStatus(SESSION_ID, '')],
      ['POST complete', () => controller.completeUpload(SESSION_ID, body, '')],
    ];

    it.each(endpoints)(
      '%s responde 409, aborta el multipart y elimina la sesión si otra carga ya se completó',
      async (_caso, llamar) => {
        repository.buscarPorId.mockResolvedValueOnce(sesionConChecksum());
        repository.buscarPorChecksum.mockResolvedValueOnce(otroYaCompletado());

        expect(await cuerpoDelError(llamar())).toEqual({
          statusCode: 409,
          error: 'DUPLICATE_CONTENT',
          message: MENSAJE_DUPLICADO,
          existingContentId: OTHER_CONTENT_ID,
        });
        expect(minio.abortarMultipartUpload).toHaveBeenCalledWith(
          BUCKET,
          `${SESSION_ID}/tutorial.mp4`,
          'upload-id-777',
        );
        expect(repository.eliminar).toHaveBeenCalledWith(SESSION_ID);
        expect(minio.getPresignedUrl).not.toHaveBeenCalled();
        expect(minio.listParts).not.toHaveBeenCalled();
        expect(minio.completeMultipartUpload).not.toHaveBeenCalled();
        expect(broker.publish).not.toHaveBeenCalled();
      },
    );

    it('no detiene la sesión si el checksum encontrado es el suyo propio', async () => {
      repository.buscarPorId.mockResolvedValueOnce(sesionConChecksum());
      repository.buscarPorChecksum.mockResolvedValueOnce(
        videoRow({ checksum_sha256: CHECKSUM_CALCULADO }),
      );

      await expect(
        controller.getPresignedUrl(SESSION_ID, 1),
      ).resolves.toHaveProperty('url');
      expect(minio.abortarMultipartUpload).not.toHaveBeenCalled();
    });

    it('sin checksum declarado no consulta duplicados', async () => {
      await controller.getPresignedUrl(SESSION_ID, 1);

      expect(repository.buscarPorChecksum).not.toHaveBeenCalled();
    });

    it('responde 409 aunque falle el abort del multipart', async () => {
      repository.buscarPorId.mockResolvedValueOnce(sesionConChecksum());
      repository.buscarPorChecksum.mockResolvedValueOnce(otroYaCompletado());
      minio.abortarMultipartUpload.mockRejectedValueOnce(
        new Error('NoSuchUpload'),
      );

      await expect(controller.getPresignedUrl(SESSION_ID, 1)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.eliminar).toHaveBeenCalledWith(SESSION_ID);
    });
  });
});
