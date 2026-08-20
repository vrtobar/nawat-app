import { Module } from '@nestjs/common';

import { DialectsController } from './dialects.controller';
import { DialectsService } from './dialects.service';

// The dictionary domain: entries, translations, and the dialects they belong
// to. Only dialects are wired today — reference data with no publish workflow
// and no per-locale content resolution, so it is the smallest slice that stands
// on its own and sets the controller/service/spec shape the rest of the module
// follows. Entries (browse, detail, search) and translations land in later
// slices under this same module.
@Module({
  controllers: [DialectsController],
  providers: [DialectsService],
})
export class DictionaryModule {}
