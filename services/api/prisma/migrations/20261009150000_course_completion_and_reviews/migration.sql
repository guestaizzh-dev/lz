CREATE TABLE "CourseCertificate" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" text NOT NULL REFERENCES "User"(id),
  "courseId" text NOT NULL REFERENCES "Course"(id),
  "releaseId" text NOT NULL REFERENCES "CourseRelease"(id),
  "courseTitle" text NOT NULL,
  "lessonCount" integer NOT NULL CHECK ("lessonCount">0),
  "completedAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId","releaseId")
);
CREATE TABLE "CourseReview" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" text NOT NULL REFERENCES "User"(id),
  "courseId" text NOT NULL REFERENCES "Course"(id),
  "releaseId" text NOT NULL REFERENCES "CourseRelease"(id),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  "reviewState" text NOT NULL DEFAULT 'PENDING' CHECK ("reviewState" IN ('PENDING','APPROVED','REJECTED','REMOVED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  "reviewerId" text REFERENCES "User"(id),
  "reviewedAt" timestamptz,
  "deletedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId","courseId")
);
CREATE INDEX "CourseReview_courseId_reviewState_createdAt_idx" ON "CourseReview"("courseId","reviewState","createdAt");
