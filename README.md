# Módulo 1: Gestión de Contenidos y Almacenamiento

Este archivo sirve como **guía oficial** para levantar, configurar y probar el código correspondiente a este módulo.

Esta guía está redactada cuidadosamente para que sea comprensible tanto para personal técnico y desarrolladores, como para personas que recién se familiarizan con el sistema. Te recomendamos leer todas las instrucciones detalladamente antes de iniciar el proceso de despliegue.

---

## Descripción General

Este módulo es el responsable de administrar el ciclo de vida completo del contenido audiovisual (videos). Funciona como la fuente de verdad del catálogo del sistema y representa el punto de entrada inicial para todo el flujo editorial.

Sus responsabilidades abarcan desde la ingesta de los archivos multimedia hasta el almacenamiento seguro de los objetos y el versionado de sus metadatos.

## Funcionalidades Principales

> **Nota:** Esto se actualizará a medida que avancen los Sprints del proyecto.

| Historia                      | Estado                   | Descripción                                                                                                                                                           |
| ----------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **US-A1: Carga resumible**    | ✅ Expuesta vía HTTP     | Subida por partes (S3 Multipart) con URLs prefirmadas, consulta de progreso y cálculo de checksum SHA-256 al completar.                                               |
| **US-A5: Anti-duplicados**    | ✅ Expuesta vía HTTP     | `checksum` SHA-256 opcional en `init` (409 si ya existe), verificación de integridad al completar (422 si difiere) e índice único global sobre `checksum_sha256`.     |
| **US-A4: Máquina de estados** | 🟡 Solo capa de servicio | Transiciones `borrador → listo → programado` en `VideoStateService` (aún sin endpoints HTTP). El paso `programado → publicado` lo realiza un cron job cada 5 minutos. |

---

## 🏗️ Arquitectura

### Stack

