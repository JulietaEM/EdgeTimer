import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Orígenes permitidos (frontend web). Separa varios con comas en CORS_ORIGINS,
// por ejemplo para desarrollo local: http://localhost:8081
const DEFAULT_ORIGIN = 'https://edge-timer-blue.vercel.app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origins = (process.env.CORS_ORIGINS ?? DEFAULT_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
