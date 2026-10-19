ALTER TABLE "LiveSession" ADD COLUMN "providerEventAt" timestamptz,
  ADD COLUMN "providerSequence" text, ADD COLUMN "providerStreamSid" text, ADD COLUMN "disconnectedAt" timestamptz,
  ADD COLUMN "providerCheckedAt" timestamptz;
CREATE INDEX "LiveSession_state_providerCheckedAt_idx" ON "LiveSession"(state,"providerCheckedAt");
CREATE INDEX "LiveSession_roomId_scheduledAt_idx" ON "LiveSession"("roomId","scheduledAt");
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_state_check"
 CHECK (state IN ('SCHEDULED','PREPARING','LIVE','ENDED','REPLAY_READY','CANCELLED'));
CREATE TABLE "LiveRtcLease" (
 id text PRIMARY KEY, "sessionId" text NOT NULL REFERENCES "LiveSession"(id),
 "authSessionId" text NOT NULL REFERENCES "AuthSession"(id), "userId" text NOT NULL REFERENCES "User"(id),
 "rtcUserId" text NOT NULL, role text NOT NULL CHECK(role IN ('VIEWER','HOST')),
 "keyHash" text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL, "absoluteExpiresAt" timestamptz NOT NULL,
 "revokedAt" timestamptz, "kickedAt" timestamptz,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "LiveRtcLease_kickedAt_expiresAt_idx" ON "LiveRtcLease"("kickedAt","expiresAt");
CREATE INDEX "LiveRtcLease_sessionId_userId_idx" ON "LiveRtcLease"("sessionId","userId");
ALTER TABLE "Comment" ADD COLUMN "liveSessionId" text REFERENCES "LiveSession"(id),
 ADD COLUMN "requestKey" text,
 ADD CONSTRAINT "Comment_live_content_check" CHECK ("liveSessionId" IS NULL OR
   (length(btrim(body)) BETWEEN 1 AND 1000 AND "requestKey" IS NOT NULL AND "parentId" IS NULL));
CREATE UNIQUE INDEX "Comment_liveSessionId_authorId_requestKey_key" ON "Comment"("liveSessionId","authorId","requestKey");
CREATE INDEX "Comment_liveSessionId_createdAt_id_idx" ON "Comment"("liveSessionId","createdAt",id);
