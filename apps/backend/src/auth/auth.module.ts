import { Module, forwardRef } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AzureADStrategy } from './azure.strategy';
import { AzureAdGuard } from './azure-ad.guard';
import { ContributorGuard } from './contributor.guard';
import { ContributorService } from './contributor.service';
import { ContributorController } from './contributor.controller';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    PassportModule.register({ defaultStrategy: 'azure-ad' }),
  ],
  controllers: [ContributorController],
  providers: [AzureADStrategy, AzureAdGuard, ContributorGuard, ContributorService],
  exports: [PassportModule, AzureAdGuard, ContributorGuard, ContributorService],
})
export class AuthModule {}