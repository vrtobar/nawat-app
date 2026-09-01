import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { MediaDerivativesSchema, MediaProcessingMessageSchema } from '../src/schemas/media.schema';

// Generates the JSON Schema that the Python media consumer validates against,
// from the Zod definitions that are already the contract for the TypeScript
// side. ADR 10 made one definition the rule; this is what extends that rule
// across a language boundary instead of abandoning it there.
//
// THE OUTPUT IS COMMITTED, and CI regenerates and diffs it. A generated file
// nobody regenerates is worse than a hand-written one because it looks
// authoritative — so the check is what makes this trustworthy, not the
// generator. Same shape as `terraform fmt -check` and `prettier --check`.
//
// It lands in the consumer's tree rather than here: it is an input to a Python
// package, and a developer working on that package should not have to know
// which npm workspace produced it.
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/workers/media-consumer/contracts',
);

const CONTRACTS = [
  // What the API publishes. The consumer validates it on the way IN, so a
  // message from a version it does not understand fails loudly at the boundary
  // rather than half-parsing.
  { file: 'media-processing-message.schema.json', schema: MediaProcessingMessageSchema },
  // What the consumer writes. Validated on the way OUT, because the reader is
  // the approval gate in another language and another process — by the time it
  // notices a bad shape, the reviewer is already looking at the asset.
  { file: 'media-derivatives.schema.json', schema: MediaDerivativesSchema },
] as const;

mkdirSync(OUT_DIR, { recursive: true });

for (const { file, schema } of CONTRACTS) {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  // Trailing newline so the file matches what prettier and git expect, and so
  // the CI diff is not permanently one byte wide.
  writeFileSync(join(OUT_DIR, file), `${JSON.stringify(jsonSchema, null, 2)}\n`);
  console.log(`wrote ${file}`);
}
