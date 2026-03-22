import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateFlightDto } from './dto/create-flight.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('flights')
  @Roles(Role.PASSENGER)
  createFlight(
    @CurrentUser() user: any,
    @Body() dto: CreateFlightDto,
  ) {
    return this.usersService.createFlight(user.id, dto);
  }

  @Get('flights')
  @Roles(Role.PASSENGER)
  getFlights(@CurrentUser() user: any) {
    return this.usersService.findFlightsByUser(user.id);
  }
}
