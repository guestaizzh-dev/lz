ALTER TABLE "CourseRelease"
  ADD COLUMN "withdrawnAt" timestamptz,
  ADD COLUMN "withdrawalReason" text,
  ADD COLUMN "replacementReleaseId" text REFERENCES "CourseRelease"(id),
  ADD COLUMN "deliveryVersion" integer NOT NULL DEFAULT 1 CHECK ("deliveryVersion">0),
  ADD CONSTRAINT course_withdrawal_consistency CHECK (("withdrawnAt" IS NULL AND "withdrawalReason" IS NULL AND "replacementReleaseId" IS NULL) OR ("withdrawnAt" IS NOT NULL AND length(trim("withdrawalReason"))>=2));
ALTER TABLE "CourseRelease" ADD CONSTRAINT course_replacement_same_course FOREIGN KEY ("replacementReleaseId","courseId") REFERENCES "CourseRelease" (id,"courseId"), ADD CONSTRAINT course_replacement_other CHECK ("replacementReleaseId" IS NULL OR "replacementReleaseId"<>id);
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_id_userId_courseId_key" UNIQUE (id,"userId","courseId");
CREATE TABLE "CourseVersionChoice" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "userId" text NOT NULL REFERENCES "User"(id),
  "enrollmentId" text NOT NULL REFERENCES "Enrollment"(id),
  "grantKey" text NOT NULL CHECK (length("grantKey")>0),
  "courseId" text NOT NULL REFERENCES "Course"(id),
  "fromReleaseId" text NOT NULL REFERENCES "CourseRelease"(id),
  "toReleaseId" text NOT NULL REFERENCES "CourseRelease"(id),
  "requestKey" text NOT NULL,
  "requestHash" text NOT NULL,
  action text NOT NULL CHECK (action IN ('UPGRADE','RESTORE','REPLACEMENT')),
  "consentSnapshot" jsonb NOT NULL,
  UNIQUE ("userId","requestKey"),
  CHECK ("fromReleaseId"<>"toReleaseId"),
  FOREIGN KEY ("fromReleaseId","courseId") REFERENCES "CourseRelease" (id,"courseId"),
  FOREIGN KEY ("toReleaseId","courseId") REFERENCES "CourseRelease" (id,"courseId"),
  FOREIGN KEY ("enrollmentId","userId","courseId") REFERENCES "Enrollment" (id,"userId","courseId")
);
CREATE INDEX "CourseVersionChoice_enrollmentId_createdAt_idx" ON "CourseVersionChoice" ("enrollmentId","createdAt");
