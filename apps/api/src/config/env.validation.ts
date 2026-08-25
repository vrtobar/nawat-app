import { z } from 'zod';

// =============================================================================
// ENVIRONMENT VALIDATION — Zod, not Joi, so the schemas here use the same
// vocabulary as every other contract in the repo (docs/adr/0010).
// Wired into ConfigModule.forRoot({ validate: validateEnv }) — the process
// exits at boot with field-level errors if anything required is missing.
//
// Two deployment shapes for the same variables:
//   Local:      DATABASE_URL / REDIS_URL in .env.local (docker-compose)
//   Production: individual DB_* fields (ECS injects them from the
//               AWS-managed RDS secret) and REDIS_HOST/REDIS_PORT
// The refinements below accept either form.
// =============================================================================

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),

    // Database — DATABASE_URL or all five DB_* fields
    DATABASE_URL: z.string().min(1).optional(),
    DB_USERNAME: z.string().min(1).optional(),
    DB_PASSWORD: z.string().min(1).optional(),
    DB_HOST: z.string().min(1).optional(),
    DB_PORT: z.coerce.number().int().optional(),
    DB_NAME: z.string().min(1).optional(),

    // Redis — REDIS_URL (local) or REDIS_HOST/REDIS_PORT (production)
    REDIS_URL: z.string().min(1).optional(),
    REDIS_HOST: z.string().min(1).optional(),
    REDIS_PORT: z.coerce.number().int().optional(),

    // Auth0
    AUTH0_DOMAIN: z.string().min(1),
    AUTH0_AUDIENCE: z.string().min(1),

    // Both default to the Auth0 tenant derived from AUTH0_DOMAIN, so staging
    // and production set neither and behave exactly as before. They exist so
    // local development can point the *issuer* at a mock OIDC provider that
    // mints RS256 tokens with arbitrary claims — the strategy is unchanged and
    // still trusts only RS256-via-JWKS. Swapping the issuer is not the rejected
    // NODE_ENV/HS256 bypass: no branch is added to the running service, which
    // is the property docs/adr/0013 protects.
    //
    // Two variables rather than one because the paths genuinely differ: Auth0
    // serves /.well-known/jwks.json, oauth2-mock-server serves /jwks, so the
    // JWKS URI cannot simply be derived from the issuer.
    AUTH0_ISSUER_URL: z.url().optional(),
    AUTH0_JWKS_URI: z.url().optional(),
    AUTH0_CLIENT_ID: z.string().min(1),
    AUTH0_CLIENT_SECRET: z.string().min(1),
    AUTH0_MGMT_CLIENT_ID: z.string().min(1),
    AUTH0_MGMT_CLIENT_SECRET: z.string().min(1),

    // Uploads / CDN
    S3_BUCKET: z.string().min(1),
    CDN_URL: z.url(),

    // SQS — disabled locally (consumers run synchronously in-process)
    SQS_ENABLED: z.stringbool().default(false),
    SQS_AUDIT_QUEUE_URL: z.url().optional(),
    SQS_LESSON_COMPLETION_QUEUE_URL: z.url().optional(),
    SQS_CACHE_INVALIDATION_QUEUE_URL: z.url().optional(),
    SQS_CDN_INVALIDATION_QUEUE_URL: z.url().optional(),

    // CORS origin for the Next.js app
    WEB_URL: z.url().default('http://localhost:3000'),
  })
  .superRefine((env, ctx) => {
    const hasDbFields =
      env.DB_USERNAME && env.DB_PASSWORD && env.DB_HOST && env.DB_PORT && env.DB_NAME;
    if (!env.DATABASE_URL && !hasDbFields) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'Provide DATABASE_URL, or all of DB_USERNAME/DB_PASSWORD/DB_HOST/DB_PORT/DB_NAME',
      });
    }

    if (!env.REDIS_URL && !(env.REDIS_HOST && env.REDIS_PORT)) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'Provide REDIS_URL, or both REDIS_HOST and REDIS_PORT',
      });
    }

    if (env.SQS_ENABLED) {
      for (const key of [
        'SQS_AUDIT_QUEUE_URL',
        'SQS_LESSON_COMPLETION_QUEUE_URL',
        'SQS_CACHE_INVALIDATION_QUEUE_URL',
        'SQS_CDN_INVALIDATION_QUEUE_URL',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when SQS_ENABLED=true`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );

    console.error(`❌ Environment validation failed:\n${lines.join('\n')}`);
    throw new Error('Environment validation failed');
  }

  return result.data;
}
