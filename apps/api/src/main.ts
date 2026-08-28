import './env-bootstrap'; // MUST be first — see comment in that file

// TODO: initialize AWS X-Ray here, BEFORE NestFactory.create —
// the SDK must patch http/https/pg before anything else imports them.
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  // Prefix and versioning live in configure-app.ts so the HTTP tests boot an
  // application addressed the same way this one is.
  configureApp(app);

  app.enableCors({
    origin: config.get('WEB_URL', { infer: true }),
    credentials: true,
  });

  // Cross-cutting providers are registered in AppModule rather than here, so
  // they can take constructor dependencies. Done:
  //   - CorrelationIdMiddleware  — middleware, not an interceptor: guards throw
  //                                before interceptors run, and a 401 without a
  //                                correlation id is the one you most want
  //   - HttpExceptionFilter      — uniform error envelope
  //
  // ZodValidationPipe is NOT global: a global pipe cannot know which schema a
  // given handler expects. It is applied per parameter —
  // @Body(new ZodValidationPipe(CreateEntrySchema)).
  //
  // TODO: still to come —
  //   - JwtAuthGuard via APP_GUARD, global by default with @Public() escape
  //
  //   - Request logging as MIDDLEWARE, not an interceptor. The original
  //     design called for a LoggingInterceptor; that shape cannot work.
  //     Interceptors run after guards, so a request rejected by JwtAuthGuard
  //     never reaches one — no 401 or 403 would ever be logged, which is the
  //     opposite of what an access log is for. Log on response finish from
  //     middleware instead, and keep an interceptor only if handler-level
  //     timing is wanted separately.

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  console.log(`API listening on :${port}`);
}

void bootstrap();
