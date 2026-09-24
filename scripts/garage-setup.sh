#!/bin/sh
# garage-setup.sh
# Provisiona un nodo Garage single-node: layout, access key y buckets.
# Diseñado para correr en un contenedor Alpine con curl y jq.
#
# Variables de entorno requeridas:
#   GARAGE_ADMIN_URL   — ej: http://garage-test:3903
#   GARAGE_ADMIN_TOKEN — admin_token definido en garage.toml
#   MINIO_ACCESS_KEY   — access key S3 a importar
#   MINIO_SECRET_KEY   — secret key S3 a importar
#   MINIO_BUCKET_CONTENT    — nombre del bucket de contenido
#   MINIO_BUCKET_THUMBNAILS — nombre del bucket de miniaturas

set -e

ADMIN="${GARAGE_ADMIN_URL}"
TOKEN="${GARAGE_ADMIN_TOKEN}"

apk add --no-cache curl jq >/dev/null 2>&1

# ── 1. Esperar a que la Admin API esté lista ─────────────────────────────────
echo "→ Esperando a que Garage acepte conexiones en ${ADMIN}..."
until curl -sf \
  -H "Authorization: Bearer ${TOKEN}" \
  "${ADMIN}/v2/GetClusterStatus" >/dev/null 2>&1
do
  sleep 1
done
echo "✓ Garage listo."

# ── 2. Asegurar existencia de buckets y permisos ─────────────────────────────
for BUCKET in "${MINIO_BUCKET_CONTENT}" "${MINIO_BUCKET_THUMBNAILS}"; do
  [ -z "${BUCKET}" ] && continue

  INFO=$(curl -s \
    -H "Authorization: Bearer ${TOKEN}" \
    "${ADMIN}/v2/GetBucketInfo?globalAlias=${BUCKET}")

  BUCKET_ID=$(printf '%s' "${INFO}" | jq -r '.id // empty')

  if [ -z "${BUCKET_ID}" ]; then
    echo "→ Creando bucket '${BUCKET}'..."
    BUCKET_ID=$(curl -sf -X POST \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      --data-raw "$(jq -nc --arg alias "${BUCKET}" '{globalAlias: $alias}')" \
      "${ADMIN}/v2/CreateBucket" | jq -r '.id')
  else
    echo "✓ Bucket '${BUCKET}' ya existe (ID: ${BUCKET_ID})."
  fi

  echo "→ Concediendo permisos a '${MINIO_ACCESS_KEY}' en bucket '${BUCKET}'..."
  curl -sf -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-raw "$(jq -nc \
      --arg bid "${BUCKET_ID}" \
      --arg kid "${MINIO_ACCESS_KEY}" \
      '{bucketId: $bid, accessKeyId: $kid, permissions: {read: true, write: true, owner: true}}')" \
    "${ADMIN}/v2/AllowBucketKey" >/dev/null
  echo "✓ Permisos listos para '${BUCKET}'."
done

echo ""
echo "✅ Aprovisionamiento de Garage completo."
