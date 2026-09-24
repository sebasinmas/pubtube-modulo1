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

# ── 2. Obtener el Node ID del único nodo ────────────────────────────────────
STATUS=$(curl -sf \
  -H "Authorization: Bearer ${TOKEN}" \
  "${ADMIN}/v2/GetClusterStatus")

NODE_ID=$(printf '%s' "${STATUS}" | jq -r '[.nodes[] | select(.isUp == true)][0].id')

if [ -z "${NODE_ID}" ] || [ "${NODE_ID}" = "null" ]; then
  echo "✗ No se encontró ningún nodo activo en el cluster."
  exit 1
fi
echo "✓ Node ID: ${NODE_ID}"

# ── 3. Asignar layout (zona dc1, capacidad 10 GiB) ──────────────────────────
echo "→ Asignando layout..."
curl -sf -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-raw "$(jq -nc \
    --arg id "${NODE_ID}" \
    '{($id): {zone: "dc1", capacity: 10737418240, tags: []}}')" \
  "${ADMIN}/v2/UpdateClusterLayout" >/dev/null

# ── 4. Aplicar layout ───────────────────────────────────────────────────────
echo "→ Aplicando layout v1..."
curl -sf -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-raw '{"version": 1}' \
  "${ADMIN}/v2/ApplyClusterLayout" >/dev/null
echo "✓ Layout aplicado."

# ── 5. Importar access key ──────────────────────────────────────────────────
echo "→ Importando access key '${MINIO_ACCESS_KEY}'..."
curl -sf -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-raw "$(jq -nc \
    --arg id  "${MINIO_ACCESS_KEY}" \
    --arg sec "${MINIO_SECRET_KEY}" \
    '{accessKeyId: $id, secretAccessKey: $sec, name: "pubtube-key"}')" \
  "${ADMIN}/v2/ImportKey" >/dev/null
echo "✓ Key importada."

# ── 6. Crear buckets y otorgar permisos ─────────────────────────────────────
for BUCKET in "${MINIO_BUCKET_CONTENT}" "${MINIO_BUCKET_THUMBNAILS}"; do
  echo "→ Creando bucket '${BUCKET}'..."
  BUCKET_ID=$(curl -sf -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-raw "$(jq -nc --arg alias "${BUCKET}" '{globalAlias: $alias}')" \
    "${ADMIN}/v2/CreateBucket" | jq -r '.id')

  echo "→ Concediendo read+write al bucket '${BUCKET}'..."
  curl -sf -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-raw "$(jq -nc \
      --arg bid "${BUCKET_ID}" \
      --arg kid "${MINIO_ACCESS_KEY}" \
      '{bucketId: $bid, accessKeyId: $kid, permissions: {read: true, write: true, owner: false}}')" \
    "${ADMIN}/v2/AllowBucketKey" >/dev/null
  echo "✓ Bucket '${BUCKET}' listo."
done

echo ""
echo "✅ Aprovisionamiento de Garage completo."
