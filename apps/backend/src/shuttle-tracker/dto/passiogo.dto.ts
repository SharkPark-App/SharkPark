
import { IsString, IsNumber, IsOptional, IsDefined } from 'class-validator';
import { Transform } from 'class-transformer';

/** DTO for recieving and validating PassioGO! stop data */
export class PassioStopDto {
  @IsString()
  stopId!: string;

  @IsString()
  name!: string;

  @IsNumber()
  latitude!: number;

  @IsNumber()
  longitude!: number;

  @IsString()
  routeId!: string;

  @IsOptional()
  @IsString()
  color?: string; // Should be defined, but stops could still be used otherwise
}

/** DTO for recieving and validating PassioGO! route data */
export class PassioRouteDto {
  @IsString()
  myid!: string;

  @IsOptional()
  @IsString()
  nameOrig?: string;

  @IsString()
  name!: string;

  @IsString()
  shortName!: string;

  @IsString()
  color!: string;

  @IsOptional()
  @IsString()
  serviceTimeShort?: string;
}

/** DTO for recieving and validating PassioGO! shuttle data */
export class PassioShuttleDto {
  @IsDefined()
  busId!: string | number;

  @IsString()
  busName!: string;

  @IsString()
  color!: string;

  @IsString()
  routeId!: string;

  @IsString()
  route!: string;

  @IsString()
  latitude!: string;

  @IsString()
  longitude!: string;

  @IsOptional()
  calculatedCourse?: string | number;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10))
  paxLoad?: number;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10))
  totalCap?: number;
}