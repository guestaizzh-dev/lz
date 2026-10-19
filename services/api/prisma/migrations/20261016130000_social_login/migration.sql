BEGIN;
ALTER TABLE "AuthIdentity" ADD COLUMN "refreshCipher" text;
CREATE TABLE "SocialChallenge" (
 "id" text PRIMARY KEY,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "provider" text NOT NULL CHECK ("provider" IN ('WECHAT','APPLE')),
 "appScope" text NOT NULL,
 "stateHash" text NOT NULL CHECK ("stateHash" ~ '^[a-f0-9]{64}$'),
 "userId" text REFERENCES "User"("id"),
 "sessionId" text REFERENCES "AuthSession"("id"),
 "codeHash" text UNIQUE,
 "subjectHash" text,
 "refreshCipher" text,
 "verifiedAt" timestamptz,
 "finishedAt" timestamptz,
 "expiresAt" timestamptz NOT NULL,
 CHECK (("userId" IS NULL)=("sessionId" IS NULL)),
 CHECK ("verifiedAt" IS NULL OR ("subjectHash" IS NOT NULL AND "codeHash" IS NOT NULL)),
 CHECK ("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '10 minutes')
);
CREATE INDEX "SocialChallenge_expiresAt_idx" ON "SocialChallenge"("expiresAt");
COMMIT;
