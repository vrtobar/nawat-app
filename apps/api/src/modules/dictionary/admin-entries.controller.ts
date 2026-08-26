import {
  type AdminEntriesQuery,
  AdminEntriesQuerySchema,
  type AdminEntryDetail,
  type AdminEntryListItem,
  type JwtClaims,
  type PaginationMeta,
} from '@nahuat/shared';
import { Controller, Get, Param, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminEntriesService } from './admin-entries.service';

// The authoring panel's read surface. Every route is CONTRIBUTOR+ — there is no
// @Public here, which is the entire reason this controller exists separately
// from EntriesController: those reads are public, so no req.user exists to
// authorize a draft view against, and they hardcode `isPublished: true`.
//
// ON THE /admin PREFIX. ADR 0008 rejects grouping resources under a prefix, and
// this deviates, so the reasoning is recorded here rather than left to be
// rediscovered. That ADR's objections were (1) a NestJS module name leaking
// into the public contract and (2) literal-vs-parameter route collisions like
// /lessons/exercises against /lessons/:lessonId. Neither applies: `admin` names
// an audience and an authorization boundary, not a module — these handlers live
// in DictionaryModule beside the public ones — and no root-level /:param route
// exists for it to collide with.
//
// The alternative, GET /entries/drafts, would have added a FOURTH literal
// segment declared before /entries/:id, after `search`, `full` and `by-slug`.
// ADR 0008 calls that ordering hazard a class of bug worth removing, so adding
// to it to honour the letter of the same ADR would be the wrong trade.
@Roles('CONTRIBUTOR')
@Controller('admin/entries')
export class AdminEntriesController {
  constructor(private readonly adminEntriesService: AdminEntriesService) {}

  // Drafts by default (AdminEntriesQuerySchema), newest edit first. A
  // CONTRIBUTOR sees only rows they created; an ADMIN sees every author's.
  @Get()
  list(
    @Query(new ZodValidationPipe(AdminEntriesQuerySchema)) query: AdminEntriesQuery,
    @CurrentUser() user: JwtClaims,
  ): Promise<{ data: AdminEntryListItem[]; meta: PaginationMeta }> {
    return this.adminEntriesService.list(query, user);
  }

  // No @ContentLocale and no by-slug variant. Content comes back in both
  // languages because this backs an edit form (see AdminTranslationDetail), and
  // the panel navigates from a list it already holds ids for — a slug lookup
  // exists for the public URL, which a draft does not have yet.
  //
  // No @CurrentUser either: the row returned does not depend on who asks. Any
  // CONTRIBUTOR+ may edit any entry, so refusing to open one would be the wrong
  // half of the old ownership model left behind.
  @Get(':id')
  detail(@Param('id') id: string): Promise<AdminEntryDetail> {
    return this.adminEntriesService.detail(id);
  }
}
