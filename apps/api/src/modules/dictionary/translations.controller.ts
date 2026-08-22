import {
  type CreateTranslation,
  CreateTranslationSchema,
  type JwtClaims,
  type Locale,
  type TranslationDetail,
  type UpdateTranslation,
  UpdateTranslationSchema,
} from '@nahuat/shared';
import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';

import { ContentLocale } from '../../common/decorators/content-locale.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TranslationsService } from './translations.service';

// Translations are flat resources (ADR 0008), but a create is nested — the
// parent entry comes from the path, not the body — so this controller carries
// two roots rather than a single prefix: POST /entries/:entryId/translations and
// PATCH /translations/:id. Both are CONTRIBUTOR; @CurrentUser is the verified
// claim set, and attribution is stamped from it in the service.
@Controller()
export class TranslationsController {
  constructor(private readonly translationsService: TranslationsService) {}

  @Roles('CONTRIBUTOR')
  @Post('entries/:entryId/translations')
  create(
    @Param('entryId') entryId: string,
    @Body(new ZodValidationPipe(CreateTranslationSchema)) body: CreateTranslation,
    @CurrentUser() user: JwtClaims,
    @ContentLocale() locale: Locale,
  ): Promise<TranslationDetail> {
    return this.translationsService.create(entryId, body, user.userId, locale);
  }

  @Roles('CONTRIBUTOR')
  @Patch('translations/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTranslationSchema)) body: UpdateTranslation,
    @CurrentUser() user: JwtClaims,
    @ContentLocale() locale: Locale,
  ): Promise<TranslationDetail> {
    return this.translationsService.update(id, body, user.userId, user.role, locale);
  }

  // ADMIN. Removes a single translation from an entry. There is no per-
  // translation publish — publishing is entry-level (PATCH /entries/:id/publish
  // cascades) — but removing one wrong translation without touching the rest is
  // a real need, so delete stays granular. No @HttpCode(204): the void return
  // becomes { success: true, data: null } at 200 through TransformInterceptor.
  @Roles('ADMIN')
  @Delete('translations/:id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtClaims): Promise<void> {
    return this.translationsService.delete(id, user.userId);
  }
}
