import { execSync, spawn } from 'node:child_process';
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';

// Cargar variables de entorno exclusivas para pruebas de integración
dotenv.config({ path: resolve(process.cwd(), '.env.test'), override: true });

const COMPOSE_CMD =
  'docker compose -f docker-compose.test.yml --env-file .env.test';

function cleanUp(): void {
  try {
    console.log('\n🧹 Limpiando infraestructura efímera de pruebas...');
    execSync(`${COMPOSE_CMD} down -v`, { stdio: 'inherit' });
    console.log('✅ Entorno de pruebas destruido y recursos liberados.\n');
  } catch (error) {
    console.error('⚠️  Error al intentar limpiar contenedores:', error);
  }
}

// Registrar manejadores de señales para garantizar teardown ante cancelaciones
process.on('SIGINT', () => {
  cleanUp();
  process.exit(130);
});

process.on('SIGTERM', () => {
  cleanUp();
  process.exit(143);
});

async function run(): Promise<void> {
  let exitCode = 0;

  try {
    console.log(
      '🚀 1/3: Levantando infraestructura de test (Postgres tmpfs + MinIO tmpfs)...',
    );
    execSync(`${COMPOSE_CMD} up -d --wait`, { stdio: 'inherit' });

    console.log(
      '\n📦 2/3: Aplicando migraciones de Drizzle en la base de datos de test...',
    );
    execSync('pnpm exec drizzle-kit migrate', {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
      },
    });

    console.log(
      '\n🧪 3/3: Ejecutando suite de pruebas de integración con Vitest...',
    );
    exitCode = await new Promise<number>((res) => {
      const vitestProcess = spawn(
        'pnpm',
        ['exec', 'vitest', 'run', '--config', './vitest.config.e2e.ts'],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
          },
        },
      );

      vitestProcess.on('close', (code) => {
        res(code ?? 0);
      });
    });
  } catch (error) {
    console.error(
      '\n❌ Fallo en la ejecución del flujo de integración:',
      error,
    );
    exitCode = 1;
  } finally {
    cleanUp();
  }

  process.exit(exitCode);
}

void run();
