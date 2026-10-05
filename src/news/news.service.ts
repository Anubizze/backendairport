import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { desc, eq, sql } from 'drizzle-orm';

import { DrizzleService } from '../db/drizzle.service';
import { newsArticles } from '../db/schema';

type NewsSource = 'akorda' | 'abay' | 'transport' | 'aviation';

type NewsItem = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
  dateLabel: string;
  sourceUrl: string;
  imageUrl: string | null;
  category: 'news';
  source: NewsSource;
};

@Injectable()
export class NewsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NewsService.name);
  private readonly akordaListUrl = 'https://www.akorda.kz/ru/events';
  private readonly abayListUrl =
    'https://www.gov.kz/memleket/entities/abay/press/news/news/1?lang=ru';
  private readonly transportListUrl =
    'https://www.gov.kz/memleket/entities/transport/press/news/news/1?lang=ru';
  private readonly aviationListUrl =
    'https://www.gov.kz/memleket/entities/aviation/press/news/1?lang=ru';
  private timer: NodeJS.Timeout | null = null;
  private inProgress = false;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureStorage();

    const enabled = this.config.get<string>('NEWS_SYNC_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('News sync disabled by NEWS_SYNC_ENABLED=false');
      return;
    }

    const intervalMs = Number(this.config.get<string>('NEWS_SYNC_INTERVAL_MS', '300000'));
    this.logger.log(`News sync enabled. Interval: ${intervalMs}ms`);

    await this.runSync();
    this.timer = setInterval(() => {
      void this.runSync();
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getAkordaEvents(limit = 12): Promise<NewsItem[]> {
    return this.getNewsBySource('akorda', limit);
  }

  async getAbayEvents(limit = 12): Promise<NewsItem[]> {
    return this.getNewsBySource('abay', limit);
  }

  async getTransportEvents(limit = 12): Promise<NewsItem[]> {
    return this.getNewsBySource('transport', limit);
  }

  async getAviationEvents(limit = 12): Promise<NewsItem[]> {
    return this.getNewsBySource('aviation', limit);
  }

  async getArticleBySlug(slug: string): Promise<{ article: NewsItem; related: NewsItem[] } | null> {
    const normalizedSlug = slug.trim();
    if (!normalizedSlug) return null;

    const rows = await this.drizzle.db
      .select()
      .from(newsArticles)
      .where(eq(newsArticles.slug, normalizedSlug))
      .limit(1);

    if (!rows.length) return null;

    const row = rows[0];
    const source = this.detectSourceFromUrl(row.sourceUrl);
    const article = this.mapDbNewsToApi(row, source);

    const relatedRows = await this.drizzle.db
      .select()
      .from(newsArticles)
      .where(
        sql`${newsArticles.sourceUrl} like ${this.getSourcePrefix(source)} and ${newsArticles.slug} <> ${normalizedSlug}`,
      )
      .orderBy(desc(newsArticles.publishedAt), desc(newsArticles.updatedAt))
      .limit(3);

    const related = relatedRows.map((item) => this.mapDbNewsToApi(item, source));
    return { article, related };
  }

  private detectSourceFromUrl(sourceUrl: string): NewsSource {
    if (sourceUrl.includes('akorda.kz')) return 'akorda';
    if (sourceUrl.includes('/entities/abay/')) return 'abay';
    if (sourceUrl.includes('/entities/transport/')) return 'transport';
    if (sourceUrl.includes('/entities/aviation/')) return 'aviation';
    return 'akorda';
  }

  private async getNewsBySource(source: NewsSource, limit = 12): Promise<NewsItem[]> {
    const safeLimit = Math.max(1, Math.min(limit, 50));
    if (source !== 'akorda') {
      // Keep gov.kz feeds fresh on demand because list pages are dynamic.
      await this.runSyncSource(source);
    }
    const rows = await this.selectNewsRows(source, safeLimit);

    // If list is too short, try immediate re-sync for this source.
    if (rows.length < safeLimit) {
      await this.runSyncSource(source);
      const afterSync = await this.selectNewsRows(source, safeLimit);
      if (afterSync.length) {
        return afterSync.map((row) => this.mapDbNewsToApi(row, source));
      }
      if (source === 'abay') {
        const recovered = await this.recoverAbayNewsFromSeeds(safeLimit);
        if (recovered.length) return recovered;
      }
      return [];
    }

    return rows.map((row) => this.mapDbNewsToApi(row, source));
  }

  private async selectNewsRows(source: NewsSource, limit: number) {
    const base = this.drizzle.db
      .select()
      .from(newsArticles)
      .where(sql`${newsArticles.sourceUrl} like ${this.getSourcePrefix(source)}`);

    if (source !== 'akorda') {
      return base
        .orderBy(
          desc(newsArticles.publishedAt),
          sql`CAST(COALESCE(substring(${newsArticles.sourceUrl} from '/details/([0-9]+)'), '0') as bigint) DESC`,
        )
        .limit(limit);
    }

    return base
      .orderBy(desc(newsArticles.publishedAt), desc(newsArticles.updatedAt))
      .limit(limit);
  }

  private getSourcePrefix(source: NewsSource): string {
    if (source === 'akorda') return 'https://www.akorda.kz/%';
    if (source === 'abay') return 'https://www.gov.kz/memleket/entities/abay/%';
    if (source === 'transport') return 'https://www.gov.kz/memleket/entities/transport/%';
    return 'https://www.gov.kz/memleket/entities/aviation/%';
  }

  private async ensureStorage() {
    await this.drizzle.db.execute(sql`
      CREATE TABLE IF NOT EXISTS "news_articles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "source_url" text NOT NULL,
        "slug" varchar(255) NOT NULL,
        "title" text NOT NULL,
        "excerpt" text NOT NULL,
        "content" text NOT NULL,
        "image_url" text,
        "published_at" timestamp with time zone NOT NULL,
        "published_label" varchar(128),
        "category" varchar(32) DEFAULT 'news' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);

    await this.drizzle.db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "news_articles_source_url_unique"
      ON "news_articles" ("source_url");
    `);
  }

  private async runSync() {
    if (this.inProgress) return;
    this.inProgress = true;
    try {
      await this.runSyncSource('akorda');
      await this.runSyncSource('abay');
      await this.runSyncSource('transport');
      await this.runSyncSource('aviation');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      this.logger.warn(`News sync failed: ${message}`);
    } finally {
      this.inProgress = false;
    }
  }

  private async runSyncSource(source: NewsSource) {
    const fetchLimit = Number(this.config.get<string>('NEWS_SYNC_FETCH_LIMIT', '30'));
    const maxItems = Math.max(1, Math.min(fetchLimit, 100));

    const raw = source === 'akorda'
      ? await this.fetchAkordaList(maxItems)
      : source === 'abay'
        ? await this.fetchAbayList(maxItems)
        : source === 'transport'
          ? await this.fetchTransportList(maxItems)
          : await this.fetchAviationList(maxItems);
    if (!raw.length) {
      this.logger.warn(`News sync ${source}: no items parsed`);
      return;
    }

    const enriched = await this.enrichWithOriginalArticles(raw, source);
    let createdOrUpdated = 0;
    for (const item of enriched) {
      if (source !== 'akorda' && /^([a-z]+)-\d+$/i.test(item.title.trim())) {
        continue;
      }
      const publishedAt = this.toDate(item.date) ?? new Date();
      await this.drizzle.db
        .insert(newsArticles)
        .values({
          sourceUrl: item.sourceUrl,
          slug: item.slug,
          title: item.title,
          excerpt: item.excerpt,
          content: item.content,
          imageUrl: item.imageUrl,
          publishedAt,
          publishedLabel: item.dateLabel,
          category: item.category,
        })
        .onConflictDoUpdate({
          target: newsArticles.sourceUrl,
          set: {
            slug: item.slug,
            title: item.title,
            excerpt: item.excerpt,
            content: item.content,
            imageUrl: item.imageUrl,
            publishedAt,
            publishedLabel: item.dateLabel,
            category: item.category,
            updatedAt: new Date(),
          },
        });
      createdOrUpdated += 1;
    }

    this.logger.log(`News sync ${source} done. processed=${createdOrUpdated}`);
  }

  private async recoverAbayNewsFromSeeds(limit: number): Promise<NewsItem[]> {
    const seeds = this.config
      .get<string>('ABAY_NEWS_SEED_IDS', '952578,969425,527244,915792,959960')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, limit);

    const raw: NewsItem[] = seeds.map((id) => {
      const url = `https://www.gov.kz/memleket/entities/abay/press/news/details/${id}?lang=ru`;
      return {
        id: url,
        slug: `abay-${id}`,
        title: `abay-${id}`,
        excerpt: `abay-${id}`,
        content: `abay-${id}`,
        date: new Date().toISOString().slice(0, 10),
        dateLabel: '',
        sourceUrl: url,
        imageUrl: null,
        category: 'news',
        source: 'abay',
      };
    });

    const enriched = await this.enrichWithOriginalArticles(raw, 'abay');
    const valid = enriched.filter((item) => !/^abay-\d+$/i.test(item.title.trim()));
    if (!valid.length) return [];

    for (const item of valid) {
      const publishedAt = this.toDate(item.date) ?? new Date();
      await this.drizzle.db
        .insert(newsArticles)
        .values({
          sourceUrl: item.sourceUrl,
          slug: item.slug,
          title: item.title,
          excerpt: item.excerpt,
          content: item.content,
          imageUrl: item.imageUrl,
          publishedAt,
          publishedLabel: item.dateLabel,
          category: item.category,
        })
        .onConflictDoUpdate({
          target: newsArticles.sourceUrl,
          set: {
            slug: item.slug,
            title: item.title,
            excerpt: item.excerpt,
            content: item.content,
            imageUrl: item.imageUrl,
            publishedAt,
            publishedLabel: item.dateLabel,
            category: item.category,
            updatedAt: new Date(),
          },
        });
    }

    return valid.slice(0, limit);
  }

  private async fetchAkordaList(limit: number): Promise<NewsItem[]> {
    const html = await this.fetchHtml(this.akordaListUrl);
    if (!html) return [];

    const results: NewsItem[] = [];
    const re =
      /<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/gi;

    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null && results.length < limit) {
      const hrefRaw = match[1] || '';
      const titleRaw = match[2] || '';
      const dateRaw = match[3] || '';

      const title = this.cleanText(titleRaw);
      const dateText = this.cleanText(dateRaw);
      if (!title || !dateText) continue;

      const sourceUrl = this.toAbsoluteUrl(hrefRaw, this.akordaListUrl);
      results.push({
        id: sourceUrl,
        slug: this.slugFromHref(hrefRaw, title),
        title,
        excerpt: title,
        content: title,
        date: this.parseRuDate(dateText),
        dateLabel: dateText,
        sourceUrl,
        imageUrl: this.extractNearbyImage(html, match.index, re.lastIndex, this.akordaListUrl),
        category: 'news',
        source: 'akorda',
      });
    }

    return results;
  }

  private async fetchAbayList(limit: number): Promise<NewsItem[]> {
    const byUrl = new Map<string, NewsItem>();
    const discoveredLinks = new Set<string>();

    const listPages = [
      this.abayListUrl,
      'https://www.gov.kz/memleket/entities/abay/press/news?lang=ru',
      'https://www.gov.kz/memleket/entities/abay?lang=ru',
    ];

    for (const pageUrl of listPages) {
      const escapedListUrl = this.withEscapedFragment(pageUrl);
      const html =
        (await this.fetchHtml(escapedListUrl, true)) ||
        (await this.fetchHtml(pageUrl, true));
      if (!html) continue;
      const links = this.extractGovAbayDetailLinks(html, pageUrl);
      for (const link of links) {
        discoveredLinks.add(link);
      }
    }

    const newestLinks = Array.from(discoveredLinks)
      .sort((a, b) => this.extractGovNewsId(b) - this.extractGovNewsId(a))
      .slice(0, limit);

    for (const link of newestLinks) {
      const idPart = link.match(/details\/(\d+)/)?.[1] ?? '';
      byUrl.set(link, {
        id: link,
        slug: idPart ? `abay-${idPart}` : this.slugFromHref(link, 'news'),
        title: 'Новость Акимата области Абай',
        excerpt: 'Новость Акимата области Абай',
        content: 'Новость Акимата области Абай',
        date: new Date().toISOString().slice(0, 10),
        dateLabel: '',
        sourceUrl: link,
        imageUrl: null,
        category: 'news',
        source: 'abay',
      });
    }

    // Fallback on known public detail pages, so tab is never empty.
    const seeds = this.config
      .get<string>('ABAY_NEWS_SEED_IDS', '952578,969425,527244,915792,959960')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, limit);
    for (const id of seeds) {
      if (byUrl.size >= limit) break;
      const url = `https://www.gov.kz/memleket/entities/abay/press/news/details/${id}?lang=ru`;
      if (byUrl.has(url)) continue;
      byUrl.set(url, {
        id: url,
        slug: `abay-${id}`,
        title: `abay-${id}`,
        excerpt: `abay-${id}`,
        content: `abay-${id}`,
        date: new Date().toISOString().slice(0, 10),
        dateLabel: '',
        sourceUrl: url,
        imageUrl: null,
        category: 'news',
        source: 'abay',
      });
    }

    return Array.from(byUrl.values());
  }

  private async fetchTransportList(limit: number): Promise<NewsItem[]> {
    const byUrl = new Map<string, NewsItem>();
    const discoveredLinks = new Set<string>();

    const listPages = [
      this.transportListUrl,
      'https://www.gov.kz/memleket/entities/transport/press/news?lang=ru',
      'https://www.gov.kz/memleket/entities/transport?lang=ru',
    ];

    for (const pageUrl of listPages) {
      const escapedListUrl = this.withEscapedFragment(pageUrl);
      const html =
        (await this.fetchHtml(escapedListUrl, true)) ||
        (await this.fetchHtml(pageUrl, true));
      if (!html) continue;
      const links = this.extractGovEntityDetailLinks(html, pageUrl, 'transport');
      for (const link of links) {
        discoveredLinks.add(link);
      }
    }

    const newestLinks = Array.from(discoveredLinks)
      .sort((a, b) => this.extractGovNewsId(b) - this.extractGovNewsId(a))
      .slice(0, limit);

    for (const link of newestLinks) {
      const idPart = link.match(/details\/(\d+)/)?.[1] ?? '';
      byUrl.set(link, {
        id: link,
        slug: idPart ? `transport-${idPart}` : this.slugFromHref(link, 'news'),
        title: 'Новость Министерства транспорта РК',
        excerpt: 'Новость Министерства транспорта РК',
        content: 'Новость Министерства транспорта РК',
        date: new Date().toISOString().slice(0, 10),
        dateLabel: '',
        sourceUrl: link,
        imageUrl: null,
        category: 'news',
        source: 'transport',
      });
    }

    return Array.from(byUrl.values());
  }

  private async fetchAviationList(limit: number): Promise<NewsItem[]> {
    const byUrl = new Map<string, NewsItem>();
    const discoveredLinks = new Set<string>();

    const listPages = [
      this.aviationListUrl,
      'https://www.gov.kz/memleket/entities/aviation/press/news?lang=ru',
      'https://www.gov.kz/memleket/entities/aviation?lang=ru',
    ];

    for (const pageUrl of listPages) {
      const escapedListUrl = this.withEscapedFragment(pageUrl);
      const html =
        (await this.fetchHtml(escapedListUrl, true)) ||
        (await this.fetchHtml(pageUrl, true));
      if (!html) continue;
      const links = this.extractGovEntityDetailLinks(html, pageUrl, 'aviation');
      for (const link of links) {
        discoveredLinks.add(link);
      }
    }

    const newestLinks = Array.from(discoveredLinks)
      .sort((a, b) => this.extractGovNewsId(b) - this.extractGovNewsId(a))
      .slice(0, limit);

    for (const link of newestLinks) {
      const idPart = link.match(/details\/(\d+)/)?.[1] ?? '';
      byUrl.set(link, {
        id: link,
        slug: idPart ? `aviation-${idPart}` : this.slugFromHref(link, 'news'),
        title: 'Новость Комитета гражданской авиации',
        excerpt: 'Новость Комитета гражданской авиации',
        content: 'Новость Комитета гражданской авиации',
        date: new Date().toISOString().slice(0, 10),
        dateLabel: '',
        sourceUrl: link,
        imageUrl: null,
        category: 'news',
        source: 'aviation',
      });
    }

    return Array.from(byUrl.values());
  }

  private async enrichWithOriginalArticles(items: NewsItem[], source: NewsSource): Promise<NewsItem[]> {
    const fallbackBase =
      source === 'akorda'
        ? this.akordaListUrl
        : source === 'abay'
          ? this.abayListUrl
          : source === 'transport'
            ? this.transportListUrl
            : this.aviationListUrl;
    return Promise.all(
      items.map(async (item) => {
        try {
          const urlToFetch =
            source === 'abay' || source === 'transport'
              ? this.withEscapedFragment(item.sourceUrl)
              : item.sourceUrl;
          const html = await this.fetchHtml(urlToFetch, source !== 'akorda');
          if (!html) return item;

          const ogTitle = this.extractMeta(html, 'og:title');
          const ogDesc = this.extractMeta(html, 'og:description');
          const ogImage = this.extractMeta(html, 'og:image');
          const published = this.extractMeta(html, 'article:published_time');
          const dateLabel = this.extractArticleDateLabel(html);
          const h1Title = this.extractFirstH1(html);
          const bodyImage = this.extractFirstImage(html, fallbackBase);
          const bodyText = this.extractArticleText(html);

          const title = h1Title || ogTitle || item.title;
          const content = bodyText || ogDesc || item.content;
          const excerpt = ogDesc || this.firstSentence(content) || title;
          const imageUrl =
            (ogImage ? this.toAbsoluteUrl(ogImage, fallbackBase) : null) ??
            bodyImage ??
            this.extractNearbyImage(html, 0, html.length, fallbackBase) ??
            item.imageUrl;
          const resolvedDate =
            source === 'transport' || source === 'aviation'
              ? item.date
              : this.toIsoDate(published) ?? this.parseRuDate(dateLabel || item.dateLabel || '');
          const resolvedDateLabel =
            source === 'transport' || source === 'aviation'
              ? ''
              : dateLabel || item.dateLabel;

          return {
            ...item,
            title,
            excerpt,
            content,
            date: resolvedDate,
            dateLabel: resolvedDateLabel,
            imageUrl,
          };
        } catch {
          return item;
        }
      }),
    );
  }

  private mapDbNewsToApi(row: typeof newsArticles.$inferSelect, source: NewsSource): NewsItem {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      content: row.content,
      date: row.publishedAt.toISOString().slice(0, 10),
      dateLabel: row.publishedLabel ?? '',
      sourceUrl: row.sourceUrl,
      imageUrl: row.imageUrl,
      category: 'news',
      source,
    };
  }

  private async fetchHtml(url: string, asBot = false): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': asBot
            ? 'Googlebot/2.1 (+http://www.google.com/bot.html)'
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
        },
      });
      if (!response.ok) return '';
      return await response.text();
    } catch {
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private toAbsoluteUrl(href: string, base: string): string {
    if (!href) return base;
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    if (href.startsWith('//')) return `https:${href}`;
    return new URL(href, base).toString();
  }

  private slugFromHref(href: string, title: string): string {
    const parts = href.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last.toLowerCase().replace(/[^a-z0-9-_]/gi, '-');
    return `news-${this.slugify(title)}`;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9а-яёіїңғүұқөһ]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private cleanText(value: string): string {
    return value
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&laquo;|&raquo;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractMeta(html: string, property: string): string {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i',
    );
    return this.cleanText(html.match(re)?.[1] ?? '');
  }

  private extractNearbyImage(html: string, start: number, end: number, base: string): string | null {
    const snippet = html.slice(Math.max(0, start - 3000), Math.min(html.length, end + 3000));
    const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
    let current: RegExpExecArray | null;
    let lastSrc = '';
    while ((current = imgRegex.exec(snippet)) !== null) {
      lastSrc = current[1] ?? '';
    }
    if (!lastSrc) return null;
    const normalized = this.toAbsoluteUrl(lastSrc, base);
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(normalized)) return null;
    return normalized;
  }

  private extractArticleText(html: string): string {
    const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
    const contentDivMatch = html.match(/<div>\s*<p[\s\S]*?<\/div>/i);
    const scope = articleMatch?.[0] ?? contentDivMatch?.[0] ?? html;
    const paragraphs: string[] = [];
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(scope)) !== null) {
      const text = this.cleanText(m[1] ?? '');
      if (text.length > 20) paragraphs.push(text);
    }
    return paragraphs.join('\n\n');
  }

  private extractArticleDateLabel(html: string): string {
    const m1 = html.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
    const v1 = this.cleanText(m1?.[1] ?? '');
    if (/\d{4}/.test(v1)) return v1;
    const m2 = html.match(/(\d{1,2}\s+[а-яё]+\s+\d{4}\s+года)/i);
    const v2 = this.cleanText(m2?.[1] ?? '');
    if (v2) return v2;
    return '';
  }

  private extractFirstH1(html: string): string {
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    return this.cleanText(m?.[1] ?? '');
  }

  private extractFirstImage(html: string, base: string): string | null {
    const m = html.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    const src = this.cleanText(m?.[1] ?? '');
    if (!src) return null;
    const absolute = this.toAbsoluteUrl(src, base);
    return /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(absolute) ? absolute : null;
  }

  private withEscapedFragment(url: string): string {
    if (url.includes('_escaped_fragment_=')) return url;
    return `${url}${url.includes('?') ? '&' : '?'}_escaped_fragment_=`;
  }

  private extractGovAbayDetailLinks(html: string, baseUrl: string): string[] {
    return this.extractGovEntityDetailLinks(html, baseUrl, 'abay');
  }

  private extractGovEntityDetailLinks(
    html: string,
    baseUrl: string,
    entity: 'abay' | 'transport' | 'aviation',
  ): string[] {
    const links = new Set<string>();
    const patterns = [
      new RegExp(`href="([^"]*\\/memleket\\/entities\\/${entity}\\/press\\/news\\/details\\/\\d+[^"]*)"`, 'gi'),
      new RegExp(`href='([^']*\\/memleket\\/entities\\/${entity}\\/press\\/news\\/details\\/\\d+[^']*)'`, 'gi'),
      new RegExp(`\\/memleket\\/entities\\/${entity}\\/press\\/news\\/details\\/\\d+\\?lang=ru`, 'gi'),
      new RegExp(`\\\\\\/memleket\\\\\\/entities\\\\\\/${entity}\\\\\\/press\\\\\\/news\\\\\\/details\\\\\\/\\d+\\?lang=ru`, 'gi'),
      new RegExp(`\\/memleket\\/entities\\/${entity}\\/press\\/news\\/details\\/\\d+`, 'gi'),
      new RegExp(`\\\\\\/memleket\\\\\\/entities\\\\\\/${entity}\\\\\\/press\\\\\\/news\\\\\\/details\\\\\\/\\d+`, 'gi'),
    ];

    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const raw = (m[1] ?? m[0] ?? '').replace(/\\\//g, '/').replace(/&amp;/g, '&');
        if (!raw.includes('/press/news/details/')) continue;
        const absolute = this.toAbsoluteUrl(raw, baseUrl);
        links.add(absolute.includes('lang=') ? absolute : `${absolute}${absolute.includes('?') ? '&' : '?'}lang=ru`);
      }
    }

    return Array.from(links);
  }

  private extractGovNewsId(url: string): number {
    const raw = url.match(/\/details\/(\d+)/)?.[1];
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private firstSentence(value: string): string {
    const cleaned = this.cleanText(value);
    const idx = cleaned.search(/[.!?]\s/);
    if (idx === -1) return cleaned.slice(0, 220).trim();
    return cleaned.slice(0, idx + 1).trim();
  }

  private toIsoDate(value: string): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  private toDate(value: string): Date | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  private parseRuDate(value: string): string {
    if (!value) return new Date().toISOString().slice(0, 10);
    const lowered = value.toLowerCase().replace('года', '').trim();
    const m = lowered.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
    if (!m) return new Date().toISOString().slice(0, 10);
    const day = Number(m[1]);
    const month = this.ruMonthToNumber(m[2]);
    const year = Number(m[3]);
    if (!month || !day || !year) return new Date().toISOString().slice(0, 10);
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  }

  private ruMonthToNumber(month: string): number {
    const map: Record<string, number> = {
      января: 1,
      февраля: 2,
      марта: 3,
      апреля: 4,
      мая: 5,
      июня: 6,
      июля: 7,
      августа: 8,
      сентября: 9,
      октября: 10,
      ноября: 11,
      декабря: 12,
    };
    return map[month] ?? 0;
  }
}
