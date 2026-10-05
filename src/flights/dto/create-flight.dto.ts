import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const DIRECTIONS = ['arrival', 'departure'] as const;
const STATUSES = [
  'scheduled',
  'checkin',
  'boarding',
  'departed',
  'delayed',
  'cancelled',
  'landing',
  'landed',
  'arrived',
] as const;

export class CreateFlightDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  flightNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  airlineName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  airlineCode!: string;

  @IsString()
  @IsIn(DIRECTIONS)
  direction!: (typeof DIRECTIONS)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  cityCode!: string;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  terminal?: string;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  sector?: string;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  gate?: string;

  @IsDateString()
  scheduledTime!: string;

  @IsDateString()
  @IsOptional()
  estimatedTime?: string;

  @IsString()
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}
