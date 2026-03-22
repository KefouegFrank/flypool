import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { NearbyTripsDto } from './dto/nearby-trips.dto';
import { AnnounceDelayDto } from './dto/announce-delay.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@Controller('trips')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
  @Roles(Role.DRIVER)
  create(@CurrentUser() user: any, @Body() dto: CreateTripDto) {
    return this.tripsService.create(user.id, dto);
  }

  @Get('nearby')
  @Roles(Role.PASSENGER, Role.DRIVER, Role.ADMIN)
  findNearby(@Query() dto: NearbyTripsDto) {
    return this.tripsService.findNearby(dto);
  }

  @Get(':id')
  @Roles(Role.PASSENGER, Role.DRIVER, Role.ADMIN)
  findOne(@Param('id') id: string) {
    return this.tripsService.findById(id);
  }

  @Patch(':id/delay')
  @Roles(Role.DRIVER)
  announceDelay(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: AnnounceDelayDto,
  ) {
    return this.tripsService.announceDelay(id, user.id, dto);
  }
}
