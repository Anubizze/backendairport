## Backend (NestJS + Drizzle + PostgreSQL + Redis)

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

When flight status changes, subscribers from `flight_subscriptions` receive email updates.
