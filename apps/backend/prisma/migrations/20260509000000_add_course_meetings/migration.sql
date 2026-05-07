-- D1: CSULB course schedule rows scraped from the public Schedule of Classes.
-- Populated by services/ml/scripts/ingest_csulb_catalog.py (D2). Consumed by
-- D3 build_proximity_matrix.py and D4 synthetic_v2.py.
CREATE TABLE "course_meetings" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "subject_code" TEXT NOT NULL,
    "course_code" TEXT NOT NULL,
    "course_title" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "class_number" TEXT,
    "course_type" TEXT,
    "units" TEXT,
    "days_mask" INTEGER NOT NULL DEFAULT 0,
    "days_raw" TEXT,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "location_raw" TEXT,
    "building_id" TEXT,
    "room" TEXT,
    "instructor" TEXT,
    "enrollment" INTEGER,
    "enrollment_source" TEXT,
    "room_capacity" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_meetings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_meetings_school_id_term_subject_code_course_code_section_key"
    ON "course_meetings" ("school_id", "term", "subject_code", "course_code", "section");

CREATE INDEX "course_meetings_school_id_term_idx"
    ON "course_meetings" ("school_id", "term");

CREATE INDEX "course_meetings_school_id_term_days_mask_idx"
    ON "course_meetings" ("school_id", "term", "days_mask");

CREATE INDEX "course_meetings_building_id_idx"
    ON "course_meetings" ("building_id");

ALTER TABLE "course_meetings"
    ADD CONSTRAINT "course_meetings_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_meetings"
    ADD CONSTRAINT "course_meetings_building_id_fkey"
    FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
