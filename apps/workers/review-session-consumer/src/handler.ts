import { prisma } from '@nahuat/database';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

// review-session-consumer — the side effects of finishing a flashcard review
// session that are allowed to lag the request: a UserActivity row of type
// REVIEW_SESSION, and the denormalized streak, xp and lastActiveAt caches the
// User model keeps so a streak need not be recalculated on every request.
//
// SRS card scheduling is deliberately NOT here. ADR 19 put it in the request
// path, in the transaction that records the session: a learner who finishes a
// session and finds nothing scheduled is the same silent failure as a dropped
// audit write. What is left here is the work nobody notices arriving a second
// late.
//
// Trigger re-scoped from lesson completion to review-session completion by
// docs/adr/0022-dictionary-and-flashcards-as-the-first-product.md, which
// dropped the learning hierarchy. ActivityType has one member for the same
// reason.
//
// LANGUAGE IS UNSETTLED. ADR 11 kept this consumer in TypeScript because it
// seeded FSRS defaults and needed the Prisma schema, and a second FSRS
// implementation in Python would not throw on divergence — it would schedule
// reviews wrongly. ADR 19 moved that work into the request path, so the
// argument no longer describes this handler. What remains is ordinary Postgres
// writes, which is the case ADR 11 assigns to Python. Recorded in the backlog
// rather than settled here.

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
  // TODO: log the activity and advance the streak, xp and lastActiveAt caches
  // in one transaction.
  //
  // The open problem is idempotency, and it is not the same as the audit
  // consumer's. SQS delivers at least once, so a redelivery must not count a
  // session twice — but xp and streak are accumulators, and an upsert with an
  // empty update does not protect an increment the way it protects a seed.
  //
  // UserActivity has no unique key that would express "this session, once":
  // it is keyed on (userId, date) as an index, not a constraint. Whether the
  // dedupe key is the review session's own id or the SQS message id is a
  // schema decision, and it needs a migration either way. See the backlog.
  void prisma;
  void record;
  throw new Error('not implemented');
}
