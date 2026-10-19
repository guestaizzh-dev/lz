ALTER TABLE "CourseChapter" ADD COLUMN "liveSessionId" text;
ALTER TABLE "CourseChapter" ADD CONSTRAINT "CourseChapter_liveSessionId_fk" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession" (id);
ALTER TABLE "CourseChapter" ADD CONSTRAINT "CourseChapter_live_format" CHECK ("liveSessionId" IS NULL OR format='LIVE');
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_live_format" CHECK ("liveSessionId" IS NULL OR format='LIVE');
CREATE INDEX "Lesson_liveSessionId_idx" ON "Lesson" ("liveSessionId") WHERE "liveSessionId" IS NOT NULL;
-- Published delivery identity belongs to the purchased release, not the editable course draft.
CREATE FUNCTION protect_live_lesson_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."liveSessionId",NEW."releaseId",NEW.format,NEW."sourceId") IS DISTINCT FROM (OLD."liveSessionId",OLD."releaseId",OLD.format,OLD."sourceId") AND (OLD.format='LIVE' OR NEW.format='LIVE')
  THEN RAISE EXCEPTION 'Published live lesson session is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Lesson_live_binding_immutable" BEFORE UPDATE ON "Lesson" FOR EACH ROW EXECUTE FUNCTION protect_live_lesson_binding();

ALTER TABLE "LiveReplay" ADD COLUMN "durationSeconds" integer CHECK ("durationSeconds">0 AND "durationSeconds"<=86400);
