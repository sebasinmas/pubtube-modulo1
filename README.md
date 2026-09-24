# Módulo 1: Gestión de Contenidos y Almacenamiento

Este archivo sirve como **guía oficial** para levantar, configurar y probar el código correspondiente a este módulo.

Esta guía está redactada cuidadosamente para que sea comprensible tanto para personal técnico y desarrolladores, como para personas que recién se familiarizan con el sistema. Te recomendamos leer todas las instrucciones detalladamente antes de iniciar el proceso de despliegue.

---

## Descripción General

Este módulo es el responsable de administrar el ciclo de vida completo del contenido audiovisual (videos). Funciona como la fuente de verdad del catálogo del sistema y representa el punto de entrada inicial para todo el flujo editorial.

Sus responsabilidades abarcan desde la ingesta de los archivos multimedia hasta el almacenamiento seguro de los objetos y el versionado de sus metadatos.

## Funcionalidades Principales

El sistema integra las siguientes capacidades operativas y técnicas:

> **Nota:** Esto se actualizara a medida que avancen los Sprints del proyecto.

---

## Guía de Despliegue y Ejecución

### 1. Requisitos Previos

Asegurate de tener instalado en tu máquina:

| Herramienta                 | Versión mínima | Verificación             |
| --------------------------- | -------------- | ------------------------ |
| **Node.js**                 | `22.x`         | `node --version`         |
| **pnpm**                    | `10.x`         | `pnpm --version`         |
| **Docker + Docker Compose** | `24.x`         | `docker compose version` |
| **Git**                     | `2.x`          | `git --version`          |

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
# Copiar el archivo de ejemplo (listo para usar inmediatamente, plug & play)
cp .env.example .env
```

El archivo `.env.example` contiene valores predeterminados listos para desarrollo local:

```dotenv
# Configuración API
API_PORT=8000

# PostgreSQL (puerto 5433 en host mapeado al 5432 del contenedor)
POSTGRES_USER=pubtube
POSTGRES_PASSWORD=pubtube_secret
POSTGRES_DB=pubtube_db
POSTGRES_PORT=5433

# URL de conexión directa desde el host (migraciones y CLI)
DATABASE_URL=postgresql://pubtube:pubtube_secret@localhost:5433/pubtube_db

# MinIO (Object Storage compatible S3)
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001
MINIO_ACCESS_KEY=adminminio
MINIO_SECRET_KEY=minio_secret123
MINIO_BUCKET_CONTENT=videos
MINIO_BUCKET_THUMBNAILS=thumbnails
```

> **Nota sobre puertos:** El contenedor de PostgreSQL expone el puerto `5433` en tu máquina host (`5433:5432`) para evitar colisiones si ya tienes un PostgreSQL local corriendo en el puerto padrão `5432`. Dentro de la red interna de Docker, la API se conecta directamente a `db:5432`.

### 3. Ejecución del Proyecto

El repositorio cuenta con tres archivos Docker Compose según el propósito:
- `docker-compose.yml`: Entorno de desarrollo local (API + Postgres + MinIO).
- `docker-compose.test.yml`: Infraestructura efímera para pruebas de integración (en `tmpfs` y puertos aislados `5434` / `9100`).
- `docker-compose.prod.yml`: Configuración endurecida para producción.

**Opción A: Levantar todo en Docker (API + DB + MinIO):**

```bash
# 1. Iniciar contenedores
docker compose up -d

# 2. Aplicar migraciones
pnpm run db:migrate
```

**Opción B: Servidor local con hot-reload (desarrollo ágil):**

```bash
# 1. Iniciar solo la infraestructura necesaria
docker compose up db minio minio-setup -d

# 2. Aplicar migraciones
pnpm run db:migrate

# 3. Iniciar el servidor NestJS con recarga en vivo
pnpm run start:dev
```

---

### 4. Ejecución de Pruebas de Integración (E2E)

Las pruebas de integración interactúan con instancias reales de PostgreSQL y MinIO (sin mocks). Para ofrecer la máxima simplicidad (*plug & play*), el flujo completo está **automatizado en un único comando**:

```bash
pnpm test:integration
```

Este comando ejecuta de forma transparente:
1. **Aislamiento**: Levanta la infraestructura de test (`docker-compose.test.yml`) usando variables de `.env.test`. Utiliza puertos dedicados (**Postgres: 5434, MinIO: 9100/9101**) y almacenamiento en memoria (`tmpfs`), por lo que **no entra en conflicto** si tienes el entorno de desarrollo corriendo y no desgasta el disco.
2. **Espera activa**: Espera hasta que la base de datos y los buckets de MinIO estén 100% listos (`--wait`).
3. **Migraciones automáticas**: Aplica el esquema de base de datos vía Drizzle sobre la base de pruebas.
4. **Ejecución de pruebas**: Corre la suite completa de integración en Vitest en el host (rápido y con soporte de depuración).
5. **Teardown y limpieza automática**: Al finalizar (sea exitoso, con error o interrumpido con `Ctrl+C`), apaga y destruye los contenedores y recursos temporales automáticamente (`down -v`), liberando puertos y memoria.

> **Ejecución manual (opcional):** Si prefieres mantener los contenedores de test levantados para iterar muy rápido sobre una prueba específica:
> ```bash
> docker compose -f docker-compose.test.yml --env-file .env.test up -d --wait
> pnpm run db:migrate
> pnpm test:integration:manual
> ```

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
pnpm test                  # Vitest: corre todos los tests unitarios
pnpm run test:watch        # Vitest: modo watch (útil durante desarrollo)
pnpm run test:cov          # Vitest: tests + reporte de cobertura en /coverage
pnpm run test:e2e          # Vitest: solo tests de integración end-to-end

# ── Suite completa (equivalente exacto al CI de GitHub Actions) ────────
pnpm run validate
```

### Pipeline de CI (GitHub Actions)

El pipeline está diseñado bajo un principio de **alta eficiencia y mínimo cómputo** en GitHub Actions:
- **`develop` y PRs iterativos**: Ejecuta un único runner unificado de calidad y compilación (~30-40s), evitando levantar múltiples VMs redundantes.
- **`main` (Gate de Producción)**: Exige adicionalmente la ejecución de la suite completa de pruebas de integración (`pnpm run test:integration` con Docker en memoria) antes de permitir cualquier merge.

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
│ ├─ Docker Compose (tmpfs Postgres+S3)│
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
  *(Ningún Pull Request puede mergearse a `main` sin pasar ambos checks).*
- **Para la rama `develop`:**
  Exigir el check: `📦 Quality & Build`.

---

## 📋 Estándares de Código

- **Tipado**: `any` explícito está **prohibido** (genera error en CI). Toda dependencia externa debe estar tipada con su interfaz correspondiente.
- **Promesas**: Las promesas flotantes (`floating promises`) generan error de CI. Todo `async` debe tener su `await` o ser retornado explícitamente.
- **Módulos NestJS**: Cada feature debe vivir en su propio módulo (`@Module`) con sus providers correctamente registrados e inyectados.
- **Ciclos**: Los ciclos de dependencia entre módulos están **prohibidos** y se detectan automáticamente antes de cada push.
