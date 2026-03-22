import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
} from 'class-validator';

export class CreateFlightDto {
  @IsString()
  flightNumber: string;

  @IsOptional()
  @IsString()
  terminal?: string;

  @IsDateString()
  flightTime: string;

  @IsInt()
  @Min(30)
  @Max(360)
  checkinDurationMins: number;

  @IsInt()
  @Min(0)
  @Max(120)
  safetyBufferMins: number;
}
