import {
  type CreateEntry,
  CreateEntrySchema,
  type CreateFullEntry,
  CreateFullEntrySchema,
  type DictionaryBrowseParams,
  DictionaryBrowseParamsSchema,
  type DictionaryEntryDetail,
  type DictionaryEntryListItem,
  type DictionarySearchParams,
  DictionarySearchParamsSchema,
  type JwtClaims,
  type Locale,
  type PaginationMeta,
  type UpdateEntry,
  UpdateEntrySchema,
} from '@nahuat/shared';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { ContentLocale } from '../../common/decorators/content-locale.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { EntriesService } from './entries.service';

// Top-level `/entries` (ADR 0008). The reads are @Public — the dictionary is
// readable without a token — and @ContentLocale resolves which language the
// content comes back in (?locale= → user token → Accept-Language → es). The
// writes are CONTRIBUTOR.
//
// Route order is load-bearing: literal segments (`search`, `full`) are declared
// before the `:id` param, or Nest matches them as an id — a search or a full
// create would 404 looking up an entry with that literal as its id.
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

  // Declared before `:id` — see the class note. Fuzzy search; `q` is required
  // (the schema 400s without it).
  @Public()
  @Get('search')
  search(
    @Query(new ZodValidationPipe(DictionarySearchParamsSchema)) query: DictionarySearchParams,
    @ContentLocale() locale: Locale,
  ): Promise<{ data: DictionaryEntryListItem[]; meta: PaginationMeta }> {
    return this.entriesService.search(query, locale);
  }

  // The dictionary's canonical detail path — /dictionary/[slug] resolves here.
  // A literal first segment, so declared before `:id` (see the class note), or
  // `by-slug` would be matched as an entry id.
  @Public()
  @Get('by-slug/:slug')
  detailBySlug(
    @Param('slug') slug: string,
    @ContentLocale() locale: Locale,
  ): Promise<DictionaryEntryDetail> {
    return this.entriesService.findBySlug(slug, locale);
  }

  @Public()
  @Get(':id')
  detail(@Param('id') id: string, @ContentLocale() locale: Locale): Promise<DictionaryEntryDetail> {
    return this.entriesService.findById(id, locale);
  }

  // CONTRIBUTOR write paths. No @Public, so the global JwtAuthGuard requires a
  // token and RolesGuard the rank; @CurrentUser is the verified claim set.
  // Attribution is stamped from user.userId in the service, never the body.
  // Both create a draft — publishing is a separate ADMIN action (a later slice).
  @Roles('CONTRIBUTOR')
  @Post()
  create(
    @Body(new ZodValidationPipe(CreateEntrySchema)) body: CreateEntry,
    @CurrentUser() user: JwtClaims,
    @ContentLocale() locale: Locale,
  ): Promise<DictionaryEntryDetail> {
    return this.entriesService.create(body, user.userId, locale);
  }

  // Entry plus its first translations in one atomic request. A literal segment,
  // so declared before `:id` (see the class note).
  @Roles('CONTRIBUTOR')
  @Post('full')
  createFull(
    @Body(new ZodValidationPipe(CreateFullEntrySchema)) body: CreateFullEntry,
    @CurrentUser() user: JwtClaims,
    @ContentLocale() locale: Locale,
  ): Promise<DictionaryEntryDetail> {
    return this.entriesService.createFull(body, user.userId, locale);
  }

  @Roles('CONTRIBUTOR')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEntrySchema)) body: UpdateEntry,
    @CurrentUser() user: JwtClaims,
    @ContentLocale() locale: Locale,
  ): Promise<DictionaryEntryDetail> {
    return this.entriesService.update(id, body, user.userId, user.role, locale);
  }

  // ADMIN lifecycle. `:id/publish` is more specific than `:id`, so it does not
  // collide with the CONTRIBUTOR update above.
  @Roles('ADMIN')
  @Patch(':id/publish')
  publish(
    @Param('id') id: string,
    @CurrentUser() user: JwtClaims,
    @ContentLocale() locale: Locale,
  ): Promise<DictionaryEntryDetail> {
    return this.entriesService.publish(id, user.userId, locale);
  }

  // No @HttpCode(204): TransformInterceptor turns the void return into
  // { success: true, data: null } at 200, which delete clients parse like any
  // other response — a 204 would forbid that body.
  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtClaims): Promise<void> {
    return this.entriesService.delete(id, user.userId);
  }
}
