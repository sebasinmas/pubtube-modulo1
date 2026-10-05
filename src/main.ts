import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Habilita la validación declarativa de los DTOs (class-validator) y
  // excluye propiedades no declaradas en ellos (US-A2).
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  await app.listen(process.env.PORT ?? 3000);

  const url = await app.getUrl();
  logger.log(`API PubTube Módulo 1 escuchando en ${url}`);
}
void bootstrap();
