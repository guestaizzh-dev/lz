CREATE TABLE "MediaUpload" (
  "id" text PRIMARY KEY, "uploaderId" text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "fingerprint" text NOT NULL, "name" text NOT NULL, "mime" text NOT NULL,
  "bytes" integer NOT NULL CHECK ("bytes" BETWEEN 1 AND 2147483647),
  "receivedBytes" integer NOT NULL DEFAULT 0 CHECK ("receivedBytes" >= 0 AND "receivedBytes" <= "bytes"),
  "state" text NOT NULL DEFAULT 'UPLOADING' CHECK ("state" IN ('UPLOADING','PROCESSING','READY','FAILED','CANCELLED')),
  "assetId" text UNIQUE REFERENCES "MediaAsset"(id) ON DELETE RESTRICT,
  "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "leaseUntil" timestamptz(6), "leaseToken" text, "failure" text,
  "createdAt" timestamptz(6) NOT NULL DEFAULT now(), "updatedAt" timestamptz(6) NOT NULL DEFAULT now(),
  "expiresAt" timestamptz(6) NOT NULL
);
CREATE INDEX "MediaUpload_uploaderId_fingerprint_state_idx" ON "MediaUpload"("uploaderId","fingerprint","state");
CREATE INDEX "MediaUpload_state_leaseUntil_idx" ON "MediaUpload"("state","leaseUntil");
