// MUST stay the first import in main.ts. The @nahuat/database prisma
// singleton reads process.env at import time — which happens before
// ConfigModule.forRoot() would load env files — so the files have to be
// loaded here, ahead of every other module. ConfigModule then validates
// process.env with ignoreEnvFile: true; this file is the only env-file
// loader. In production (ECS/Lambda) the files don't exist and this
// no-ops — env comes from the task definition.
import { config } from 'dotenv';

// quiet: dotenv v17 prints a banner to stdout on load. Harmless for the
// server, but it corrupts any script that loads env and then writes something
// machine-readable to stdout — scripts/mock-oidc/mint.ts prints a bare token
// meant to be consumed with $(...), and the banner landed inside the
// Authorization header.
config({ path: ['.env.local', '.env'], quiet: true });
