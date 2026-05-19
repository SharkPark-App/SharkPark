-- AlterTable
ALTER TABLE "lots" ADD COLUMN     "park_mobile_zones" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- RenameIndex
ALTER INDEX "course_meetings_school_id_term_subject_code_course_code_section" RENAME TO "course_meetings_school_id_term_subject_code_course_code_sec_key";
