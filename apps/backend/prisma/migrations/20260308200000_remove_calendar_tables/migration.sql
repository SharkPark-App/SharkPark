-- DropForeignKey
ALTER TABLE "academic_calendar" DROP CONSTRAINT IF EXISTS "academic_calendar_school_id_fkey";

-- DropForeignKey
ALTER TABLE "campus_closures" DROP CONSTRAINT IF EXISTS "campus_closures_school_id_fkey";

-- DropForeignKey
ALTER TABLE "campus_activity_baselines" DROP CONSTRAINT IF EXISTS "campus_activity_baselines_school_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "academic_calendar";

-- DropTable
DROP TABLE IF EXISTS "campus_closures";

-- DropTable
DROP TABLE IF EXISTS "campus_activity_baselines";