| Capa           | Tecnología                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| API            | NestJS 12 (TypeScript, ESM)                                                                               |
| Base de datos  | PostgreSQL 16 + Drizzle ORM (migraciones en `src/db/migrations/`)                                         |
| Object Storage | **[Garage](https://garagehq.deuxfleurs.fr/) `v2.4.1`** (compatible S3), accedido con `@aws-sdk/client-s3` |
| Mensajería     | Stub en memoria sobre `@nestjs/event-emitter` (pendiente de reemplazo por RabbitMQ)                       |

La documentación OpenAPI (Swagger UI) queda disponible en `/api/docs` con la API corriendo.

Las decisiones de arquitectura se documentan en [`ADR/`](ADR/). En particular, [ADR 002](ADR/002-migracion-minio-a-garage.md) explica la migración de MinIO a Garage.

> **Nombres heredados de MinIO:** el almacenamiento ya **no** es MinIO, pero por decisión explícita del ADR 002 se conservan la clase `MinioService` (`src/infrastructure/minio/`), la columna `minio_upload_id` y las variables `MINIO_*`. Todas apuntan a Garage vía la API S3 estándar.

### Flujo de carga resumible (US-A1)

El backend nunca recibe los bytes del video: el cliente sube cada parte **directamente a Garage** usando URLs prefirmadas.

| Paso | Endpoint                                       | Qué hace                                                                                                                                                                                                                                     |
| ---- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `POST /api/content/init`                       | Valida `mimeType` (`video/mp4`, `video/quicktime`), `filename` y `sizeBytes` (máx. `MAX_UPLOAD_SIZE_BYTES`, 2 GB por defecto). Inicia el multipart upload y crea el video en estado `borrador`. Devuelve `uploadSessionId` (= id del video). |
| 2    | `GET /api/content/:sessionId/part/:partNumber` | Devuelve una URL prefirmada (15 min) para subir esa parte con `PUT`.                                                                                                                                                                         |
| 3    | `GET /api/content/upload/:sessionId/status`    | Lista las partes ya subidas, para reanudar una carga interrumpida.                                                                                                                                                                           |
| 4    | `POST /api/content/upload/:sessionId/complete` | Recibe `{ parts: [{ PartNumber, ETag }] }`, ensambla el objeto, relee el objeto para calcular su SHA-256, lo persiste y publica el evento `video.uploaded`.                                                                                  |

El objeto se guarda en el bucket `MINIO_BUCKET_CONTENT` con la clave `<videoId>/<filename>`. Se puede enviar el header `x-correlation-id` para trazar el flujo; si no se envía, se genera uno.

### Máquina de estados del contenido

```
borrador ──(metadata válida)──► listo ──(fecha futura)──► programado ──(cron + YouTube OK)──► publicado
```

- Las transiciones se ejecutan dentro de una transacción con `SELECT ... FOR UPDATE`.
- `borrador → listo` publica el evento `metadata.updated`.
- `VideoWorkerService` (cron cada 5 min) publica los videos `programado` cuya fecha ya pasó, tras verificar la URL de YouTube vía oEmbed.

### Eventos

Todos los eventos se envuelven en un `EventEnvelope` (`id`, `type`, `version`, `timestamp`, `correlationId`, `causationId`, `source: module1-content`, `payload`). Los contratos JSON Schema están en [`docs/contratos/`](docs/contratos/).

---

## Guía de Despliegue y Ejecución

### 1. Requisitos Previos

Asegúrate de tener instalado en tu máquina:

| Herramienta                 | Versión mínima                           | Verificación             |
| --------------------------- | ---------------------------------------- | ------------------------ |
| **Node.js**                 | `26.x` (igual que CI y la imagen Docker) | `node --version`         |
| **pnpm**                    | `11.x`                                   | `pnpm --version`         |
| **Docker + Docker Compose** | `24.x`                                   | `docker compose version` |
| **Git**                     | `2.x`                                    | `git --version`          |

### 2. Instalación y Configuración

**Clonar el repositorio e instalar dependencias:**

```bash
git clone <url-del-repo>
cd pubtube-modulo1
pnpm install
```

> `pnpm install` activa automáticamente los **git hooks** de Lefthook (pre-commit, commit-msg, pre-push). No requiere ningún paso adicional.

**Configurar variables de entorno:**

```bash
cp .env.example .env
```

Contenido de `.env.example`:

```dotenv
# Configuración API
API_PORT=8000

# Credenciales de PostgreSQL
POSTGRES_USER=pubtube
POSTGRES_PASSWORD=pubtube_secret
POSTGRES_DB=pubtube_db
POSTGRES_PORT=5433

# URL de Conexión a Base de Datos (Host)
DATABASE_URL=postgresql://pubtube:pubtube_secret@localhost:5433/pubtube_db

# Almacenamiento de Objetos S3 (Garage). Los nombres MINIO_* son heredados (ver ADR 002).
# MINIO_PORT es el puerto que usa la API corriendo en el HOST (9000 publicado -> 3900 interno).
# Dentro de Docker, el compose fuerza MINIO_ENDPOINT=garage y MINIO_PORT=3900.
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_API_PORT=9000
# Garage exige access key >= 8 caracteres y secret key >= 16 caracteres.
MINIO_ACCESS_KEY=adminminio
MINIO_SECRET_KEY=minio_secret_key_123
MINIO_BUCKET_CONTENT=videos
MINIO_BUCKET_THUMBNAILS=thumbnails
AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED

# Secretos del servidor Garage (solo desarrollo). En producción: openssl rand -hex 32
GARAGE_RPC_SECRET=4b51f62f2b5d3e44a5f4b51f62f2b5d3e44a5f4b51f62f2b5d3e44a5f4b51f62
GARAGE_ADMIN_TOKEN=pubtube-garage-admin-token
```

| Variable                                                                | Uso                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MINIO_API_PORT`                                                        | Puerto del **host** donde Docker publica la API S3 de Garage (`9000:3900`).                                                                                                          |
| `MINIO_PORT`                                                            | Puerto al que se conecta la API. Tiene prioridad sobre `MINIO_API_PORT`. Dentro de Docker debe ser `3900` (el compose ya lo fija); **ejecutando la API en el host debe ser `9000`**. |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`                                 | Credenciales S3 que Garage crea al arrancar y que la API usa para firmar peticiones. Garage exige ≥ 8 caracteres para la key y ≥ 16 para el secret.                                  |
| `MINIO_BUCKET_CONTENT` / `MINIO_BUCKET_THUMBNAILS`                      | Buckets aprovisionados al levantar el entorno.                                                                                                                                       |
| `AWS_REQUEST_CHECKSUM_CALCULATION` / `AWS_RESPONSE_CHECKSUM_VALIDATION` | Deben ser `WHEN_REQUIRED`: las versiones recientes del AWS SDK agregan checksums CRC por defecto que Garage no acepta.                                                               |
| `GARAGE_RPC_SECRET` / `GARAGE_ADMIN_TOKEN`                              | Secretos del servidor Garage. Se inyectan por variable de entorno (no viven en `garage.toml`). El RPC secret es de 32 bytes en hex (`openssl rand -hex 32`).                         |
| `MAX_UPLOAD_SIZE_BYTES`                                                 | Opcional. Tamaño máximo declarado por carga (2 GB por defecto).                                                                                                                      |

> **Variables obligatorias:** los compose usan `${VAR:?}` para credenciales y secretos. Si falta alguna (por ejemplo, un `.env` antiguo sin `GARAGE_RPC_SECRET`), `docker compose` aborta indicando cuál. Para actualizar un `.env` existente, copia las variables nuevas desde `.env.example`.

> **Nota sobre puertos:** PostgreSQL se expone en el puerto `5433` del host (`5433:5432`) para no chocar con un PostgreSQL local en el `5432`. Dentro de la red de Docker la API usa `db:5432` y `garage:3900`.

### 3. Ejecución del Proyecto

El repositorio cuenta con tres archivos Docker Compose según el propósito:

| Archivo                   | Servicios                                                                                                                                    | Propósito                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`      | `module1-content`, `migrate`, `db`, `garage`, `garage-setup`                                                                                 | Desarrollo local (volúmenes persistentes). Proyecto `pubtube-modulo1`.                                        |
| `docker-compose.test.yml` | `db-test`, `garage-test`, `garage-setup-test` (perfil `setup`)                                                                               | Infraestructura efímera para integración (`tmpfs`, puertos `5434` / `9100`). Proyecto `pubtube-modulo1-test`. |
| `docker-compose.prod.yml` | Igual que desarrollo, con `restart: always`, rotación de logs, Postgres sin puerto publicado y **sin valores por defecto para credenciales** | Producción. Proyecto `pubtube-modulo1-prod`.                                                                  |

Orden de arranque (dev y prod), garantizado con `depends_on` + healthchecks:

```
db (healthy) ──► migrate (exit 0) ─────┐
garage (healthy) ──► garage-setup (exit 0) ──┴──► module1-content
```

- `migrate` aplica las migraciones Drizzle con la etapa `builder` del `Dockerfile` (que incluye `drizzle-kit`); no hace falta correr `db:migrate` a mano en este modo.
- La API corre con Node 26 (misma versión que el CI) y como usuario `node`, no root.

**Opción A: Levantar todo en Docker (API + DB + Garage):**

```bash
docker compose up -d --build
```

Las migraciones se aplican solas (servicio `migrate`). La API queda en `http://localhost:8000`.

> ⚠️ En este modo la API firma las URLs prefirmadas con el host interno `garage:3900`, que no es resolvible desde fuera de Docker. Para probar el flujo de subida completo desde el host usa la Opción B.

**Opción B: Servidor local con hot-reload (desarrollo ágil):**

```bash
# 1. Iniciar la infraestructura y aplicar migraciones (sin la API)
docker compose up -d --wait db garage garage-setup migrate

# 2. Iniciar NestJS cargando .env (Nest no lo carga por sí solo)
pnpm run start:dev --env-file .env
```

> `.env.example` ya trae `MINIO_PORT=9000`, el valor correcto para este modo. Si no se define `PORT`, la API escucha en el `3000`. Tras cambiar el esquema, aplica las migraciones con `pnpm run db:migrate` (lee `.env`).

### 4. Object Storage: Garage

Garage corre como nodo único (`replication_factor = 1`) con la imagen `dxflrs/garage:v2.4.1`.

| Puerto (contenedor) | Uso                                     | Publicado en el host                                   |
| ------------------- | --------------------------------------- | ------------------------------------------------------ |
| `3900`              | API S3                                  | Sí: `${MINIO_API_PORT}` (`9000` dev/prod, `9100` test) |
| `3901`              | RPC entre nodos                         | No                                                     |
| `3903`              | Admin API (protegida por `admin_token`) | No                                                     |

**Configuración:** un único [`garage.toml`](garage.toml), sin secretos, montado en `/etc/garage.toml` en los tres entornos (metadatos SQLite en `/var/lib/garage/meta`, datos en `/var/lib/garage/data`). En dev/prod ese directorio es un volumen; en test, `tmpfs`. Los secretos llegan por las variables `GARAGE_RPC_SECRET` y `GARAGE_ADMIN_TOKEN`.

**Healthcheck:** la imagen es distroless (sin shell ni curl), así que el healthcheck usa la propia CLI: `/garage status`.

**Aprovisionamiento en dos pasos:**

1. El contenedor `garage` arranca con `server --single-node --default-bucket`: aplica automáticamente el layout mono-nodo y crea la access key (`GARAGE_DEFAULT_ACCESS_KEY` / `GARAGE_DEFAULT_SECRET_KEY`, tomadas de `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`) junto con el bucket de contenido.
2. Cuando Garage está sano, el contenedor efímero `garage-setup` ejecuta [`scripts/garage-setup.sh`](scripts/garage-setup.sh) contra la Admin API v2: crea los buckets `MINIO_BUCKET_CONTENT` y `MINIO_BUCKET_THUMBNAILS` si no existen y concede permisos `read`/`write`/`owner` a la key. Es idempotente y falla (exit 1) si la Admin API no responde en `GARAGE_SETUP_TIMEOUT` segundos (60 por defecto), en vez de quedarse esperando para siempre. La API solo arranca si termina con éxito.
   - Corre en una imagen Alpine con `curl` + `jq` ([`scripts/garage-setup.Dockerfile`](scripts/garage-setup.Dockerfile)), construida una vez: no descarga paquetes en cada arranque.

**Inspección manual** (Garage no trae consola web):

```bash
docker exec module1-garage /garage status
docker exec module1-garage /garage bucket list
docker exec module1-garage /garage key list
```

> Los secretos de `.env.example` y `.env.test` son **solo para desarrollo/test**. En producción, `docker-compose.prod.yml` no tiene valores por defecto: genera cada secreto con `openssl rand -hex 32` y gestiónalos fuera del repositorio (secret manager, variables del host).

---

### 5. Ejecución de Pruebas de Integración (E2E)

Las pruebas de integración levantan la aplicación NestJS completa contra PostgreSQL y Garage reales (sin mocks). El flujo completo está **automatizado en un único comando**:

```bash
pnpm test:integration
```

Este comando ([`scripts/test-integration.ts`](scripts/test-integration.ts)) ejecuta:

1. **Aislamiento**: levanta `docker-compose.test.yml` con las variables de `.env.test`, usando puertos dedicados (**Postgres: 5434, Garage S3: 9100**) y almacenamiento en memoria (`tmpfs`). No entra en conflicto con el entorno de desarrollo.
2. **Espera activa y aprovisionamiento**: espera a que Postgres y Garage estén sanos (`--wait`) y luego ejecuta `garage-setup-test` con `docker compose run`, que propaga su código de salida: si el aprovisionamiento falla, la suite se aborta.
3. **Migraciones automáticas**: aplica el esquema con Drizzle sobre la base de pruebas.
4. **Ejecución de pruebas**: corre `**/*.e2e-spec.ts` con Vitest en el host.
5. **Teardown**: al finalizar (con éxito, con error o con `Ctrl+C`) ejecuta `down -v` y libera puertos y memoria.

> **Ejecución manual (opcional):** para mantener los contenedores de test levantados e iterar rápido. Es importante cargar `.env.test` en cada comando; si no, `drizzle.config.ts` y la suite E2E leerían el `.env` de desarrollo:
>
> ```bash
> docker compose -f docker-compose.test.yml --env-file .env.test up -d --wait
> docker compose -f docker-compose.test.yml --env-file .env.test run --rm garage-setup-test
> pnpm exec dotenvx run -f .env.test -- pnpm run db:migrate
> pnpm exec dotenvx run -f .env.test -- pnpm test:integration:manual
> ```
>
> Al terminar: `docker compose -f docker-compose.test.yml --env-file .env.test --profile setup down -v`

### 6. Convenciones de Tests Unitarios

Los tests unitarios (`*.spec.ts`, junto al código) no tocan Docker ni red. Convenciones:

- **Aislamiento automático** ([`vitest.config.ts`](vitest.config.ts)): `restoreMocks` y `unstubEnvs` restauran mocks y variables de entorno tras cada test; [`test/setup-unit.ts`](test/setup-unit.ts) silencia el `Logger` de Nest y vuelve a timers reales.
- **Sin dependencia del entorno**: toda variable que lee el código bajo prueba se fija con `vi.stubEnv(...)` en el propio test.
- **Sin fechas de calendario**: usa `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime(NOW)` y calcula fechas relativas a `NOW`. Una fecha fija "futura" caduca y el test sigue pasando por la razón equivocada.
- **Mocks tipados**: `vi.fn<Servicio['metodo']>()` / `Mock<...>` en lugar de `any`, con fixtures completas (por ejemplo, una fila de `videos` con todas sus columnas), para que el compilador detecte mocks que ya no reflejan la realidad.
- **Afirmar la razón, no solo el tipo de error**: en las transiciones de estado se verifica el mensaje, para distinguir "estado inválido" de "fecha inválida".
- **Bordes explícitos** con `it.each`: valores límite (tamaño máximo exacto y +1 byte), entradas ausentes, vacías o de tipo incorrecto, y los caminos 404.
- **Brechas conocidas como `it.todo`**: un comportamiento esperado que el código aún no cumple se registra como `it.todo('...')` con la descripción del problema, en vez de escribir un test que consagre el bug. Vitest los muestra como `todo` en cada ejecución.

## 🔬 Flujo de Trabajo para Desarrolladores (CI/DX)

Este proyecto tiene un pipeline de calidad de código automatizado en **dos niveles**: local (antes del commit/push) y remoto (GitHub Actions en cada PR).

### Herramientas del Stack de Análisis Estático

| Herramienta           | Rol                                               | Velocidad |
| --------------------- | ------------------------------------------------- | --------- |
| **Prettier**          | Formateo uniforme de código                       | ~1s       |
| **oxlint**            | Linting estructural rápido (Rust)                 | ~100ms    |
| **madge**             | Detección de ciclos entre módulos NestJS          | ~1s       |
| **typescript-eslint** | Reglas semánticas que requieren el grafo de tipos | ~5s       |
| **tsc --noEmit**      | Verificación completa del compilador TypeScript   | ~10s      |
| **Vitest**            | Suite de tests unitarios                          | ~2s       |

### Git Hooks Automáticos (Lefthook)

Los hooks se activan solos con `pnpm install`. No requieren configuración manual.

| Hook           | Cuándo se ejecuta                | Qué valida                               |
| -------------- | -------------------------------- | ---------------------------------------- |
| **pre-commit** | Antes de cada `git commit`       | Prettier (solo archivos staged) + oxlint |
| **commit-msg** | Al escribir el mensaje de commit | Formato de Conventional Commits          |
| **pre-push**   | Antes de cada `git push`         | `tsc --noEmit` + detección de ciclos     |

**Formato de commits obligatorio (Conventional Commits):**

```
type(scope): descripción corta en minúsculas

Tipos válidos: feat | fix | docs | style | refactor | test | chore | ci | perf

Ejemplos válidos:
  feat(storage): implement multipart stream upload
  fix(video-state): handle missing video in programado transition
  test(content): add coverage for checksum idempotency
  docs: update developer workflow instructions
```

> Para hacer un commit sin pasar por los hooks en casos de emergencia:
>
> ```bash
> git commit --no-verify -m "hotfix: ..."
> ```

### Comandos de Calidad Disponibles

```bash
# ── Validación rápida (equivalente al pre-commit) ──────────────────────
pnpm run lint              # oxlint: linting estructural (~100ms)
pnpm run lint:fix          # oxlint: corrige automáticamente lo que puede
pnpm run format            # Prettier: formatea todos los archivos
pnpm run format:check      # Prettier: verifica sin modificar (modo CI)

# ── Validación profunda ────────────────────────────────────────────────
pnpm run typecheck         # tsc --noEmit: verificación completa de tipos
pnpm run check:cycles      # madge: detecta ciclos de dependencias entre módulos
pnpm run lint:types        # ESLint type-aware: reglas semánticas de TypeScript

# ── Tests ──────────────────────────────────────────────────────────────
pnpm test                  # Vitest: corre todos los tests unitarios (*.spec.ts)
pnpm exec vitest run <ruta/al/archivo.spec.ts>   # un solo archivo
pnpm exec vitest run -t "<nombre del test>"      # filtrar por nombre
pnpm run test:watch        # Vitest: modo watch (útil durante desarrollo)
pnpm run test:cov          # Vitest: tests + reporte de cobertura en /coverage
pnpm test:integration      # Integración E2E con Docker efímero (ver sección 5)

# ── Base de datos ──────────────────────────────────────────────────────
pnpm run db:generate       # genera una migración a partir de src/db/schema.ts
pnpm run db:migrate        # aplica las migraciones pendientes

# ── Suite completa (equivalente al job de calidad de GitHub Actions) ───
pnpm run validate
```

### Pipeline de CI (GitHub Actions)

El pipeline está diseñado bajo un principio de **alta eficiencia y mínimo cómputo** en GitHub Actions:

- **`develop` y PRs iterativos**: ejecuta un único runner unificado de calidad y compilación (~30-40s), evitando levantar múltiples VMs redundantes.
- **`main` (Gate de Producción)**: exige además la suite completa de pruebas de integración (`pnpm run test:integration` con Docker en memoria) antes de permitir cualquier merge.

```
Push / PR
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  📦 Quality & Build (1 solo runner ~35s)                     │
│  ├─ Prettier (formato)                                      │
│  ├─ oxlint (linting estructural fail-fast)                  │
│  ├─ madge (detección de ciclos)                             │
│  ├─ tsc (typecheck estricto)                                │
│  ├─ ESLint (reglas semánticas)                              │
│  ├─ Vitest (tests unitarios)                                │
│  └─ NestJS Build (verificación de compilación de prod)      │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ¿Es PR hacia main o push a main?
                               │
                    ┌──────────┴──────────┐
                   SÍ                     NO
                    │                     │
                    ▼                     ▼
┌──────────────────────────────────────┐  ✅ Fin del CI
│ 🧪 Integration Tests (~40s)          │  (Ahorro de cómputo en develop)
│ ├─ Docker Compose (tmpfs Postgres    │
│ │   + Garage)                        │
│ ├─ Drizzle Migrations                │
│ └─ Vitest E2E Suite                  │
└──────────────────────────────────────┘
                    │
                    ▼
     ✅ Requisito obligatorio para main
```

**Configurar Branch Protection en GitHub:**

- **Para la rama `main`:**
  En `Settings > Branches > Branch protection rules`, exigir los checks:
  1. `📦 Quality & Build`
  2. `🧪 Integration Tests (Required for main)`
     _(Ningún Pull Request puede mergearse a `main` sin pasar ambos checks)._
- **Para la rama `develop`:**
  Exigir el check: `📦 Quality & Build`.

---

## 📋 Estándares de Código

- **Tipado**: evita `any` explícito. oxlint lo reporta como _warning_ (todavía no bloquea el CI, por deuda técnica del sprint 1). Toda dependencia externa debe estar tipada con su interfaz correspondiente.
- **Promesas**: las promesas flotantes (`floating promises`) son error de oxlint. Todo `async` debe tener su `await` o retornarse explícitamente, y `require-await` / `no-misused-promises` son error en ESLint.
- **Imports ESM**: el proyecto usa `module: nodenext`, así que los imports relativos llevan extensión `.js` (`import { X } from './x.js'`).
- **Módulos NestJS**: cada feature debe vivir en su propio módulo (`@Module`) con sus providers correctamente registrados e inyectados.
- **Ciclos**: los ciclos de dependencia entre módulos están **prohibidos** y se detectan automáticamente antes de cada push.
