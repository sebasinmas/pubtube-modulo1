# Etapa 1: Construcción (Builder)
FROM node:20-alpine AS builder

# Habilitar corepack para usar pnpm nativamente
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Desactiva la verificación de Python para youtube-dl-exec
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1

RUN corepack enable

# Desactivar scripts de ciclo de vida globalmente (evita que lefthook pida git)
RUN pnpm config set ignore-scripts true

WORKDIR /usr/src/app

# Copiar manifiestos de dependencias
COPY package.json pnpm-lock.yaml ./

# Instalar todas las dependencias
RUN pnpm install --frozen-lockfile

# Copiar el resto del código fuente (el .dockerignore evitará que pase node_modules)
COPY . .

# Compilar el proyecto NestJS (genera la carpeta /dist)
RUN pnpm run build

# Etapa 2: Producción
FROM node:20-alpine AS production

# Establecer entorno de producción
ENV NODE_ENV=production
RUN corepack enable

# Desactivar scripts también en producción
RUN pnpm config set ignore-scripts true

WORKDIR /usr/src/app

# Copiar manifiestos e instalar SOLAMENTE dependencias de producción
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Extraer el código compilado desde la etapa "builder"
COPY --from=builder /usr/src/app/dist ./dist

# Exponer el puerto 8000 definido en tu infraestructura
EXPOSE 8000

# Ejecutar el proceso principal
CMD ["node", "dist/main.js"]