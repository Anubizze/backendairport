const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, mkdir, readdir, readFile, rm } = require('node:fs/promises');
const path = require('node:path');
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { ServicePhotosController } = require('../dist/service-photos/service-photos.controller');
const { ServicePhotosService } = require('../dist/service-photos/service-photos.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { RolesGuard } = require('../dist/auth/roles.guard');

test('photo upload, metadata editing, replacement, validation and rollback', async (t) => {
  const originalDirectory = process.cwd();
  const temporaryRoot = path.resolve(originalDirectory, 'tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, 'photo-test-'));
  const uploads = path.join(directory, 'uploads', 'services');
  await mkdir(uploads, { recursive: true });
  process.chdir(directory);

  // Only the database is replaced; HTTP routing, validation, multipart parsing,
  // the service and all filesystem operations run as in the application.
  let record;
  let failUpdate = false;
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => record ? [record] : [] }) }) }),
    insert: () => ({ values: (values) => ({ returning: async () => {
      record = { id: randomUUID(), createdAt: new Date(), ...values };
      return [record];
    } }) }),
    update: () => ({ set: (values) => ({ where: () => ({ returning: async () => {
      if (failUpdate) throw new Error('Simulated database failure');
      record = { ...record, ...values };
      return [record];
    } }) }) }),
    delete: () => ({ where: async () => { record = undefined; } }),
  };
  let app;
  t.after(async () => {
    if (app) await app.close();
    process.chdir(originalDirectory);
    assert.ok(path.resolve(directory).startsWith(`${temporaryRoot}${path.sep}`));
    await rm(directory, { recursive: true, force: true });
  });
  const module = await Test.createTestingModule({
    controllers: [ServicePhotosController],
    providers: [{ provide: ServicePhotosService, useValue: new ServicePhotosService({ db }) }],
  })
    .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
    .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
    .compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/service-photos`;
  const imageBytes = Buffer.from('test-image-bytes');
  const multipart = (fields, file) => {
    const body = new FormData();
    Object.entries(fields).forEach(([key, value]) => body.append(key, String(value)));
    if (file) body.append('file', new Blob([file.bytes ?? imageBytes], { type: file.type ?? 'image/png' }), file.name ?? 'photo.png');
    return body;
  };
  let id;
  let originalUrl;

  await t.test('uploads a photo using the existing endpoint', async () => {
    const response = await fetch(base, { method: 'POST', body: multipart({ serviceId: 'cafe-aspan', altRu: 'Кафе', altKz: 'Кафе KZ', altEn: 'Cafe', sortOrder: 1 }, {}) });
    assert.equal(response.status, 201);
    const photo = await response.json();
    id = photo.id;
    originalUrl = photo.url;
    assert.deepEqual(await readFile(path.join(uploads, path.basename(originalUrl))), imageBytes);
  });

  await t.test('edits metadata and clears a caption without replacing the file or translations', async () => {
    const response = await fetch(`${base}/${id}`, { method: 'PATCH', body: multipart({ serviceId: 'medical', altRu: '', sortOrder: 2 }) });
    assert.equal(response.status, 200);
    const photo = await response.json();
    assert.equal(photo.url, originalUrl);
    assert.equal(photo.serviceId, 'medical');
    assert.equal(photo.altRu, null);
    assert.equal(photo.altEn, 'Cafe');
    assert.equal(photo.altKz, 'Кафе KZ');
    assert.equal(photo.sortOrder, 2);
    assert.equal((await readdir(uploads)).length, 1);
  });

  await t.test('rejects invalid metadata and files without changing existing files', async () => {
    for (const fields of [{ sortOrder: -1 }, { sortOrder: 'invalid' }, { sortOrder: 1.5 }, { altRu: 'x'.repeat(256) }, { serviceId: 'unknown' }, { url: '/uploads/other.png' }]) {
      const response = await fetch(`${base}/${id}`, { method: 'PATCH', body: multipart(fields, {}) });
      assert.equal(response.status, 400);
    }
    const response = await fetch(`${base}/${id}`, { method: 'PATCH', body: multipart({}, { type: 'application/pdf', name: 'file.pdf' }) });
    assert.equal(response.status, 400);
    const oversized = await fetch(`${base}/${id}`, { method: 'PATCH', body: multipart({}, { bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }) });
    assert.equal(oversized.status, 413);
    assert.equal(record.url, originalUrl);
    assert.equal((await readdir(uploads)).length, 1);
  });

  await t.test('rejects a missing record without leaving an uploaded file', async () => {
    const saved = record;
    record = undefined;
    const response = await fetch(`${base}/${id}`, { method: 'PATCH', body: multipart({}, {}) });
    record = saved;
    assert.equal(response.status, 404);
    assert.equal((await readdir(uploads)).length, 1);
  });

  await t.test('replaces the image and removes the previous file only after saving', async () => {
    const response = await fetch(`${base}/${id}`, { method: 'PATCH', body: multipart({}, { bytes: Buffer.from('replacement') }) });
    assert.equal(response.status, 200);
    const photo = await response.json();
    assert.notEqual(photo.url, originalUrl);
    assert.equal(photo.id, id);
    assert.deepEqual(await readdir(uploads), [path.basename(photo.url)]);
    assert.equal((await readFile(path.join(uploads, path.basename(photo.url)))).toString(), 'replacement');
  });

  await t.test('preserves the image and removes the new file if saving fails', async () => {
    const savedUrl = record.url;
    failUpdate = true;
    const response = await fetch(`${base}/${id}`, { method: 'PATCH', body: multipart({}, {}) });
    failUpdate = false;
    assert.equal(response.status, 500);
    assert.equal(record.url, savedUrl);
    assert.deepEqual(await readdir(uploads), [path.basename(savedUrl)]);
  });

  await t.test('deletes the image file with its record', async () => {
    const response = await fetch(`${base}/${id}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.equal(record, undefined);
    assert.deepEqual(await readdir(uploads), []);
  });
});
