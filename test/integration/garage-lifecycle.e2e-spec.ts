import '@dotenvx/dotenvx/config';
import { describe, it, expect } from 'vitest';
import { GetBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import { MinioService } from '../../src/infrastructure/minio/minio.service.js';

/*
  Verifica que scripts/garage-setup.sh dejó configurada en el bucket de
  contenido la regla que aborta multipart incompletos (cargas abandonadas).
 */
describe('Garage — lifecycle del bucket de contenido', () => {
  it('aborta multipart incompletos tras GARAGE_MULTIPART_ABORT_DAYS días', async () => {
    const minio = new MinioService();
    const dias = Number(process.env.GARAGE_MULTIPART_ABORT_DAYS ?? 7);

    const res = await minio.client.send(
      new GetBucketLifecycleConfigurationCommand({
        Bucket: process.env.MINIO_BUCKET_CONTENT ?? 'videos',
      }),
    );

    expect(res.Rules).toContainEqual(
      expect.objectContaining({
        ID: 'abortar-multipart-incompletos',
        Status: 'Enabled',
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: dias },
      }),
    );
  });
});
