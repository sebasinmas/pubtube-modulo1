import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  bigint,
  integer,
  text,
  unique,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
    scheduled_at: timestamp('scheduled_at', { mode: 'date' }),
    youtube_url: varchar('youtube_url', { length: 255 }),
    filename: varchar('filename', { length: 255 }).notNull(),
    object_key: varchar('object_key', { length: 512 }).notNull(),
    minio_upload_id: varchar('minio_upload_id', { length: 255 }).notNull(),
    size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum_sha256: varchar('checksum_sha256', { length: 64 }),
    checksum_declarado: varchar('checksum_declarado', { length: 64 }),
    created_at: timestamp('created_at', { mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex('videos_checksum_sha256_unique').on(t.checksum_sha256)],
);

export type VideoRow = typeof videos.$inferSelect;

export const visibilityEnum = pgEnum('video_visibility', [
  'public',
  'private',
  'unlisted',
]);

export const metadataVersions = pgTable(
  'metadata_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: varchar('title', { length: 100 }).notNull(),
    description: text('description'),
    tags: text('tags').array(),
    visibility: visibilityEnum('visibility').notNull().default('private'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('metadata_versions_video_id_version_unique').on(
      t.videoId,
      t.version,
    ),
    check('metadata_versions_version_positive', sql`${t.version} >= 1`),
    check(
      'metadata_versions_title_not_blank',
      sql`char_length(btrim(${t.title})) > 0`,
    ),
  ],
);