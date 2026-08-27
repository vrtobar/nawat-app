/**
 * Mints an access token for one of the seeded development users, so
 * role-gated routes can be exercised with curl or Postman without a browser.
 *
 *   npm run auth:token --workspace=api -- admin
 *   npm run auth:token --workspace=api -- contributor
 *   npm run auth:token --workspace=api -- user
 *
 * REPLACES scripts/mock-oidc/, deleted with the identity change
 * (docs/adr/0018). That directory ran a local OIDC provider because Auth0's
 * servers cannot reach localhost, and minted RS256 tokens for it to verify via
 * a mock JWKS. Nothing verifies those any more: this API accepts only tokens
 * signed by its own key set, so the mock issuer could not produce a usable
 * token however it were configured. Signing with the real key is both simpler
 * and closer to what production does.
 *
 * The tokens are as real as any other — same key, same issuer, same audience —
 * so this is only ever as safe as JWT_SIGNING_KEYS is. That key is per
 * environment and the local one signs nothing any deployed environment
 * accepts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DEV_USERS, type DevUser } from '@nahuat/database/dev-users';
import { importJWK, SignJWT } from 'jose';

// Read directly rather than through ConfigService: this is a script, and
// booting the Nest application to sign one token would need a database.
function env(): Record<string, string> {
  const path = resolve(__dirname, '../.env.local');
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => [
        line.slice(0, line.indexOf('=')).trim(),
        line.slice(line.indexOf('=') + 1).trim(),
      ]),
  );
}

async function main(): Promise<void> {
  const requested = (process.argv[2] ?? 'admin').toUpperCase();
  const user = DEV_USERS.find((candidate: DevUser) => candidate.role === requested);

  if (!user) {
    console.error(
      `No seeded user with role "${requested}". Available: ` +
        DEV_USERS.map((candidate: DevUser) => candidate.role.toLowerCase()).join(', '),
    );
    process.exit(1);
  }

  const config = env();
  const { keys } = JSON.parse(
    Buffer.from(config.JWT_SIGNING_KEYS ?? '', 'base64').toString('utf8'),
  ) as { keys: Record<string, unknown>[] };

  const signingKey = keys[0];
  if (!signingKey) {
    console.error('JWT_SIGNING_KEYS holds no keys. Run `npm run auth:keygen`.');
    process.exit(1);
  }

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: signingKey.kid as string })
    // User.id, matching what the API mints — see token.service.ts for why the
    // subject is this system's own id rather than an identity provider's.
    .setSubject(user.id)
    .setIssuer(config.JWT_ISSUER ?? '')
    .setAudience(config.JWT_AUDIENCE ?? '')
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(await importJWK({ ...signingKey, alg: 'RS256' }, 'RS256'));

  // stderr, so `npm run auth:token > token.txt` captures only the token.
  console.error(`# ${user.name} — ${user.provider}/${user.subject} (${user.id})`);
  console.error('# Requires `npm run db:seed:dev`; the row must exist to resolve.');
  process.stdout.write(`${token}\n`);
}

void main();
