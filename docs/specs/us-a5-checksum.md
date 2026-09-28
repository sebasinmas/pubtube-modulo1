# US-A5 — Idempotencia de carga (anti-duplicados) + verificación de integridad

Estado: **implementada en `feat/us-a5-checksum`**. Unitarios, integración, `validate` y `build` en verde en local. Falta el PR y la ejecución de CI.

## 1. Hallazgos de la exploración

- `develop` (`54a2957`) **no contiene US-A1**: la carga resumible solo está en `main` (`9963ab4`). La rama se creó desde `feature/checksum-addition`, que es `main` más 4 commits de hardening, tests y docs (decisión del usuario).
- Carga (US-A1): `VideoUploadController` en `/api/content`, sin DTOs ni `ValidationPipe`.
- El SHA-256 ya se calculaba por stream desde Garage al completar (sin usar el ETag), pero no se comparaba con nada y no había unicidad.
- `videos.checksum_sha256` ya existía, nullable y sin índice.
- `video.uploaded` **no cumplía** `docs/contratos/video.uploaded.schema.json`: le faltaban `checksum` y `storageUrl`.
- No existía `@nestjs/swagger`.
- El enum `video_status` no tiene un estado "fallido".

### Restos de MinIO (se reportan; no se renombran por ADR 002)
- `MinioService`, `src/infrastructure/minio/`, la columna `minio_upload_id` y las variables `MINIO_*`.
- `MinioService` tiene **credenciales por defecto hardcodeadas** (`'minioadmin'`) como fallback del constructor. Contradice "sin credenciales en código". No se cambió aquí, para no alterar el arranque de otras historias.
- El log `'Cliente S3/MinIO inicializado'` y varios comentarios todavía dicen MinIO.
- En la máquina de desarrollo sigue corriendo un contenedor `module1-minio` de antes de la migración (no lo crea este repo).

## 2. Decisiones tomadas

| Tema | Decisión | Por qué |
|---|---|---|
| Rama base | `feat/us-a5-checksum` desde `feature/checksum-addition` | `develop` no tiene US-A1 |
| Endpoints | Se conservan las rutas y nombres acordados (`/api/content/init`, `sizeBytes`, `uploadSessionId`, …) | Son contrato; las rutas del prompt eran ilustrativas |
| `checksum` en `init` | **Opcional** (aditivo, no rompe clientes) | Si viene, se aplican el 409 temprano y el 422. Si no viene, solo aplica la unicidad al completar. Hacerlo obligatorio es cambiar una línea |
| Columna | Se reutiliza `checksum_sha256` (índice único) y se agrega `checksum_declarado` | La columna ya existía; renombrarla rompería US-A1 |
| Evento | Payload conforme a v1 (`contentId`, `checksum`, `storageUrl`), conservando los campos antiguos como extras | El esquema no tiene `additionalProperties: false`; no se toca el JSON Schema |
| `storageUrl` | `s3://<bucket>/<key>` | Es persistente: no caduca como una URL prefirmada ni depende del endpoint interno de Docker |
| Fallo de integridad o duplicado | Se borran el objeto (DeleteObject) y la fila en borrador | No hay estado "fallido" y no se toca la máquina de estados |
| Funciones S3 | Solo Create/Complete/Abort/ListParts/UploadPart/GetObject/DeleteObject y lifecycle `AbortIncompleteMultipartUpload` | Garage las soporta; no se usan checksums nativos de S3, versionado ni object lock |

## 3. Diseño

- **init**: se valida el formato (`/^[0-9a-f]{64}$/i`, si no → 400) y se normaliza a minúsculas. Si existe `checksum_sha256` igual → 409 `DUPLICATE_CONTENT` **antes** de `CreateMultipartUpload`. Se guarda en `checksum_declarado`.
- **complete**: `CompleteMultipartUpload` → SHA-256 por stream (`GetObject`) → si hay declarado y difiere: se borran objeto y fila y se responde 422 `INTEGRITY_CHECK_FAILED` (`expected`, `actual`). Después `UPDATE checksum_sha256`: el índice único es la garantía final. `VideoRepository` detecta `23505` sobre `videos_checksum_sha256_unique` (también cuando viene envuelto en `DrizzleQueryError.cause`) y lanza `ChecksumDuplicadoError(existingContentId)`. El controlador borra el objeto y la fila y responde 409. `video.uploaded` se publica **solo** después de persistir.
- El índice único admite NULL, así que los borradores sin completar no colisionan entre sí. Por eso dos cargas concurrentes pasan el `init`, y la segunda que completa recibe 409.

### 3.1 Manejo de la respuesta 409 (tarjeta US-A5, 1 SP — lado backend)

