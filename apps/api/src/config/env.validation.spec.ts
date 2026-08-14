import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateEnv } from './env.validation';

// Everything required unconditionally. Individual tests add the database and
// Redis halves, which the superRefine accepts in either of two shapes.
const baseEnv = {
  AUTH0_DOMAIN: 'nahuat-platform-staging.us.auth0.com',
  AUTH0_AUDIENCE: 'https://api.nahuat.com',
  AUTH0_CLIENT_ID: 'client-id',
  AUTH0_CLIENT_SECRET: 'client-secret',
  AUTH0_MGMT_CLIENT_ID: 'mgmt-client-id',
  AUTH0_MGMT_CLIENT_SECRET: 'mgmt-client-secret',
  INTERNAL_SECRET: 'internal-secret',
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

  it('requires every queue URL once SQS_ENABLED is true', () => {
    expect(() =>
      validateEnv({ ...baseEnv, ...localDb, ...localRedis, SQS_ENABLED: 'true' }),
    ).toThrow('Environment validation failed');
  });

  it('defaults SQS_ENABLED to false, so queue URLs stay optional locally', () => {
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
});
