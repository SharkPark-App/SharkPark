import { IsBoolean, IsOptional } from 'class-validator';

/** DTO for updating user notification preferences. Only known keys are accepted. */
export class UpdateNotificationPreferencesDto {
  @IsBoolean()
  @IsOptional()
  favorites_filling?: boolean;

  @IsBoolean()
  @IsOptional()
  favorites_clearing?: boolean;

  @IsBoolean()
  @IsOptional()
  surge_alerts?: boolean;

  @IsBoolean()
  @IsOptional()
  event_alerts?: boolean;
}
