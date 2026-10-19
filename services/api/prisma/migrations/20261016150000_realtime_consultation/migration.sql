CREATE TABLE "ConsultRtcLease" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "appointmentId" text NOT NULL REFERENCES "Appointment"(id),
  "authSessionId" text NOT NULL REFERENCES "AuthSession"(id),
  "userId" text NOT NULL REFERENCES "User"(id),
  "rtcUserId" text NOT NULL,
  role text NOT NULL CHECK(role IN ('TEACHER','STUDENT')),
  "keyHash" text NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "absoluteExpiresAt" timestamptz NOT NULL,
  "revokedAt" timestamptz,
  "kickedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "ConsultRtcLease_appointmentId_userId_idx" ON "ConsultRtcLease"("appointmentId","userId");
CREATE INDEX "ConsultRtcLease_kickedAt_expiresAt_idx" ON "ConsultRtcLease"("kickedAt","expiresAt");
CREATE UNIQUE INDEX "LiveMicRequest_active_user" ON "LiveMicRequest"("sessionId","userId") WHERE state IN ('WAITING','APPROVED','CONNECTED');
