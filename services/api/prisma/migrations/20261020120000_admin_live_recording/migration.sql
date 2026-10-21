ALTER TABLE "LiveRoom" ALTER COLUMN "teacherId" DROP NOT NULL;
ALTER TABLE "LiveRoom" ADD COLUMN "managedByAdmin" boolean NOT NULL DEFAULT false;
ALTER TABLE "LiveRoom" ADD COLUMN cover text NOT NULL DEFAULT '';
-- Room metadata has no title/summary fields; the generic trigger erased the separately edited announcement.
-- All live creation paths already create Resource explicitly, with its composite FK enforcing identity.
DROP TRIGGER domain_live_resource ON "LiveRoom";
ALTER TABLE "LiveRoom" ADD CONSTRAINT live_managed_rule CHECK (NOT "managedByAdmin" OR ("teacherId" IS NULL AND "courseId" IS NULL AND "accessRule" @> '{"mode":"MEMBER","allMembers":true}'::jsonb));
CREATE TABLE "LiveRecording" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sessionId" text NOT NULL UNIQUE REFERENCES "LiveSession"(id),
  state text NOT NULL DEFAULT 'WAITING' CHECK (state IN ('WAITING','STARTING','ARMED','RECORDING','PROCESSING','READY','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  retries integer NOT NULL DEFAULT 0 CHECK (retries>=0),
  "leaseToken" text,
  "leaseUntil" timestamptz,
  "startedAt" timestamptz,
  "stoppedAt" timestamptz,
  "assetId" text REFERENCES "MediaAsset"(id),
  failure text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "LiveRecording_state_leaseUntil_idx" ON "LiveRecording"(state,"leaseUntil");
