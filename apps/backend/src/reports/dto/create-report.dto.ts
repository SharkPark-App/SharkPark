import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum IncidentType {
  BLOCKAGE = 'blockage',
  CRASH = 'crash',
  OTHER = 'other',
}

export class CreateReportDto {
  @IsString()
  @IsNotEmpty()
  lotId!: string; // e.g. 'G2'

  @IsEnum(IncidentType)
  type!: IncidentType;

  @IsString()
  @IsOptional()
  message?: string;
}