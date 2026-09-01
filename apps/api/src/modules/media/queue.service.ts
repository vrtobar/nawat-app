import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { MEDIA_PROCESSING_MESSAGE_VERSION, type MediaProcessingMessage } from '@nahuat/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The only place in the API that publishes to a queue. It exists because ADR
// 19's amendment moved the media producer here from an S3 bucket notification:
// bytes landing in the bucket is not the event worth acting on, an upload being
// CONFIRMED is, and only the API knows which one happened.
//
// OFF BY DEFAULT. Locally there is no queue and no consumer, so publishing is
// skipped and an asset stops at PENDING. Making that a hard failure would mean
// no one could exercise the upload path without AWS.
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly client: SQSClient;
  private readonly enabled: boolean;
  private readonly mediaQueueUrl: string | undefined;

  constructor(private readonly config: ConfigService) {
    // Same reasoning as StorageService: no explicit region or credentials, so
    // the default chain reads the task role in ECS and a developer's profile
    // locally.
    this.client = new SQSClient({});
    this.enabled = this.config.get<boolean>('SQS_ENABLED') ?? false;
    this.mediaQueueUrl = this.config.get<string>('SQS_MEDIA_QUEUE_URL');
  }

  // Returns whether the message was published, rather than throwing when it
  // was not.
  //
  // THE CALLER MUST NOT FAIL THE REQUEST ON A FALSE. By the time this runs the
  // upload is confirmed and the row is committed at PENDING; the bytes are in
  // the bucket and the contributor did nothing wrong. Failing here would also
  // be unrecoverable for them — the completion endpoint refuses a second call
  // on an asset that has left AWAITING_UPLOAD, so a client retry cannot
  // republish. A row left PENDING with no message is precisely what the
  // reaper's republish sweep exists to collect, and this logs at error so the
  // sweep is not the first thing that notices.
  async publishMediaProcessing(assetId: string): Promise<boolean> {
    if (!this.enabled || !this.mediaQueueUrl) {
      this.logger.debug(`SQS disabled; not queueing media asset ${assetId}`);
      return false;
    }

    const message: MediaProcessingMessage = {
      version: MEDIA_PROCESSING_MESSAGE_VERSION,
      assetId,
    };

    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.mediaQueueUrl,
          MessageBody: JSON.stringify(message),
        }),
      );
      return true;
    } catch (err) {
      // Deliberately swallowed. See the contract above: the alternative is a
      // 500 on a request that succeeded, for a failure the caller cannot fix.
      this.logger.error(
        `Failed to queue media asset ${assetId}; it will be republished by the reaper`,
        err instanceof Error ? err.stack : String(err),
      );
      return false;
    }
  }
}
