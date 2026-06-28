import {
  mysqlTable, varchar, int, text, timestamp, json, tinyint,
} from "drizzle-orm/mysql-core";

// ── Override requests ─────────────────────────────────────────────────
export const parceliqOverrides = mysqlTable("parceliq_overrides", {
  id:           varchar("id",          { length: 36  }).primaryKey(),
  parcelPin:    varchar("parcel_pin",  { length: 64  }).notNull(),
  address:      varchar("address",     { length: 255 }),
  currentVal:   int("current_val"),
  proposedVal:  int("proposed_val"),
  modelVal:     int("model_val"),
  reason:       text("reason"),
  submittedBy:  varchar("submitted_by",{ length: 128 }),
  status:       varchar("status",      { length: 32  }).notNull().default("pending"),
  reviewedBy:   varchar("reviewed_by", { length: 128 }),
  reviewNote:   text("review_note"),
  reviewedAt:   timestamp("reviewed_at"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

// ── Audit log ─────────────────────────────────────────────────────────
export const parceliqAudit = mysqlTable("parceliq_audit", {
  id:          varchar("id",          { length: 36  }).primaryKey(),
  eventType:   varchar("event_type",  { length: 64  }).notNull(),
  parcelPin:   varchar("parcel_pin",  { length: 64  }),
  userName:    varchar("user_name",   { length: 128 }),
  description: text("description"),
  metadata:    json("metadata"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

// ── County configurations (for multi-county SaaS scaling) ─────────────
export const parceliqCounties = mysqlTable("parceliq_counties", {
  id:              int("id").autoincrement().primaryKey(),
  name:            varchar("name",           { length: 128 }).notNull(),
  state:           varchar("state",          { length: 2   }).notNull(),
  fipsCode:        varchar("fips_code",      { length: 10  }),
  gisFeatureUrl:   varchar("gis_feature_url",{ length: 512 }),
  totalAssessedValue: int("total_assessed_value_millions"),
  targetRevenue:   int("target_revenue"),
  totalParcels:    int("total_parcels"),
  active:          tinyint("active").notNull().default(1),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});
