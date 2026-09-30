-- Rollback manual de 0003_us_a5_checksum_unico (drizzle-kit no genera "down").
-- Aplicar con psql y luego eliminar la fila correspondiente de
-- drizzle.__drizzle_migrations (la de mayor created_at).
DROP INDEX IF EXISTS "videos_checksum_sha256_unique";
ALTER TABLE "videos" DROP COLUMN IF EXISTS "checksum_declarado";
