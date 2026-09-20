import { Module, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const logger = new Logger('DatabaseModule');

@Module({
  providers: [
    {
      provide: 'DATABASE_CONNECTION',
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
          throw new Error(
            'DATABASE_URL no está definida. Revisa el archivo .env o las variables de entorno del docker-compose.',
          );
        }

        const pool = new Pool({ connectionString });
        pool.on('error', (err) => {
          logger.error(
            'Error inesperado en el pool de conexiones de Postgres',
            err,
          );
        });

        logger.log('Conexión Drizzle/PostgreSQL inicializada correctamente.');
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: ['DATABASE_CONNECTION'],
})
export class DatabaseModule {}
