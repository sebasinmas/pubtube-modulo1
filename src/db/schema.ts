import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  pgEnum,
  bigint,
  integer,
  text,
} from 'drizzle-orm/pg-core';

export const videoStatusEnum = pgEnum('video_status', [
  'borrador',
  'listo',
  'programado',
  'publicado',
]);

export type VideoStatusValue = (typeof videoStatusEnum.enumValues)[number];

export const videos = pgTable('videos', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: videoStatusEnum('status').default('borrador').notNull(),
  //metadata: jsonb('metadata'), DESCARTADO DEL MODELO
  scheduled_at: timestamp('scheduled_at', { mode: 'date' }),
  youtube_url: varchar('youtube_url', { length: 255 }),
  filename: varchar('filename', { length: 255 }).notNull(),
  object_key: varchar('object_key', { length: 512 }).notNull(),
  minio_upload_id: varchar('minio_upload_id', { length: 255 }).notNull(),
  size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  checksum_sha256: varchar('checksum_sha256', { length: 64 }),
});

export const visibilityEnum = pgEnum('video_visibility', [
  'public',
  'private',
  'unlisted',
]);

export const metadataVersions = pgTable('metadata_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  videoId: uuid('video_id')
    .notNull()
    .references(() => videos.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(), // Manejo autoincremental por código (1, 2, 3...)
  title: varchar('title', { length: 100 }).notNull(),
  description: text('description'),
  tags: text('tags').array(), // Array nativo de Postgres para evitar tablas pivote innecesarias en historiales
  visibility: visibilityEnum('visibility').notNull().default('private'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
