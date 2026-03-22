import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

interface SeatUpdateEvent {
  tripId: string;
  availableSeats: number;
  bookingId: string;
  timestamp: string;
}

interface BookingInvalidatedEvent {
  passengerId: string;
  bookingId: string;
  tripId: string;
  reason: string;
  timestamp: string;
}

@WebSocketGateway({
  namespace: '/trips',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class TripsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TripsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected — socket: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected — socket: ${client.id}`);
  }

  // Driver calls this to subscribe to updates for their trip
  @SubscribeMessage('join_trip_room')
  handleJoinRoom(
    @MessageBody() data: { tripId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `trip:${data.tripId}`;
    client.join(room);
    this.logger.log(`Socket ${client.id} joined room ${room}`);
    return { event: 'joined', room };
  }

  @SubscribeMessage('leave_trip_room')
  handleLeaveRoom(
    @MessageBody() data: { tripId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `trip:${data.tripId}`;
    client.leave(room);
    this.logger.log(`Socket ${client.id} left room ${room}`);
    return { event: 'left', room };
  }

  // Called by SeatUpdateListener after booking.confirmed
  emitSeatUpdate(payload: SeatUpdateEvent): void {
    const room = `trip:${payload.tripId}`;
    const emitStart = Date.now();

    this.server.to(room).emit('seat_update', payload);

    const latency = Date.now() - emitStart;
    this.logger.log(
      `seat_update emitted to room ${room} — latency: ${latency}ms`,
    );

    if (payload.availableSeats === 0) {
      this.server.to(room).emit('trip_full', {
        tripId: payload.tripId,
        timestamp: payload.timestamp,
      });
    }
  }

  // Called by SeatUpdateListener after booking.invalidated
  emitBookingInvalidated(payload: BookingInvalidatedEvent): void {
    const room = `trip:${payload.tripId}`;
    this.server.to(room).emit('booking_invalidated', payload);
    this.logger.log(
      `booking_invalidated emitted to room ${room} — booking ${payload.bookingId}`,
    );
  }
}
