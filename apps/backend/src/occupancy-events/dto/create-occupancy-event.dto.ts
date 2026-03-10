import { IsString, IsEnum, IsISO8601, IsNotEmpty, MaxLength, MinLength, IsOptional, IsNumber, Min, Max, IsObject } from 'class-validator';

/** DTO for creating an anonymous occupancy event from geofencing with optional client-side validation. */
export class CreateOccupancyEventDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(20)
  lot_id!: string;

  @IsEnum(['ENTER', 'EXIT'], { message: 'event_type must be either ENTER or EXIT' })
  event_type!: 'ENTER' | 'EXIT';

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  device_id!: string;

  /** ISO8601 timestamp when event occurred on device */
  @IsISO8601({ strict: true })
  timestamp!: string;

  // Client-Side Validation 

  /** Pre-hashed device ID if client wants to handle hashing */
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  device_hash?: string;

  /** Client-side calculated parking behavior classification */
  @IsOptional()
  @IsEnum(['ANALYZING', 'PARKED', 'DROVE_THROUGH', 'SEARCHING', 'UNKNOWN'])
  validation_status?: 'ANALYZING' | 'PARKED' | 'DROVE_THROUGH' | 'SEARCHING' | 'UNKNOWN';

  /** Client-side calculated confidence score (0.0-1.0) */
  @IsOptional()
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  confidence_score?: number;

  /** Client analysis metadata (no PII - aggregated metrics only) */
  @IsOptional()
  @IsObject()
  analysis_metadata?: Record<string, unknown>;
}
