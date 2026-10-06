import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Habilita la validación declarativa de los DTOs (class-validator) y
  // excluye propiedades no declaradas en ellos (US-A2).
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  const config = new DocumentBuilder()
    .setTitle('PubTube Módulo 1 — Gestión de Contenidos')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('api/docs', app, () =>
    SwaggerModule.createDocument(app, config),
  );

  await app.listen(process.env.PORT ?? 3000);

  const url = await app.getUrl();
  logger.log(`API PubTube Módulo 1 escuchando en ${url}`);
}
void bootstrap();
