import { IsInt, Min, Max } from 'class-validator';

export class AnnounceDelayDto {
  @IsInt()
  @Min(1)
  @Max(480)
  delayMinutes: number;
}
