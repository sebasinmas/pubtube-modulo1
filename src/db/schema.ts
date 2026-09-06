import {pgTable, uuid, varchar, timestamp, jsonb, pgEnum} from 'drizzle-orm/pg-core';

export const videoStatusEnum = pgEnum('video_status', [
    'borrador',
    'listo',
    'programado',
    'publicado'
]);

export const videos = pgTable('videos',{
    id: uuid('id').defaultRandom().primaryKey(),
    status: videoStatusEnum('status').default('borrador').notNull(),
    metadata: jsonb('metadata'),
    scheduled_at: timestamp('scheduled_at', {mode:'date'}),
    youtube_url: varchar('youtube_url', {length: 255}),
});