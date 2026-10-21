import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateServicePhotoDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  serviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  altRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  altKz?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  altEn?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder?: number;
}
