import {
  type AttachMedia,
  AttachMediaSchema,
  type JwtClaims,
  type MediaAsset,
} from '@nahuat/shared';
import { Body, Controller, Delete, Param, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AttachmentsService } from './attachments.service';

// MEDIA IS A SUB-RESOURCE, NOT A FIELD (docs/adr/0020). These paths hang off
// the dictionary rows rather than living under /media, because that is what
// they act on — and routing them here rather than through the entry and
// translation PATCH endpoints is the whole point: a recording is not an edit.
//
// The consequences are the reason for the shape. Attaching does not touch the
// parent's updatedAt, so it cannot collide with an open editing session; the
// person who recorded is credited on the asset instead of becoming the entry's
// updater; and an audit line reads "recording added" rather than "entry
// edited".
//
// A second controller declaring @Controller('translations') would work — Nest
// merges routes across controllers — but the paths are spelled out here
// instead, so a reader of this file can see every route the media module owns
// without reconciling two prefixes.
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  // PUT, not POST: one translation has at most one recording, so sending the
  // same asset twice must mean the same thing as sending it once.
  @Roles('CONTRIBUTOR')
  @Put('translations/:id/audio')
  attachAudio(
    @CurrentUser() user: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AttachMediaSchema)) body: AttachMedia,
  ): Promise<MediaAsset> {
    return this.attachments.attachAudio(user.userId, user.role, id, body.assetId);
  }

  // No @HttpCode(204) — see the note in DialectsController: the envelope
  // carries a body on every success, and a 204 forbids one.
  @Roles('CONTRIBUTOR')
  @Delete('translations/:id/audio')
  detachAudio(@CurrentUser() user: JwtClaims, @Param('id') id: string): Promise<void> {
    return this.attachments.detachAudio(user.role, id);
  }

  @Roles('CONTRIBUTOR')
  @Put('entries/:id/image')
  attachImage(
    @CurrentUser() user: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AttachMediaSchema)) body: AttachMedia,
  ): Promise<MediaAsset> {
    return this.attachments.attachImage(user.userId, user.role, id, body.assetId);
  }

  @Roles('CONTRIBUTOR')
  @Delete('entries/:id/image')
  detachImage(@CurrentUser() user: JwtClaims, @Param('id') id: string): Promise<void> {
    return this.attachments.detachImage(user.role, id);
  }
}
