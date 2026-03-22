import { IsNumber, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class NearbyTripsDto {
  @IsNumber()
  @Type(() => Number)
  longitude: number;

  @IsNumber()
  @Type(() => Number)
  latitude: number;

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(50000)
  @Type(() => Number)
  radiusMeters?: number = 5000;
}
