import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const started = Date.now();
    const { method, originalUrl } = req;

    res.on('finish', () => {
      const ms = Date.now() - started;
      const tag = originalUrl.includes('/stream') ? 'SSE' : method;
      this.logger.log(`${tag} ${originalUrl} → ${res.statusCode} (${ms}ms)`);
    });

    next();
  }
}
