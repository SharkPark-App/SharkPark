-- Add optional description and event_url to campus_events.
-- Both are nullable so existing rows are unaffected; the scraper populates them going forward.

ALTER TABLE "campus_events" ADD COLUMN "description" TEXT;
ALTER TABLE "campus_events" ADD COLUMN "event_url"   TEXT;
