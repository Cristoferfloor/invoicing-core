import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
  // Fuera de Docker las variables vienen de .env; dentro, de env_file.
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables del entorno
  }

  const app = await NestFactory.create(AppModule.registrar(process.env));
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  const puerto = Number(process.env.PORT ?? 3006);
  await app.listen(puerto, '0.0.0.0');
  new Logger('Bootstrap').log(`core-service escuchando en :${puerto}`);
}

void bootstrap();
