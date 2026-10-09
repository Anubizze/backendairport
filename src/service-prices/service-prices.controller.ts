import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

import { ServicePricesService } from './service-prices.service';

@Controller('service-prices')
export class ServicePricesController {
  constructor(private readonly servicePrices: ServicePricesService) {}

  @Get()
  getPublic() {
    return this.servicePrices.get();
  }

  @Put()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  update(@Body() body: unknown) {
    return this.servicePrices.update(body);
  }
}
