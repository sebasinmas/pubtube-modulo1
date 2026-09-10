ALTER TABLE "videos" ADD COLUMN "filename" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "object_key" varchar(512) NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "minio_upload_id" varchar(255) NOT NULL;