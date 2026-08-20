import { Module } from '@nestjs/common';

import { DialectsController } from './dialects.controller';
import { DialectsService } from './dialects.service';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';

// The dictionary domain: entries, translations, and the dialects they belong
// to. Dialects (reference CRUD) and the public entry reads (browse + detail)
// are wired. Still to come under this same module: entry search (pg_trgm),
// translation reads, and the CONTRIBUTOR/ADMIN write and publish paths.
@Module({
  controllers: [DialectsController, EntriesController],
  providers: [DialectsService, EntriesService],
})
export class DictionaryModule {}
