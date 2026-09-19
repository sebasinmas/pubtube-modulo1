ALTER TABLE "videos" ADD COLUMN "size_bytes" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "checksum_sha256" varchar(64);