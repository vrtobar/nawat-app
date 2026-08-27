/**
 * Generates the value for JWT_SIGNING_KEYS — a base64-encoded JWK Set of
 * private RSA keys, which this API signs its own access tokens with. See
 * docs/adr/0018 and src/modules/auth/token.service.ts.
 *
 *   npm run auth:keygen            a fresh set holding one new key
 *   npm run auth:keygen -- --rotate    a new key PREPENDED to the current set
 *
 * `--rotate` reads the existing set from JWT_SIGNING_KEYS in the environment.
 * Because the first key signs and every key verifies, prepending is the whole
 * rotation: deploy the new value, and tokens signed by the previous key keep
 * verifying until they expire. Drop the old key from the set on a later deploy,
 * once no token older than ACCESS_TOKEN_TTL_SECONDS can still be in flight.
 *
 * THE OUTPUT IS A PRIVATE KEY. It goes to stdout so it can be piped into a
 * secret store, and it is never written to a file here — a key on disk is a key
 * that ends up in a backup, an editor's recovery directory, or a commit.
 */
import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from 'jose';

// 2048 is the floor for RS256 in every guideline that names one, and the size
// Google, Auth0 and Okta all use for their own signing keys. 4096 signs and
// verifies measurably slower for a margin that is not the weak link here.
const MODULUS_LENGTH = 2048;

async function newSigningKey(): Promise<JWK> {
  const { privateKey } = await generateKeyPair('RS256', {
    modulusLength: MODULUS_LENGTH,
    // exportJWK needs the key material readable. WebCrypto keys are not
    // extractable by default, and the failure is a flat "key is not
    // extractable" from inside jose rather than anything pointing here.
    extractable: true,
  });

  const jwk = await exportJWK(privateKey);

  return {
    ...jwk,
    // RFC 7638 thumbprint — derived from the key's own public members, so it is
    // deterministic, unique per key, and carries no timestamp or counter that
    // could collide across environments. Computed from the PUBLIC half, so the
    // same kid appears in a published JWK Set without revealing anything.
    kid: await calculateJwkThumbprint(jwk),
    alg: 'RS256',
    use: 'sig',
  };
}

function currentKeys(): JWK[] {
  const encoded = process.env.JWT_SIGNING_KEYS;
  if (!encoded) {
    console.error(
      'JWT_SIGNING_KEYS is not set, so there is no set to rotate.\n' +
        'Run without --rotate to create one.',
    );
    process.exit(1);
  }

  const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('keys' in parsed) ||
    !Array.isArray(parsed.keys)
  ) {
    console.error('JWT_SIGNING_KEYS does not decode to a JWK Set with a `keys` array.');
    process.exit(1);
  }

  return parsed.keys as JWK[];
}

async function main(): Promise<void> {
  const rotating = process.argv.includes('--rotate');
  const key = await newSigningKey();
  const keys = rotating ? [key, ...currentKeys()] : [key];

  // stderr, so `npm run auth:keygen > value.txt` captures only the value.
  console.error(
    rotating
      ? `Prepended kid "${key.kid}". The set now holds ${keys.length} key(s); ` +
          'the new one signs and all of them verify.'
      : `Generated kid "${key.kid}".`,
  );

  process.stdout.write(`${Buffer.from(JSON.stringify({ keys })).toString('base64')}\n`);
}

void main();
