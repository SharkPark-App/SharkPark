-- CreateEnum
CREATE TYPE "ValidationEventType" AS ENUM ('SPEED_CHANGE', 'STATIONARY', 'WALKING', 'DRIVING', 'BLUETOOTH_CONNECT', 'BLUETOOTH_DISCONNECT', 'GEOFENCE_ENTER', 'GEOFENCE_EXIT', 'GPS_ACCURACY_CHANGE');

-- CreateEnum
CREATE TYPE "BluetoothState" AS ENUM ('CONNECTED', 'DISCONNECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('ANALYZING', 'PARKED', 'DROVE_THROUGH', 'SEARCHING', 'UNKNOWN');

-- CreateTable
CREATE TABLE "validation_events" (
    "id" TEXT NOT NULL,
    "device_hash" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "event_type" "ValidationEventType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "speed_mph" DOUBLE PRECISION,
    "accuracy_meters" DOUBLE PRECISION,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "bluetooth_state" "BluetoothState",
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_sessions" (
    "id" TEXT NOT NULL,
    "device_hash" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "enter_time" TIMESTAMP(3) NOT NULL,
    "exit_time" TIMESTAMP(3),
    "validation_status" "ValidationStatus" NOT NULL DEFAULT 'ANALYZING',
    "confidence_score" DOUBLE PRECISION,
    "occupancy_contribution" BOOLEAN NOT NULL DEFAULT false,
    "speed_transition_score" DOUBLE PRECISION,
    "dwell_time_score" DOUBLE PRECISION,
    "movement_pattern_score" DOUBLE PRECISION,
    "bluetooth_score" DOUBLE PRECISION,
    "validation_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_validation_device_time" ON "validation_events"("device_hash", "lot_id", "timestamp");

-- CreateIndex
CREATE INDEX "idx_validation_lot_time" ON "validation_events"("lot_id", "timestamp");

-- CreateIndex
CREATE INDEX "idx_sessions_device_time" ON "parking_sessions"("device_hash", "enter_time");

-- CreateIndex
CREATE INDEX "idx_sessions_lot_time" ON "parking_sessions"("lot_id", "enter_time");

-- CreateIndex
CREATE INDEX "idx_sessions_status" ON "parking_sessions"("validation_status");

-- AddForeignKey
ALTER TABLE "validation_events" ADD CONSTRAINT "validation_events_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
