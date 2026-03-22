import {
  IsDateString,
  IsInt,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PointDto {
  @IsNumber()
  longitude: number;

  @IsNumber()
  latitude: number;
}

export class CreateTripDto {
  @ValidateNested()
  @Type(() => PointDto)
  departurePoint: PointDto;

  @ValidateNested()
  @Type(() => PointDto)
  arrivalPoint: PointDto;

  @IsDateString()
  departureTime: string;

  @IsInt()
  @Min(1)
  availableSeats: number;
}
