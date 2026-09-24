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
        const user = process.env.POSTGRES_USER || 'pubtube';
        const password = process.env.POSTGRES_PASSWORD || 'pubtube_secret';
        const host = process.env.POSTGRES_HOST || 'localhost';
        const port = process.env.POSTGRES_PORT || '5433';
        const dbName = process.env.POSTGRES_DB || 'pubtube_db';

        const connectionString =
          process.env.DATABASE_URL ||
          `postgresql://${user}:${password}@${host}:${port}/${dbName}`;

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
