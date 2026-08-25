import { Module } from '@nestjs/common';

import { AdminEntriesController } from './admin-entries.controller';
import { AdminEntriesService } from './admin-entries.service';
import { DialectsController } from './dialects.controller';
import { DialectsService } from './dialects.service';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';
import { TranslationsController } from './translations.controller';
import { TranslationsService } from './translations.service';

// The dictionary domain: entries, translations, and the dialects they belong
// to. Wired: dialects (reference CRUD), the public entry reads (browse, search,
// detail), the CONTRIBUTOR write paths for entries and translations, the ADMIN
// publish and delete paths, and the CONTRIBUTOR+ admin read surface that backs
// the authoring panel.
//
// AdminEntriesController is a second controller over the same tables rather
// than a branch inside EntriesController: the public reads are @Public and
// resolve content to one locale, both of which are wrong for an editor. See
// that file for why the split falls here.
@Module({
  controllers: [
    AdminEntriesController,
    DialectsController,
    EntriesController,
    TranslationsController,
  ],
  providers: [AdminEntriesService, DialectsService, EntriesService, TranslationsService],
})
export class DictionaryModule {}
