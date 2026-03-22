import { Module } from '@nestjs/common';
import { TicketsListener } from './tickets.listener';

@Module({
  providers: [TicketsListener],
})
export class TicketsModule {}
