// Same loader the API uses, so AUTH0_AUDIENCE here is whatever the API is
// actually validating against. A token minted for a different audience is
// rejected with the same 401 as a forged one, which is a confusing way to
// discover a config mismatch.
import '../../src/env-bootstrap';

import { DEV_USERS, findDevUser } from '@nahuat/database/dev-users';

import { ISSUER_CLAIM, loadIssuer } from './key';

// Mints an access token for one of the seeded dev users.
//
//   npm run auth:token -- admin
//   npm run auth:token -- contributor
//   npm run auth:token -- user
//
// Offline: the issuer does not need to be running, because signing needs the
// key and not a socket. The API does need it running to fetch the JWKS.
//
// Claims are namespaced exactly as Auth0 namespaces them, because that is what
// jwt.strategy.ts reads — this mints the token the Post Login Action would have
// produced, not a differently-shaped one the API has to special-case.
const CLAIM_NAMESPACE = 'https://nahuat.com';

// Read from the same .env.local the API reads, falling back to the value in
// .env.example for a checkout that has not written one yet.
const AUDIENCE = process.env.AUTH0_AUDIENCE ?? 'https://api.staging.nahuat.com';

async function main(): Promise<void> {
  const shorthand = process.argv[2];
  const user = shorthand ? findDevUser(shorthand) : undefined;

  if (!user) {
    const known = DEV_USERS.map((u) => u.role.toLowerCase()).join(' | ');
    console.error(
      shorthand
        ? `Unknown dev user "${shorthand}". Expected one of: ${known}`
        : `Usage: npm run auth:token -- <${known}>`,
    );
    process.exit(1);
  }

  const server = await loadIssuer();
  server.issuer.url = ISSUER_CLAIM;

  const token = await server.issuer.buildToken({
    scopesOrTransform: (_header, payload) => {
      payload.iss = ISSUER_CLAIM;
      payload.aud = AUDIENCE;
      payload.sub = user.auth0Id;
      payload[`${CLAIM_NAMESPACE}/role`] = user.role;
      // Must name a row that exists: content attribution is a non-null foreign
      // key, so a token pointing at no user fails on the first write rather
      // than at the door. `npm run db:seed:dev` creates them.
      payload[`${CLAIM_NAMESPACE}/userId`] = user.id;
      payload[`${CLAIM_NAMESPACE}/locale`] = 'ES';
    },
  });

  console.error(`# ${user.name} — ${user.auth0Id} (${user.id})`);
  // stdout carries the token alone, so the command can be substituted directly:
  //   curl -H "Authorization: Bearer $(npm run --silent auth:token -- admin)"
  console.log(token);
}

void main();
