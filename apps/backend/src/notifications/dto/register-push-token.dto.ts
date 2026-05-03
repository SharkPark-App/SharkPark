import { IsString, IsEnum } from 'class-validator';

export class RegisterPushTokenDto {
  @IsString()
  token!: string;

  @IsEnum(['ios', 'android'])
  platform!: 'ios' | 'android';
}
