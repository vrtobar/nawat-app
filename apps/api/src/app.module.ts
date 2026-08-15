import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './modules/health/health.module';

// TODO(PLAN §12): feature modules land here as they're implemented —
// AuthModule, DictionaryModule, LessonsModule, ProgressModule,
// FlashcardsModule, ReviewModule, UploadsModule, UsersModule,
// AuditModule (@Global), CacheModule, SqsModule.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // env files are loaded by env-bootstrap.ts (first import in main.ts)
      // so they're in process.env before @nahuat/database initializes —
      // loading them here too would just create a second source of truth.
      ignoreEnvFile: true,
    }),
    HealthModule,
  ],
  providers: [
    // Registered as a provider rather than via app.useGlobalFilters() so it can
    // take constructor dependencies later without rewiring — the audit logger
    // and Pino are the likely ones.
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // '{*path}' rather than '*'. NestJS 11 runs Express 5, whose path-to-regexp
    // v8 rejects a bare '*' — it throws at boot, before any request is served.
    consumer.apply(CorrelationIdMiddleware).forRoutes('{*path}');
  }
}
