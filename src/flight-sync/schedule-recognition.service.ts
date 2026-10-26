import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { copyFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { createWorker, PSM, Worker } from 'tesseract.js';
import { parseScheduleText } from './schedule-parser';

const sharp: typeof import('sharp').default = require('sharp');

@Injectable()
export class ScheduleRecognitionService {
  private busy = false;
  private readonly logger = new Logger(ScheduleRecognitionService.name);

  async recognize(path: string) {
    if (this.busy) throw new ServiceUnavailableException('Другое фото уже распознаётся. Повторите через минуту.');
    this.busy = true;
    let worker: Worker | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      let image: Buffer;
      try {
        image = await sharp(path, { limitInputPixels: 25_000_000, animated: false })
          .rotate().resize({ width: 2400, height: 3200, fit: 'inside' }).grayscale().normalize().png().toBuffer();
      } catch {
        throw new BadRequestException('Не удалось открыть изображение. Используйте JPEG, PNG или WebP до 25 мегапикселей.');
      }
      const langPath = join(process.cwd(), 'uploads', 'schedules', '.ocr-models');
      await mkdir(langPath, { recursive: true });
      await Promise.all(['rus', 'eng'].map((code) => copyFile(
        join(dirname(require.resolve(`@tesseract.js-data/${code}`)), '4.0.0_best_int', `${code}.traineddata.gz`),
        join(langPath, `${code}.traineddata.gz`),
      )));
      worker = await createWorker(['rus', 'eng'], 1, { langPath, cacheMethod: 'none', errorHandler: (error) => this.logger.error(String(error).slice(0, 500)) });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
      const activeWorker = worker;
      const recognize = async () => {
        const result = await activeWorker.recognize(image, { rotateAuto: true });
        try {
          return parseScheduleText(result.data.text);
        } catch (error) {
          if (!(error instanceof BadRequestException)) throw error;
          await activeWorker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
          const retry = await activeWorker.recognize(image, { rotateAuto: true });
          return parseScheduleText(retry.data.text);
        }
      };
      return await Promise.race([
        recognize(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Schedule OCR timed out')), 60000);
        }),
      ]);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('Schedule recognition failed', error instanceof Error ? error.stack : String(error));
      throw new ServiceUnavailableException('Распознавание временно недоступно. Попробуйте ещё раз или заполните таблицу вручную. Расписание не изменено.');
    } finally {
      if (timer) clearTimeout(timer);
      await worker?.terminate().catch(() => undefined);
      this.busy = false;
    }
  }
}
