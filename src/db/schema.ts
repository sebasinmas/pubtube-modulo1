import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  pgEnum,
  bigint,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const videoStatusEnum = pgEnum('video_status', [
  'borrador',
  'listo',
  'programado',
  'publicado',
]);

export type VideoStatusValue = (typeof videoStatusEnum.enumValues)[number];

export const videos = pgTable(
  'videos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    status: videoStatusEnum('status').default('borrador').notNull(),
    metadata: jsonb('metadata'),
    scheduled_at: timestamp('scheduled_at', { mode: 'date' }),
    youtube_url: varchar('youtube_url', { length: 255 }),
    filename: varchar('filename', { length: 255 }).notNull(),
    object_key: varchar('object_key', { length: 512 }).notNull(),
    minio_upload_id: varchar('minio_upload_id', { length: 255 }).notNull(),
    size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    // SHA-256 calculado por el servidor sobre el objeto completo (fuente de verdad).
    // Único a nivel global (US-A5): NULL mientras la carga no se completa.
    checksum_sha256: varchar('checksum_sha256', { length: 64 }),
    // SHA-256 declarado por el cliente al iniciar la carga (US-A5). Opcional.
    checksum_declarado: varchar('checksum_declarado', { length: 64 }),
  },
  (t) => [uniqueIndex('videos_checksum_sha256_unique').on(t.checksum_sha256)],
);

export type VideoRow = typeof videos.$inferSelect;
