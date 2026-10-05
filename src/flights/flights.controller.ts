import {
  Body,
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';

import { AuthUser } from '../auth/auth-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightsEventsService } from './flights.events';
import { QueryFlightsDto } from './dto/query-flights.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { FlightsService } from './flights.service';

@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flightsService: FlightsService,
    private readonly flightsEvents: FlightsEventsService,
  ) {}

  @Get()
  findAll(@Query() query: QueryFlightsDto) {
    return this.flightsService.findAll(query);
  }

  @Get('history/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher')
  getStatusHistory(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 200;
    return this.flightsService.getStatusHistory(Number.isFinite(parsed) ? parsed : 200);
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const events$ = this.flightsEvents.stream().pipe(
      map((event) => ({
        data: event,
      })),
    );

    const heartbeat$ = interval(15000).pipe(
      map(() => ({
        data: {
          type: 'ping',
          payload: { timestamp: new Date().toISOString() },
        },
      })),
    );

    return merge(events$, heartbeat$);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.flightsService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher')
  create(@Body() dto: CreateFlightDto) {
    return this.flightsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFlightDto,
    @Req() request: { user?: AuthUser },
  ) {
    return this.flightsService.update(id, dto, request.user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin')
  remove(@Param('id') id: string) {
    return this.flightsService.remove(id);
  }
}
