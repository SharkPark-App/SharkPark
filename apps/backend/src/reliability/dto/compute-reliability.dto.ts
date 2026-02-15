import { IsNumber, IsOptional, Min, Max } from 'class-validator';

/**
 * DTO for manually triggering reliability computation
 * (primarily for testing/admin purposes)
 */
export class ComputeReliabilityDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  penetrationRate!: number;

  @IsNumber()
  @Min(0)
  minutesSinceLastEvent!: number;

  @IsNumber()
  @Min(0)
  eventsInLastHour!: number;

  @IsNumber()
  @Min(0)
  uniqueDevicesInLastHour!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  historicalAccuracy?: number;
}
