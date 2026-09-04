import {
  type JwtClaims,
  type MediaAsset,
  type PresignedUpload,
  type PresignUpload,
  PresignUploadSchema,
} from '@nahuat/shared';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UploadsService } from './uploads.service';

// CONTRIBUTOR and above. Uploading is contributing: a USER browsing the
// dictionary has nothing to add, and a presigned URL is a write capability
// that should not be handed to every authenticated account.
//
// Flat `/uploads`, not `/media/uploads` — the owning module never appears in
// the path (ADR 0008). The asset itself is addressed under `/uploads/:id`
// because that is where it lives until it is attached to an entry or a
// translation, at which point the sub-resource endpoints on those rows take
// over.
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Roles('CONTRIBUTOR')
  @Post('presign')
  presign(
    @CurrentUser() user: JwtClaims,
    @Body(new ZodValidationPipe(PresignUploadSchema)) body: PresignUpload,
  ): Promise<PresignedUpload> {
    return this.uploads.presign(user.userId, body);
  }

  // Separate from the PUT because the PUT does not touch this API at all — the
  // browser sends it straight to S3. Something has to tell the API the bytes
  // arrived, and that call is also where the object gets verified.
  @Roles('CONTRIBUTOR')
  @Post(':id/uploaded')
  complete(@CurrentUser() user: JwtClaims, @Param('id') id: string): Promise<MediaAsset> {
    return this.uploads.complete(user.userId, id);
  }

  @Roles('CONTRIBUTOR')
  @Get()
  list(@CurrentUser() user: JwtClaims): Promise<MediaAsset[]> {
    return this.uploads.list(user.userId);
  }

  // What a client polls while the processor works. Declared after @Get() so
  // the literal collection route is matched first — Nest resolves in
  // declaration order, and ':id' would otherwise swallow it.
  @Roles('CONTRIBUTOR')
  @Get(':id')
  get(@CurrentUser() user: JwtClaims, @Param('id') id: string): Promise<MediaAsset> {
    return this.uploads.get(user.userId, id);
  }
}
