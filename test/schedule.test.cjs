const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, mkdir, readFile, readdir, rm } = require('node:fs/promises');
const path = require('node:path');
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { UnauthorizedException, ForbiddenException } = require('@nestjs/common');
const { ConfigService } = require('@nestjs/config');
const { getTableName } = require('drizzle-orm');
const { PgDialect } = require('drizzle-orm/pg-core');
const sharp = require('sharp');
const { ScheduleController } = require('../dist/flight-sync/schedule.controller');
const { ScheduleRecognitionService } = require('../dist/flight-sync/schedule-recognition.service');
const { FlightSyncService } = require('../dist/flight-sync/flight-sync.service');
const { FlightsService } = require('../dist/flights/flights.service');
const { DrizzleService } = require('../dist/db/drizzle.service');
const { FlightsEventsService } = require('../dist/flights/flights.events');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { RolesGuard } = require('../dist/auth/roles.guard');
const { DEFAULT_SCHEDULE_ENTRIES } = require('../dist/flight-sync/default-schedule');
const { parseScheduleText } = require('../dist/flight-sync/schedule-parser');
const { normalizeScheduleEntry } = require('../dist/flight-sync/schedule-entry');
const legacyBoard = require('./fixtures/legacySchedule.json');

const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const cities = { Astana: 'Астана', Almaty: 'Алматы', Urzhar: 'Урджар' };
const shortDate = (value) => value.slice(8) + '.' + value.slice(5, 7) + '.' + value.slice(2, 4);
const paperLines = ['Расписание движения воздушных судов', '25.10.2026-27.03.2027'];
for (const weekday of [1, 2, 3, 4, 5, 6, 0]) {
  paperLines.push(days[weekday]);
  const entries = DEFAULT_SCHEDULE_ENTRIES.filter((entry) => entry.weekday === weekday);
  const departures = entries.filter((entry) => entry.direction === 'departure').sort((a, b) => a.time.localeCompare(b.time));
  const arrivals = entries.filter((entry) => entry.direction === 'arrival').sort((a, b) => a.time.localeCompare(b.time));
  departures.forEach((dep, index) => {
    const arr = arrivals.find((entry) => entry.city === dep.city && entry.flightNumber.slice(0, 2) === dep.flightNumber.slice(0, 2) && entry.validFrom === dep.validFrom && entry.validTo === dep.validTo);
    paperLines.push(`${cities[dep.city]} ${dep.flightNumber} ${dep.time} ${dep.counterpartTime} ${shortDate(dep.validFrom)}-${shortDate(dep.validTo)} ${arr.flightNumber} ${arr.counterpartTime} ${arr.time}`);
  });
}
const paper = paperLines.join('\n');
const canonical = (entries) => entries.map((entry) => JSON.stringify(normalizeScheduleEntry(entry))).sort();

test('paper table parses all days, periods, both times and repeated flight numbers', () => {
  const parsed = parseScheduleText(paper);
  assert.deepEqual(canonical(parsed.entries), canonical(DEFAULT_SCHEDULE_ENTRIES));
  assert.deepEqual(parsed.warnings, []);
  const imperfect = parseScheduleText(paper.replace('IQ374', '1Q374').replace('IH3107', 'ІН3107'));
  assert.deepEqual(canonical(imperfect.entries), canonical(DEFAULT_SCHEDULE_ENTRIES));
  assert.throws(() => parseScheduleText('not a timetable'), /Не удалось распознать/);
  const partial = parseScheduleText(paper.replace(/FS7152 14:10 16:00/, 'FS7152 unreadable'));
  assert.equal(partial.entries.length, 48);
  assert.ok(partial.warnings.length);
});

test('invalid dates, directions and times are rejected before saving', () => {
  const valid = DEFAULT_SCHEDULE_ENTRIES[0];
  for (const fields of [{ validFrom: '2026-02-30' }, { validFrom: '2028-01-01' }, { weekday: 7 }, { direction: 'invalid' }, { time: '24:00' }, { counterpartTime: '12:80' }, { flightNumber: '' }]) {
    assert.throws(() => normalizeScheduleEntry({ ...valid, ...fields }));
  }
});

