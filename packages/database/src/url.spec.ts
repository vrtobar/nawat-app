import { describe, expect, it } from 'vitest';

import { buildDatabaseUrl } from './url';

const deployed = {
  DB_USERNAME: 'nahuat',
  DB_PASSWORD: 'plainpassword',
  DB_HOST: 'db.example.rds.amazonaws.com',
  DB_PORT: '5432',
  DB_NAME: 'nahuat',
};

describe('buildDatabaseUrl', () => {
  it('prefers DATABASE_URL verbatim when it is set', () => {
    const url = 'postgresql://nahuat:nahuat@localhost:5432/nahuat';

    expect(buildDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  });

  it('does not append sslmode to DATABASE_URL: local Postgres has no TLS', () => {
    const url = 'postgresql://nahuat:nahuat@localhost:5432/nahuat';

    expect(buildDatabaseUrl({ DATABASE_URL: url })).not.toContain('sslmode');
  });

  it('takes DATABASE_URL even when DB_* fields are also present', () => {
    const url = 'postgresql://override@localhost:5432/other';

    expect(buildDatabaseUrl({ ...deployed, DATABASE_URL: url })).toBe(url);
  });

  it('assembles a URL from the five DB_* fields', () => {
    expect(buildDatabaseUrl(deployed)).toBe(
      'postgresql://nahuat:plainpassword@db.example.rds.amazonaws.com:5432/nahuat?sslmode=no-verify',
    );
  });

  // RDS enforces rds.force_ssl=1, so an assembled URL without this is refused
  // with "no pg_hba.conf entry ... no encryption" — a production outage that
  // has already happened once.
  it('always appends sslmode=no-verify on the assembled branch', () => {
    expect(buildDatabaseUrl(deployed)).toContain('?sslmode=no-verify');
  });

  // AWS generates the master password and it can contain characters that are
  // reserved in a URL. Unencoded, ':' and '@' silently reshape the authority
  // section and the connection fails somewhere unrelated.
  it('percent-encodes reserved characters in the password', () => {
    const url = buildDatabaseUrl({ ...deployed, DB_PASSWORD: 'p@ss:w/rd?#' });

    expect(url).toContain(':p%40ss%3Aw%2Frd%3F%23@');
    expect(url).not.toContain('p@ss');
  });

  it('percent-encodes reserved characters in the username', () => {
    expect(buildDatabaseUrl({ ...deployed, DB_USERNAME: 'na huat' })).toContain('//na%20huat:');
  });

  it.each(Object.keys(deployed))(
    'returns undefined when %s is missing, rather than a malformed URL',
    (missing) => {
      const partial = { ...deployed, [missing]: undefined };

      expect(buildDatabaseUrl(partial)).toBeUndefined();
    },
  );

  it('returns undefined for a completely empty environment', () => {
    expect(buildDatabaseUrl({})).toBeUndefined();
  });

  it('treats an empty-string field as missing', () => {
    expect(buildDatabaseUrl({ ...deployed, DB_HOST: '' })).toBeUndefined();
  });
});
