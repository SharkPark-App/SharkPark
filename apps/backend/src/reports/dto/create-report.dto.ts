import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export enum IncidentType {
  BLOCKAGE = 'blockage',
  CRASH = 'crash',
  OTHER = 'other',
}

/**
 * Maximum length of the optional free-text `message` on a parking-incident
 * report. Sized to fit a couple of sentences ("Truck blocking row B near the
 * north entrance, license plate 8ABC123"), not a paragraph. The cap protects
 * the API from Postgres TOAST blowup, the export endpoint from large payloads,
 * and the UI from overflow.
 */
export const REPORT_MESSAGE_MAX_LENGTH = 500;

export class CreateReportDto {
  @IsString()
  @IsNotEmpty()
  lotId!: string; // lot.id (cuid) from DB

  @IsEnum(IncidentType)
  type!: IncidentType;

  @IsString()
  @IsOptional()
  @MaxLength(REPORT_MESSAGE_MAX_LENGTH)
  message?: string;
}