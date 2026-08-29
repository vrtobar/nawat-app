import { Module } from '@nestjs/common';

import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { StorageService } from './storage.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

// Audio and images: the upload path, and later the sub-resource attachment and
// the ADMIN approval gate (docs/adr/0020).
//
// One module for both kinds because one pipeline processes both — the kind
// selects the transformations, not a separate code path. Splitting audio from
// images would duplicate the presign, the state machine and the gate to gain a
// distinction only ffmpeg cares about.
@Module({
  controllers: [AttachmentsController, UploadsController],
  providers: [AttachmentsService, StorageService, UploadsService],
  // StorageService is the only S3 client in the API. Exported because the
  // approval gate needs it to move objects between prefixes, and a second
  // client would mean a second place the bucket name is resolved.
  exports: [StorageService],
})
export class MediaModule {}
