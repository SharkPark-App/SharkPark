-- CreateEnum: BuildingCategory
CREATE TYPE "BuildingCategory" AS ENUM (
  'ACADEMIC',
  'ADMINISTRATIVE',
  'HOUSING',
  'RETAIL',
  'ATHLETIC',
  'OUTDOOR',
  'OTHER'
);

-- AlterTable: add Building.category, default OTHER for any pre-existing rows
ALTER TABLE "buildings"
  ADD COLUMN "category" "BuildingCategory" NOT NULL DEFAULT 'OTHER';
