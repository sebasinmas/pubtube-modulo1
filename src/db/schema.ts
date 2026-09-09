import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  pgEnum,
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
  metadata: jsonb('metadata'),
  scheduled_at: timestamp('scheduled_at', { mode: 'date' }),
  youtube_url: varchar('youtube_url', { length: 255 }),
  filename: varchar('filename', { length: 255 }).notNull(),
  object_key: varchar('object_key', { length: 512 }).notNull(),
  minio_upload_id: varchar('minio_upload_id', { length: 255 }).notNull(),
});
