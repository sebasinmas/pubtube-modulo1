CREATE TYPE "public"."video_visibility" AS ENUM('public', 'private', 'unlisted');--> statement-breakpoint
CREATE TABLE "metadata_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(100) NOT NULL,
	"description" text,
	"tags" text[],
	"visibility" "video_visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "metadata_versions_video_id_version_unique" UNIQUE("video_id","version"),
	CONSTRAINT "metadata_versions_version_positive" CHECK ("metadata_versions"."version" >= 1),
	CONSTRAINT "metadata_versions_title_not_blank" CHECK (char_length(btrim("metadata_versions"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "metadata_versions" ADD CONSTRAINT "metadata_versions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" DROP COLUMN "metadata";