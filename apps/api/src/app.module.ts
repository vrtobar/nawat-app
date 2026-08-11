import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

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
})
export class AppModule {}
