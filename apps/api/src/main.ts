import './env-bootstrap'; // MUST be first — see comment in that file

// TODO(PLAN §12): initialize AWS X-Ray here, BEFORE NestFactory.create —
// the SDK must patch http/https/pg before anything else imports them.
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import type { Env } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  // All routes under /api, versioned as /api/v1/... — the health
  // controller opts out with VERSION_NEUTRAL (ECS probes /api/health).
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.enableCors({
    origin: config.get('WEB_URL', { infer: true }),
    credentials: true,
  });

  // TODO(PLAN §12): global providers, in order:
  //   - ZodValidationPipe        (common/pipes)
  //   - HttpExceptionFilter      (common/filters) — uniform error envelope
  //   - TransformInterceptor     (common/interceptors) — success envelope
  //   - LoggingInterceptor       (common/interceptors) — Pino + correlationId
  //   - JwtAuthGuard via APP_GUARD, global by default with @Public() escape

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  console.log(`API listening on :${port}`);
}

void bootstrap();
