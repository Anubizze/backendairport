import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';

import { NewsService } from './news.service';

@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get('article/:slug')
  async getBySlug(@Param('slug') slug: string) {
    const result = await this.newsService.getArticleBySlug(slug);
    if (!result) {
      throw new NotFoundException('News article not found');
    }
    return result;
  }

  @Get('akorda')
  getAkorda(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 12;
    const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 12;
    return this.newsService.getAkordaEvents(safeLimit);
  }

  @Get('abay')
  getAbay(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 12;
    const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 12;
    return this.newsService.getAbayEvents(safeLimit);
  }

  @Get('transport')
  getTransport(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 12;
    const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 12;
    return this.newsService.getTransportEvents(safeLimit);
  }

  @Get('aviation')
  getAviation(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 12;
    const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 12;
    return this.newsService.getAviationEvents(safeLimit);
  }
}
