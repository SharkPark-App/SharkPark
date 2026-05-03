import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ContributorService } from '../auth/contributor.service';
import { ContributorGuard } from '../auth/contributor.guard';

// ContributorService and ContributorGuard are registered here directly (not via
// AuthModule) to avoid the circular dependency AuthModule → UsersModule.
// ContributorService only needs PrismaService, which is globally provided.
@Module({
  controllers: [UsersController],
  providers: [UsersService, ContributorService, ContributorGuard],
  exports: [UsersService],
})
export class UsersModule {}