// Execute the real services against an in-memory database boundary, retaining
// transaction rollback and the SQL parameters produced by Drizzle.
function memoryDatabase() {
  const state = { schedule_board: [{ id: 1, photoUrl: null, planSaved: false }], flight_schedule_entries: [], flights: [] };
  const dialect = new PgDialect();
  const matches = (condition) => {
    if (!condition) return () => true;
    const { sql, params } = dialect.sqlToQuery(condition);
    if (sql.includes('flight_number')) return (row) => row.flightNumber === params[0] && row.direction === params[1];
    if (sql.includes('schedule_locked')) return (row) => row.scheduleLocked === params[0];
    return (row) => row.id === params[0];
  };
  const db = {
    execute: async () => {},
    select: () => ({ from: (table) => {
      let predicate = () => true;
      let limit = Infinity;
      const query = {
        where(condition) { predicate = matches(condition); return this; },
        orderBy() { return this; },
        limit(value) { limit = value; return this; },
        for() { return this; },
        then(resolve, reject) { return Promise.resolve(state[getTableName(table)].filter(predicate).slice(0, limit)).then(resolve, reject); },
      };
      return query;
    } }),
    insert: (table) => ({ values: (input) => {
      const rows = (Array.isArray(input) ? input : [input]).map((row) => ({ id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...row }));
      const commit = () => {
        if (db.failNextInsert) { db.failNextInsert = false; throw new Error('Simulated database write failure'); }
        state[getTableName(table)].push(...rows);
        return rows;
      };
      return { then: (resolve, reject) => Promise.resolve().then(commit).then(resolve, reject), returning: async () => commit() };
    } }),
    update: (table) => ({ set: (fields) => ({ where: (condition) => {
      const commit = () => { const rows = state[getTableName(table)].filter(matches(condition)); rows.forEach((row) => Object.assign(row, fields)); return rows; };
      return { then: (resolve, reject) => Promise.resolve().then(commit).then(resolve, reject), returning: async () => commit() };
    } }) }),
    delete: (table) => {
      const commit = (predicate) => { state[getTableName(table)] = state[getTableName(table)].filter((row) => !predicate(row)); };
      return { then: (resolve, reject) => Promise.resolve().then(() => commit(() => true)).then(resolve, reject), where: async (condition) => commit(matches(condition)) };
    },
    transaction: async (callback) => {
      const snapshot = structuredClone(state);
      try { return await callback(db); } catch (error) { Object.assign(state, snapshot); throw error; }
    },
  };
  return { state, db };
}

test('existing database records are upgraded once and omitted fields cannot erase details', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-06T06:00:00Z') });
  const { db, state } = memoryDatabase();
  state.flight_schedule_entries = legacyBoard.entries.map(({ time, ...entry }) => ({ ...entry, id: randomUUID(), planTime: time }));
  const originalIds = state.flight_schedule_entries.map((entry) => entry.id);
  const service = new FlightSyncService({ get: (_key, fallback) => fallback }, { db }, { publish: () => {} });
  const upgraded = await service.getScheduleBoard();
  assert.equal(upgraded.schemaVersion, 2);
  assert.equal(state.schedule_board[0].schemaVersion, 2);
  assert.deepEqual(canonical(upgraded.entries), canonical(DEFAULT_SCHEDULE_ENTRIES));
  assert.equal(state.flight_schedule_entries.filter((entry) => originalIds.includes(entry.id)).length, 48);

  // A stale admin tab still sends only the five old fields.
  const oldPayload = legacyBoard.entries.map(({ weekday, flightNumber, direction, city, time }) => ({ weekday, flightNumber, direction, city, time }));
  await service.saveSchedulePlan(oldPayload);
  assert.deepEqual(canonical((await service.getScheduleBoard()).entries), canonical(DEFAULT_SCHEDULE_ENTRIES));

  // A time edit from an old client preserves the other fields of that slot.
  const updated = (await service.getScheduleBoard()).entries;
  const simple = updated.map(({ weekday, flightNumber, direction, city, time }) => ({ weekday, flightNumber, direction, city, time }));
  const departure = simple.find((entry) => entry.weekday === 1 && entry.flightNumber === 'IQ374');
  departure.time = '10:25';
  await service.saveSchedulePlan(simple);
  const edited = (await service.getScheduleBoard()).entries.find((entry) => entry.weekday === 1 && entry.flightNumber === 'IQ374');
  assert.equal(edited.time, '10:25');
  assert.equal(edited.counterpartTime, '11:45');
  assert.equal(edited.validTo, '2027-03-27');

  // Explicit clearing in a current client remains an intentional edit.
  const explicit = (await service.getScheduleBoard()).entries.map((entry) => ({ ...entry }));
  explicit[0].counterpartTime = null;
  await service.saveSchedulePlan(explicit);
  const restarted = new FlightSyncService({ get: (_key, fallback) => fallback }, { db }, { publish: () => {} });
  assert.equal((await restarted.getScheduleBoard()).entries[0].counterpartTime, null);
});

