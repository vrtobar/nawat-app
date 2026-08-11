import { prisma } from '@nahuat/database';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

// lesson-completion-consumer — post-completion side effects that don't
// belong in the request path: SRS card seeding from LessonVocabulary,
// UserActivity logging, streak/XP recalculation (PLAN §14).

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
  // TODO(PLAN §14): seed UserCardProgress for the lesson's vocabulary.
  // Idempotency pattern — upsert with empty update inside a transaction,
  // so retries never clobber existing SRS state:
  //
  //   await prisma.$transaction(
  //     vocabulary.map((v) =>
  //       prisma.userCardProgress.upsert({
  //         where: { userId_translationId: { userId, translationId: v.translationId } },
  //         create: { userId, translationId: v.translationId /* + ts-fsrs defaults */ },
  //         update: {},
  //       }),
  //     ),
  //   );
  void prisma;
  void record;
  throw new Error('not implemented');
}
