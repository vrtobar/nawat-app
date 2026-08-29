import { prisma } from '@nahuat/database';
import { MAX_UNRESOLVED_UPLOADS, MediaAssetSchema } from '@nahuat/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StorageService } from './storage.service';
import { UploadsService } from './uploads.service';

vi.mock('@nahuat/database', () => ({
  prisma: {
    mediaAsset: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const mediaAsset = vi.mocked(prisma.mediaAsset);

// Same discipline as dialects.service.spec: Prisma's select return type defeats
// hand-written fixtures, so rows go in as `never` and every response is parsed
// through MediaAssetSchema.strict(). That is what catches a leaked sourceKey —
// the field this module most needs to keep out of a response.
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'med_1',
  kind: 'AUDIO',
  status: 'AWAITING_UPLOAD',
  contentType: 'audio/mpeg',
  sizeBytes: 2048,
  error: null,
  notes: null,
  isPublished: false,
  createdAt: new Date('2026-08-29T12:00:00.000Z'),
  ...overrides,
});

const storage = {
  presignPut: vi.fn(),
  head: vi.fn(),
};

const service = new UploadsService(storage as unknown as StorageService);

beforeEach(() => {
  vi.clearAllMocks();
  storage.presignPut.mockResolvedValue({
    url: 'https://bucket.s3.amazonaws.com/source/med_1/source.mp3?X-Amz-Signature=x',
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '2048' },
    expiresInSeconds: 300,
  });
});

describe('presign', () => {
  const input = { kind: 'AUDIO', contentType: 'audio/mpeg', sizeBytes: 2048 } as const;

  it('signs the key built from the created row, not one the caller chose', async () => {
    mediaAsset.count.mockResolvedValue(0 as never);
    mediaAsset.create.mockResolvedValue({ id: 'med_1' } as never);
    mediaAsset.update.mockResolvedValue({ id: 'med_1' } as never);

    const result = await service.presign('usr_1', input);

    expect(storage.presignPut).toHaveBeenCalledWith('source/med_1/source.mp3', 'audio/mpeg', 2048);
    expect(result.assetId).toBe('med_1');
    // The extension comes from the signed content type. Nothing the caller
    // sends reaches the key.
    expect(mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { sourceKey: 'source/med_1/source.mp3' } }),
    );
  });

  it('does not return a readable URL, because none exists before approval', async () => {
    mediaAsset.count.mockResolvedValue(0 as never);
    mediaAsset.create.mockResolvedValue({ id: 'med_1' } as never);
    mediaAsset.update.mockResolvedValue({ id: 'med_1' } as never);

    const result = await service.presign('usr_1', input);

    expect(result).not.toHaveProperty('cdnUrl');
    expect(result).not.toHaveProperty('key');
  });

  it('refuses once the caller holds the maximum unresolved uploads', async () => {
    mediaAsset.count.mockResolvedValue(MAX_UNRESOLVED_UPLOADS as never);

    await expect(service.presign('usr_1', input)).rejects.toBeInstanceOf(ConflictException);
    expect(mediaAsset.create).not.toHaveBeenCalled();
  });

  it('counts only unresolved uploads towards the ceiling', async () => {
    mediaAsset.count.mockResolvedValue(0 as never);
    mediaAsset.create.mockResolvedValue({ id: 'med_1' } as never);
    mediaAsset.update.mockResolvedValue({ id: 'med_1' } as never);

    await service.presign('usr_1', input);

    // A contributor with a hundred processed recordings is not blocked from
    // making another — only outstanding capability counts.
    expect(mediaAsset.count).toHaveBeenCalledWith({
      where: { uploaderId: 'usr_1', status: 'AWAITING_UPLOAD' },
    });
  });
});

describe('complete', () => {
  it('moves an uploaded asset to PENDING and returns the contract shape', async () => {
    mediaAsset.findUnique.mockResolvedValue(
      row({ uploaderId: 'usr_1', sourceKey: 'source/med_1/source.mp3' }) as never,
    );
    storage.head.mockResolvedValue({ sizeBytes: 2048, contentType: 'audio/mpeg' });
    mediaAsset.update.mockResolvedValue(row({ status: 'PENDING' }) as never);

    const result = await service.complete('usr_1', 'med_1');

    expect(mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING' } }),
    );
    // .strict() is the assertion that matters: sourceKey and uploaderId were on
    // the row read above, and neither may reach the response.
    expect(() => MediaAssetSchema.strict().parse(result)).not.toThrow();
  });

  it('refuses when no object arrived, and leaves the asset retryable', async () => {
    mediaAsset.findUnique.mockResolvedValue(
      row({ uploaderId: 'usr_1', sourceKey: 'source/med_1/source.mp3' }) as never,
    );
    storage.head.mockResolvedValue(undefined);

    await expect(service.complete('usr_1', 'med_1')).rejects.toBeInstanceOf(BadRequestException);
    // Still AWAITING_UPLOAD: the caller retries the PUT against the URL it
    // already holds rather than presigning a second one.
    expect(mediaAsset.update).not.toHaveBeenCalled();
  });

  it('refuses when the object is not the size that was signed', async () => {
    mediaAsset.findUnique.mockResolvedValue(
      row({ uploaderId: 'usr_1', sourceKey: 'source/med_1/source.mp3' }) as never,
    );
    storage.head.mockResolvedValue({ sizeBytes: 9, contentType: 'audio/mpeg' });

    await expect(service.complete('usr_1', 'med_1')).rejects.toBeInstanceOf(BadRequestException);
    expect(mediaAsset.update).not.toHaveBeenCalled();
  });

  it('refuses a second completion', async () => {
    mediaAsset.findUnique.mockResolvedValue(
      row({
        uploaderId: 'usr_1',
        sourceKey: 'source/med_1/source.mp3',
        status: 'PENDING',
      }) as never,
    );

    await expect(service.complete('usr_1', 'med_1')).rejects.toBeInstanceOf(ConflictException);
    expect(storage.head).not.toHaveBeenCalled();
  });

  it('refuses an asset belonging to another contributor', async () => {
    mediaAsset.findUnique.mockResolvedValue(
      row({ uploaderId: 'usr_2', sourceKey: 'source/med_1/source.mp3' }) as never,
    );

    await expect(service.complete('usr_1', 'med_1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.head).not.toHaveBeenCalled();
  });

  it('404s an unknown asset', async () => {
    mediaAsset.findUnique.mockResolvedValue(null as never);

    await expect(service.complete('usr_1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('list', () => {
  it('returns only the caller rows, newest first, in the contract shape', async () => {
    mediaAsset.findMany.mockResolvedValue([row(), row({ id: 'med_2' })] as never);

    const result = await service.list('usr_1');

    expect(mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { uploaderId: 'usr_1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    for (const asset of result) {
      expect(() => MediaAssetSchema.strict().parse(asset)).not.toThrow();
    }
  });
});
