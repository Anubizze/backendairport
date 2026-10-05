import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateVacancyApplicationDto } from './dto/create-vacancy-application.dto';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';
import { VacanciesService } from './vacancies.service';

@Controller('vacancies')
export class VacanciesController {
  constructor(private readonly vacanciesService: VacanciesService) {}

  @Get()
  findPublished() {
    return this.vacanciesService.findPublished();
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  findAll() {
    return this.vacanciesService.findAll();
  }

  @Get('admin/applications')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  findApplications() {
    return this.vacanciesService.findApplications();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vacanciesService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  create(@Body() dto: CreateVacancyDto) {
    return this.vacanciesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  update(@Param('id') id: string, @Body() dto: UpdateVacancyDto) {
    return this.vacanciesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('superadmin', 'dispatcher', 'news_editor')
  remove(@Param('id') id: string) {
    return this.vacanciesService.remove(id);
  }

  @Post(':id/applications')
  createApplication(
    @Param('id') id: string,
    @Body() dto: CreateVacancyApplicationDto,
  ) {
    return this.vacanciesService.createApplication(id, dto);
  }
}
