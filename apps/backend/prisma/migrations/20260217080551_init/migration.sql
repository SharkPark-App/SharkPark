-- CreateEnum
CREATE TYPE "LotType" AS ENUM ('STUDENT', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('STUDENT', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('ENTER', 'EXIT');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CampusEventType" AS ENUM ('ATHLETIC', 'ACADEMIC', 'PERFORMANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ImpactLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "schools" (
    "id" TEXT NOT NULL,
    "school_name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "lot_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "lot_number" TEXT NOT NULL,
    "lot_type" "LotType" NOT NULL,
    "capacity" INTEGER NOT NULL,
    "current_occupancy" INTEGER NOT NULL DEFAULT 0,
    "location_description" TEXT NOT NULL,
    "building_proximity" TEXT[],
    "center_lat" DOUBLE PRECISION NOT NULL,
    "center_lng" DOUBLE PRECISION NOT NULL,
    "geofence_polygon" JSONB NOT NULL,
    "geofence_radius" DOUBLE PRECISION NOT NULL,
    "permit_types" TEXT[],
    "daily_permit_allowed" BOOLEAN NOT NULL DEFAULT false,
    "daily_rate" DOUBLE PRECISION,
    "hours_weekday" JSONB NOT NULL,
    "hours_saturday" JSONB NOT NULL,
    "hours_sunday" JSONB NOT NULL,
    "ev_charging_stations" INTEGER NOT NULL DEFAULT 0,
    "motorcycle_spaces" INTEGER NOT NULL DEFAULT 0,
    "accessible_spaces" INTEGER NOT NULL DEFAULT 0,
    "has_lighting" BOOLEAN NOT NULL DEFAULT true,
    "has_cameras" BOOLEAN NOT NULL DEFAULT false,
    "has_emergency_phone" BOOLEAN NOT NULL DEFAULT false,
    "is_covered" BOOLEAN NOT NULL DEFAULT false,
    "is_paved" BOOLEAN NOT NULL DEFAULT true,
    "levels" INTEGER,
    "penetration_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_turnover_minutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'LOW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "user_type" "UserType" NOT NULL,
    "phone" TEXT,
    "notification_preferences" JSONB NOT NULL DEFAULT '{"favorites_filling":false,"favorites_clearing":false,"surge_alerts":false,"event_alerts":false}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupancy_events" (
    "id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "event_type" "EventType" NOT NULL,
    "device_hash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occupancy_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupancy_snapshots" (
    "id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "occupancy" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    "occupancy_rate" DOUBLE PRECISION NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "reliability_score" DOUBLE PRECISION,
    "is_cold_start" BOOLEAN,
    "academic_period" TEXT,
    "week_of_semester" INTEGER,
    "is_campus_open" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "occupancy_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_states" (
    "id" TEXT NOT NULL,
    "device_hash" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "last_event_type" "EventType" NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_events" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "event_type" "CampusEventType" NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "expected_attendance" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campus_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_impacts" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "impact_level" "ImpactLevel" NOT NULL,
    "expected_increase_percent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "event_impacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_calendar" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "period_name" TEXT NOT NULL,
    "period_type" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_closures" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campus_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "temperature_f" DOUBLE PRECISION NOT NULL,
    "feels_like_f" DOUBLE PRECISION NOT NULL,
    "humidity_percent" DOUBLE PRECISION NOT NULL,
    "wind_speed_mph" DOUBLE PRECISION NOT NULL,
    "conditions" TEXT NOT NULL,
    "precipitation_probability" DOUBLE PRECISION NOT NULL,
    "is_raining" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weather_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictions_short_term" (
    "id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "predicted_at" TIMESTAMP(3) NOT NULL,
    "target_time" TIMESTAMP(3) NOT NULL,
    "predicted_occupancy" INTEGER NOT NULL,
    "confidence_lower" INTEGER NOT NULL,
    "confidence_upper" INTEGER NOT NULL,
    "model_version" TEXT NOT NULL,

    CONSTRAINT "predictions_short_term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictions_long_term" (
    "id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "predicted_at" TIMESTAMP(3) NOT NULL,
    "target_date" TIMESTAMP(3) NOT NULL,
    "target_hour" INTEGER NOT NULL,
    "predicted_occupancy" INTEGER NOT NULL,
    "confidence_lower" INTEGER NOT NULL,
    "confidence_upper" INTEGER NOT NULL,
    "model_version" TEXT NOT NULL,

    CONSTRAINT "predictions_long_term_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schools_school_name_key" ON "schools"("school_name");

-- CreateIndex
CREATE UNIQUE INDEX "schools_short_name_key" ON "schools"("short_name");

-- CreateIndex
CREATE INDEX "idx_lots_type" ON "lots"("lot_type");

-- CreateIndex
CREATE UNIQUE INDEX "lots_school_id_lot_id_key" ON "lots"("school_id", "lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_favorites_user_id_lot_id_key" ON "user_favorites"("user_id", "lot_id");

-- CreateIndex
CREATE INDEX "idx_events_lot_time" ON "occupancy_events"("lot_id", "timestamp");

-- CreateIndex
CREATE INDEX "idx_events_device" ON "occupancy_events"("device_hash", "lot_id");

-- CreateIndex
CREATE INDEX "idx_snapshots_lot_time" ON "occupancy_snapshots"("lot_id", "timestamp");

-- CreateIndex
CREATE INDEX "idx_snapshots_training" ON "occupancy_snapshots"("lot_id", "timestamp", "academic_period");

-- CreateIndex
CREATE UNIQUE INDEX "device_states_device_hash_lot_id_key" ON "device_states"("device_hash", "lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_impacts_event_id_lot_id_key" ON "event_impacts"("event_id", "lot_id");

-- CreateIndex
CREATE INDEX "weather_school_id_timestamp_idx" ON "weather"("school_id", "timestamp");

-- CreateIndex
CREATE INDEX "idx_pred_short" ON "predictions_short_term"("lot_id", "target_time");

-- CreateIndex
CREATE INDEX "idx_pred_long" ON "predictions_long_term"("lot_id", "target_date", "target_hour");

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupancy_events" ADD CONSTRAINT "occupancy_events_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupancy_snapshots" ADD CONSTRAINT "occupancy_snapshots_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_states" ADD CONSTRAINT "device_states_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_events" ADD CONSTRAINT "campus_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_impacts" ADD CONSTRAINT "event_impacts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "campus_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_impacts" ADD CONSTRAINT "event_impacts_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_calendar" ADD CONSTRAINT "academic_calendar_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_closures" ADD CONSTRAINT "campus_closures_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather" ADD CONSTRAINT "weather_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions_short_term" ADD CONSTRAINT "predictions_short_term_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions_long_term" ADD CONSTRAINT "predictions_long_term_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
