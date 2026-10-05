import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';

import { DrizzleService } from '../db/drizzle.service';
import {
  vacancies,
  vacancyApplications,
} from '../db/schema';
import { CreateVacancyApplicationDto } from './dto/create-vacancy-application.dto';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';

@Injectable()
export class VacanciesService {
  constructor(private readonly drizzle: DrizzleService) {}

  findPublished() {
    return this.drizzle.db
      .select()
      .from(vacancies)
      .where(eq(vacancies.isPublished, true))
      .orderBy(asc(vacancies.sortOrder), desc(vacancies.createdAt));
  }

  findAll() {
    return this.drizzle.db
      .select()
      .from(vacancies)
      .orderBy(asc(vacancies.sortOrder), desc(vacancies.createdAt));
  }

  async findOne(id: string) {
    const [vacancy] = await this.drizzle.db
      .select()
      .from(vacancies)
      .where(eq(vacancies.id, id))
      .limit(1);

    if (!vacancy) {
      throw new NotFoundException('Вакансия не найдена');
    }

    return vacancy;
  }

  async create(dto: CreateVacancyDto) {
    const [vacancy] = await this.drizzle.db
      .insert(vacancies)
      .values({
        title: dto.title,
        department: dto.department,
        employmentType: dto.employmentType ?? 'Полная занятость',
        salaryText: dto.salaryText,
        description: dto.description,
        contactPhone: dto.contactPhone ?? '87222360033',
        isPublished: dto.isPublished ?? true,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning();

    return vacancy;
  }

  async update(id: string, dto: UpdateVacancyDto) {
    await this.findOne(id);

    const [vacancy] = await this.drizzle.db
      .update(vacancies)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(vacancies.id, id))
      .returning();

    return vacancy;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.drizzle.db.delete(vacancies).where(eq(vacancies.id, id));
    return { deleted: true };
  }

  async createApplication(vacancyId: string, dto: CreateVacancyApplicationDto) {
    const vacancy = await this.findOne(vacancyId);

    if (!vacancy.isPublished) {
      throw new NotFoundException('Вакансия не найдена');
    }

    const [application] = await this.drizzle.db
      .insert(vacancyApplications)
      .values({
        vacancyId,
        fullName: dto.fullName,
        phone: dto.phone,
        email: dto.email,
        message: dto.message,
      })
      .returning();

    return {
      application,
      contactPhone: vacancy.contactPhone,
    };
  }

  findApplications() {
    return this.drizzle.db
      .select({
        id: vacancyApplications.id,
        vacancyId: vacancyApplications.vacancyId,
        vacancyTitle: vacancies.title,
        fullName: vacancyApplications.fullName,
        phone: vacancyApplications.phone,
        email: vacancyApplications.email,
        message: vacancyApplications.message,
        createdAt: vacancyApplications.createdAt,
      })
      .from(vacancyApplications)
      .innerJoin(vacancies, eq(vacancyApplications.vacancyId, vacancies.id))
      .orderBy(desc(vacancyApplications.createdAt));
  }
}
