import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(data: {
    email: string;
    passwordHash: string;
    role: Role;
  }) {
    return this.prisma.user.create({ data });
  }

  async updateRefreshToken(userId: string, hashedToken: string | null) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashedToken },
    });
  }

  async createFlight(userId: string, dto: import('./dto/create-flight.dto').CreateFlightDto) {
    return this.prisma.passengerFlight.create({
      data: {
        userId,
        flightNumber: dto.flightNumber,
        terminal: dto.terminal,
        flightTime: new Date(dto.flightTime),
        checkinDurationMins: dto.checkinDurationMins,
        safetyBufferMins: dto.safetyBufferMins,
      },
    });
  }

  async findFlightById(id: string) {
    return this.prisma.passengerFlight.findUnique({ where: { id } });
  }

  async findFlightsByUser(userId: string) {
    return this.prisma.passengerFlight.findMany({
      where: { userId },
      orderBy: { flightTime: 'asc' },
    });
  }
}
