import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

// cdn-invalidation-consumer — creates CloudFront invalidations when
// assets are replaced (PLAN §14). The only worker that needs internet
// access (CloudFront API via NAT gateway). Assets normally use
// content-addressed keys (new upload = new URL), so invalidations are
// the exception: explicit replacement of an existing key.

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
  // TODO(PLAN §14): @aws-sdk/client-cloudfront CreateInvalidation for
  // the paths in record.body, against CDN_DISTRIBUTION_ID. Use the
  // record.messageId as CallerReference — CloudFront dedupes identical
  // CallerReferences, which makes retries idempotent for free.
  void record;
  throw new Error('not implemented');
}
