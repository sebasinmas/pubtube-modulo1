# Misma versión de Node y pnpm que el CI (.github/workflows/ci.yml).
# Node >= 25 ya no incluye corepack, por eso pnpm se instala con npm.
ARG NODE_VERSION=26
ARG PNPM_VERSION=11

# Etapa 1: Construcción (Builder)
# También la usa el servicio `migrate` de docker-compose (incluye drizzle-kit).
FROM node:${NODE_VERSION}-alpine AS builder
ARG PNPM_VERSION

# Desactiva la verificación de Python para youtube-dl-exec
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1

RUN npm install -g pnpm@${PNPM_VERSION} \
  # Desactivar scripts de ciclo de vida globalmente (evita que lefthook pida git)
  && pnpm config set ignore-scripts true

WORKDIR /usr/src/app

# Copiar manifiestos de dependencias (capa cacheable)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copiar el resto del código fuente (.dockerignore excluye node_modules, .env, etc.)
COPY . .

# Compilar el proyecto NestJS (genera la carpeta /dist)
RUN pnpm run build

# Etapa 2: Producción
FROM node:${NODE_VERSION}-alpine AS production
ARG PNPM_VERSION

ENV NODE_ENV=production

RUN npm install -g pnpm@${PNPM_VERSION} \
  && pnpm config set ignore-scripts true

WORKDIR /usr/src/app

# Instalar SOLAMENTE dependencias de producción
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Extraer el código compilado desde la etapa "builder"
COPY --from=builder /usr/src/app/dist ./dist

# No correr como root
USER node

EXPOSE 8000

CMD ["node", "dist/main.js"]