test('migration preserves unrelated custom plans and explicitly saved empty plans', async () => {
  for (const variant of ['custom', 'empty']) {
    const { db, state } = memoryDatabase();
    state.schedule_board[0].planSaved = true;
    if (variant === 'custom') state.flight_schedule_entries = [{ id: randomUUID(), weekday: 1, flightNumber: 'IQ374', direction: 'departure', city: 'Astana', planTime: '10:25' }];
    const before = structuredClone(state.flight_schedule_entries);
    const service = new FlightSyncService({ get: (_key, fallback) => fallback }, { db }, { publish: () => {} });
    const board = await service.getScheduleBoard();
    assert.equal(board.source, 'custom');
    assert.deepEqual(state.flight_schedule_entries, before);
    assert.equal(board.entries.length, before.length);
  }
});

test('upload → preview → save → public calendar and board, including failed recognition', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-06T06:00:00Z') });
  const originalDirectory = process.cwd();
  const temporaryRoot = path.resolve(originalDirectory, 'tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, 'schedule-test-'));
  process.chdir(directory);
  const { db, state } = memoryDatabase();
  const events = [];
  let app;
  t.after(async () => {
    if (app) await app.close();
    process.chdir(originalDirectory);
    assert.ok(path.resolve(directory).startsWith(temporaryRoot + path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  const module = await Test.createTestingModule({
    controllers: [ScheduleController],
    providers: [FlightSyncService, ScheduleRecognitionService,
      { provide: ConfigService, useValue: { get: (key, fallback) => key === 'FLIGHT_SYNC_ENABLED' ? 'false' : fallback } },
      { provide: DrizzleService, useValue: { db } },
      { provide: FlightsEventsService, useValue: { publish: (event) => events.push(event) } },
    ],
  })
    .overrideGuard(JwtAuthGuard).useValue({ canActivate: (context) => {
      const auth = context.switchToHttp().getRequest().headers.authorization;
      if (!auth) throw new UnauthorizedException();
      return true;
    } })
    .overrideGuard(RolesGuard).useValue({ canActivate: (context) => {
      if (context.switchToHttp().getRequest().headers.authorization !== 'Bearer dispatcher') throw new ForbiddenException();
      return true;
    } }).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/schedule`;
  const auth = { Authorization: 'Bearer dispatcher' };
  const save = (body, headers = auth) => fetch(base, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const upload = (bytes, type = 'image/png', name = 'schedule.png') => {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    return fetch(`${base}/photo`, { method: 'POST', headers: auth, body: form });
  };

  await t.test('read is public; changing data requires an authorized role', async () => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).entries.length, 50);
    assert.equal((await save({ entries: [] }, {})).status, 401);
    assert.equal((await save({ entries: [] }, { Authorization: 'Bearer editor' })).status, 403);
  });

  let draft;
  await t.test('recognizes a real PNG using local Russian and English models', async () => {
    const texts = paperLines.map((line, index) => `<text x="24" y="${42 + index * 39}" font-family="Arial" font-size="27">${line}</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="${paperLines.length * 39 + 40}"><rect width="100%" height="100%" fill="white"/><g fill="black">${texts}</g></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const response = await upload(png);
    draft = await response.json();
    assert.equal(response.status, 201, JSON.stringify(draft));
    assert.deepEqual(canonical(draft.entries), canonical(DEFAULT_SCHEDULE_ENTRIES));
    assert.equal((await (await fetch(base)).json()).source, 'default');
    assert.equal(state.schedule_board[0].photoUrl, null);
    assert.ok((await readFile(path.join(directory, draft.photoUrl.replace('/api/', '')))).length);
  });

  await t.test('saving publishes the complete plan and both Friday FS7151 occurrences', async () => {
    const response = await save({ entries: draft.entries, photoUrl: draft.photoUrl });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { saved: 50, applied: 10 });
    const board = await (await fetch(base)).json();
    assert.equal(board.source, 'custom');
    assert.equal(board.photoUrl, draft.photoUrl);
    assert.equal(board.entries.find((entry) => entry.weekday === 5 && entry.flightNumber === 'FS7154').validTo, '2027-11-27');
    assert.equal(state.flights.filter((row) => row.flightNumber === 'FS7151').length, 2);
    const flights = new FlightsService({ db }, {}, {});
    assert.equal((await flights.findAll({})).filter((row) => row.flightNumber === 'FS7151').length, 2);
    assert.ok(events.some((event) => event.type === 'created'));
  });

  await t.test('edits retain both occurrences; removed and expired slots leave the board', async () => {
    const changed = draft.entries.map((entry) => ({ ...entry }));
    changed.find((entry) => entry.weekday === 5 && entry.flightNumber === 'FS7151' && entry.time === '19:40').time = '19:55';
    changed.find((entry) => entry.weekday === 5 && entry.flightNumber === 'IH3107').validTo = '2026-11-05';
    const withoutOne = changed.filter((entry) => !(entry.weekday === 5 && entry.flightNumber === 'IH3108'));
    assert.equal((await save({ entries: withoutOne })).status, 200);
    assert.deepEqual(state.flights.filter((row) => row.flightNumber === 'FS7151').map((row) => row.scheduledTime.toISOString()).sort(), ['2026-11-06T08:20:00.000Z', '2026-11-06T14:55:00.000Z']);
    assert.equal(state.flights.some((row) => row.flightNumber.startsWith('IH')), false);
    assert.ok(events.some((event) => event.type === 'deleted'));
  });

  await t.test('provider updates match the published times and keep repeated flight numbers separate', () => {
    const service = module.get(FlightSyncService);
    const dto = (time, status) => ({ flightNumber: 'FS7151', direction: 'arrival', scheduledTime: new Date(`2026-11-06T${time}:00Z`), airlineName: 'FlyArystan', status });
    const daytime = dto('08:20', 'arrived');
    const evening = dto('14:55', 'scheduled');
    const list = service.dedupeProviderFlights([daytime, { ...daytime, status: 'scheduled' }, evening]);
    assert.equal(list.length, 2);
    assert.equal(list[0].status, 'arrived');
    assert.equal(service.withOfficialPlan(evening).scheduledTime.toISOString(), '2026-11-06T14:55:00.000Z');
  });

  await t.test('database failures roll back the new plan and photo together', async () => {
    const before = await (await fetch(base)).json();
    db.failNextInsert = true;
    const response = await save({ entries: draft.entries, photoUrl: '' });
    assert.equal(response.status, 500);
    assert.deepEqual(await (await fetch(base)).json(), before);
  });

  await t.test('invalid saves and failed image reads preserve published data and remove rejected files', async () => {
    const before = await (await fetch(base)).json();
    const filesBefore = await readdir(path.join(directory, 'uploads', 'schedules'));
    assert.equal((await save({ entries: [{ ...draft.entries[0], time: '99:99' }] })).status, 400);
    assert.equal((await upload(Buffer.from('broken png'))).status, 400);
    assert.equal((await upload(Buffer.from('not an image'), 'text/plain', 'payload.txt')).status, 400);
    assert.deepEqual(await (await fetch(base)).json(), before);
    assert.deepEqual(await readdir(path.join(directory, 'uploads', 'schedules')), filesBefore);
  });

  await t.test('an explicitly saved empty plan stays empty on reload and sync', async () => {
    assert.equal((await save({ entries: [] })).status, 200);
    assert.equal(state.flights.length, 0);
    const board = await (await fetch(base)).json();
    assert.equal(board.source, 'custom');
    assert.deepEqual(board.entries, []);
    await module.get(FlightSyncService).seedPlannedFlightsForToday();
    assert.equal(state.flights.length, 0);
  });
});
