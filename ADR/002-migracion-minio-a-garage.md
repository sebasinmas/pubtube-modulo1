# ADR 02: Migración de MinIO a Garage como Object Storage S3-Compatible

> **Nota:** Se utilizó Inteligencia Artificial (IA) como apoyo en la redacción de este documento. La decisión arquitectónica fue tomada por el equipo ante un evento externo que rompió la pipeline de CI/CD.

- **Fecha:** 2026-09-24
- **Estado:** Aceptado
- **Reemplaza parcialmente:** ADR 01 — Tech Stack (sección Object Storage)

---

## Contexto

El 24 de septiembre de 2026, MinIO migró su repositorio público de imágenes Docker desde Docker Hub hacia **quay.io** (`quay.io/minio/minio`, `quay.io/minio/mc`). Esta migración se realizó sin período de transición, lo que causó que todas las pipelines de CI/CD que referenciaban esas imágenes fallaran en el paso de pull, rompiendo la suite de integración de forma inmediata.

Adicionalmente, en los últimos meses MinIO ha endurecido su licencia AGPL-3.0 con restricciones de uso comercial y ha adoptado una postura más agresiva respecto a proyectos auto-hospedados, generando incertidumbre sobre la viabilidad del proyecto a largo plazo.

## Decisión

Migramos el componente de **Object Storage** de **MinIO** a **[Garage](https://garagehq.deuxfleurs.fr/)** (`dxflrs/garage:v2.4.1`), un servidor de almacenamiento de objetos distribuido, open-source (AGPL-3.0, sin restricciones adicionales) y **100% compatible con la API de Amazon S3**.

La versión se fija en `v2.4.1` (última versión estable al momento de la migración) para garantizar reproducibilidad de los contenedores.

## Alcance del cambio

### Lo que NO cambia (zero-touch)

| Componente | Motivo |
|---|---|
| `src/infrastructure/minio/minio.service.ts` | Usa `@aws-sdk/client-s3` que habla S3 estándar — Garage lo implementa íntegramente |
| `src/infrastructure/minio/minio.module.ts` | Sin cambios |
| Cualquier controlador o test unitario | Sin cambios |
| Variables de entorno (`MINIO_*`) | Se mantienen los mismos nombres para no tocar código de aplicación |
| Puerto externo expuesto (`9000` por defecto) | Se mantiene igual — solo cambia el puerto interno del contenedor (`3900`) |
| Pipeline de CI/CD (`.github/workflows/ci.yml`) | Sin cambios — los nombres de los checks se preservan |

### Lo que SÍ cambia

| Archivo | Cambio |
|---|---|
| `docker-compose.yml` | Servicio `minio` → `garage`; `minio-setup` → `garage-setup` |
| `docker-compose.test.yml` | Servicio `minio-test` → `garage-test`; `minio-setup-test` → `garage-setup-test` |
| `docker-compose.prod.yml` | Mismo patrón que dev |
| `garage.toml` | **Nuevo** — configuración de Garage para dev/prod |
| `garage.test.toml` | **Nuevo** — configuración de Garage para el entorno de tests de integración |
| `.env.example` / `.env.test` | Puerto interno actualizado a `3900`; eliminada variable `MINIO_CONSOLE_PORT` |
| `scripts/test-integration.ts` | Solo actualización de mensaje de log |

## Diferencias arquitectónicas relevantes

### Provisioning más explícito

Garage requiere un paso de inicialización de cluster que MinIO no necesitaba: asignar el nodo a una **zona de disponibilidad** y aplicar un **layout**, antes de poder crear buckets. El contenedor `garage-setup` realiza esta orquestación usando la misma imagen de Garage (sin dependencia de imagen adicional como `mc`).

Flujo del contenedor `garage-setup`:
```
1. Esperar a que la Admin API (puerto 3903) responda
2. Obtener el NODE_ID del cluster single-node
3. Asignar el nodo a zona dc1 con capacidad 10G
4. Aplicar el layout (versión 1)
5. Importar la access key con las credenciales de .env
6. Crear los buckets (videos, thumbnails)
7. Otorgar permisos read+write a la key sobre ambos buckets
```

### Puerto interno distinto

Garage expone la S3 API en el puerto **3900** (no 9000 como MinIO). El mapeo `${MINIO_API_PORT:-9000}:3900` en Docker Compose mantiene el puerto externo sin cambios.

### Sin consola web integrada

Garage no incluye una consola web como la de MinIO. Para inspección manual se puede usar la [garage-webui](https://github.com/khairul169/garage-webui) o la CLI directamente:
```bash
docker exec module1-garage /garage bucket list
docker exec module1-garage /garage key list
```

### Configuración por archivo TOML (no env vars)

Garage requiere un archivo `garage.toml` montado como volumen. Este archivo define paths de datos, secretos de RPC y token de admin. **Los tokens en `garage.toml` son para el entorno de desarrollo/test y no contienen credenciales sensibles de producción real.**

> ⚠️ En un entorno productivo real, el `rpc_secret` y `admin_token` deben generarse con `openssl rand -hex 32` y gestionarse con un secret manager (Vault, SOPS, etc.).

## Trade-offs

| Aspecto | MinIO | Garage |
|---|---|---|
| Compatibilidad S3 | ✅ Completa | ✅ Completa |
| Imagen Docker Hub | ❌ Migró a quay.io (breaking) | ✅ En Docker Hub (`dxflrs/garage`) |
| Consola web | ✅ Integrada | ❌ Requiere herramienta extra |
| Provisioning | Simple (`mc` CLI) | Más verboso (CLI propia + layout) |
| Multipart Upload | ✅ | ✅ |
| Presigned URLs | ✅ | ✅ |
| Licencia | AGPL-3.0 + restricciones comerciales | AGPL-3.0 pura |
| Imagen distroless | ❌ | ✅ (más segura) |
| Huella de memoria | Mayor | Menor (Rust) |

## Consecuencias

- La pipeline de CI/CD vuelve a funcionar inmediatamente al hacer pull de la imagen desde Docker Hub estándar.
- El código de aplicación (`MinioService`) no requiere ninguna modificación — la interfaz S3 es idéntica.
- El proceso de setup de buckets es ligeramente más complejo pero está contenido en el script del contenedor `garage-setup`.
- Se elimina la dependencia de `quay.io` en su totalidad.
- El nombre de la clase (`MinioService`) y las variables de entorno (`MINIO_*`) se mantienen por pragmatismo: renombrarlos no aportaría valor y generaría ruido innecesario en el diff.
