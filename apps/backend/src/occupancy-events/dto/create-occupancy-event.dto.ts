import {
  IsString,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  MaxLength,
  MinLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/** Maximum age (ms) of an event timestamp before it is rejected */
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
/** Maximum drift (ms) into the future before an event is rejected */
const MAX_FUTURE_MS = 5 * 60 * 1000; // 5 minutes

function IsRecentTimestamp(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isRecentTimestamp',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return true; // let other validators handle
          const ts = new Date(value).getTime();
          if (Number.isNaN(ts)) return true; // let @IsISO8601 handle
          const now = Date.now();
          return ts <= now + MAX_FUTURE_MS && ts >= now - MAX_AGE_MS;
        },
        defaultMessage() {
          return 'timestamp must be within the last hour and no more than 5 minutes in the future';
        },
      },
    });
  };
}

/** DTO for creating an anonymous occupancy event from geofencing. */
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
  @IsRecentTimestamp()
  timestamp!: string;
}
