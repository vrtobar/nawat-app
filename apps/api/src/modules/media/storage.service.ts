import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// How long a presigned URL stays valid. Short because it is a write capability
// handed to a browser: long enough for a slow connection to finish a 10MB PUT,
// short enough that one copied out of a network log is worthless by the time
// it is used.
const UPLOAD_URL_TTL_SECONDS = 300;

// A reviewer's playback link. Shorter than the upload window and for a
// different reason: this one points at UNAPPROVED media, so the window is how
// long a link remains useful if it leaves the admin's browser.
const PREVIEW_URL_TTL_SECONDS = 120;

// What the browser must send on the PUT, and what S3 will check the body
// against because they were signed.
export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface ObjectSummary {
  sizeBytes: number;
  contentType: string | undefined;
}

// The only place in the API that talks to S3. Bytes never pass through this
// process — it signs URLs the browser uses directly, and reads object metadata
// to check what arrived.
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    // No explicit region or credentials: the SDK's default chain reads the task
    // role in ECS and the developer's profile locally. Passing them explicitly
    // would add two environment variables that only ever restate what the
    // execution context already knows, and would make a local run able to
    // point at the wrong account by typo.
    this.client = new S3Client({});
    this.bucket = this.config.getOrThrow<string>('S3_BUCKET');
  }

  // Content-Type and Content-Length are SIGNED, not merely suggested. A PUT
  // whose body disagrees with either is rejected by S3 itself, which is what
  // turns the client's declared type and size into a constraint the API does
  // not have to police after the fact.
  //
  // It still proves nothing about the bytes: a caller can send a JPEG that is
  // exactly the declared length under an audio content type. Sniffing the
  // magic bytes is the processor's job, and this is the cheap half that stops
  // the obvious cases before an object exists.
  async presignPut(key: string, contentType: string, sizeBytes: number): Promise<PresignedPut> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    return {
      url,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(sizeBytes),
      },
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  // Used to confirm an upload actually landed before the asset is queued for
  // processing. Returns undefined when the object is not there, which is the
  // expected answer for a client that reported an upload it never made.
  async head(key: string): Promise<ObjectSummary | undefined> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        sizeBytes: result.ContentLength ?? 0,
        contentType: result.ContentType,
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  // A read link for media that is not published, so an admin can hear or see
  // what they are approving. Deliberately not the CDN: CloudFront cannot read
  // the pending prefix at all, which is what makes the gate a boundary rather
  // than a convention — so review has to go through a signed request or not
  // happen.
  presignGet(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: PREVIEW_URL_TTL_SECONDS,
    });
  }

  // Publication. A server-side copy, so the bytes never travel through this
  // process or back out to the internet.
  async copy(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        // CopySource is the one place in the S3 API that wants bucket and key
        // as one slash-joined string, and it must be URI-encoded — a key with
        // a space or a plus silently copies the wrong object otherwise.
        CopySource: encodeURI(`${this.bucket}/${fromKey}`),
        Key: toKey,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

// S3 answers a missing key on HeadObject with a bodyless 404, so the SDK
// surfaces it as NotFound or as a bare $metadata status — matching on the name
// alone misses the second form.
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404;
}
