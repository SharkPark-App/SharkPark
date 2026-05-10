import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum DebugPushType {
  FAVORITES_FILLING = 'favorites_filling',
  FAVORITES_CLEARING = 'favorites_clearing',
  SURGE = 'surge',
  EVENTS = 'events',
}

export class DebugSendPushDto {
  @IsEnum(DebugPushType)
  type!: DebugPushType;

  @IsOptional()
  @IsString()
  lotId?: string;
}
