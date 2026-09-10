CREATE TYPE "public"."video_status" AS ENUM('borrador', 'listo', 'programado', 'publicado');--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "video_status" DEFAULT 'borrador' NOT NULL,
	"metadata" jsonb,
	"scheduled_at" timestamp,
	"youtube_url" varchar(255)
);
