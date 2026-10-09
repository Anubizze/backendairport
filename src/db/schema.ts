import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'superadmin',
  'dispatcher',
  'news_editor',
]);

export const flightDirectionEnum = pgEnum('flight_direction', [
  'arrival',
  'departure',
]);

export const flightStatusEnum = pgEnum('flight_status', [
  'scheduled',
  'checkin',
  'boarding',
  'departed',
  'delayed',
  'cancelled',
  'landing',
  'landed',
  'arrived',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('dispatcher'),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    usersEmailUnique: uniqueIndex('users_email_unique').on(table.email),
  }),
);

export const flights = pgTable('flights', {
  id: uuid('id').defaultRandom().primaryKey(),
  flightNumber: varchar('flight_number', { length: 32 }).notNull(),
  airlineName: varchar('airline_name', { length: 120 }).notNull(),
  airlineCode: varchar('airline_code', { length: 8 }).notNull(),
  direction: flightDirectionEnum('direction').notNull(),
  city: varchar('city', { length: 120 }).notNull(),
  cityCode: varchar('city_code', { length: 8 }).notNull(),
  terminal: varchar('terminal', { length: 16 }).notNull().default('1'),
  sector: varchar('sector', { length: 16 }),
  gate: varchar('gate', { length: 16 }),
  scheduledTime: timestamp('scheduled_time', { withTimezone: true }).notNull(),
  estimatedTime: timestamp('estimated_time', { withTimezone: true }),
  status: flightStatusEnum('status').notNull().default('scheduled'),
  scheduleLocked: boolean('schedule_locked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const flightScheduleEntries = pgTable('flight_schedule_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  weekday: smallint('weekday').notNull(),
  flightNumber: varchar('flight_number', { length: 32 }).notNull(),
  direction: flightDirectionEnum('direction').notNull(),
  city: varchar('city', { length: 120 }).notNull(),
  planTime: varchar('plan_time', { length: 5 }).notNull(),
});

export const airlines = pgTable(
  'airlines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    code: varchar('code', { length: 8 }).notNull(),
    logoUrl: text('logo_url'),
    websiteUrl: text('website_url'),
    description: varchar('description', { length: 255 }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    airlinesCodeUnique: uniqueIndex('airlines_code_unique').on(table.code),
  }),
);

export const servicePriceContent = pgTable('service_price_content', {
  id: integer('id').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const scheduleBoard = pgTable('schedule_board', {
  id: integer('id').primaryKey(),
  photoUrl: text('photo_url'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const flightStatusHistory = pgTable('flight_status_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  flightId: uuid('flight_id')
    .notNull()
    .references(() => flights.id, { onDelete: 'cascade' }),
  previousStatus: flightStatusEnum('previous_status'),
  newStatus: flightStatusEnum('new_status').notNull(),
  changedByUserId: uuid('changed_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const flightSubscriptions = pgTable(
  'flight_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    flightId: uuid('flight_id')
      .notNull()
      .references(() => flights.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    flightSubscriptionsUnique: uniqueIndex(
      'flight_subscriptions_flight_email_unique',
    ).on(table.flightId, table.email),
  }),
);

export const notificationLog = pgTable('notification_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  subscriptionId: uuid('subscription_id').references(
    () => flightSubscriptions.id,
    {
      onDelete: 'set null',
    },
  ),
  flightId: uuid('flight_id').references(() => flights.id, {
    onDelete: 'set null',
  }),
  statusSent: flightStatusEnum('status_sent').notNull(),
  channel: varchar('channel', { length: 32 }).notNull().default('email'),
  wasSuccessful: integer('was_successful').notNull().default(1),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const newsArticles = pgTable(
  'news_articles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceUrl: text('source_url').notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt').notNull(),
    content: text('content').notNull(),
    imageUrl: text('image_url'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    publishedLabel: varchar('published_label', { length: 128 }),
    category: varchar('category', { length: 32 }).notNull().default('news'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    newsArticlesSourceUrlUnique: uniqueIndex('news_articles_source_url_unique').on(
      table.sourceUrl,
    ),
  }),
);

export const vacancies = pgTable('vacancies', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  department: varchar('department', { length: 120 }).notNull(),
  employmentType: varchar('employment_type', { length: 64 })
    .notNull()
    .default('Полная занятость'),
  salaryText: varchar('salary_text', { length: 128 }).notNull(),
  description: text('description'),
  contactPhone: varchar('contact_phone', { length: 32 })
    .notNull()
    .default('87222360033'),
  isPublished: boolean('is_published').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const vacancyApplications = pgTable('vacancy_applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  vacancyId: uuid('vacancy_id')
    .notNull()
    .references(() => vacancies.id, { onDelete: 'cascade' }),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 32 }).notNull(),
  email: varchar('email', { length: 255 }),
  message: text('message'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const servicePhotos = pgTable('service_photos', {
  id: uuid('id').defaultRandom().primaryKey(),
  serviceId: varchar('service_id', { length: 64 }).notNull(),
  url: text('url').notNull(),
  altRu: varchar('alt_ru', { length: 255 }),
  altKz: varchar('alt_kz', { length: 255 }),
  altEn: varchar('alt_en', { length: 255 }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const partnerDocuments = pgTable('partner_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  year: integer('year').notNull(),
  titleRu: varchar('title_ru', { length: 255 }).notNull(),
  titleKz: varchar('title_kz', { length: 255 }),
  titleEn: varchar('title_en', { length: 255 }),
  url: text('url').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublished: boolean('is_published').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const fuelStorageContent = pgTable(
  'fuel_storage_content',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    contentKey: varchar('content_key', { length: 32 }).notNull().default('default'),
    capacityDate: varchar('capacity_date', { length: 32 }),
    capacityTons: varchar('capacity_tons', { length: 64 }),
    priceRowsJson: text('price_rows_json').notNull().default('[]'),
    priceRowsRuJson: text('price_rows_ru_json').notNull().default('[]'),
    priceRowsKzJson: text('price_rows_kz_json').notNull().default('[]'),
    priceRowsEnJson: text('price_rows_en_json').notNull().default('[]'),
    documentsJson: text('documents_json').notNull().default('[]'),
    documentsRuJson: text('documents_ru_json').notNull().default('[]'),
    documentsKzJson: text('documents_kz_json').notNull().default('[]'),
    documentsEnJson: text('documents_en_json').notNull().default('[]'),
    submitEmail: varchar('submit_email', { length: 255 })
      .notNull()
      .default('airportsemey@mail.kz'),
    contactPhone: varchar('contact_phone', { length: 64 })
      .notNull()
      .default('8 (7222) 36-00-33'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    fuelStorageContentKeyUnique: uniqueIndex('fuel_storage_content_key_unique').on(
      table.contentKey,
    ),
  }),
);

export const feedbackMessages = pgTable('feedback_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  message: text('message').notNull(),
  emailSent: boolean('email_sent').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const flightRelations = relations(flights, ({ many }) => ({
  statusHistory: many(flightStatusHistory),
  subscriptions: many(flightSubscriptions),
}));
