-- =============================================================
-- Módulo 1 – Gestión de Contenidos
-- Modelo de Datos Inicial
-- =============================================================

-- Extensión para generación de UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------
-- Tabla: content
-- Almacena el registro principal de cada pieza de contenido.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID          NOT NULL,
    status        VARCHAR(50)   NOT NULL DEFAULT 'pending',
    checksum      VARCHAR(256)  NOT NULL UNIQUE,
    storage_url   TEXT          NOT NULL,
    thumbnail_url TEXT,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Índices de uso frecuente
CREATE INDEX IF NOT EXISTS idx_content_owner_id  ON content (owner_id);
CREATE INDEX IF NOT EXISTS idx_content_status     ON content (status);

-- -------------------------------------------------------------
-- Tabla: metadata_version
-- Historial versionado de metadatos asociados a un contenido.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metadata_version (
    id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id  UUID          NOT NULL REFERENCES content (id) ON DELETE CASCADE,
    version     INTEGER       NOT NULL DEFAULT 1,
    title       VARCHAR(255)  NOT NULL,
    description TEXT,
    tags        TEXT[]        NOT NULL DEFAULT '{}',
    visibility  VARCHAR(50)   NOT NULL DEFAULT 'private',
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- Cada par (content_id, version) debe ser único
    CONSTRAINT uq_content_version UNIQUE (content_id, version)
);

-- Índices de uso frecuente
CREATE INDEX IF NOT EXISTS idx_metadata_content_id ON metadata_version (content_id);
CREATE INDEX IF NOT EXISTS idx_metadata_visibility  ON metadata_version (visibility);
