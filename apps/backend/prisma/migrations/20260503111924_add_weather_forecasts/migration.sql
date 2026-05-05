-- CreateTable
CREATE TABLE "weather_forecasts" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "target_time" TIMESTAMP(3) NOT NULL,
    "temperature_f" DOUBLE PRECISION NOT NULL,
    "precipitation_probability" DOUBLE PRECISION NOT NULL,
    "is_raining" BOOLEAN NOT NULL,
    "wind_speed_mph" DOUBLE PRECISION NOT NULL,
    "conditions" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weather_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weather_forecasts_school_id_target_time_key" ON "weather_forecasts"("school_id", "target_time");

-- AddForeignKey
ALTER TABLE "weather_forecasts" ADD CONSTRAINT "weather_forecasts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
