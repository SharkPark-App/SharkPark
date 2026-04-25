import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AzureADStrategy } from './azure.strategy';
import { AzureAdGuard } from './azure-ad.guard';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'azure-ad' }),
  ],
  providers: [AzureADStrategy, AzureAdGuard],
  exports: [PassportModule, AzureAdGuard],
})
export class AuthModule {}