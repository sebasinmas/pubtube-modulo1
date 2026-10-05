-- Rollback manual de 0004_borradores_abandonados (drizzle-kit no genera "down").
-- Aplicar con psql y luego eliminar la fila correspondiente de
-- drizzle.__drizzle_migrations (la de mayor created_at).
ALTER TABLE "videos" DROP COLUMN IF EXISTS "created_at";
