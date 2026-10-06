import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import { VideoCleanupService } from './video-cleanup.service.js';
import type { MinioService } from '../../../infrastructure/minio/minio.service.js';
import type { VideoRepository } from '../repository/video.repository.js';
import type { VideoRow } from '../../../db/schema.js';

const BUCKET = 'videos';
const DIA_MS = 24 * 60 * 60 * 1000;
const AHORA = new Date(1_800_000_000_000);

function borrador(id: string): VideoRow {
  return {
    id,
    status: 'borrador',
    scheduled_at: null,
    youtube_url: null,
    filename: 'clase.mp4',
    object_key: `${id}/clase.mp4`,
    minio_upload_id: `upload-${id}`,
    size_bytes: 1024,
    checksum_sha256: null,
    checksum_declarado: null,
    created_at: new Date(0),
  };
}

describe('VideoCleanupService.limpiarBorradoresAbandonados', () => {
  let repository: {
    eliminarAbandonados: Mock<VideoRepository['eliminarAbandonados']>;
  };
  let minio: {
    abortarMultipartUpload: Mock<MinioService['abortarMultipartUpload']>;
  };
  let service: VideoCleanupService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
    vi.stubEnv('MINIO_BUCKET_CONTENT', BUCKET);
    vi.stubEnv('BORRADOR_ABANDONADO_DIAS', undefined);

    repository = {
      eliminarAbandonados: vi
        .fn<VideoRepository['eliminarAbandonados']>()
        .mockResolvedValue([]),
    };
    minio = {
      abortarMultipartUpload: vi
        .fn<MinioService['abortarMultipartUpload']>()
        .mockResolvedValue(undefined),
    };
    service = new VideoCleanupService(
      repository as unknown as VideoRepository,
      minio as unknown as MinioService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('usa 8 días de antigüedad por defecto (mayor que los 7 del lifecycle de Garage)', async () => {
    await service.limpiarBorradoresAbandonados();

    expect(repository.eliminarAbandonados).toHaveBeenCalledWith(
      new Date(AHORA.getTime() - 8 * DIA_MS),
    );
  });

  it('respeta BORRADOR_ABANDONADO_DIAS', async () => {
    vi.stubEnv('BORRADOR_ABANDONADO_DIAS', '3');

    await service.limpiarBorradoresAbandonados();

    expect(repository.eliminarAbandonados).toHaveBeenCalledWith(
      new Date(AHORA.getTime() - 3 * DIA_MS),
    );
  });

  it('ignora un BORRADOR_ABANDONADO_DIAS inválido y usa el valor por defecto', async () => {
    vi.stubEnv('BORRADOR_ABANDONADO_DIAS', 'abc');

    await service.limpiarBorradoresAbandonados();

    expect(repository.eliminarAbandonados).toHaveBeenCalledWith(
      new Date(AHORA.getTime() - 8 * DIA_MS),
    );
  });

  it('aborta el multipart de cada borrador eliminado y devuelve el total', async () => {
    repository.eliminarAbandonados.mockResolvedValueOnce([
      borrador('a'),
      borrador('b'),
    ]);

    await expect(service.limpiarBorradoresAbandonados()).resolves.toBe(2);

    expect(minio.abortarMultipartUpload).toHaveBeenCalledTimes(2);
    expect(minio.abortarMultipartUpload).toHaveBeenCalledWith(
      BUCKET,
      'a/clase.mp4',
      'upload-a',
    );
    expect(minio.abortarMultipartUpload).toHaveBeenCalledWith(
      BUCKET,
      'b/clase.mp4',
      'upload-b',
    );
  });

  it('sin borradores abandonados no llama al storage', async () => {
    await expect(service.limpiarBorradoresAbandonados()).resolves.toBe(0);

    expect(minio.abortarMultipartUpload).not.toHaveBeenCalled();
  });

  it('un fallo al abortar un multipart (p. ej. NoSuchUpload) no frena el resto ni lanza', async () => {
    repository.eliminarAbandonados.mockResolvedValueOnce([
      borrador('a'),
      borrador('b'),
    ]);
    minio.abortarMultipartUpload.mockRejectedValueOnce(
      Object.assign(new Error('no existe'), { name: 'NoSuchUpload' }),
    );

    await expect(service.limpiarBorradoresAbandonados()).resolves.toBe(2);

    expect(minio.abortarMultipartUpload).toHaveBeenCalledTimes(2);
  });

  it('un fallo de BD no se propaga al scheduler', async () => {
    repository.eliminarAbandonados.mockRejectedValueOnce(new Error('db caída'));

    await expect(service.limpiarBorradoresAbandonados()).resolves.toBe(0);

    expect(minio.abortarMultipartUpload).not.toHaveBeenCalled();
  });
});
