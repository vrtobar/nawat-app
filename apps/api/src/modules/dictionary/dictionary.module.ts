import { Module } from '@nestjs/common';

import { DialectsController } from './dialects.controller';
import { DialectsService } from './dialects.service';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';
import { TranslationsController } from './translations.controller';
import { TranslationsService } from './translations.service';

// The dictionary domain: entries, translations, and the dialects they belong
// to. Wired: dialects (reference CRUD), the public entry reads (browse, search,
// detail), and the CONTRIBUTOR write paths for entries and translations. Still
// to come under this same module: the ADMIN publish and delete paths.
@Module({
  controllers: [DialectsController, EntriesController, TranslationsController],
  providers: [DialectsService, EntriesService, TranslationsService],
})
export class DictionaryModule {}
