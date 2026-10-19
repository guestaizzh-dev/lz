ALTER TABLE "CourseChapter" ADD COLUMN "subtitleText" text NOT NULL DEFAULT '' CHECK (length("subtitleText")<=200000);
ALTER TABLE "Lesson" ADD COLUMN "subtitleText" text NOT NULL DEFAULT '' CHECK (length("subtitleText")<=200000);
ALTER TABLE "LiveReplay" ADD COLUMN "subtitleText" text NOT NULL DEFAULT '' CHECK (length("subtitleText")<=200000);
ALTER TABLE "LiveReplay" ADD COLUMN notes text NOT NULL DEFAULT '' CHECK (length(notes)<=50000);
CREATE FUNCTION protect_lesson_subtitles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."subtitleText" IS DISTINCT FROM OLD."subtitleText" THEN RAISE EXCEPTION 'Published lesson subtitles are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Lesson_subtitles_immutable" BEFORE UPDATE ON "Lesson" FOR EACH ROW EXECUTE FUNCTION protect_lesson_subtitles();
