export const Events = {
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_INVALIDATED: 'booking.invalidated',
  BOOKING_CANCELLED: 'booking.cancelled',
  TRIP_DELAY_ANNOUNCED: 'trip.delay.announced',
  TRIP_STATUS_UPDATED: 'trip.status.updated',
} as const;

export type EventKey = (typeof Events)[keyof typeof Events];
