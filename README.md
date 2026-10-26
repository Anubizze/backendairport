## Backend (NestJS + Drizzle + PostgreSQL + Redis)

### Timetable photo import

`GET /api/schedule` is public and returns the published weekly plan. The write
endpoints (`PUT /api/schedule`, `POST /api/schedule/photo`, `POST /api/schedule/sync`)
require a dispatcher or superadmin session.

Photo upload accepts JPEG, PNG, WebP or GIF up to 8 MB. It returns a draft
`{ photoUrl, entries, warnings }`; it does not change the published board. Save
the reviewed entries and `photoUrl` together with `PUT /api/schedule` to publish.
Each entry includes `weekday` (Sunday = 0), `flightNumber`, `direction`, `city`,
`time` (Semey local time), optional `counterpartTime`, `validFrom` and `validTo`
(`YYYY-MM-DD`). Repeated flight numbers at different times are separate occurrences.
Empty plans remain empty across restarts. Invalid images leave the existing plan intact.

After updating, install dependencies from `pnpm-lock.yaml`, build and restart the
API. Node.js 20.9 or newer is required by Sharp. Schema additions are applied once
at startup by `FlightSyncService`; no separate manual SQL step is needed.
Tesseract uses the packaged Russian and English models with no runtime downloads
or external OCR API key. Keep `uploads/` persistent and writable.

Run `npm run test:schedule` for parser validation and a local HTTP integration
test with real PNG recognition, preview, saving, public reads and failed uploads.
PostgreSQL uses an in-memory boundary; access guards simulate dispatcher and
unauthorized sessions. No production data is accessed.

This folder now contains a ready backend skeleton for the tender scope:

- NestJS API (`/api/*`)
- Drizzle ORM with PostgreSQL schema
- Redis connection config placeholder
- Flight management module with filtering
- Health endpoint

### 1) Install dependencies

```bash
cd backend
npm install
```

### 2) Start infrastructure

```bash
docker compose up -d
```

### 3) Configure environment

Copy `.env.example` to `.env` and adjust values if needed.

### 4) Apply migrations

Option A (recommended): generate + migrate from schema

```bash
npm run db:generate
npm run db:migrate
```

Option B (manual SQL baseline):

Apply `drizzle/0000_initial_schema.sql` in your PostgreSQL database.

### 5) Start backend

```bash
npm run start:dev
```

Server base URL:

- `http://localhost:4000/api`

Key endpoints:

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me` (requires Bearer token)
- `GET /api/flights?direction=arrival&search=astana`
- `GET /api/flights/stream` (SSE realtime)
- `GET /api/flights/:id`
- `POST /api/flights` (requires Bearer token)
- `PATCH /api/flights/:id` (requires Bearer token)
- `DELETE /api/flights/:id` (requires Bearer token)
- `POST /api/subscriptions` (public flight email subscription)
- `GET /api/news/akorda?limit=12` (stored/synced Akorda news)
- `GET /api/news/abay?limit=12` (stored/synced Abay Akimat news)

### Auto sync of flights (free-tier API)

Backend can auto-pull flights from AviationStack (free plan available):

- `FLIGHT_SYNC_ENABLED=true`
- `FLIGHT_SYNC_INTERVAL_MS=300000` (every 5 min)
- `FLIGHT_SYNC_AIRPORT_IATA=PLX` (Semey airport IATA)
- `AVIATIONSTACK_ACCESS_KEY=...` (required)
- `FLIGHT_SYNC_ALLOWED_ROUTES=KC7352:departure:astana,KC7351:arrival:astana` (optional)

When key is configured, backend periodically imports arrivals/departures
and updates local `flights` table automatically.

### Auto sync of Akorda + Abay news

Backend stores Akorda and Abay Akimat news in local PostgreSQL table `news_articles`
and keeps it updated automatically:

- `NEWS_SYNC_ENABLED=true`
- `NEWS_SYNC_INTERVAL_MS=300000` (every 5 min)
- `NEWS_SYNC_FETCH_LIMIT=30` (how many latest items to sync)
- `ABAY_NEWS_SEED_IDS=952578,969425` (fallback detail IDs if gov.kz listing blocks parsing)

On startup backend creates table/index if they are missing and performs
an initial sync.

### Admin credentials

Set in `.env`:

- `ADMIN_LOGIN` (default: `admin`)
- `ADMIN_PASSWORD` (default: `admin123`)

### Email notifications

Configure SMTP in `.env`:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

### Фото услуг: маршруты, редактирование и хранение

Фронтенд обращается к файлам через `${NEXT_PUBLIC_API_BASE_URL}/uploads/...`, например
`https://abaiairport.kz/api/uploads/services/<имя>.jpeg`. Прокси должен отправлять
`/api/*` в NestJS. В `src/main.ts` уже зарегистрирована раздача `/api/uploads`
из каталога `uploads` в рабочей директории процесса. Старый адрес `/uploads/*`
на общем домене может попадать во фронтенд Next.js и возвращать HTML с кодом 404.

Для редактирования используется защищённый `PATCH /api/service-photos/:id` с
`multipart/form-data`: `serviceId`, `altRu`, `altKz`, `altEn`, `sortOrder` и
необязательный `file`. Без файла меняются только переданные поля. Новый файл
заменяет старый после успешного сохранения записи. Нужен деплой обоих проектов:
фронтенд находится в `airportsemey`, бэкенд — в отдельном репозитории `backendairport`.

В контейнере каталог `<рабочая директория приложения>/uploads` нужно подключить
как постоянный том. Записи в PostgreSQL не содержат сами изображения: наличие
записей в `/api/service-photos` не гарантирует наличие файлов на диске.

При проверке 21.10.2026 существующие изображения возвращали 404 как через
`/uploads/services/...`, так и через `/api/uploads/services/...`. Локально
сохранились все семь исходных JPEG. Архив для восстановления подготовлен в
`tmp/service-photos-recovery-2026-10-21.tar.gz`; он содержит только `services/*.jpeg`.
Если серверные файлы отсутствуют, распаковать архив в постоянный каталог `uploads`
с сохранением существующих имён (не переименовывать файлы: на них ссылается база).
Перед заменой существующих серверных файлов сохранить их копию. Проверить после
деплоя, что `/api/uploads/services/<имя>.jpeg` отвечает `200` с `Content-Type: image/jpeg`.

Проверки: `npm run test:service-photos` в бэкенде и во фронтенде. Бэкенд-тесты
используют временные файлы и подменённую базу данных, рабочие изображения не меняют.

When flight status changes, subscribers from `flight_subscriptions` receive email updates.
