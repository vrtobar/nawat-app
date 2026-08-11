// MUST stay the first import in main.ts. The @nahuat/database prisma
// singleton reads process.env at import time — which happens before
// ConfigModule.forRoot() would load env files — so the files have to be
// loaded here, ahead of every other module. ConfigModule then validates
// process.env with ignoreEnvFile: true; this file is the only env-file
// loader. In production (ECS/Lambda) the files don't exist and this
// no-ops — env comes from the task definition.
import { config } from 'dotenv';

config({ path: ['.env.local', '.env'] });
