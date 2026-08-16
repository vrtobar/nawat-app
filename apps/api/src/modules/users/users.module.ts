import { Module } from '@nestjs/common';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Profile reads only. Username editing, the admin list, role changes and
// Management API session revocation land separately — those need an Auth0
// Management API client, which is unrelated to reading your own row.
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
