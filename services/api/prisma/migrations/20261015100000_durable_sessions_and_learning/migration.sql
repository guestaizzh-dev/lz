-- Nullable additions preserve old clients and all existing business records.
ALTER TABLE "ConsumedRefresh" ADD COLUMN "requestHash" text, ADD COLUMN "resultCipher" text;
ALTER TABLE "CohortStudyProgress" ADD COLUMN "lastEventAt" timestamptz(6);
UPDATE "StudyProgress" SET "lastEventAt" = "updatedAt" AT TIME ZONE 'UTC' WHERE "lastEventAt" IS NULL;
UPDATE "CohortStudyProgress" SET "lastEventAt" = "updatedAt" WHERE "lastEventAt" IS NULL;
