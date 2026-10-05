import { IsIn, IsOptional, IsString } from 'class-validator';

export class QueryFlightsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['arrival', 'departure'])
  direction?: 'arrival' | 'departure';
}
