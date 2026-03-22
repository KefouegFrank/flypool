import { IsUUID } from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  tripId: string;

  @IsUUID()
  passengerFlightId: string;
}