| Punto de la tarjeta | Implementación backend |
|---|---|
| Detectar el 409 | Se detecta en **cuatro** puntos: `init` (antes de abrir multipart), `GET part` y `GET status` (subida en curso) y `complete` (antes de ensamblar, y por índice único después). |
| Mensaje descriptivo | `message: "Este video ya existe en el catálogo"` (`MENSAJE_DUPLICADO`), junto con `error: "DUPLICATE_CONTENT"` y `existingContentId`. |
| Detener la carga y liberar | Si otra carga del mismo checksum ya se completó, la siguiente petición de la sesión responde 409. Además se **aborta el multipart** (Garage libera las partes) y se elimina la sesión, así que no hay nada que reanudar (`status` → 404). No se firman más URLs de partes. |

### 3.2 Limpieza de multipart abandonados en Garage

- `scripts/garage-setup.sh` aplica `PutBucketLifecycleConfiguration` al bucket de contenido con `AbortIncompleteMultipartUpload.DaysAfterInitiation = GARAGE_MULTIPART_ABORT_DAYS` (7 por defecto). Garage solo soporta `AbortIncompleteMultipartUpload` y `Expiration` (ver *reference-manual/s3-compatibility*).
- La petición se firma con SigV4 usando `curl --aws-sigv4`. Las credenciales se pasan por stdin. Es idempotente, porque el PUT reemplaza la configuración, y después se verifica con un GET. Se comprobó corriéndolo dos veces seguidas.
- Alternativa manual: `garage bucket cleanup-incomplete-uploads --older-than 7d videos`.
- ⚠️ Cuando Garage aborta un multipart, la fila `borrador` queda en la BD con un `minio_upload_id` que ya no existe. Si el cliente pide `status` o `part` de esa sesión obtiene un 500 (`NoSuchUpload`), que viene de US-A1. Falta un job que limpie esas filas o que traduzca `NoSuchUpload` a 404/410.

## 4. Migración `0003_us_a5_checksum_unico`

```sql
ALTER TABLE "videos" ADD COLUMN "checksum_declarado" varchar(64);
CREATE UNIQUE INDEX "videos_checksum_sha256_unique" ON "videos" USING btree ("checksum_sha256");
```

Rollback (drizzle-kit no genera "down"): `src/db/rollbacks/0003_us_a5_checksum_unico.down.sql`

```sql
DROP INDEX IF EXISTS "videos_checksum_sha256_unique";
ALTER TABLE "videos" DROP COLUMN IF EXISTS "checksum_declarado";
```

⚠️ Si una base existente ya tiene checksums duplicados (subidas repetidas durante US-A1), el `CREATE UNIQUE INDEX` falla. Antes de migrar esas bases hay que revisarlas con `SELECT checksum_sha256, count(*) FROM videos WHERE checksum_sha256 IS NOT NULL GROUP BY 1 HAVING count(*) > 1;`.

## 5. Endpoints

| Método | Ruta | Cambio | Códigos |
|---|---|---|---|
| POST | `/api/content/init` | nuevo campo opcional `checksum` | 201, 400 (checksum inválido, nuevo), **409 `DUPLICATE_CONTENT`**, 413, 415 |
| POST | `/api/content/upload/:sessionId/complete` | verificación de integridad y unicidad | 200, 404, **409 `DUPLICATE_CONTENT`**, **422 `INTEGRITY_CHECK_FAILED`** |
| GET | `/api/content/:sessionId/part/:partNumber` | detiene la subida si ya existe el duplicado | 200, 404, **409 `DUPLICATE_CONTENT`** |
| GET | `/api/content/upload/:sessionId/status` | detiene la subida si ya existe el duplicado | 200, 404, **409 `DUPLICATE_CONTENT`** |
| GET | `/api/docs` | nuevo: Swagger UI / OpenAPI | 200 |

## 6. Pruebas

- Unitarios (`pnpm run validate`): 8 archivos, **103 passed / 11 todo**.
- Integración (`pnpm test:integration`, Postgres y Garage v2.4.1 reales en Docker): 3 archivos, **12 passed**. Incluye la subida detenida en curso y la regla de lifecycle.
- `pnpm run build` OK. Se inspeccionó el OpenAPI generado: `init` → 201/400/409/413/415, `complete` → 200/404/409/422.

## 7. Pendientes / riesgos

- **CI**: el job de integración solo corre en PR/push a `main` o `workflow_dispatch`. Un PR contra `develop` no lo ejecuta, así que hay que lanzarlo con *Run workflow* o abrir el PR contra `main`.
- **Acordar con el núcleo y los consumidores**: el formato de `storageUrl` (`s3://…`) y el plan para retirar los campos extra del payload (`sessionId`, `sizeBytes`, `checksumSha256`, `uploadedAt`).
- **Acordar con el frontend** si `checksum` pasa a ser obligatorio.
- Los multipart abandonados los aborta Garage a los `GARAGE_MULTIPART_ABORT_DAYS` días (§3.2), pero la fila `borrador` sigue en la BD (ver la advertencia de §3.2).
- Si falla la limpieza de un objeto (DeleteObject), se loguea y se devuelve igual el 409/422. No hay reintento.
- El 409 de `init` permite averiguar si un hash dado existe en el catálogo (oráculo de existencia). Es aceptable según el objetivo de la historia, pero conviene saberlo cuando exista autenticación real.
