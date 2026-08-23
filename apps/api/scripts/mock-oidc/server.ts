import { ISSUER_PORT, ISSUER_URL, loadIssuer } from './key';

// A local OIDC issuer for hand-testing role-gated routes.
//
// It exists because there is otherwise no way to obtain an ADMIN-claimed token
// against a local API: the role claim is stamped by an Auth0 Post Login Action
// that calls back into the API, and Auth0's servers cannot reach localhost.
//
// What this does NOT do is weaken the API. The strategy still verifies RS256
// against a JWKS endpoint, with issuer and audience pinned; only the URLs it
// reads them from move. See docs/adr/0013.
async function main(): Promise<void> {
  const server = await loadIssuer();
  await server.start(ISSUER_PORT, 'localhost');

  console.log(`mock-oidc: issuer listening on ${ISSUER_URL}`);
  console.log('');
  console.log('Point the API at it in apps/api/.env.local:');
  console.log(`  AUTH0_ISSUER_URL=${ISSUER_URL}/`);
  console.log(`  AUTH0_JWKS_URI=${ISSUER_URL}/jwks`);
  console.log('');
  console.log('Then mint a token:  npm run auth:token -- admin');
  console.log('Users come from the seed:  npm run db:seed:dev');

  // Leave the process running until interrupted; there is nothing to await.
  process.on('SIGINT', () => {
    void server.stop().then(() => process.exit(0));
  });
}

void main();
