-- Sports events scraped from Sidearm only have a published start_time; the
-- 3-hour synthetic end_time was a guess. Make end_time optional so the
-- sports scraper can leave it null at create time and the FINAL-score
-- refresh cron can backfill it with the actual finish timestamp.
-- CampusLabs (academic / club) events still set a real end_time.
ALTER TABLE "campus_events" ALTER COLUMN "end_time" DROP NOT NULL;
