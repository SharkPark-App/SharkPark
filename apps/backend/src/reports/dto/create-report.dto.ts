import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum IncidentType {
  BLOCKAGE = 'blockage',
  CRASH = 'crash',
  OTHER = 'other',
}

export class CreateReportDto {
  @IsString()
  @IsNotEmpty()
  lotId!: string; // lot.id (cuid) from DB

  @IsEnum(IncidentType)
  type!: IncidentType;

  @IsString()
  @IsOptional()
  message?: string;
}