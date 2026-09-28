#!/bin/sh
# garage-setup.sh
# Provisiona los buckets de un nodo Garage single-node y concede permisos a la
# access key. El layout y la key los crea el propio servidor al arrancar con
# `server --single-node --default-bucket`.
#
# Corre en la imagen garage-setup (Alpine + curl + jq) definida en los
# docker-compose. Es idempotente: puede ejecutarse en cada `up`.
#
# Variables de entorno requeridas:
#   GARAGE_ADMIN_URL   — ej: http://garage:3903
#   GARAGE_ADMIN_TOKEN — mismo token con el que arranca el servidor
#   MINIO_ACCESS_KEY   — access key S3 que recibe los permisos
#   MINIO_BUCKET_CONTENT    — nombre del bucket de contenido
#   MINIO_BUCKET_THUMBNAILS — nombre del bucket de miniaturas
# Opcional:
#   GARAGE_SETUP_TIMEOUT — segundos máximos esperando la Admin API (default 60)

set -eu

ADMIN="${GARAGE_ADMIN_URL:?GARAGE_ADMIN_URL es requerida}"
TOKEN="${GARAGE_ADMIN_TOKEN:?GARAGE_ADMIN_TOKEN es requerida}"
KEY="${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY es requerida}"
TIMEOUT="${GARAGE_SETUP_TIMEOUT:-60}"

admin_get() {
  curl -sf -H "Authorization: Bearer ${TOKEN}" "${ADMIN}$1"
}

admin_post() {
  curl -sf -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-raw "$2" \
    "${ADMIN}$1"
}

# ── 1. Esperar a que la Admin API responda (con límite de tiempo) ────────────
echo "→ Esperando a que Garage acepte conexiones en ${ADMIN} (máx. ${TIMEOUT}s)..."
ELAPSED=0
until admin_get "/v2/GetClusterHealth" >/dev/null 2>&1; do
  if [ "${ELAPSED}" -ge "${TIMEOUT}" ]; then
    echo "✗ Garage no respondió en ${TIMEOUT}s (¿token o URL incorrectos?)." >&2
    exit 1
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done
echo "✓ Garage listo."

# ── 2. Asegurar existencia de buckets y permisos ─────────────────────────────
for BUCKET in "${MINIO_BUCKET_CONTENT:-}" "${MINIO_BUCKET_THUMBNAILS:-}"; do
  [ -z "${BUCKET}" ] && continue

  # GetBucketInfo responde 404 si el bucket no existe; no es un error.
  BUCKET_ID=$(admin_get "/v2/GetBucketInfo?globalAlias=${BUCKET}" 2>/dev/null \
    | jq -r '.id // empty' || true)

  if [ -z "${BUCKET_ID}" ]; then
    echo "→ Creando bucket '${BUCKET}'..."
    RESPONSE=$(admin_post "/v2/CreateBucket" \
      "$(jq -nc --arg alias "${BUCKET}" '{globalAlias: $alias}')")
    BUCKET_ID=$(printf '%s' "${RESPONSE}" | jq -r '.id // empty')
    if [ -z "${BUCKET_ID}" ]; then
      echo "✗ No se pudo crear el bucket '${BUCKET}': ${RESPONSE}" >&2
      exit 1
    fi
  else
    echo "✓ Bucket '${BUCKET}' ya existe (ID: ${BUCKET_ID})."
  fi

  echo "→ Concediendo permisos a '${KEY}' en bucket '${BUCKET}'..."
  admin_post "/v2/AllowBucketKey" "$(jq -nc \
    --arg bid "${BUCKET_ID}" \
    --arg kid "${KEY}" \
    '{bucketId: $bid, accessKeyId: $kid, permissions: {read: true, write: true, owner: true}}')" \
    >/dev/null
  echo "✓ Permisos listos para '${BUCKET}'."
done

echo ""
echo "✅ Aprovisionamiento de Garage completo."
