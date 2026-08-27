// Accounts for hand-testing role-gated routes without a browser. Paired with
// `npm run auth:token --workspace=api`, which mints a real access token naming
// one of them.
//
// ⚠️ A ROW HERE IS NOW ENOUGH TO BE SOMEBODY, which it was not before. Under
// the mock OIDC issuer these were inert without it, because authorization was
// read from the token; identity is now resolved from this table on every
// request, so anything holding a token for one of these ids has that role. The
// rows are still safe to seed anywhere, because minting a token needs
// JWT_SIGNING_KEYS — but the thing keeping them harmless is the key, not the
// absence of an issuer. Dev path only; seedReference never writes them.
//
// The SEED provider is what makes them unmistakable. Identity is the
// (provider, subject) pair, so these cannot collide with a Google sign-in even
// if the subjects matched exactly.
//
// Shared rather than declared in prisma/seed.ts, because two things need the
// same ids: the seed that writes the rows and the script that mints tokens
// naming them. Duplicating the literals would reintroduce exactly the drift
// seedDevUsers refuses to tolerate.
//
// Synthetic and unmistakable on purpose, following the same conventions as the
// sample-content author: `seed|` is not an Auth0 connection prefix so these can
// never collide with a real `sub`, and `.invalid` is reserved by RFC 2606 so
// the addresses can never be delivered to.
//
// `id` is pinned instead of left to @default(cuid()) so the rows are known
// before they are written, which is what lets tokens be minted offline and
// deterministically. Entry.creatorId and Translation.creatorId are non-null
// foreign keys with onDelete: Restrict, so a request resolving to no row
// authenticates and then fails the first write on a constraint violation.
//
// The id is pinned again as of docs/adr/0018: the access token's subject IS
// User.id, so a token minted for one of these has to name a row that exists.
// The (provider, subject) pair is pinned alongside it so the seed and anything
// minting against it agree on one set of literals.
//
// All three rungs of the ladder, not just ADMIN: @Roles is a ranked
// comparison, so proving a CONTRIBUTOR is refused a publish needs a
// CONTRIBUTOR token as much as proving an ADMIN is allowed one needs an ADMIN
// token.
export const DEV_USERS = [
  {
    id: 'dev_user_0000000000000000',
    provider: 'SEED',
    subject: 'dev-user',
    email: 'dev-user@nahuat.invalid',
    name: 'Dev User (USER)',
    role: 'USER',
  },
  {
    id: 'dev_contributor_000000000',
    provider: 'SEED',
    subject: 'dev-contributor',
    email: 'dev-contributor@nahuat.invalid',
    name: 'Dev User (CONTRIBUTOR)',
    role: 'CONTRIBUTOR',
  },
  {
    id: 'dev_admin_000000000000000',
    provider: 'SEED',
    subject: 'dev-admin',
    email: 'dev-admin@nahuat.invalid',
    name: 'Dev User (ADMIN)',
    role: 'ADMIN',
  },
] as const;

export type DevUser = (typeof DEV_USERS)[number];

// Lowercase shorthand for the CLI: `npm run auth:token -- admin`.
export function findDevUser(shorthand: string): DevUser | undefined {
  return DEV_USERS.find((u) => u.role.toLowerCase() === shorthand.toLowerCase());
}
