import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

// cache-invalidation-consumer — deletes Valkey/Redis keys when content
// is published or updated. No database access — this is the
// only worker that talks to Redis (see security module notes).
//
// MOVING TO PYTHON — see docs/adr/0011-polyglot-workers-and-packaging.md.
// Redis only, no schema coupling. Packaging is a container image, not a zip.
//
// Key conventions to invalidate (see infra/terraform/modules/cache):
//   entry:{entryId}      — dictionary entry cache (1h TTL)
//   search:{md5(params)} — search result cache (5m TTL, pattern delete)

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (err) {
      console.error('Failed to process record', record.messageId, err);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};

async function processRecord(record: SQSRecord): Promise<void> {
  // TODO: connect a Redis client using REDIS_HOST/REDIS_PORT (created
  // created outside the handler for warm-invocation reuse; TLS only when
  // NODE_ENV=production) and delete the keys named in record.body.
  // Deleting an already-deleted key is a no-op — naturally idempotent.
  void record;
  throw new Error('not implemented');
}
