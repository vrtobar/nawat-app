import { prisma } from '@nahuat/database';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

// audit-consumer — writes AuditLog rows from audit events published by
// the NestJS AuditModule.
//
// MOVING TO PYTHON — see docs/adr/0011-polyglot-workers-and-packaging.md before
// implementing. This consumer appends one fixed-shape row and never reads the
// model, so it does not need the Prisma client; raw psycopg is the honest
// description of the job. Packaging is a container image, not a zip.
//
// ReportBatchItemFailures is enabled on the event source mapping: only
// failed records return to the queue, the rest of the batch is deleted.

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
  // TODO: parse the audit event from record.body and upsert —
  // AuditLog.sqsMessageId is @unique, which makes retries idempotent:
  //
  //   await prisma.auditLog.upsert({
  //     where: { sqsMessageId: record.messageId },
  //     create: { ...event, sqsMessageId: record.messageId },
  //     update: {}, // empty — never overwrite on retry
  //   });
  //
  // Wrap multi-row writes in prisma.$transaction. Internal retry with
  // exponential backoff (2-3 attempts) per notes.md before letting the
  // record fail to SQS.
  void prisma;
  void record;
  throw new Error('not implemented');
}
