import { IsString } from 'class-validator';

export class UnregisterPushTokenDto {
  @IsString()
  token!: string;
}
