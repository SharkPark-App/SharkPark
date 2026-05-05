import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';

// AuthModule exports ContributorGuard (used by GET /users/me/forecast).
// AuthModule also imports UsersModule (for UsersService) so we use forwardRef
// on both sides to break the circular import without duplicating providers.
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
