import 'dotenv/config'; // runs via tsx like seed.ts — nothing else loads .env

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { buildDatabaseUrl } from '../src/url';

// Prints the IP address of the Postgres server on the other end of this
// connection, and nothing else.
//
// WHY THIS EXISTS. Every deployed database is reached through the bastion
// tunnel, so from the client's side every one of them is `localhost:5433`. The
// environment named on a command line selects the bucket and the credentials;
// it cannot select which RDS instance the tunnel happens to terminate at. A
// tunnel opened to production with `export staging` typed afterwards reads
// production and writes it into staging's bucket, and every message along the
// way says "staging".
//
// inet_server_addr() is the one thing that differs: it is answered by the
// server itself, so it names the instance actually reached rather than the
// address dialled. Comparing it against the endpoint's DNS resolution is what
// lets dictionary-backup.sh refuse a tunnel pointed somewhere unintended.
//
// Returns empty over a unix socket — inet_server_addr() is NULL there, which is
// correct and not an error. Callers treat "unknown" as "cannot verify" rather
// than as a mismatch.
const adapter = new PrismaPg({ connectionString: buildDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  // host() renders inet as bare text; without it the value carries a netmask.
  const rows = await prisma.$queryRaw<{ addr: string | null }[]>`
    SELECT host(inet_server_addr()) AS addr
  `;
  process.stdout.write(`${rows[0]?.addr ?? ''}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
