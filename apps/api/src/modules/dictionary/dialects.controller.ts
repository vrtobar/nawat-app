import {
  type CreateDialect,
  CreateDialectSchema,
  type Dialect,
  type UpdateDialect,
  UpdateDialectSchema,
} from '@nahuat/shared';
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DialectsService } from './dialects.service';

// Top-level `/dialects`, not `/dictionary/dialects` — resources are flat, the
// owning module never appears in the path (ADR 0008). Reads are public so the
// dictionary can render a dialect filter without a token; writes are ADMIN
// because dialects are project-authored reference data, not contributed
// content.
@Controller('dialects')
export class DialectsController {
  constructor(private readonly dialectsService: DialectsService) {}

  @Public()
  @Get()
  list(): Promise<Dialect[]> {
    return this.dialectsService.list();
  }

  @Roles('ADMIN')
  @Post()
  create(@Body(new ZodValidationPipe(CreateDialectSchema)) body: CreateDialect): Promise<Dialect> {
    return this.dialectsService.create(body);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDialectSchema)) body: UpdateDialect,
  ): Promise<Dialect> {
    return this.dialectsService.update(id, body);
  }

  // No @HttpCode(204): the response envelope carries a body on every success,
  // and TransformInterceptor turns a void return into { success: true, data:
  // null } at 200. A 204 would forbid that body and break clients that parse
  // every response the same way.
  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.dialectsService.delete(id);
  }
}
