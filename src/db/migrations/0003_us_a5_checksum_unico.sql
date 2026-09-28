ALTER TABLE "videos" ADD COLUMN "checksum_declarado" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "videos_checksum_sha256_unique" ON "videos" USING btree ("checksum_sha256");