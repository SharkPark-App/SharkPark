import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AzureADStrategy } from './azure.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'azure-ad' }),
  ],
  providers: [AzureADStrategy],
  exports: [PassportModule], // export AuthGuards
})
export class AuthModule {}