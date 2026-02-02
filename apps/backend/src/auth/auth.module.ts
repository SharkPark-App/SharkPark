import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AzureADStrategy } from './azure.strategy';

@Module({
  imports: [
    UsersModule,  // makes usersService.findOrCreateUser() invokable
    PassportModule.register({ defaultStrategy: 'azure-ad' }),
  ],
  providers: [AzureADStrategy],
  exports: [PassportModule], // export @UseGuards(), e.g. for userId endpoint in users.controller.ts
})
export class AuthModule {}