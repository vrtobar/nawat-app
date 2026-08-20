import {
  type DictionaryBrowseParams,
  DictionaryBrowseParamsSchema,
  type DictionaryEntryDetail,
  type DictionaryEntryListItem,
  type Locale,
  type PaginationMeta,
} from '@nahuat/shared';
import { Controller, Get, Param, Query } from '@nestjs/common';

import { ContentLocale } from '../../common/decorators/content-locale.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { EntriesService } from './entries.service';

// Top-level `/entries` (ADR 0008). Both routes are @Public — the dictionary is
// readable without a token — and @ContentLocale resolves which language the
// content comes back in (?locale= → user token → Accept-Language → es).
//
// Route order matters once search lands: `GET /entries/search` must be declared
// before `GET /entries/:id`, or Nest matches "search" as an :id. Nothing here
// collides yet — `/` and `/:id` are distinct.
@Controller('entries')
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Public()
  @Get()
  browse(
    @Query(new ZodValidationPipe(DictionaryBrowseParamsSchema)) query: DictionaryBrowseParams,
    @ContentLocale() locale: Locale,
  ): Promise<{ data: DictionaryEntryListItem[]; meta: PaginationMeta }> {
    return this.entriesService.browse(query, locale);
  }

  @Public()
  @Get(':id')
  detail(@Param('id') id: string, @ContentLocale() locale: Locale): Promise<DictionaryEntryDetail> {
    return this.entriesService.findById(id, locale);
  }
}
