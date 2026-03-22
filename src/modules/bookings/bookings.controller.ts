import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @Roles(Role.PASSENGER)
  @HttpCode(HttpStatus.CREATED)
  createBooking(
    @CurrentUser() user: any,
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookingsService.createBooking(user.id, dto);
  }

  @Get('my')
  @Roles(Role.PASSENGER)
  getMyBookings(@CurrentUser() user: any) {
    return this.bookingsService.findByPassenger(user.id);
  }

  @Get(':id')
  @Roles(Role.PASSENGER, Role.DRIVER, Role.ADMIN)
  getBooking(@Param('id') id: string) {
    return this.bookingsService.findById(id);
  }

  @Patch(':id/cancel')
  @Roles(Role.PASSENGER)
  @HttpCode(HttpStatus.OK)
  cancelBooking(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.cancelBooking(id, user.id);
  }
}
