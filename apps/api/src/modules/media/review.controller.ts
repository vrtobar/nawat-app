import {
  type AdminMediaAsset,
  type JwtClaims,
  type MediaQuery,
  MediaQuerySchema,
} from '@nahuat/shared';
import { Controller, Get, Param, Post, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReviewService } from './review.service';

// ADMIN throughout. Only an ADMIN can publish, so for anyone else this is a
// work queue holding no work they can perform — the same reasoning that made
// the pending-translations queue admin-only.
@Controller('admin/media')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Roles('ADMIN')
  @Get()
  list(
    @Query(new ZodValidationPipe(MediaQuerySchema)) query: MediaQuery,
  ): Promise<AdminMediaAsset[]> {
    return this.review.list(query);
  }

  // POST rather than PATCH on the asset: publishing is not a field an admin
  // sets, it is an action with consequences beyond the row — objects move
  // between prefixes and a URL appears on a dictionary page.
  @Roles('ADMIN')
  @Post(':id/publish')
  publish(@CurrentUser() user: JwtClaims, @Param('id') id: string): Promise<AdminMediaAsset> {
    return this.review.publish(user.userId, id);
  }

  @Roles('ADMIN')
  @Post(':id/unpublish')
  unpublish(@Param('id') id: string): Promise<AdminMediaAsset> {
    return this.review.unpublish(id);
  }
}
