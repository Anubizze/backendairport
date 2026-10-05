import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { FuelStorageService } from './fuel-storage.service';

@Controller('fuel-storage-content')
export class FuelStorageController {
  constructor(private readonly fuelStorageService: FuelStorageService) {}

  @Get()
  getPublic() {
    return this.fuelStorageService.getPublicData();
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  getAdmin() {
    return this.fuelStorageService.getPublicData();
  }

  @Put('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  updateAdmin(@Body() body: unknown) {
    return this.fuelStorageService.update((body ?? {}) as Record<string, unknown>);
  }
}
