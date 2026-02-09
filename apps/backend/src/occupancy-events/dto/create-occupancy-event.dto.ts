import { IsString, IsEnum, IsISO8601, IsNotEmpty, MaxLength, MinLength } from 'class-validator';

/** DTO for creating an anonymous occupancy event from geofencing. */
export class CreateOccupancyEventDto {
  /** Parking lot identifier (e.g., "G1", "E7") */
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(20)
  lot_id!: string;

  /** ENTER when entering lot geofence, EXIT when leaving */
  @IsEnum(['ENTER', 'EXIT'], { message: 'event_type must be either ENTER or EXIT' })
  event_type!: 'ENTER' | 'EXIT';

  /** Device identifier for deduplication (hashed server-side, not stored) */
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  device_id!: string;

  /** ISO8601 timestamp when event occurred on device */
  @IsISO8601({ strict: true })
  timestamp!: string;
}
