import { Module } from '@nestjs/common';
import { TripsGateway } from './trips.gateway';
import { SeatUpdateListener } from './seat-update.listener';

@Module({
  providers: [TripsGateway, SeatUpdateListener],
  exports: [TripsGateway],
})
export class GatewayModule {}
