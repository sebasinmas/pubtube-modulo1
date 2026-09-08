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

| Herramienta | Versión mínima | Verificación |
|---|---|---|
| **Node.js** | `22.x` | `node --version` |
| **pnpm** | `10.x` | `pnpm --version` |
| **Docker + Docker Compose** | `24.x` | `docker compose version` |
| **Git** | `2.x` | `git --version` |

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
# Copiar el archivo de ejemplo
cp .env.example .env
```

Editar `.env` con los valores correspondientes al entorno local. Las variables requeridas son:

```dotenv
# PostgreSQL
POSTGRES_USER=pubtube
POSTGRES_PASSWORD=pubtube_secret
POSTGRES_DB=pubtube_db

# MinIO (Object Storage compatible S3)
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET_CONTENT=content
MINIO_BUCKET_THUMBNAILS=thumbnails

# API
API_PORT=8000
```

### 3. Ejecución del Proyecto

**Levantar toda la infraestructura local (API + DB + MinIO):**

```bash
docker compose up -d
```

**Solo el servidor en modo desarrollo (hot-reload):**

```bash
pnpm run start:dev
```

**Correr migraciones de base de datos:**

```bash
pnpm run db:migrate
```

---

## 🔬 Flujo de Trabajo para Desarrolladores (CI/DX)

Este proyecto tiene un pipeline de calidad de código automatizado en **dos niveles**: local (antes del commit/push) y remoto (GitHub Actions en cada PR).

### Herramientas del Stack de Análisis Estático

| Herramienta | Rol | Velocidad |
|---|---|---|
| **Prettier** | Formateo uniforme de código | ~1s |
| **oxlint** | Linting estructural rápido (Rust) | ~100ms |
| **madge** | Detección de ciclos entre módulos NestJS | ~1s |
| **typescript-eslint** | Reglas semánticas que requieren el grafo de tipos | ~5s |
| **tsc --noEmit** | Verificación completa del compilador TypeScript | ~10s |
| **Vitest** | Suite de tests unitarios | ~2s |

### Git Hooks Automáticos (Lefthook)

Los hooks se activan solos con `pnpm install`. No requieren configuración manual.

| Hook | Cuándo se ejecuta | Qué valida |
|---|---|---|
| **pre-commit** | Antes de cada `git commit` | Prettier (solo archivos staged) + oxlint |
| **commit-msg** | Al escribir el mensaje de commit | Formato de Conventional Commits |
| **pre-push** | Antes de cada `git push` | `tsc --noEmit` + detección de ciclos |

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

El pipeline se ejecuta automáticamente en cada **push a `main`/`develop`** y en cada **Pull Request**. Está compuesto por 4 jobs que corren en paralelo tras la instalación de dependencias:

```
Push / PR
    │
    ▼
┌─────────────────────┐
│   setup (pnpm)      │  📦 ~15s
└──────────┬──────────┘
           │  (3 jobs en paralelo)
    ┌──────┼──────────────────┐
    ▼      ▼                  ▼
┌───────┐ ┌──────────┐ ┌──────────┐
│static │ │typecheck │ │  tests   │
│analysis│ │(tsc)    │ │(vitest)  │
│~30-60s│ │~10-20s  │ │~15-30s  │
└───┬───┘ └────┬─────┘ └────┬─────┘
    └──────────┴─────────────┘
                   │
                   ▼
           ┌───────────────┐
           │   ci-gate     │  ✅ / ❌
           └───────────────┘
```

**Configurar Branch Protection en GitHub:**

En `Settings > Branches > Branch protection rules`, agregar la regla sobre `main` y `develop` con el check requerido: `✅ CI Gate`.

> Con esto, ningún Pull Request puede mergearse si el CI no pasa completamente.

---

## 📋 Estándares de Código

- **Tipado**: `any` explícito está **prohibido** (genera error en CI). Toda dependencia externa debe estar tipada con su interfaz correspondiente.
- **Promesas**: Las promesas flotantes (`floating promises`) generan error de CI. Todo `async` debe tener su `await` o ser retornado explícitamente.
- **Módulos NestJS**: Cada feature debe vivir en su propio módulo (`@Module`) con sus providers correctamente registrados e inyectados.
- **Ciclos**: Los ciclos de dependencia entre módulos están **prohibidos** y se detectan automáticamente antes de cada push.