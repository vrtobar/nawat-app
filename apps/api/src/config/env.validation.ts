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

    // In-house access tokens (docs/adr/0018). This API is the authorization
    // server: it signs the tokens it verifies, and the private key never
    // leaves this process.
    //
    // A base64-encoded JWK Set of PRIVATE RSA keys. The first key signs and
    // every key verifies, which is what makes rotation a one-variable change —
    // see token.service.ts. `npm run auth:keygen` produces the value.
    //
    // REQUIRED, with no development default, and that is the point: a signing
    // key that falls back to something when unset is a signing key an
    // environment can accidentally share, and every token it minted would
    // verify everywhere. The Auth0-era AUTH0_ISSUER_URL escape hatch above
    // exists because pointing verification at a mock issuer adds no branch to
    // the running service; a defaulted key would.
    JWT_SIGNING_KEYS: z.string().min(1),

    // `iss` and `aud` on every token this API mints, and the values it demands
    // when verifying one. Both are checked: without `aud`, a token minted by
    // this issuer for some other consumer would be accepted here.
    JWT_ISSUER: z.url(),
    JWT_AUDIENCE: z.string().min(1),

    // ~1 hour, per docs/adr/0018. Short because the refresh token carries the
    // session — see the RefreshToken store — so a stolen access token expires
    // on its own rather than lasting the length of a login.
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

    // The session, in two deadlines. The absolute one belongs to the login and
    // survives every rotation; the idle one belongs to the token in hand and
    // resets each time it is used. Both defaults follow docs/adr/0018, which
    // took them from what Auth0 issues with rotation enabled.
    REFRESH_TOKEN_ABSOLUTE_TTL_DAYS: z.coerce.number().int().positive().default(30),
    REFRESH_TOKEN_IDLE_TTL_DAYS: z.coerce.number().int().positive().default(14),

    // The Google OAuth client this API accepts ID tokens for — the `aud` every
    // one of them must carry.
    //
    // ⚠️ ONE CLIENT PER ENVIRONMENT, and it is not an incidental detail. A
    // single client listing localhost, staging and production redirect URIs
    // works, and was briefly how this was set up — but it makes this value
    // identical everywhere, so an ID token obtained against local development
    // satisfies production's audience check too. That is the
    // cross-environment token validity docs/adr/0018 exists to end, rebuilt in
    // a smaller form. The sharper cost is the client SECRET: with one client,
    // anyone who can run this application locally holds production's OAuth
    // credential.
    //
    // Separate clients make the coupling structurally impossible rather than
    // merely unused, which is the same reasoning as JWT_SIGNING_KEYS below
    // having no default.
    //
    // THE CLIENT SECRET IS DELIBERATELY ABSENT. The web tier performs the code
    // exchange and is the only place that needs it; this API only ever
    // verifies an assertion Google already signed, which takes the public
    // client id and Google's published keys. So a compromise here yields no
    // credential that can obtain a Google identity.
    GOOGLE_CLIENT_ID: z.string().min(1),

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
