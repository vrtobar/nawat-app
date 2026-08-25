// Accounts for hand-testing role-gated routes against the local mock OIDC
// issuer (apps/api/scripts/mock-oidc, docs/adr/0013). They are a companion to
// that issuer and useless without it: a User row grants nothing on its own,
// because authorization is read from the token, never from the database.
// Staging runs this same seed and verifies against the real Auth0 tenant,
// which will never mint a `seed|` subject — so the rows are inert there by
// construction.
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
// The original reason was narrower and no longer holds: the token carried a
// https://nahuat.com/userId claim that had to name a real User.id. Custom
// claims are gone as of 2026-08-24 (see docs/adr/0013) and only `sub` is read,
// so what has to match a row now is `auth0Id`, not the id. Pinning both keeps
// the seed and the minting script agreeing on one set of literals.
//
// All three rungs of the ladder, not just ADMIN: @Roles is a ranked
// comparison, so proving a CONTRIBUTOR is refused a publish needs a
// CONTRIBUTOR token as much as proving an ADMIN is allowed one needs an ADMIN
// token.
export const DEV_USERS = [
  {
    id: 'dev_user_0000000000000000',
    auth0Id: 'seed|dev-user',
    email: 'dev-user@nahuat.invalid',
    name: 'Dev User (USER)',
    role: 'USER',
  },
  {
    id: 'dev_contributor_000000000',
    auth0Id: 'seed|dev-contributor',
    email: 'dev-contributor@nahuat.invalid',
    name: 'Dev User (CONTRIBUTOR)',
    role: 'CONTRIBUTOR',
  },
  {
    id: 'dev_admin_000000000000000',
    auth0Id: 'seed|dev-admin',
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
