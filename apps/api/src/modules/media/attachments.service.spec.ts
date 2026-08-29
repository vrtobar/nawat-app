import { prisma } from '@nahuat/database';
import { MediaAssetSchema } from '@nahuat/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentsService } from './attachments.service';

vi.mock('@nahuat/database', () => ({
  prisma: {
    translation: { findFirst: vi.fn() },
    entry: { findFirst: vi.fn() },
    mediaAsset: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

const translation = vi.mocked(prisma.translation);
const entry = vi.mocked(prisma.entry);
const mediaAsset = vi.mocked(prisma.mediaAsset);
const executeRaw = vi.mocked(prisma.$executeRaw);

const asset = (overrides: Record<string, unknown> = {}) => ({
  id: 'med_1',
  kind: 'AUDIO',
  status: 'PENDING',
  contentType: 'audio/mpeg',
  sizeBytes: 2048,
  error: null,
  notes: null,
  isPublished: false,
  createdAt: new Date('2026-08-29T12:00:00.000Z'),
  uploaderId: 'usr_1',
  entry: null,
  translation: null,
  ...overrides,
});

const service = new AttachmentsService();

beforeEach(() => {
  vi.clearAllMocks();
  // One row written, which is what every path here expects. The zero case has
  // its own test.
  executeRaw.mockResolvedValue(1 as never);
});

describe('attachAudio', () => {
  it('sets the asset and clears the URL the outgoing one earned', async () => {
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset() as never);

    const result = await service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1');

    // One statement, and audio_url is in it. A published translation pointing
    // at one recording while its asset column names another is the
    // desynchronised state the gate exists to prevent.
    const sql = executeRaw.mock.calls[0]?.[0] as unknown as string[];
    expect(sql.join('?')).toContain('audio_url = NULL');
    expect(sql.join('?')).toContain('audio_asset_id');
    expect(() => MediaAssetSchema.strict().parse(result)).not.toThrow();
  });

  it('does not touch updatedAt, because attaching is not an edit', async () => {
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset() as never);

    await service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1');

    // The write is raw for exactly this reason: Prisma would bump `@updatedAt`
    // and invalidate an open editor's optimistic lock, answering EDIT_CONFLICT
    // for a change touching no field the author can see. If this ever becomes a
    // prisma.translation.update, that promise is silently broken.
    const sql = (executeRaw.mock.calls[0]?.[0] as unknown as string[]).join('?');
    expect(sql).not.toContain('updated_at');
  });

  it('refuses an image in the audio slot', async () => {
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset({ kind: 'IMAGE' }) as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('refuses a FAILED asset, which no approval could complete', async () => {
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset({ status: 'FAILED' }) as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts an asset still awaiting its upload', async () => {
    // Attaching is independent of processing, and attaching early is the normal
    // flow — the row is claimed before the bytes finish moving.
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset({ status: 'AWAITING_UPLOAD' }) as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1'),
    ).resolves.toBeDefined();
  });

  it("refuses another contributor's upload, but not an admin's use of it", async () => {
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset({ uploaderId: 'usr_2' }) as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(service.attachAudio('usr_1', 'ADMIN', 'tr_1', 'med_1')).resolves.toBeDefined();
  });

  it('refuses an asset already hanging on something else', async () => {
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset({ translation: { id: 'tr_9' } }) as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts re-attaching the same asset to the same row', async () => {
    // PUT means the same thing sent twice as sent once.
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset({ translation: { id: 'tr_1' } }) as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1'),
    ).resolves.toBeDefined();
  });

  it('lets a contributor add audio to a published translation', async () => {
    // The contribution the sub-resource exists to make possible: a recording
    // for a word that is already live.
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset() as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1'),
    ).resolves.toBeDefined();
  });

  it('refuses a contributor replacing APPROVED audio, but allows an admin', async () => {
    translation.findFirst.mockResolvedValue({
      id: 'tr_1',
      audioAsset: { id: 'med_old', isPublished: true },
    } as never);
    mediaAsset.findUnique.mockResolvedValue(asset() as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(service.attachAudio('usr_1', 'ADMIN', 'tr_1', 'med_1')).resolves.toBeDefined();
  });

  it('404s an unknown translation before looking at the asset', async () => {
    translation.findFirst.mockResolvedValue(null as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'nope', 'med_1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mediaAsset.findUnique).not.toHaveBeenCalled();
  });

  it('404s when the row is deleted between the read and the write', async () => {
    // The window the raw write closes: the read said the translation was
    // there, and by the time the UPDATE ran it was soft deleted. Reporting
    // success for a statement that changed nothing is the silent half of that.
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset() as never);
    executeRaw.mockResolvedValue(0 as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'med_1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s an unknown asset', async () => {
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(null as never);

    await expect(
      service.attachAudio('usr_1', 'CONTRIBUTOR', 'tr_1', 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('detachAudio', () => {
  it('clears both columns and is idempotent when there is nothing attached', async () => {
    translation.findFirst.mockResolvedValue({ id: 'tr_1', audioAsset: null } as never);

    await service.detachAudio('CONTRIBUTOR', 'tr_1');

    const sql = (executeRaw.mock.calls[0]?.[0] as unknown as string[]).join('?');
    expect(sql).toContain('audio_asset_id = NULL');
    expect(sql).toContain('audio_url = NULL');
  });

  it('refuses a contributor removing approved audio', async () => {
    translation.findFirst.mockResolvedValue({
      id: 'tr_1',
      audioAsset: { id: 'med_old', isPublished: true },
    } as never);

    await expect(service.detachAudio('CONTRIBUTOR', 'tr_1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe('the image side', () => {
  it('mirrors the audio rules against entries', async () => {
    entry.findFirst.mockResolvedValue({ id: 'ent_1', imageAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset({ kind: 'IMAGE' }) as never);

    const result = await service.attachImage('usr_1', 'CONTRIBUTOR', 'ent_1', 'med_1');

    const sql = (executeRaw.mock.calls[0]?.[0] as unknown as string[]).join('?');
    expect(sql).toContain('image_asset_id');
    expect(sql).toContain('image_url = NULL');
    expect(() => MediaAssetSchema.strict().parse(result)).not.toThrow();
  });

  it('refuses audio in the image slot', async () => {
    entry.findFirst.mockResolvedValue({ id: 'ent_1', imageAsset: null } as never);
    mediaAsset.findUnique.mockResolvedValue(asset({ kind: 'AUDIO' }) as never);

    await expect(
      service.attachImage('usr_1', 'CONTRIBUTOR', 'ent_1', 'med_1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
