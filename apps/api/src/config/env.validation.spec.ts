import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateEnv } from './env.validation';

// Everything required unconditionally. Individual tests add the database and
// Redis halves, which the superRefine accepts in either of two shapes.
const baseEnv = {
  // Not a real key — validateEnv only checks that the value is a non-empty
  // string. TokenService is what rejects one that does not decode to a usable
  // private JWK Set, and it does so at boot; see token.service.spec.ts.
  JWT_SIGNING_KEYS: 'base64-encoded-jwk-set',
  JWT_ISSUER: 'https://api.nahuat.com',
  JWT_AUDIENCE: 'https://api.nahuat.com',
  GOOGLE_CLIENT_ID: '1234567890-abcdef.apps.googleusercontent.com',
  S3_BUCKET: 'nahuat-assets',
  CDN_URL: 'https://cdn.nahuat.com',
};

const localDb = { DATABASE_URL: 'postgresql://nahuat:nahuat@localhost:5432/nahuat' };
const deployedDb = {
  DB_USERNAME: 'nahuat',
  DB_PASSWORD: 'generated-by-aws',
  DB_HOST: 'db.example.rds.amazonaws.com',
  DB_PORT: '5432',
  DB_NAME: 'nahuat',
};

const localRedis = { REDIS_URL: 'redis://localhost:6379' };
const deployedRedis = { REDIS_HOST: 'cache.example.cache.amazonaws.com', REDIS_PORT: '6379' };

describe('validateEnv', () => {
  beforeEach(() => {
    // validateEnv prints the field-level failures before throwing; that output
    // is the point of it, but it is noise in a passing test run.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('accepts the local shape: DATABASE_URL and REDIS_URL', () => {
    expect(() => validateEnv({ ...baseEnv, ...localDb, ...localRedis })).not.toThrow();
  });

  it('accepts the deployed shape: DB_* and REDIS_HOST/PORT from ECS', () => {
    expect(() => validateEnv({ ...baseEnv, ...deployedDb, ...deployedRedis })).not.toThrow();
  });

  it('rejects a partial DB_* set rather than connecting to the wrong place', () => {
    const { DB_NAME: _omitted, ...partial } = deployedDb;

    expect(() => validateEnv({ ...baseEnv, ...partial, ...localRedis })).toThrow(
      'Environment validation failed',
    );
  });

  it('rejects a missing database entirely', () => {
    expect(() => validateEnv({ ...baseEnv, ...localRedis })).toThrow(
      'Environment validation failed',
    );
  });

  it('requires the media queue URL once SQS_ENABLED is true', () => {
    expect(() =>
      validateEnv({ ...baseEnv, ...localDb, ...localRedis, SQS_ENABLED: 'true' }),
    ).toThrow('Environment validation failed');
  });

  it('accepts SQS_ENABLED with the media queue URL supplied', () => {
    const env = validateEnv({
      ...baseEnv,
      ...localDb,
      ...localRedis,
      SQS_ENABLED: 'true',
      SQS_MEDIA_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/1/nahuat-staging-media',
    });

    expect(env.SQS_ENABLED).toBe(true);
  });

  it('defaults SQS_ENABLED to false, so the queue URL stays optional locally', () => {
    const env = validateEnv({ ...baseEnv, ...localDb, ...localRedis });

    expect(env.SQS_ENABLED).toBe(false);
  });

  it('coerces PORT from the string the environment always provides', () => {
    const env = validateEnv({ ...baseEnv, ...localDb, ...localRedis, PORT: '3001' });

    expect(env.PORT).toBe(3001);
  });

  it('rejects a CDN_URL that is not a URL', () => {
    expect(() =>
      validateEnv({ ...baseEnv, ...localDb, ...localRedis, CDN_URL: 'cdn.nahuat.com' }),
    ).toThrow('Environment validation failed');
  });

  // The signing key has no default and must not acquire one — see the schema.
  // This test is what fails if someone adds `.optional()` or a fallback to make
  // a local run boot, which is exactly the change that would let two
  // environments mint interchangeable tokens.
  it.each<keyof typeof baseEnv>(['JWT_SIGNING_KEYS', 'JWT_ISSUER', 'JWT_AUDIENCE'])(
    'refuses to boot without %s',
    (key) => {
      const { [key]: _omitted, ...withoutKey } = baseEnv;

      expect(() => validateEnv({ ...withoutKey, ...localDb, ...localRedis })).toThrow(
        'Environment validation failed',
      );
    },
  );

  it('defaults the token lifetimes to one hour, 30 days and 14 days idle', () => {
    const env = validateEnv({ ...baseEnv, ...localDb, ...localRedis });

    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
    expect(env.REFRESH_TOKEN_ABSOLUTE_TTL_DAYS).toBe(30);
    expect(env.REFRESH_TOKEN_IDLE_TTL_DAYS).toBe(14);
  });
});
