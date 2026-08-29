import { API_ERROR_CODES, type MediaKind, type MediaStatus } from '@nahuat/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

// Factories for the media module, following dictionary-errors.ts: every
// refusal answers in the same envelope with a machine-readable code, and the
// message is written to be shown verbatim.

export function mediaAssetNotFound(): NotFoundException {
  return new NotFoundException({
    code: API_ERROR_CODES.MEDIA_ASSET_NOT_FOUND,
    message: 'Media asset not found',
  });
}

export function mediaTypeUnsupported(contentType: string): BadRequestException {
  return new BadRequestException({
    code: API_ERROR_CODES.MEDIA_TYPE_UNSUPPORTED,
    message: `${contentType} is not an accepted upload format`,
  });
}

export function uploadLimitReached(limit: number): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.UPLOAD_LIMIT_REACHED,
    message: `You have ${limit} uploads still waiting to be sent. Finish or abandon them before starting another.`,
  });
}

// Names the state it was actually in. The recovery differs per state — a
// PENDING asset needs waiting on, a READY one is already done, a FAILED one
// has to be uploaded again — and a bare CONFLICT would make the caller guess.
export function mediaInvalidState(status: MediaStatus): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.MEDIA_INVALID_STATE,
    message: `This upload is ${status.toLowerCase().replace('_', ' ')} and cannot be completed again`,
  });
}

// The asset deliberately stays AWAITING_UPLOAD when this is raised, so the
// caller can retry the PUT against the same presigned URL rather than
// presigning a second one and stranding the first.
export function mediaUploadIncomplete(detail: string): BadRequestException {
  return new BadRequestException({
    code: API_ERROR_CODES.MEDIA_UPLOAD_INCOMPLETE,
    message: `The upload did not arrive as described (${detail}). Send the file again.`,
  });
}

// An asset belongs to whoever uploaded it until it is attached to a dictionary
// row. Cross-contributor editing is the goal for entries (see the ownership
// note in the dictionary module), but an unattached upload is not content yet
// — it is a file someone is still working on, and there is nothing for another
// contributor to collaborate on until it is attached.
export function uploadNotYours(): ForbiddenException {
  return new ForbiddenException({
    code: API_ERROR_CODES.FORBIDDEN,
    message: 'This upload belongs to another contributor',
  });
}

export function mediaKindMismatch(expected: MediaKind, actual: MediaKind): BadRequestException {
  return new BadRequestException({
    code: API_ERROR_CODES.MEDIA_KIND_MISMATCH,
    message: `This slot takes ${expected.toLowerCase()}, and that asset is ${actual.toLowerCase()}`,
  });
}

export function mediaAlreadyAttached(): ConflictException {
  return new ConflictException({
    code: API_ERROR_CODES.MEDIA_ALREADY_ATTACHED,
    message: 'That upload is already attached to something else',
  });
}

// The media equivalent of publishedEditForbidden in the dictionary module, and
// deliberately a separate factory rather than an import across modules: the two
// rules coincide today and answer to different records. This one comes from the
// approval gate (docs/adr/0020) — live media was reviewed by an admin, so
// removing or replacing it is an admin's decision. ADDING media where there is
// none stays open to contributors even on a published row, which is the
// contribution the sub-resource exists to make possible.
export function publishedMediaChangeForbidden(): ForbiddenException {
  return new ForbiddenException({
    code: API_ERROR_CODES.FORBIDDEN,
    message: 'Published media can only be replaced or removed by an admin',
  });
}
