-- Actual local PostgreSQL schema; structure only, no accounts or business rows.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE','FROZEN','DELETED');

CREATE TYPE "CourseFormat" AS ENUM ('VIDEO','AUDIO','LIVE','COHORT','OFFLINE');

CREATE TYPE "LessonFormat" AS ENUM ('TEXT','VIDEO','AUDIO','LIVE','OFFLINE');

CREATE TYPE "OrderStatus" AS ENUM ('PENDING','CLOSED');

CREATE TYPE "ProductType" AS ENUM ('PHYSICAL','DIGITAL','SERVICE');

CREATE TYPE "PublishStatus" AS ENUM ('DRAFT','REVIEW','PUBLISHED','REJECTED','ARCHIVED');

CREATE TYPE "Role" AS ENUM ('USER','TEACHER','OPERATOR','MODERATOR','SUPPORT','FINANCE','ADMIN');

CREATE TYPE "Visibility" AS ENUM ('PUBLIC','MEMBER');

CREATE TABLE "AccessRole" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "permissionCodes" text[] NOT NULL DEFAULT '{}'::text[],
  "active" boolean NOT NULL DEFAULT true
);

CREATE TABLE "AdCampaign" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "placementId" text NOT NULL,
  "operatingServiceId" text,
  "targetResourceId" text NOT NULL,
  "creativeAssetId" text,
  "startsAt" timestamp with time zone NOT NULL,
  "endsAt" timestamp with time zone NOT NULL,
  "state" text NOT NULL,
  "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE "AdPlacement" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "surface" text NOT NULL,
  "format" text NOT NULL,
  "label" text NOT NULL DEFAULT '推广'::text,
  "active" boolean NOT NULL DEFAULT false
);

CREATE TABLE "Address" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "recipient" text NOT NULL,
  "phone" text NOT NULL,
  "province" text NOT NULL,
  "city" text NOT NULL,
  "district" text NOT NULL,
  "detail" text NOT NULL,
  "isDefault" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "recipientCipher" text NOT NULL DEFAULT ''::text,
  "phoneCipher" text NOT NULL DEFAULT ''::text,
  "provinceCode" text NOT NULL DEFAULT ''::text,
  "cityCode" text NOT NULL DEFAULT ''::text,
  "districtCode" text NOT NULL DEFAULT ''::text,
  "detailCipher" text NOT NULL DEFAULT ''::text
);

CREATE TABLE "Appointment" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "slotId" text NOT NULL,
  "orderItemId" text,
  "requestKey" text NOT NULL,
  "state" text NOT NULL,
  "contactCipher" text NOT NULL,
  "serviceSnapshot" jsonb NOT NULL,
  "benefitUsageId" text,
  "confirmedAt" timestamp with time zone,
  "completedAt" timestamp with time zone,
  "cancelReason" text
);

CREATE TABLE "AppointmentSlot" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "offeringId" text NOT NULL,
  "startsAt" timestamp with time zone NOT NULL,
  "endsAt" timestamp with time zone NOT NULL,
  "capacity" integer NOT NULL DEFAULT 1,
  "reserved" integer NOT NULL DEFAULT 0,
  "confirmed" integer NOT NULL DEFAULT 0,
  "state" text NOT NULL DEFAULT 'OPEN'::text,
  "teacherId" text NOT NULL
);

CREATE TABLE "Article" (
  "id" text NOT NULL,
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "category" text NOT NULL,
  "author" text NOT NULL,
  "source" text NOT NULL,
  "cover" text NOT NULL,
  "blocks" jsonb NOT NULL,
  "tags" text[],
  "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC'::"Visibility",
  "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT'::"PublishStatus",
  "isDemo" boolean NOT NULL DEFAULT false,
  "featured" boolean NOT NULL DEFAULT false,
  "publishedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "membershipTier" integer NOT NULL DEFAULT 1,
  "resourceKind" text NOT NULL DEFAULT 'ARTICLE'::text,
  "authorDisplay" text NOT NULL DEFAULT ''::text,
  "authorUserId" text,
  "currentReleaseId" text,
  "draftSourceSnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "draftTemplateCode" text
);

CREATE TABLE "ArticleBlock" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "releaseId" text NOT NULL,
  "stableKey" text NOT NULL,
  "position" integer NOT NULL,
  "kind" text NOT NULL,
  "body" jsonb NOT NULL,
  "mediaId" text,
  "citationEvidenceId" text
);

CREATE TABLE "ArticleRelease" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "articleId" text NOT NULL,
  "releaseNo" integer NOT NULL,
  "sourceSnapshot" jsonb NOT NULL,
  "authorSnapshot" jsonb NOT NULL,
  "reviewerId" text NOT NULL,
  "publishedAt" timestamp with time zone NOT NULL
);

CREATE TABLE "Assignment" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "courseId" text NOT NULL,
  "lessonId" text,
  "cohortId" text,
  "title" text NOT NULL,
  "instructions" jsonb NOT NULL,
  "dueAt" timestamp with time zone,
  "required" boolean NOT NULL,
  "allowedKinds" text[] NOT NULL,
  "state" text NOT NULL
);

CREATE TABLE "AttachmentBinding" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "assetId" text NOT NULL,
  "noteId" text,
  "logId" text,
  "submissionId" text,
  "checkinId" text,
  "threadId" text,
  "reportId" text,
  "feedbackId" text,
  "refundId" text,
  "operatingServiceId" text,
  "position" integer NOT NULL DEFAULT 0,
  "caption" text,
  "resourceId" text,
  "purpose" text NOT NULL DEFAULT 'ATTACHMENT'::text,
  "feedbackReplyId" text
);

CREATE TABLE "AuditLog" (
  "id" text NOT NULL,
  "actorId" text NOT NULL,
  "action" text NOT NULL,
  "resource" text NOT NULL,
  "resourceId" text,
  "changes" jsonb NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resourceType" text NOT NULL DEFAULT ''::text,
  "resourceKey" text NOT NULL DEFAULT ''::text,
  "requestId" text NOT NULL DEFAULT ''::text,
  "reason" text,
  "beforeSnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "afterSnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ipHash" text
);

CREATE TABLE "AuthIdentity" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "provider" text NOT NULL,
  "appScope" text NOT NULL,
  "subjectHash" text NOT NULL,
  "unionSubjectHash" text,
  "verifiedAt" timestamp with time zone NOT NULL
);

CREATE TABLE "AuthSession" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "accessHash" text NOT NULL,
  "accessExpiresAt" timestamp(3) without time zone NOT NULL,
  "refreshHash" text NOT NULL,
  "csrfToken" text NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "revokedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind" text NOT NULL DEFAULT 'ADMIN'::text,
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "csrfHash" text,
  "deviceId" text
);

CREATE TABLE "BenefitDefinition" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "parameterSchema" jsonb NOT NULL,
  "active" boolean NOT NULL DEFAULT false
);

CREATE TABLE "BenefitGrant" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "definitionId" text NOT NULL,
  "growthLedgerId" text,
  "redemptionId" text,
  "resourceId" text,
  "offerId" text,
  "source" text NOT NULL,
  "quota" integer NOT NULL,
  "parametersSnapshot" jsonb NOT NULL,
  "startsAt" timestamp with time zone NOT NULL,
  "endsAt" timestamp with time zone NOT NULL,
  "revokedAt" timestamp with time zone,
  "grantKey" text NOT NULL,
  "actorId" text,
  "reason" text NOT NULL
);

CREATE TABLE "BenefitScope" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "planBenefitId" text NOT NULL,
  "resourceId" text,
  "offerId" text,
  "categoryCode" text
);

CREATE TABLE "BenefitUsage" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "periodId" text,
  "definitionId" text NOT NULL,
  "windowStart" date NOT NULL,
  "windowEnd" date NOT NULL,
  "quantity" integer NOT NULL,
  "businessKey" text NOT NULL,
  "state" text NOT NULL,
  "parametersSnapshot" jsonb NOT NULL,
  "reversalOfId" text,
  "grantId" text
);

CREATE TABLE "CampaignEntry" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "campaignId" text NOT NULL,
  "threadId" text NOT NULL,
  "userId" text NOT NULL,
  "authorizationId" text,
  "state" text NOT NULL,
  "rank" integer,
  "judgeId" text,
  "judgeNote" text,
  "rewardKey" text
);

CREATE TABLE "CartItem" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "skuId" text NOT NULL,
  "quantity" integer NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "offerId" text NOT NULL DEFAULT ''::text
);

CREATE TABLE "ChannelProductMapping" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "offerId" text NOT NULL,
  "channel" text NOT NULL,
  "appScope" text NOT NULL,
  "externalProductId" text NOT NULL,
  "productType" text NOT NULL,
  "currency" character(3) NOT NULL,
  "priceMinor" bigint,
  "minorExponent" integer NOT NULL DEFAULT 2,
  "active" boolean NOT NULL DEFAULT false
);

CREATE TABLE "Comment" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "resourceId" text NOT NULL,
  "authorId" text NOT NULL,
  "parentId" text,
  "quoteBlockId" text,
  "quoteSnapshot" text,
  "body" text NOT NULL,
  "reviewState" text NOT NULL,
  "deletedAt" timestamp with time zone
);

CREATE TABLE "CommissionLedger" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "promoterId" text NOT NULL,
  "orderItemId" text NOT NULL,
  "referralId" text NOT NULL,
  "eventKey" text NOT NULL,
  "delta" bigint NOT NULL,
  "currency" character(3) NOT NULL,
  "basisSnapshot" jsonb NOT NULL,
  "rateBasisPoints" integer NOT NULL,
  "availableAt" timestamp with time zone NOT NULL,
  "reversalOfId" text
);

CREATE TABLE "ConsentRecord" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "userId" text NOT NULL,
  "policyCode" text NOT NULL,
  "policyVersion" text NOT NULL,
  "purpose" text NOT NULL,
  "accepted" boolean NOT NULL,
  "actedAt" timestamp with time zone NOT NULL,
  "source" text NOT NULL
);

CREATE TABLE "ConsumedRefresh" (
  "hash" text NOT NULL,
  "sessionId" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "expiresAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "ContentAuthorization" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "threadId" text,
  "noteId" text,
  "logId" text,
  "sourceSnapshot" jsonb NOT NULL,
  "usageScope" text NOT NULL,
  "agreementVersion" text NOT NULL,
  "targetReleaseId" text,
  "grantedAt" timestamp with time zone NOT NULL,
  "revokedAt" timestamp with time zone
);

CREATE TABLE "ContentRelation" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "fromId" text NOT NULL,
  "toId" text NOT NULL,
  "relationType" text NOT NULL,
  "rank" integer NOT NULL DEFAULT 0,
  "startsAt" timestamp with time zone,
  "endsAt" timestamp with time zone,
  "approvedBy" text
);

CREATE TABLE "CouponTemplate" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "discountKind" text NOT NULL,
  "discountValue" bigint NOT NULL,
  "threshold" bigint NOT NULL,
  "maxDiscount" bigint,
  "startsAt" timestamp with time zone NOT NULL,
  "endsAt" timestamp with time zone NOT NULL,
  "validDays" integer,
  "totalLimit" integer NOT NULL,
  "issuedCount" integer NOT NULL DEFAULT 0,
  "perUserLimit" integer NOT NULL,
  "allowedChannels" text[] NOT NULL,
  "scope" jsonb NOT NULL,
  "stackingPolicy" text NOT NULL,
  "active" boolean NOT NULL DEFAULT false
);

CREATE TABLE "Course" (
  "id" text NOT NULL,
  "title" text NOT NULL,
  "subtitle" text NOT NULL,
  "description" text NOT NULL,
  "category" text NOT NULL,
  "format" "CourseFormat" NOT NULL DEFAULT 'VIDEO'::"CourseFormat",
  "cover" text NOT NULL,
  "price" integer NOT NULL,
  "chaptersCount" integer NOT NULL DEFAULT 0,
  "durationMinutes" integer NOT NULL DEFAULT 0,
  "tags" text[],
  "teacherId" text NOT NULL,
  "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT'::"PublishStatus",
  "featured" boolean NOT NULL DEFAULT false,
  "isDemo" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "accessDays" integer,
  "membershipTier" integer,
  "publishedReleaseId" text,
  "refundPolicy" text NOT NULL DEFAULT '未开始学习可申请退款，具体以订单售前规则为准'::text,
  "version" integer NOT NULL DEFAULT 1,
  "resourceKind" text NOT NULL DEFAULT 'COURSE'::text,
  "completionPolicy" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE "CourseChapter" (
  "id" text NOT NULL,
  "courseId" text NOT NULL,
  "title" text NOT NULL,
  "position" integer NOT NULL,
  "format" "LessonFormat" NOT NULL,
  "body" text NOT NULL DEFAULT ''::text,
  "mediaId" text,
  "durationSeconds" integer NOT NULL DEFAULT 0,
  "trial" boolean NOT NULL DEFAULT false,
  "required" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "stableKey" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "archivedAt" timestamp with time zone
);

CREATE TABLE "CourseCohort" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "courseId" text NOT NULL,
  "releaseId" text NOT NULL,
  "title" text NOT NULL,
  "startsAt" timestamp with time zone NOT NULL,
  "endsAt" timestamp with time zone NOT NULL,
  "enrollDeadline" timestamp with time zone NOT NULL,
  "capacity" integer NOT NULL,
  "reserved" integer NOT NULL DEFAULT 0,
  "confirmed" integer NOT NULL DEFAULT 0,
  "state" text NOT NULL
);

CREATE TABLE "CourseRelease" (
  "id" text NOT NULL,
  "courseId" text NOT NULL,
  "version" integer NOT NULL,
  "title" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "descriptionSnapshot" text NOT NULL DEFAULT ''::text,
  "teacherSnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "accessDays" integer,
  "refundPolicySnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "completionPolicySnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE "CourseStaff" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "courseId" text NOT NULL,
  "cohortId" text,
  "userId" text NOT NULL,
  "role" text NOT NULL,
  "revokedAt" timestamp with time zone
);

CREATE TABLE "DeliveryTemplate" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "name" text NOT NULL,
  "chargeBasis" text NOT NULL,
  "prioritySupported" boolean NOT NULL DEFAULT false,
  "description" text NOT NULL,
  "active" boolean NOT NULL DEFAULT false
);

CREATE TABLE "DeliveryZone" (
  "province" text NOT NULL,
  "fee" integer NOT NULL,
  "surcharge" integer NOT NULL DEFAULT 0,
  "freeAbove" integer,
  "enabled" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1
);

CREATE TABLE "DeviceToken" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "platform" text NOT NULL,
  "provider" text NOT NULL,
  "tokenCipher" text NOT NULL,
  "tokenHash" text NOT NULL,
  "deviceId" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "revokedAt" timestamp with time zone,
  "lastConfirmedAt" timestamp with time zone
);

CREATE TABLE "DigitalDelivery" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "orderItemId" text NOT NULL,
  "releaseId" text NOT NULL,
  "startsAt" timestamp with time zone NOT NULL,
  "expiresAt" timestamp with time zone,
  "revokedAt" timestamp with time zone,
  "grantKey" text NOT NULL
);

CREATE TABLE "DigitalRelease" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "productId" text NOT NULL,
  "releaseNo" integer NOT NULL,
  "description" text NOT NULL,
  "accessDays" integer,
  "rightsSnapshot" jsonb NOT NULL
);

CREATE TABLE "DigitalReleaseAsset" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "releaseId" text NOT NULL,
  "assetId" text NOT NULL,
  "position" integer NOT NULL
);

CREATE TABLE "Enrollment" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "courseId" text NOT NULL,
  "releaseId" text NOT NULL,
  "source" text NOT NULL,
  "expiresAt" timestamp(3) without time zone,
  "revokedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "cohortId" text,
  "orderItemId" text,
  "grantKey" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "startsAt" timestamp with time zone NOT NULL DEFAULT now(),
  "grantActorId" text,
  "grantReason" text
);

CREATE TABLE "Event" (
  "id" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "category" text NOT NULL,
  "cover" text NOT NULL,
  "location" text NOT NULL,
  "startsAt" timestamp(3) without time zone NOT NULL,
  "endsAt" timestamp(3) without time zone NOT NULL,
  "capacity" integer NOT NULL,
  "price" integer NOT NULL,
  "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT'::"PublishStatus",
  "isDemo" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "resourceKind" text NOT NULL DEFAULT 'EVENT'::text,
  "organizerPartnerId" text,
  "teacherId" text,
  "cancelPolicy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "responsibleUserId" text NOT NULL
);

CREATE TABLE "EventCheckin" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "registrationId" text NOT NULL,
  "attendeeNo" integer NOT NULL,
  "actorId" text NOT NULL,
  "requestKey" text NOT NULL,
  "checkedAt" timestamp with time zone NOT NULL
);

CREATE TABLE "EventRegistration" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "ticketTypeId" text NOT NULL,
  "orderItemId" text,
  "requestKey" text NOT NULL,
  "quantity" integer NOT NULL,
  "attendeeSnapshotCipher" text NOT NULL,
  "state" text NOT NULL,
  "checkinHash" text NOT NULL,
  "benefitUsageId" text,
  "confirmedAt" timestamp with time zone,
  "cancelledAt" timestamp with time zone
);

CREATE TABLE "EventSession" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "eventId" text NOT NULL,
  "startsAt" timestamp with time zone NOT NULL,
  "endsAt" timestamp with time zone NOT NULL,
  "location" text NOT NULL,
  "contactCipher" text,
  "state" text NOT NULL,
  "capacity" integer NOT NULL,
  "cancelDeadline" timestamp with time zone NOT NULL,
  "publicOpenAt" timestamp with time zone NOT NULL,
  "memberOpenAt" timestamp with time zone,
  "rescheduledFromId" text
);

CREATE TABLE "EventStaff" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "sessionId" text NOT NULL,
  "userId" text NOT NULL,
  "scopeCodes" text[] NOT NULL,
  "revokedAt" timestamp with time zone
);

CREATE TABLE "EventTicketType" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "sessionId" text NOT NULL,
  "title" text NOT NULL,
  "capacity" integer NOT NULL,
  "reserved" integer NOT NULL DEFAULT 0,
  "confirmed" integer NOT NULL DEFAULT 0,
  "perUserLimit" integer NOT NULL DEFAULT 1,
  "active" boolean NOT NULL DEFAULT false
);

CREATE TABLE "EventWaitlist" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "sessionId" text NOT NULL,
  "userId" text NOT NULL,
  "quantity" integer NOT NULL,
  "state" text NOT NULL,
  "invitedUntil" timestamp with time zone,
  "registrationId" text
);

CREATE TABLE "Favorite" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "articleId" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "FeatureConfig" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "configKey" text NOT NULL,
  "revision" integer NOT NULL,
  "value" jsonb NOT NULL,
  "effectiveAt" timestamp with time zone NOT NULL,
  "approvedBy" text NOT NULL,
  "reason" text NOT NULL
);

CREATE TABLE "Feedback" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "orderId" text,
  "kind" text NOT NULL,
  "body" text NOT NULL,
  "contactCipher" text,
  "state" text NOT NULL,
  "assigneeId" text,
  "closedAt" timestamp with time zone
);

CREATE TABLE "FeedbackReply" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "feedbackId" text NOT NULL,
  "authorId" text NOT NULL,
  "body" text NOT NULL,
  "internal" boolean NOT NULL DEFAULT false
);

CREATE TABLE "FinanceAccount" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true
);

CREATE TABLE "FinanceEntry" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "journalId" text NOT NULL,
  "accountCode" text NOT NULL,
  "partnerId" text,
  "userId" text,
  "debit" bigint NOT NULL DEFAULT 0,
  "credit" bigint NOT NULL DEFAULT 0
);

CREATE TABLE "FinanceJournal" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "eventKey" text NOT NULL,
  "kind" text NOT NULL,
  "orderId" text,
  "transactionId" text,
  "refundId" text,
  "currency" character(3) NOT NULL,
  "postedAt" timestamp with time zone NOT NULL,
  "reversalOfId" text,
  "description" text NOT NULL
);

CREATE TABLE "ForumSection" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "scope" text NOT NULL,
  "courseId" text,
  "cohortId" text,
  "description" text NOT NULL,
  "active" boolean NOT NULL DEFAULT false
);

CREATE TABLE "ForumThread" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "resourceKind" text NOT NULL DEFAULT 'THREAD'::text,
  "sectionId" text NOT NULL,
  "authorId" text NOT NULL,
  "blocks" jsonb NOT NULL,
  "citationReleaseId" text,
  "essence" boolean NOT NULL DEFAULT false,
  "pinnedUntil" timestamp with time zone,
  "pinScope" text,
  "benefitUsageId" text,
  "deletedAt" timestamp with time zone
);

CREATE TABLE "GiftCreditAllocation" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "debitLedgerId" text NOT NULL,
  "creditLedgerId" text NOT NULL,
  "credits" bigint NOT NULL,
  "allocatedPaidMinor" bigint NOT NULL,
  "allocatedFeeMinor" bigint NOT NULL,
  "currency" character(3) NOT NULL,
  "contractId" text,
  "reversalOfId" text
);

CREATE TABLE "GiftLedger" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "walletId" text NOT NULL,
  "eventKey" text NOT NULL,
  "delta" bigint NOT NULL,
  "kind" text NOT NULL,
  "orderItemId" text,
  "sessionId" text,
  "giftId" text,
  "quantity" integer,
  "reversalOfId" text,
  "balanceAfter" bigint NOT NULL,
  "paymentTransactionId" text,
  "refundTransactionId" text
);

CREATE TABLE "GiftWallet" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "balance" bigint NOT NULL DEFAULT 0
);

CREATE TABLE "GroupBuy" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "offerId" text NOT NULL,
  "leaderId" text NOT NULL,
  "requiredMembers" integer NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "state" text NOT NULL,
  "ruleSnapshot" jsonb NOT NULL,
  "completedAt" timestamp with time zone
);

CREATE TABLE "GroupBuyMember" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "groupId" text NOT NULL,
  "userId" text NOT NULL,
  "orderItemId" text NOT NULL,
  "state" text NOT NULL,
  "joinedAt" timestamp with time zone NOT NULL
);

CREATE TABLE "GrowthLedger" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "userId" text NOT NULL,
  "delta" integer NOT NULL,
  "businessDay" date NOT NULL,
  "eventKey" text NOT NULL,
  "reason" text NOT NULL,
  "sourceResourceId" text,
  "ruleSnapshot" jsonb NOT NULL,
  "reversalOfId" text
);

CREATE TABLE "IdempotencyRecord" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "operation" text NOT NULL,
  "requestKey" text NOT NULL,
  "payloadHash" text NOT NULL,
  "state" text NOT NULL,
  "responseCode" integer,
  "response" jsonb,
  "expiresAt" timestamp with time zone NOT NULL
);

CREATE TABLE "InventoryLedger" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "skuId" text NOT NULL,
  "reservationId" text,
  "orderItemId" text,
  "stockDelta" bigint NOT NULL,
  "reservedDelta" bigint NOT NULL,
  "reason" text NOT NULL,
  "eventKey" text NOT NULL,
  "actorId" text,
  "stockAfter" bigint NOT NULL,
  "reservedAfter" bigint NOT NULL
);

CREATE TABLE "InventoryReservation" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "orderItemId" text NOT NULL,
  "skuId" text,
  "slotId" text,
  "eventTicketId" text,
  "cohortId" text,
  "quantity" integer NOT NULL,
  "state" text NOT NULL DEFAULT 'HELD'::text,
  "expiresAt" timestamp with time zone NOT NULL,
  "convertedAt" timestamp with time zone,
  "releasedAt" timestamp with time zone,
  "requestKey" text NOT NULL,
  "promotionOfferId" text
);

CREATE TABLE "Lesson" (
  "id" text NOT NULL,
  "releaseId" text NOT NULL,
  "sourceId" text NOT NULL,
  "title" text NOT NULL,
  "position" integer NOT NULL,
  "format" "LessonFormat" NOT NULL,
  "body" text NOT NULL,
  "mediaId" text,
  "durationSeconds" integer NOT NULL,
  "trial" boolean NOT NULL,
  "required" boolean NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "liveSessionId" text,
  "eventSessionId" text
);

CREATE TABLE "LiveMicRequest" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "sessionId" text NOT NULL,
  "userId" text NOT NULL,
  "priority" integer NOT NULL DEFAULT 0,
  "state" text NOT NULL,
  "approvedBy" text,
  "rtcSessionId" text,
  "startedAt" timestamp with time zone,
  "endedAt" timestamp with time zone
);

CREATE TABLE "LivePoll" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "sessionId" text NOT NULL,
  "question" text NOT NULL,
  "allowMultiple" boolean NOT NULL DEFAULT false,
  "closesAt" timestamp with time zone NOT NULL,
  "resultVisibility" text NOT NULL,
  "state" text NOT NULL
);

CREATE TABLE "LiveReplay" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "sessionId" text NOT NULL,
  "assetId" text NOT NULL,
  "reviewState" text NOT NULL,
  "accessRuleSnapshot" jsonb NOT NULL,
  "publishedAt" timestamp with time zone,
  "reviewerId" text
);

CREATE TABLE "LiveReservation" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "sessionId" text NOT NULL,
  "userId" text NOT NULL,
  "cancelledAt" timestamp with time zone,
  "reminderSentAt" timestamp with time zone
);

CREATE TABLE "LiveRoom" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "resourceKind" text NOT NULL DEFAULT 'LIVE'::text,
  "teacherId" text NOT NULL,
  "provider" text NOT NULL,
  "providerRoomId" text NOT NULL,
  "categoryCode" text NOT NULL,
  "accessRule" jsonb NOT NULL,
  "courseId" text
);

CREATE TABLE "LiveSession" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "roomId" text NOT NULL,
  "hostUserId" text NOT NULL,
  "title" text NOT NULL,
  "scheduledAt" timestamp with time zone NOT NULL,
  "startedAt" timestamp with time zone,
  "endedAt" timestamp with time zone,
  "state" text NOT NULL DEFAULT 'SCHEDULED'::text,
  "providerSessionId" text,
  "eventSessionId" text,
  "accessRuleSnapshot" jsonb NOT NULL,
  "pushSecretRef" text
);

CREATE TABLE "MediaAsset" (
  "id" text NOT NULL,
  "storageKey" text NOT NULL,
  "name" text NOT NULL,
  "mime" text NOT NULL,
  "bytes" integer NOT NULL,
  "uploaderId" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "sha256" text NOT NULL DEFAULT ''::text,
  "status" text NOT NULL DEFAULT ''::text,
  "visibility" text NOT NULL DEFAULT ''::text,
  "durationSeconds" integer,
  "providerAssetId" text,
  "variants" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "failureCode" text
);

CREATE TABLE "Membership" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "planId" text NOT NULL,
  "tier" integer NOT NULL,
  "startsAt" timestamp(3) without time zone NOT NULL,
  "endsAt" timestamp(3) without time zone NOT NULL,
  "source" text NOT NULL,
  "revokedAt" timestamp(3) without time zone,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "planVersionId" text,
  "orderItemId" text,
  "grantKey" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "actorId" text,
  "reason" text
);

CREATE TABLE "MembershipPlan" (
  "id" text NOT NULL,
  "title" text NOT NULL,
  "tier" integer NOT NULL,
  "days" integer NOT NULL,
  "price" integer NOT NULL,
  "description" text NOT NULL,
  "active" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "currentVersionId" text
);

CREATE TABLE "MembershipPlanVersion" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "planId" text NOT NULL,
  "releaseNo" integer NOT NULL,
  "tier" integer NOT NULL,
  "days" integer NOT NULL,
  "description" text NOT NULL,
  "termsSnapshot" jsonb NOT NULL,
  "publishedAt" timestamp with time zone NOT NULL
);

CREATE TABLE "ModerationAction" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "actorId" text NOT NULL,
  "reportId" text,
  "resourceId" text,
  "commentId" text,
  "targetUserId" text,
  "action" text NOT NULL,
  "reason" text NOT NULL,
  "beforeSnapshot" jsonb NOT NULL,
  "afterSnapshot" jsonb NOT NULL,
  "appealOfId" text
);

CREATE TABLE "Note" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "articleId" text NOT NULL,
  "articleTitle" text NOT NULL,
  "blockId" text NOT NULL,
  "quote" text NOT NULL,
  "text" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "articleVersion" integer NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "releaseId" text,
  "rangeStart" integer,
  "rangeEnd" integer,
  "deletedAt" timestamp with time zone
);

CREATE TABLE "NoteExport" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "requestKey" text NOT NULL,
  "filterSnapshot" jsonb NOT NULL,
  "format" text NOT NULL,
  "state" text NOT NULL,
  "assetId" text,
  "expiresAt" timestamp with time zone,
  "errorCode" text
);

CREATE TABLE "Notification" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "eventKey" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "resourceId" text,
  "orderId" text,
  "appointmentId" text,
  "registrationId" text,
  "readAt" timestamp with time zone,
  "expiresAt" timestamp with time zone
);

CREATE TABLE "NotificationDelivery" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "notificationId" text NOT NULL,
  "deviceTokenId" text,
  "channel" text NOT NULL,
  "deliveryKey" text NOT NULL,
  "state" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "nextRetryAt" timestamp with time zone,
  "providerMessageId" text,
  "failureCode" text
);

CREATE TABLE "OfflineLicense" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "deviceId" text NOT NULL,
  "lessonId" text NOT NULL,
  "assetId" text NOT NULL,
  "entitlementSnapshot" jsonb NOT NULL,
  "licenseHash" text NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "revokedAt" timestamp with time zone
);

CREATE TABLE "OperatingService" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "partnerId" text NOT NULL,
  "contractId" text NOT NULL,
  "title" text NOT NULL,
  "deliverySpec" jsonb NOT NULL,
  "dueAt" timestamp with time zone,
  "state" text NOT NULL
);

CREATE TABLE "Order" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "requestId" text NOT NULL,
  "requestHash" text NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING'::"OrderStatus",
  "address" jsonb NOT NULL,
  "subtotal" integer NOT NULL,
  "shipping" integer NOT NULL,
  "total" integer NOT NULL,
  "quoteId" text NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "closedAt" timestamp(3) without time zone,
  "closeReason" text,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "OrderItem" (
  "id" text NOT NULL,
  "orderId" text NOT NULL,
  "skuId" text NOT NULL,
  "productId" text NOT NULL,
  "title" text NOT NULL,
  "skuTitle" text NOT NULL,
  "cover" text NOT NULL,
  "unitPrice" integer NOT NULL,
  "quantity" integer NOT NULL,
  "subtotal" integer NOT NULL
);

CREATE TABLE "OtpChallenge" (
  "id" text NOT NULL,
  "phone" text NOT NULL,
  "codeHash" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "consumedAt" timestamp(3) without time zone,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "phoneHash" text NOT NULL DEFAULT ''::text,
  "purpose" text NOT NULL DEFAULT ''::text,
  "providerRequestId" text,
  "deliveryState" text NOT NULL DEFAULT ''::text
);

CREATE TABLE "OutboxJob" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "eventKey" text NOT NULL,
  "kind" text NOT NULL,
  "aggregateType" text NOT NULL,
  "aggregateId" text NOT NULL,
  "payload" jsonb NOT NULL,
  "state" text NOT NULL DEFAULT 'READY'::text,
  "attempts" integer NOT NULL DEFAULT 0,
  "availableAt" timestamp with time zone NOT NULL,
  "lockedUntil" timestamp with time zone,
  "workerId" text,
  "lastErrorCode" text,
  "completedAt" timestamp with time zone
);

CREATE TABLE "Partner" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "status" text NOT NULL,
  "contactCipher" text,
  "payeeCipher" text,
  "qualificationEvidenceId" text,
  "reviewerId" text,
  "reviewedAt" timestamp with time zone
);

CREATE TABLE "PartnerContract" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "partnerId" text NOT NULL,
  "contractNo" text NOT NULL,
  "revision" integer NOT NULL,
  "startsAt" timestamp with time zone NOT NULL,
  "endsAt" timestamp with time zone,
  "rateBasisPoints" integer NOT NULL,
  "feePolicy" jsonb NOT NULL,
  "settlementCycle" text NOT NULL,
  "proofAssetId" text NOT NULL,
  "scopeSnapshot" jsonb NOT NULL,
  "approvedBy" text NOT NULL
);

CREATE TABLE "PaymentAttempt" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "orderId" text NOT NULL,
  "channel" text NOT NULL,
  "mappingId" text,
  "requestKey" text NOT NULL,
  "externalRequestId" text,
  "state" text NOT NULL,
  "amount" bigint NOT NULL,
  "currency" character(3) NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "failureCode" text,
  "lastQueriedAt" timestamp with time zone
);

CREATE TABLE "PaymentTransaction" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "attemptId" text,
  "orderId" text NOT NULL,
  "channel" text NOT NULL,
  "appScope" text NOT NULL,
  "externalTransactionId" text NOT NULL,
  "originalTransactionId" text,
  "amount" bigint NOT NULL,
  "currency" character(3) NOT NULL,
  "channelFee" bigint NOT NULL DEFAULT 0,
  "verifiedAt" timestamp with time zone NOT NULL,
  "paidAt" timestamp with time zone NOT NULL,
  "disposition" text NOT NULL,
  "receiptHash" text NOT NULL,
  "receiptStorageRef" text,
  "settlementAmount" bigint,
  "settlementCurrency" character(3)
);

CREATE TABLE "PlanBenefit" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "planVersionId" text NOT NULL,
  "definitionId" text NOT NULL,
  "parameters" jsonb NOT NULL,
  "quota" integer,
  "periodKind" text NOT NULL
);

CREATE TABLE "PointsAccount" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "balance" bigint NOT NULL DEFAULT 0,
  "reserved" bigint NOT NULL DEFAULT 0
);

CREATE TABLE "PointsLedger" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "accountId" text NOT NULL,
  "eventKey" text NOT NULL,
  "delta" bigint NOT NULL,
  "reason" text NOT NULL,
  "orderItemId" text,
  "resourceId" text,
  "ruleSnapshot" jsonb NOT NULL,
  "businessDay" date NOT NULL,
  "reversalOfId" text,
  "balanceAfter" bigint NOT NULL
);

CREATE TABLE "PointsRedemption" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "rewardId" text NOT NULL,
  "requestKey" text NOT NULL,
  "pointsCost" bigint NOT NULL,
  "rewardSnapshot" jsonb NOT NULL,
  "state" text NOT NULL,
  "orderId" text,
  "userCouponId" text,
  "benefitUsageId" text,
  "businessDay" date NOT NULL,
  "completedAt" timestamp with time zone
);

CREATE TABLE "PointsReservation" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "accountId" text NOT NULL,
  "requestKey" text NOT NULL,
  "points" bigint NOT NULL,
  "state" text NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "redemptionId" text
);

CREATE TABLE "PointsReward" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "pointsCost" bigint NOT NULL,
  "couponTemplateId" text,
  "offerId" text,
  "benefitDefinitionId" text,
  "stock" integer NOT NULL,
  "reserved" integer NOT NULL DEFAULT 0,
  "perUserDaily" integer NOT NULL,
  "active" boolean NOT NULL DEFAULT false
);

CREATE TABLE "PollOption" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "pollId" text NOT NULL,
  "label" text NOT NULL,
  "position" integer NOT NULL
);

CREATE TABLE "PollVote" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "pollId" text NOT NULL,
  "optionId" text NOT NULL,
  "userId" text NOT NULL
);

CREATE TABLE "PracticeCheckin" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "taskId" text NOT NULL,
  "userId" text NOT NULL,
  "businessDay" date NOT NULL,
  "body" text NOT NULL,
  "privateLogId" text,
  "state" text NOT NULL,
  "rewardEventKey" text
);

CREATE TABLE "PracticeLog" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "day" text NOT NULL,
  "text" text NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "deletedAt" timestamp with time zone
);

CREATE TABLE "PracticeTask" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "courseId" text NOT NULL,
  "lessonId" text,
  "cohortId" text,
  "title" text NOT NULL,
  "instructions" jsonb NOT NULL,
  "frequency" text NOT NULL,
  "requiredDays" integer NOT NULL,
  "startsOn" date,
  "endsOn" date,
  "required" boolean NOT NULL
);

CREATE TABLE "Product" (
  "id" text NOT NULL,
  "title" text NOT NULL,
  "subtitle" text NOT NULL,
  "description" text NOT NULL,
  "category" text NOT NULL,
  "type" "ProductType" NOT NULL DEFAULT 'PHYSICAL'::"ProductType",
  "cover" text NOT NULL,
  "price" integer NOT NULL,
  "culturalOrigin" text NOT NULL,
  "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT'::"PublishStatus",
  "featured" boolean NOT NULL DEFAULT false,
  "isDemo" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "resourceKind" text NOT NULL DEFAULT 'PRODUCT'::text,
  "partnerId" text,
  "deliveryTemplateId" text,
  "afterSalesPolicy" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE "ProductSku" (
  "id" text NOT NULL,
  "productId" text NOT NULL,
  "title" text NOT NULL,
  "price" integer NOT NULL,
  "stock" integer NOT NULL DEFAULT 0,
  "reserved" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "code" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "specs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "digitalReleaseId" text,
  "serviceOfferingId" text,
  "signedCopy" boolean NOT NULL DEFAULT false
);

CREATE TABLE "Promotion" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "startsAt" timestamp with time zone NOT NULL,
  "endsAt" timestamp with time zone NOT NULL,
  "rules" jsonb NOT NULL,
  "allowedChannels" text[] NOT NULL,
  "state" text NOT NULL
);

CREATE TABLE "PromotionOffer" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "promotionId" text NOT NULL,
  "offerId" text NOT NULL,
  "price" bigint,
  "capacity" integer,
  "reserved" integer NOT NULL DEFAULT 0,
  "sold" integer NOT NULL DEFAULT 0,
  "perUserLimit" integer NOT NULL
);

CREATE TABLE "ProviderCallback" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "provider" text NOT NULL,
  "appScope" text NOT NULL,
  "externalEventId" text NOT NULL,
  "kind" text NOT NULL,
  "payloadHash" text NOT NULL,
  "payloadStorageRef" text NOT NULL,
  "signatureVerified" boolean NOT NULL,
  "state" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "nextRetryAt" timestamp with time zone,
  "lastErrorCode" text,
  "handledAt" timestamp with time zone
);

CREATE TABLE "RateLimit" (
  "key" text NOT NULL,
  "count" integer NOT NULL,
  "expiresAt" timestamp(3) without time zone NOT NULL,
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1
);

CREATE TABLE "Reaction" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "userId" text NOT NULL,
  "resourceId" text NOT NULL,
  "kind" text NOT NULL
);

CREATE TABLE "ReadingEvent" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "userId" text,
  "anonymousHash" text,
  "resourceId" text NOT NULL,
  "eventKey" text NOT NULL,
  "businessDay" date NOT NULL,
  "dwellSeconds" integer NOT NULL DEFAULT 0,
  "consentRecordId" text
);

CREATE TABLE "Reconciliation" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "channel" text NOT NULL,
  "appScope" text NOT NULL,
  "businessDay" date NOT NULL,
  "state" text NOT NULL,
  "billStorageRef" text,
  "billHash" text,
  "summary" jsonb NOT NULL,
  "differences" jsonb NOT NULL,
  "reviewerId" text,
  "resolvedAt" timestamp with time zone
);

CREATE TABLE "Referral" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "promoterId" text NOT NULL,
  "buyerId" text NOT NULL,
  "code" text NOT NULL,
  "firstValidAt" timestamp with time zone NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "approvalSnapshot" jsonb NOT NULL
);

CREATE TABLE "Refund" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "orderId" text NOT NULL,
  "userId" text NOT NULL,
  "requestKey" text NOT NULL,
  "kind" text NOT NULL,
  "state" text NOT NULL,
  "requestedAmount" bigint NOT NULL,
  "approvedAmount" bigint,
  "reasonCode" text NOT NULL,
  "description" text NOT NULL,
  "reviewerId" text,
  "reviewNote" text,
  "paymentTransactionId" text,
  "succeededAt" timestamp with time zone,
  "failureCode" text,
  "channelRequestKey" text
);

CREATE TABLE "RefundItem" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "refundId" text NOT NULL,
  "orderItemId" text NOT NULL,
  "quantity" integer NOT NULL,
  "amount" bigint NOT NULL,
  "revokeQuantity" integer NOT NULL,
  "returnStockQuantity" integer NOT NULL DEFAULT 0
);

CREATE TABLE "RefundTransaction" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "refundId" text NOT NULL,
  "paymentTransactionId" text NOT NULL,
  "channel" text NOT NULL,
  "appScope" text NOT NULL,
  "externalRefundId" text NOT NULL,
  "amount" bigint NOT NULL,
  "currency" character(3) NOT NULL,
  "verifiedAt" timestamp with time zone NOT NULL,
  "succeededAt" timestamp with time zone NOT NULL,
  "receiptHash" text NOT NULL,
  "receiptStorageRef" text
);

CREATE TABLE "Report" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "reporterId" text NOT NULL,
  "resourceId" text,
  "commentId" text,
  "reasonCode" text NOT NULL,
  "description" text NOT NULL,
  "state" text NOT NULL,
  "assigneeId" text,
  "resolvedAt" timestamp with time zone,
  "resolution" text
);

CREATE TABLE "Resource" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "summary" text NOT NULL DEFAULT ''::text,
  "coverAssetId" text,
  "ownerId" text,
  "publishState" text NOT NULL DEFAULT 'DRAFT'::text,
  "visibility" text NOT NULL DEFAULT 'PUBLIC'::text,
  "membershipTier" integer,
  "categoryCode" text NOT NULL,
  "isDemo" boolean NOT NULL DEFAULT false,
  "featuredRank" integer,
  "publishedAt" timestamp with time zone
);

CREATE TABLE "ResourceEvidence" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "resourceId" text NOT NULL,
  "evidenceId" text NOT NULL,
  "purpose" text NOT NULL
);

CREATE TABLE "ResourceTag" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "resourceId" text NOT NULL,
  "tagId" text NOT NULL
);

CREATE TABLE "SaleOffer" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "kind" text NOT NULL,
  "courseReleaseId" text,
  "cohortId" text,
  "skuId" text,
  "membershipVersionId" text,
  "serviceOfferingId" text,
  "eventTicketId" text,
  "giftId" text,
  "operatingServiceId" text,
  "currency" character(3) NOT NULL DEFAULT 'CNY'::bpchar,
  "price" bigint NOT NULL,
  "active" boolean NOT NULL DEFAULT false,
  "validFrom" timestamp with time zone,
  "validUntil" timestamp with time zone,
  "quantityLimit" integer NOT NULL DEFAULT 99,
  "policySnapshot" jsonb NOT NULL
);

CREATE TABLE "ServiceOffering" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "teacherId" text NOT NULL,
  "title" text NOT NULL,
  "mode" text NOT NULL,
  "durationMinutes" integer NOT NULL,
  "leadMinutes" integer NOT NULL,
  "cancelBeforeMinutes" integer NOT NULL,
  "locationPolicy" text NOT NULL,
  "deliveryPolicy" text NOT NULL,
  "active" boolean NOT NULL DEFAULT false
);

CREATE TABLE "Settlement" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "partnerId" text,
  "promoterId" text,
  "periodStart" date NOT NULL,
  "periodEnd" date NOT NULL,
  "currency" character(3) NOT NULL,
  "grossAmount" bigint NOT NULL,
  "feeAmount" bigint NOT NULL,
  "refundAmount" bigint NOT NULL,
  "netAmount" bigint NOT NULL,
  "state" text NOT NULL,
  "reviewerId" text,
  "paidAt" timestamp with time zone,
  "transferId" text,
  "proofAssetId" text
);

CREATE TABLE "SettlementItem" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "settlementId" text NOT NULL,
  "orderItemId" text NOT NULL,
  "eventKey" text NOT NULL,
  "contractId" text,
  "delta" bigint NOT NULL,
  "basisSnapshot" jsonb NOT NULL,
  "currency" character(3) NOT NULL,
  "commissionId" text,
  "giftAllocationId" text
);

CREATE TABLE "Shipment" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "orderId" text NOT NULL,
  "refundId" text,
  "kind" text NOT NULL,
  "carrierCode" text NOT NULL,
  "trackingNo" text NOT NULL,
  "state" text NOT NULL,
  "addressSnapshotCipher" text NOT NULL,
  "shippedAt" timestamp with time zone,
  "deliveredAt" timestamp with time zone,
  "trackingSnapshot" jsonb,
  "actorId" text NOT NULL
);

CREATE TABLE "ShipmentItem" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "shipmentId" text NOT NULL,
  "orderItemId" text NOT NULL,
  "quantity" integer NOT NULL
);

CREATE TABLE "ShippingZone" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "templateId" text NOT NULL,
  "regionCode" text NOT NULL,
  "baseFee" bigint NOT NULL,
  "surcharge" bigint NOT NULL DEFAULT 0,
  "incrementFee" bigint NOT NULL DEFAULT 0,
  "freeAbove" bigint,
  "priorityFee" bigint,
  "enabled" boolean NOT NULL DEFAULT false
);

CREATE TABLE "SourceEvidence" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "author" text,
  "edition" text,
  "sourceUrl" text,
  "proofAssetId" text,
  "rightsHolder" text,
  "licenseScope" text,
  "validFrom" timestamp with time zone,
  "validUntil" timestamp with time zone,
  "reviewState" text NOT NULL,
  "reviewerId" text,
  "reviewNote" text
);

CREATE TABLE "StudyEvent" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "lessonId" text NOT NULL,
  "payloadHash" text NOT NULL,
  "result" jsonb NOT NULL,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "StudyProgress" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "lessonId" text NOT NULL,
  "positionSeconds" integer NOT NULL DEFAULT 0,
  "watchedSeconds" integer NOT NULL DEFAULT 0,
  "completedAt" timestamp(3) without time zone,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "lastEventAt" timestamp with time zone,
  "deviceId" text
);

CREATE TABLE "Submission" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "assignmentId" text NOT NULL,
  "userId" text NOT NULL,
  "revision" integer NOT NULL,
  "body" text NOT NULL,
  "state" text NOT NULL,
  "submittedAt" timestamp with time zone NOT NULL
);

CREATE TABLE "Tag" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "parentId" text,
  "active" boolean NOT NULL DEFAULT true
);

CREATE TABLE "Teacher" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "title" text NOT NULL,
  "bio" text NOT NULL,
  "portrait" text,
  "expertise" text[],
  "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT'::"PublishStatus",
  "isDemo" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "resourceKind" text NOT NULL DEFAULT 'TEACHER'::text,
  "userId" text,
  "lineageSummary" text,
  "achievementSummary" text,
  "teachingDirection" text NOT NULL DEFAULT ''::text,
  "servicePolicy" text,
  "portraitAssetId" text
);

CREATE TABLE "TeacherAnswer" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "questionId" text NOT NULL,
  "authorId" text NOT NULL,
  "body" text NOT NULL,
  "assetId" text,
  "reviewState" text NOT NULL,
  "featured" boolean NOT NULL DEFAULT false,
  "reviewerId" text
);

CREATE TABLE "TeacherQuestion" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "teacherId" text NOT NULL,
  "userId" text NOT NULL,
  "body" text NOT NULL,
  "visibility" text NOT NULL,
  "state" text NOT NULL,
  "benefitUsageId" text,
  "answeredAt" timestamp with time zone
);

CREATE TABLE "TeacherReview" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "submissionId" text,
  "checkinId" text,
  "reviewerId" text NOT NULL,
  "body" text NOT NULL,
  "score" integer,
  "state" text NOT NULL,
  "reviewedAt" timestamp with time zone NOT NULL
);

CREATE TABLE "TeacherStaff" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "teacherId" text NOT NULL,
  "userId" text NOT NULL,
  "scopeCodes" text[] NOT NULL,
  "revokedAt" timestamp with time zone
);

CREATE TABLE "TradeOrder" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "orderNo" text NOT NULL,
  "userId" text NOT NULL,
  "kind" text NOT NULL,
  "requestKey" text NOT NULL,
  "requestHash" text NOT NULL,
  "state" text NOT NULL DEFAULT 'PENDING'::text,
  "currency" character(3) NOT NULL,
  "minorExponent" integer NOT NULL DEFAULT 2,
  "subtotal" bigint NOT NULL,
  "discountTotal" bigint NOT NULL DEFAULT 0,
  "shippingTotal" bigint NOT NULL DEFAULT 0,
  "payableTotal" bigint NOT NULL,
  "paidTotal" bigint NOT NULL DEFAULT 0,
  "refundedTotal" bigint NOT NULL DEFAULT 0,
  "addressSnapshotCipher" text,
  "pricingSnapshot" jsonb NOT NULL,
  "quoteHash" text NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "paidAt" timestamp with time zone,
  "closedAt" timestamp with time zone,
  "completedAt" timestamp with time zone,
  "closeReason" text
);

CREATE TABLE "TradeOrderItem" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "orderId" text NOT NULL,
  "lineNo" integer NOT NULL,
  "offerId" text NOT NULL,
  "quantity" integer NOT NULL,
  "unitPrice" bigint NOT NULL,
  "subtotal" bigint NOT NULL,
  "discountAllocated" bigint NOT NULL DEFAULT 0,
  "shippingAllocated" bigint NOT NULL DEFAULT 0,
  "payable" bigint NOT NULL,
  "refundedAmount" bigint NOT NULL DEFAULT 0,
  "itemSnapshot" jsonb NOT NULL,
  "benefitSnapshot" jsonb NOT NULL,
  "contractVersionId" text,
  "referralSnapshot" jsonb,
  "slotId" text,
  "state" text NOT NULL,
  "digitalReleaseId" text,
  "courseReleaseId" text,
  "membershipVersionId" text
);

CREATE TABLE "User" (
  "id" text NOT NULL,
  "phone" text,
  "username" text,
  "passwordHash" text,
  "nickname" text NOT NULL,
  "avatar" text,
  "tags" text[],
  "roles" "Role"[] DEFAULT ARRAY['USER'::"Role"],
  "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE'::"AccountStatus",
  "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "phoneCipher" text,
  "phoneHash" text,
  "avatarAssetId" text,
  "deletedAt" timestamp with time zone,
  "lastSeenAt" timestamp with time zone
);

CREATE TABLE "UserBlock" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "userId" text NOT NULL,
  "blockedId" text NOT NULL
);

CREATE TABLE "UserCoupon" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "templateId" text NOT NULL,
  "userId" text NOT NULL,
  "claimKey" text NOT NULL,
  "state" text NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "lockedOrderId" text,
  "usedOrderId" text,
  "termsSnapshot" jsonb NOT NULL,
  "redeemKey" text
);

CREATE TABLE "UserRestriction" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "resourceId" text,
  "scope" text NOT NULL,
  "startsAt" timestamp with time zone NOT NULL,
  "endsAt" timestamp with time zone,
  "actionId" text NOT NULL,
  "revokedAt" timestamp with time zone
);

CREATE TABLE "UserRole" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "roleId" text NOT NULL,
  "grantedBy" text NOT NULL,
  "reason" text NOT NULL,
  "revokedAt" timestamp with time zone
);

CREATE TABLE "UserTag" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "userId" text NOT NULL,
  "tagId" text NOT NULL
);

CREATE TABLE "VirtualGift" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "iconAssetId" text,
  "creditCost" bigint NOT NULL,
  "active" boolean NOT NULL DEFAULT false
);

CREATE TABLE "WithdrawalAllocation" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "withdrawalId" text NOT NULL,
  "commissionId" text NOT NULL,
  "amount" bigint NOT NULL,
  "state" text NOT NULL
);

CREATE TABLE "WithdrawalRequest" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "userId" text NOT NULL,
  "requestKey" text NOT NULL,
  "amount" bigint NOT NULL,
  "currency" character(3) NOT NULL,
  "state" text NOT NULL,
  "recipientCipher" text NOT NULL,
  "reviewerId" text,
  "paidAt" timestamp with time zone,
  "externalTransferId" text,
  "proofAssetId" text,
  "failureCode" text,
  "settlementId" text
);

CREATE TABLE "WritingCampaign" (
  "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "title" text NOT NULL,
  "sectionId" text NOT NULL,
  "startsAt" timestamp with time zone NOT NULL,
  "endsAt" timestamp with time zone NOT NULL,
  "rules" jsonb NOT NULL,
  "rewardPolicy" jsonb NOT NULL,
  "state" text NOT NULL
);

ALTER TABLE "AccessRole" ADD CONSTRAINT "AccessRole_code_key" UNIQUE (code);

ALTER TABLE "AccessRole" ADD CONSTRAINT "AccessRole_pkey" PRIMARY KEY (id);

ALTER TABLE "AccessRole" ADD CONSTRAINT "AccessRole_version_check" CHECK (version > 0);

ALTER TABLE "AccessRole" ADD CONSTRAINT "domain_role_code" CHECK (code = ANY (ARRAY['USER'::text, 'TEACHER'::text, 'OPERATOR'::text, 'MODERATOR'::text, 'SUPPORT'::text, 'FINANCE'::text, 'ADMIN'::text]));

ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_pkey" PRIMARY KEY (id);

ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_version_check" CHECK (version > 0);

ALTER TABLE "AdCampaign" ADD CONSTRAINT "domain_AdCampaign_0" CHECK ("endsAt" > "startsAt");

ALTER TABLE "AdPlacement" ADD CONSTRAINT "AdPlacement_code_key" UNIQUE (code);

ALTER TABLE "AdPlacement" ADD CONSTRAINT "AdPlacement_pkey" PRIMARY KEY (id);

ALTER TABLE "AdPlacement" ADD CONSTRAINT "AdPlacement_version_check" CHECK (version > 0);

ALTER TABLE "Address" ADD CONSTRAINT "Address_pkey" PRIMARY KEY (id);

ALTER TABLE "Address" ADD CONSTRAINT "Address_version_check" CHECK (version > 0);

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_orderItemId_key" UNIQUE ("orderItemId");

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_pkey" PRIMARY KEY (id);

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_version_check" CHECK (version > 0);

ALTER TABLE "Appointment" ADD CONSTRAINT "domain_Appointment_0" UNIQUE ("userId", "requestKey");

ALTER TABLE "Appointment" ADD CONSTRAINT "domain_Appointment_1" CHECK (state = ANY (ARRAY['PENDING'::text, 'CONFIRMED'::text, 'CANCEL_PENDING'::text, 'CANCELLED'::text, 'COMPLETED'::text, 'NO_SHOW'::text]));

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "AppointmentSlot_pkey" PRIMARY KEY (id);

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "AppointmentSlot_version_check" CHECK (version > 0);

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "domain_AppointmentSlot_0" UNIQUE ("offeringId", "startsAt");

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "domain_AppointmentSlot_1" CHECK ("endsAt" > "startsAt");

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "domain_AppointmentSlot_2" CHECK (capacity > 0 AND reserved >= 0 AND confirmed >= 0 AND (reserved + confirmed) <= capacity);

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "domain_AppointmentSlot_3" CHECK (state = ANY (ARRAY['OPEN'::text, 'CLOSED'::text, 'CANCELLED'::text]));

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "domain_AppointmentSlot_5" CHECK (capacity = 1);

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "domain_slot_no_overlap" EXCLUDE USING gist ("teacherId" WITH =, tstzrange("startsAt", "endsAt", '[)'::text) WITH &&) WHERE (state <> 'CANCELLED'::text);

ALTER TABLE "Article" ADD CONSTRAINT "Article_pkey" PRIMARY KEY (id);

ALTER TABLE "Article" ADD CONSTRAINT "Article_resourceKind_check" CHECK ("resourceKind" = 'ARTICLE'::text);

ALTER TABLE "ArticleBlock" ADD CONSTRAINT "ArticleBlock_pkey" PRIMARY KEY (id);

ALTER TABLE "ArticleBlock" ADD CONSTRAINT "domain_ArticleBlock_0" UNIQUE ("releaseId", "stableKey");

ALTER TABLE "ArticleBlock" ADD CONSTRAINT "domain_ArticleBlock_1" UNIQUE ("releaseId", "position");

ALTER TABLE "ArticleBlock" ADD CONSTRAINT "domain_ArticleBlock_2" CHECK ("position" >= 0);

ALTER TABLE "ArticleBlock" ADD CONSTRAINT "domain_ArticleBlock_3" CHECK (kind = ANY (ARRAY['PARAGRAPH'::text, 'QUOTE'::text, 'IMAGE'::text, 'AUDIO'::text, 'VIDEO'::text]));

ALTER TABLE "ArticleRelease" ADD CONSTRAINT "ArticleRelease_pkey" PRIMARY KEY (id);

ALTER TABLE "ArticleRelease" ADD CONSTRAINT "domain_ArticleRelease_0" UNIQUE ("articleId", "releaseNo");

ALTER TABLE "ArticleRelease" ADD CONSTRAINT "domain_ArticleRelease_1" UNIQUE (id, "articleId");

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_pkey" PRIMARY KEY (id);

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_version_check" CHECK (version > 0);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "AttachmentBinding_pkey" PRIMARY KEY (id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "AttachmentBinding_version_check" CHECK (version > 0);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_0" CHECK (num_nonnulls("resourceId", "noteId", "logId", "submissionId", "checkinId", "threadId", "reportId", "feedbackId", "feedbackReplyId", "refundId", "operatingServiceId") = 1);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_1" CHECK ("position" >= 0);

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);

ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY (id);

ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_version_check" CHECK (version > 0);

ALTER TABLE "AuthIdentity" ADD CONSTRAINT "domain_AuthIdentity_0" UNIQUE (provider, "appScope", "subjectHash");

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_pkey" PRIMARY KEY (id);

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_version_check" CHECK (version > 0);

ALTER TABLE "AuthSession" ADD CONSTRAINT "domain_AuthSession_0" CHECK (kind = ANY (ARRAY['APP'::text, 'ADMIN'::text]));

ALTER TABLE "AuthSession" ADD CONSTRAINT "domain_AuthSession_1" CHECK ("expiresAt" > "accessExpiresAt");

ALTER TABLE "BenefitDefinition" ADD CONSTRAINT "BenefitDefinition_code_key" UNIQUE (code);

ALTER TABLE "BenefitDefinition" ADD CONSTRAINT "BenefitDefinition_pkey" PRIMARY KEY (id);

ALTER TABLE "BenefitDefinition" ADD CONSTRAINT "BenefitDefinition_version_check" CHECK (version > 0);

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "BenefitGrant_grantKey_key" UNIQUE ("grantKey");

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "BenefitGrant_pkey" PRIMARY KEY (id);

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "BenefitGrant_version_check" CHECK (version > 0);

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "domain_BenefitGrant_0" CHECK (quota > 0 AND "endsAt" > "startsAt");

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "domain_BenefitGrant_1" CHECK (num_nonnulls("growthLedgerId", "redemptionId") <= 1);

ALTER TABLE "BenefitScope" ADD CONSTRAINT "BenefitScope_pkey" PRIMARY KEY (id);

ALTER TABLE "BenefitScope" ADD CONSTRAINT "domain_BenefitScope_0" CHECK (num_nonnulls("resourceId", "offerId", "categoryCode") = 1);

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "BenefitUsage_pkey" PRIMARY KEY (id);

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "BenefitUsage_reversalOfId_key" UNIQUE ("reversalOfId");

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "BenefitUsage_version_check" CHECK (version > 0);

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "domain_BenefitUsage_0" UNIQUE ("userId", "businessKey");

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "domain_BenefitUsage_1" CHECK (quantity > 0 AND "windowEnd" >= "windowStart");

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "domain_BenefitUsage_2" CHECK (state = ANY (ARRAY['HELD'::text, 'CONSUMED'::text, 'RELEASED'::text, 'REVERSED'::text]));

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "domain_BenefitUsage_3" CHECK (num_nonnulls("periodId", "grantId") = 1);

ALTER TABLE "CampaignEntry" ADD CONSTRAINT "CampaignEntry_pkey" PRIMARY KEY (id);

ALTER TABLE "CampaignEntry" ADD CONSTRAINT "CampaignEntry_rewardKey_key" UNIQUE ("rewardKey");

ALTER TABLE "CampaignEntry" ADD CONSTRAINT "CampaignEntry_version_check" CHECK (version > 0);

ALTER TABLE "CampaignEntry" ADD CONSTRAINT "domain_CampaignEntry_0" UNIQUE ("campaignId", "threadId");

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_pkey" PRIMARY KEY (id);

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_check" CHECK (quantity >= 1 AND quantity <= 99);

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_version_check" CHECK (version > 0);

ALTER TABLE "CartItem" ADD CONSTRAINT "domain_CartItem_0" UNIQUE ("userId", "offerId");

ALTER TABLE "CartItem" ADD CONSTRAINT "domain_CartItem_1" CHECK (quantity >= 1 AND quantity <= 99);

ALTER TABLE "ChannelProductMapping" ADD CONSTRAINT "ChannelProductMapping_pkey" PRIMARY KEY (id);

ALTER TABLE "ChannelProductMapping" ADD CONSTRAINT "ChannelProductMapping_version_check" CHECK (version > 0);

ALTER TABLE "ChannelProductMapping" ADD CONSTRAINT "domain_ChannelProductMapping_0" UNIQUE (channel, "appScope", "externalProductId");

ALTER TABLE "ChannelProductMapping" ADD CONSTRAINT "domain_ChannelProductMapping_1" CHECK ("priceMinor" IS NULL OR "priceMinor" >= 0);

ALTER TABLE "ChannelProductMapping" ADD CONSTRAINT "domain_ChannelProductMapping_2" CHECK ("minorExponent" >= 0 AND "minorExponent" <= 3);

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_pkey" PRIMARY KEY (id);

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_version_check" CHECK (version > 0);

ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_eventKey_key" UNIQUE ("eventKey");

ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_pkey" PRIMARY KEY (id);

ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_reversalOfId_key" UNIQUE ("reversalOfId");

ALTER TABLE "CommissionLedger" ADD CONSTRAINT "domain_CommissionLedger_0" CHECK (delta <> 0 AND "rateBasisPoints" >= 0 AND "rateBasisPoints" <= 10000);

ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY (id);

ALTER TABLE "ConsumedRefresh" ADD CONSTRAINT "ConsumedRefresh_id_key" UNIQUE (id);

ALTER TABLE "ConsumedRefresh" ADD CONSTRAINT "ConsumedRefresh_pkey" PRIMARY KEY (hash);

ALTER TABLE "ContentAuthorization" ADD CONSTRAINT "ContentAuthorization_pkey" PRIMARY KEY (id);

ALTER TABLE "ContentAuthorization" ADD CONSTRAINT "ContentAuthorization_version_check" CHECK (version > 0);

ALTER TABLE "ContentAuthorization" ADD CONSTRAINT "domain_ContentAuthorization_0" CHECK (num_nonnulls("threadId", "noteId", "logId") = 1);

ALTER TABLE "ContentRelation" ADD CONSTRAINT "ContentRelation_pkey" PRIMARY KEY (id);

ALTER TABLE "ContentRelation" ADD CONSTRAINT "ContentRelation_version_check" CHECK (version > 0);

ALTER TABLE "ContentRelation" ADD CONSTRAINT "domain_ContentRelation_0" UNIQUE ("fromId", "toId", "relationType");

ALTER TABLE "ContentRelation" ADD CONSTRAINT "domain_ContentRelation_1" CHECK ("fromId" <> "toId");

ALTER TABLE "ContentRelation" ADD CONSTRAINT "domain_ContentRelation_2" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt");

ALTER TABLE "CouponTemplate" ADD CONSTRAINT "CouponTemplate_code_key" UNIQUE (code);

ALTER TABLE "CouponTemplate" ADD CONSTRAINT "CouponTemplate_pkey" PRIMARY KEY (id);

ALTER TABLE "CouponTemplate" ADD CONSTRAINT "CouponTemplate_version_check" CHECK (version > 0);

ALTER TABLE "CouponTemplate" ADD CONSTRAINT "domain_CouponTemplate_0" CHECK ("discountValue" > 0 AND threshold >= 0 AND "totalLimit" >= "issuedCount" AND "issuedCount" >= 0 AND "perUserLimit" > 0);

ALTER TABLE "CouponTemplate" ADD CONSTRAINT "domain_CouponTemplate_1" CHECK ("endsAt" > "startsAt");

ALTER TABLE "Course" ADD CONSTRAINT "Course_pkey" PRIMARY KEY (id);

ALTER TABLE "Course" ADD CONSTRAINT "Course_resourceKind_check" CHECK ("resourceKind" = 'COURSE'::text);

ALTER TABLE "Course" ADD CONSTRAINT "domain_Course_0" CHECK (format = ANY (ARRAY['VIDEO'::"CourseFormat", 'AUDIO'::"CourseFormat", 'LIVE'::"CourseFormat", 'COHORT'::"CourseFormat", 'OFFLINE'::"CourseFormat"]));

ALTER TABLE "Course" ADD CONSTRAINT "domain_Course_1" CHECK ("accessDays" IS NULL OR "accessDays" > 0);

ALTER TABLE "CourseChapter" ADD CONSTRAINT "CourseChapter_pkey" PRIMARY KEY (id);

ALTER TABLE "CourseChapter" ADD CONSTRAINT "CourseChapter_version_check" CHECK (version > 0);

ALTER TABLE "CourseChapter" ADD CONSTRAINT "domain_CourseChapter_0" UNIQUE ("courseId", "stableKey");

ALTER TABLE "CourseChapter" ADD CONSTRAINT "domain_CourseChapter_1" CHECK ("position" >= 0 AND "durationSeconds" >= 0);

ALTER TABLE "CourseCohort" ADD CONSTRAINT "CourseCohort_pkey" PRIMARY KEY (id);

ALTER TABLE "CourseCohort" ADD CONSTRAINT "CourseCohort_version_check" CHECK (version > 0);

ALTER TABLE "CourseCohort" ADD CONSTRAINT "domain_CourseCohort_0" CHECK ("endsAt" > "startsAt");

ALTER TABLE "CourseCohort" ADD CONSTRAINT "domain_CourseCohort_1" CHECK (capacity >= 0 AND reserved >= 0 AND confirmed >= 0 AND (reserved + confirmed) <= capacity);

ALTER TABLE "CourseCohort" ADD CONSTRAINT "domain_CourseCohort_2" UNIQUE (id, "courseId");

ALTER TABLE "CourseRelease" ADD CONSTRAINT "CourseRelease_pkey" PRIMARY KEY (id);

ALTER TABLE "CourseRelease" ADD CONSTRAINT "domain_CourseRelease_0" UNIQUE ("courseId", version);

ALTER TABLE "CourseRelease" ADD CONSTRAINT "domain_CourseRelease_1" UNIQUE (id, "courseId");

ALTER TABLE "CourseStaff" ADD CONSTRAINT "CourseStaff_pkey" PRIMARY KEY (id);

ALTER TABLE "CourseStaff" ADD CONSTRAINT "CourseStaff_version_check" CHECK (version > 0);

ALTER TABLE "CourseStaff" ADD CONSTRAINT "domain_CourseStaff_0" CHECK (role = ANY (ARRAY['TEACHER'::text, 'ASSISTANT'::text]));

ALTER TABLE "DeliveryTemplate" ADD CONSTRAINT "DeliveryTemplate_pkey" PRIMARY KEY (id);

ALTER TABLE "DeliveryTemplate" ADD CONSTRAINT "DeliveryTemplate_version_check" CHECK (version > 0);

ALTER TABLE "DeliveryTemplate" ADD CONSTRAINT "domain_DeliveryTemplate_0" CHECK ("chargeBasis" = ANY (ARRAY['ORDER'::text, 'QUANTITY'::text, 'WEIGHT'::text]));

ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_fee_check" CHECK (fee >= 0);

ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_freeAbove_check" CHECK ("freeAbove" >= 0);

ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY (province);

ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_surcharge_check" CHECK (surcharge >= 0);

ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_pkey" PRIMARY KEY (id);

ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_tokenHash_key" UNIQUE ("tokenHash");

ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_version_check" CHECK (version > 0);

ALTER TABLE "DigitalDelivery" ADD CONSTRAINT "DigitalDelivery_grantKey_key" UNIQUE ("grantKey");

ALTER TABLE "DigitalDelivery" ADD CONSTRAINT "DigitalDelivery_orderItemId_key" UNIQUE ("orderItemId");

ALTER TABLE "DigitalDelivery" ADD CONSTRAINT "DigitalDelivery_pkey" PRIMARY KEY (id);

ALTER TABLE "DigitalDelivery" ADD CONSTRAINT "DigitalDelivery_version_check" CHECK (version > 0);

ALTER TABLE "DigitalDelivery" ADD CONSTRAINT "domain_DigitalDelivery_0" CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt");

ALTER TABLE "DigitalRelease" ADD CONSTRAINT "DigitalRelease_pkey" PRIMARY KEY (id);

ALTER TABLE "DigitalRelease" ADD CONSTRAINT "domain_DigitalRelease_0" UNIQUE ("productId", "releaseNo");

ALTER TABLE "DigitalRelease" ADD CONSTRAINT "domain_DigitalRelease_1" CHECK ("accessDays" IS NULL OR "accessDays" > 0);

ALTER TABLE "DigitalReleaseAsset" ADD CONSTRAINT "DigitalReleaseAsset_pkey" PRIMARY KEY (id);

ALTER TABLE "DigitalReleaseAsset" ADD CONSTRAINT "domain_DigitalReleaseAsset_0" UNIQUE ("releaseId", "assetId");

ALTER TABLE "DigitalReleaseAsset" ADD CONSTRAINT "domain_DigitalReleaseAsset_1" UNIQUE ("releaseId", "position");

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_grantKey_key" UNIQUE ("grantKey");

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_orderItemId_key" UNIQUE ("orderItemId");

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_pkey" PRIMARY KEY (id);

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_version_check" CHECK (version > 0);

ALTER TABLE "Enrollment" ADD CONSTRAINT "domain_Enrollment_1" CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt");

ALTER TABLE "Event" ADD CONSTRAINT "Event_pkey" PRIMARY KEY (id);

ALTER TABLE "Event" ADD CONSTRAINT "Event_resourceKind_check" CHECK ("resourceKind" = 'EVENT'::text);

ALTER TABLE "Event" ADD CONSTRAINT "Event_version_check" CHECK (version > 0);

ALTER TABLE "EventCheckin" ADD CONSTRAINT "EventCheckin_pkey" PRIMARY KEY (id);

ALTER TABLE "EventCheckin" ADD CONSTRAINT "EventCheckin_requestKey_key" UNIQUE ("requestKey");

ALTER TABLE "EventCheckin" ADD CONSTRAINT "domain_EventCheckin_0" UNIQUE ("registrationId", "attendeeNo");

ALTER TABLE "EventCheckin" ADD CONSTRAINT "domain_EventCheckin_1" CHECK ("attendeeNo" > 0);

ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_checkinHash_key" UNIQUE ("checkinHash");

ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_orderItemId_key" UNIQUE ("orderItemId");

ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_pkey" PRIMARY KEY (id);

ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_version_check" CHECK (version > 0);

ALTER TABLE "EventRegistration" ADD CONSTRAINT "domain_EventRegistration_0" UNIQUE ("userId", "requestKey");

ALTER TABLE "EventRegistration" ADD CONSTRAINT "domain_EventRegistration_1" CHECK (quantity > 0);

ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_pkey" PRIMARY KEY (id);

ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_version_check" CHECK (version > 0);

ALTER TABLE "EventSession" ADD CONSTRAINT "domain_EventSession_0" CHECK ("endsAt" > "startsAt" AND capacity > 0);

ALTER TABLE "EventSession" ADD CONSTRAINT "domain_EventSession_1" CHECK ("memberOpenAt" IS NULL OR "memberOpenAt" <= "publicOpenAt");

ALTER TABLE "EventStaff" ADD CONSTRAINT "EventStaff_pkey" PRIMARY KEY (id);

ALTER TABLE "EventStaff" ADD CONSTRAINT "EventStaff_version_check" CHECK (version > 0);

ALTER TABLE "EventTicketType" ADD CONSTRAINT "EventTicketType_pkey" PRIMARY KEY (id);

ALTER TABLE "EventTicketType" ADD CONSTRAINT "EventTicketType_version_check" CHECK (version > 0);

ALTER TABLE "EventTicketType" ADD CONSTRAINT "domain_EventTicketType_0" CHECK (capacity >= 0 AND reserved >= 0 AND confirmed >= 0 AND (reserved + confirmed) <= capacity AND "perUserLimit" > 0);

ALTER TABLE "EventWaitlist" ADD CONSTRAINT "EventWaitlist_pkey" PRIMARY KEY (id);

ALTER TABLE "EventWaitlist" ADD CONSTRAINT "EventWaitlist_version_check" CHECK (version > 0);

ALTER TABLE "EventWaitlist" ADD CONSTRAINT "domain_EventWaitlist_0" UNIQUE ("sessionId", "userId");

ALTER TABLE "EventWaitlist" ADD CONSTRAINT "domain_EventWaitlist_1" CHECK (quantity > 0);

ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_pkey" PRIMARY KEY (id);

ALTER TABLE "FeatureConfig" ADD CONSTRAINT "FeatureConfig_pkey" PRIMARY KEY (id);

ALTER TABLE "FeatureConfig" ADD CONSTRAINT "domain_FeatureConfig_0" UNIQUE ("configKey", revision);

ALTER TABLE "FeatureConfig" ADD CONSTRAINT "domain_FeatureConfig_1" CHECK (revision > 0);

ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_pkey" PRIMARY KEY (id);

ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_version_check" CHECK (version > 0);

ALTER TABLE "FeedbackReply" ADD CONSTRAINT "FeedbackReply_pkey" PRIMARY KEY (id);

ALTER TABLE "FinanceAccount" ADD CONSTRAINT "FinanceAccount_code_key" UNIQUE (code);

ALTER TABLE "FinanceAccount" ADD CONSTRAINT "FinanceAccount_pkey" PRIMARY KEY (id);

ALTER TABLE "FinanceAccount" ADD CONSTRAINT "FinanceAccount_version_check" CHECK (version > 0);

ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY (id);

ALTER TABLE "FinanceEntry" ADD CONSTRAINT "domain_FinanceEntry_0" CHECK (debit > 0 AND credit = 0 OR credit > 0 AND debit = 0);

ALTER TABLE "FinanceJournal" ADD CONSTRAINT "FinanceJournal_eventKey_key" UNIQUE ("eventKey");

ALTER TABLE "FinanceJournal" ADD CONSTRAINT "FinanceJournal_pkey" PRIMARY KEY (id);

ALTER TABLE "FinanceJournal" ADD CONSTRAINT "FinanceJournal_reversalOfId_key" UNIQUE ("reversalOfId");

ALTER TABLE "ForumSection" ADD CONSTRAINT "ForumSection_code_key" UNIQUE (code);

ALTER TABLE "ForumSection" ADD CONSTRAINT "ForumSection_pkey" PRIMARY KEY (id);

ALTER TABLE "ForumSection" ADD CONSTRAINT "ForumSection_version_check" CHECK (version > 0);

ALTER TABLE "ForumSection" ADD CONSTRAINT "domain_ForumSection_0" CHECK (scope = ANY (ARRAY['PUBLIC'::text, 'COURSE'::text]));

ALTER TABLE "ForumSection" ADD CONSTRAINT "domain_ForumSection_1" CHECK ((scope = 'COURSE'::text) = ("courseId" IS NOT NULL));

ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_pkey" PRIMARY KEY (id);

ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_resourceKind_check" CHECK ("resourceKind" = 'THREAD'::text);

ALTER TABLE "ForumThread" ADD CONSTRAINT "ForumThread_version_check" CHECK (version > 0);

ALTER TABLE "GiftCreditAllocation" ADD CONSTRAINT "GiftCreditAllocation_pkey" PRIMARY KEY (id);

ALTER TABLE "GiftCreditAllocation" ADD CONSTRAINT "GiftCreditAllocation_reversalOfId_key" UNIQUE ("reversalOfId");

ALTER TABLE "GiftCreditAllocation" ADD CONSTRAINT "domain_GiftCreditAllocation_0" UNIQUE ("debitLedgerId", "creditLedgerId");

ALTER TABLE "GiftCreditAllocation" ADD CONSTRAINT "domain_GiftCreditAllocation_1" CHECK (credits > 0 AND "allocatedPaidMinor" >= 0 AND "allocatedFeeMinor" >= 0);

ALTER TABLE "GiftLedger" ADD CONSTRAINT "GiftLedger_eventKey_key" UNIQUE ("eventKey");

ALTER TABLE "GiftLedger" ADD CONSTRAINT "GiftLedger_pkey" PRIMARY KEY (id);

ALTER TABLE "GiftLedger" ADD CONSTRAINT "GiftLedger_reversalOfId_key" UNIQUE ("reversalOfId");

ALTER TABLE "GiftLedger" ADD CONSTRAINT "domain_GiftLedger_0" CHECK (delta <> 0 AND "balanceAfter" >= 0);

ALTER TABLE "GiftLedger" ADD CONSTRAINT "domain_GiftLedger_1" CHECK (quantity IS NULL OR quantity > 0);

ALTER TABLE "GiftWallet" ADD CONSTRAINT "GiftWallet_pkey" PRIMARY KEY (id);

ALTER TABLE "GiftWallet" ADD CONSTRAINT "GiftWallet_userId_key" UNIQUE ("userId");

ALTER TABLE "GiftWallet" ADD CONSTRAINT "GiftWallet_version_check" CHECK (version > 0);

ALTER TABLE "GiftWallet" ADD CONSTRAINT "domain_GiftWallet_0" CHECK (balance >= 0);

ALTER TABLE "GroupBuy" ADD CONSTRAINT "GroupBuy_pkey" PRIMARY KEY (id);

ALTER TABLE "GroupBuy" ADD CONSTRAINT "GroupBuy_version_check" CHECK (version > 0);

ALTER TABLE "GroupBuy" ADD CONSTRAINT "domain_GroupBuy_0" CHECK ("requiredMembers" >= 2);

ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "GroupBuyMember_orderItemId_key" UNIQUE ("orderItemId");

ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "GroupBuyMember_pkey" PRIMARY KEY (id);

ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "GroupBuyMember_version_check" CHECK (version > 0);

ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "domain_GroupBuyMember_0" UNIQUE ("groupId", "userId");

ALTER TABLE "GrowthLedger" ADD CONSTRAINT "GrowthLedger_eventKey_key" UNIQUE ("eventKey");

ALTER TABLE "GrowthLedger" ADD CONSTRAINT "GrowthLedger_pkey" PRIMARY KEY (id);

ALTER TABLE "GrowthLedger" ADD CONSTRAINT "GrowthLedger_reversalOfId_key" UNIQUE ("reversalOfId");

ALTER TABLE "GrowthLedger" ADD CONSTRAINT "domain_GrowthLedger_0" CHECK (delta <> 0);

ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY (id);

ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_version_check" CHECK (version > 0);

ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "domain_IdempotencyRecord_0" UNIQUE ("userId", operation, "requestKey");

ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_eventKey_key" UNIQUE ("eventKey");

ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY (id);

ALTER TABLE "InventoryLedger" ADD CONSTRAINT "domain_InventoryLedger_0" CHECK ("stockAfter" >= "reservedAfter" AND "reservedAfter" >= 0);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY (id);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_requestKey_key" UNIQUE ("requestKey");

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_version_check" CHECK (version > 0);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "domain_InventoryReservation_0" CHECK (num_nonnulls("skuId", "slotId", "eventTicketId", "cohortId") = 1);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "domain_InventoryReservation_1" CHECK (quantity > 0);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "domain_InventoryReservation_2" CHECK (state = ANY (ARRAY['HELD'::text, 'CONVERTED'::text, 'RELEASED'::text]));

ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_pkey" PRIMARY KEY (id);

ALTER TABLE "Lesson" ADD CONSTRAINT "domain_Lesson_0" UNIQUE ("releaseId", "position");

ALTER TABLE "Lesson" ADD CONSTRAINT "domain_Lesson_1" UNIQUE ("releaseId", "sourceId");

ALTER TABLE "Lesson" ADD CONSTRAINT "domain_Lesson_2" CHECK (format = ANY (ARRAY['TEXT'::"LessonFormat", 'AUDIO'::"LessonFormat", 'VIDEO'::"LessonFormat", 'LIVE'::"LessonFormat", 'OFFLINE'::"LessonFormat"]));

ALTER TABLE "Lesson" ADD CONSTRAINT "domain_Lesson_3" CHECK ("durationSeconds" >= 0);

ALTER TABLE "LiveMicRequest" ADD CONSTRAINT "LiveMicRequest_pkey" PRIMARY KEY (id);

ALTER TABLE "LiveMicRequest" ADD CONSTRAINT "LiveMicRequest_version_check" CHECK (version > 0);

ALTER TABLE "LiveMicRequest" ADD CONSTRAINT "domain_LiveMicRequest_0" CHECK (state = ANY (ARRAY['WAITING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CONNECTED'::text, 'ENDED'::text, 'CANCELLED'::text]));

ALTER TABLE "LivePoll" ADD CONSTRAINT "LivePoll_pkey" PRIMARY KEY (id);

ALTER TABLE "LivePoll" ADD CONSTRAINT "LivePoll_version_check" CHECK (version > 0);

ALTER TABLE "LiveReplay" ADD CONSTRAINT "LiveReplay_pkey" PRIMARY KEY (id);

ALTER TABLE "LiveReplay" ADD CONSTRAINT "LiveReplay_sessionId_key" UNIQUE ("sessionId");

ALTER TABLE "LiveReplay" ADD CONSTRAINT "LiveReplay_version_check" CHECK (version > 0);

ALTER TABLE "LiveReservation" ADD CONSTRAINT "LiveReservation_pkey" PRIMARY KEY (id);

ALTER TABLE "LiveReservation" ADD CONSTRAINT "LiveReservation_version_check" CHECK (version > 0);

ALTER TABLE "LiveReservation" ADD CONSTRAINT "domain_LiveReservation_0" UNIQUE ("sessionId", "userId");

ALTER TABLE "LiveRoom" ADD CONSTRAINT "LiveRoom_pkey" PRIMARY KEY (id);

ALTER TABLE "LiveRoom" ADD CONSTRAINT "LiveRoom_resourceKind_check" CHECK ("resourceKind" = 'LIVE'::text);

ALTER TABLE "LiveRoom" ADD CONSTRAINT "LiveRoom_version_check" CHECK (version > 0);

ALTER TABLE "LiveRoom" ADD CONSTRAINT "domain_LiveRoom_0" UNIQUE (provider, "providerRoomId");

ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_pkey" PRIMARY KEY (id);

ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_version_check" CHECK (version > 0);

ALTER TABLE "LiveSession" ADD CONSTRAINT "domain_LiveSession_0" UNIQUE ("roomId", "scheduledAt");

ALTER TABLE "LiveSession" ADD CONSTRAINT "domain_LiveSession_1" CHECK (state = ANY (ARRAY['SCHEDULED'::text, 'PREPARING'::text, 'LIVE'::text, 'ENDED'::text, 'REPLAY_READY'::text, 'CANCELLED'::text]));

ALTER TABLE "LiveSession" ADD CONSTRAINT "domain_LiveSession_2" CHECK ("endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_pkey" PRIMARY KEY (id);

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_version_check" CHECK (version > 0);

ALTER TABLE "MediaAsset" ADD CONSTRAINT "domain_MediaAsset_0" CHECK (bytes >= 0);

ALTER TABLE "MediaAsset" ADD CONSTRAINT "domain_MediaAsset_1" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0);

ALTER TABLE "MediaAsset" ADD CONSTRAINT "domain_MediaAsset_2" CHECK (status = ANY (ARRAY['UPLOADING'::text, 'PROCESSING'::text, 'REVIEW'::text, 'READY'::text, 'REJECTED'::text, 'DELETED'::text]));

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_grantKey_key" UNIQUE ("grantKey");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orderItemId_key" UNIQUE ("orderItemId");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_pkey" PRIMARY KEY (id);

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_version_check" CHECK (version > 0);

ALTER TABLE "Membership" ADD CONSTRAINT "domain_Membership_0" CHECK (tier >= 1 AND tier <= 3 AND "endsAt" > "startsAt");

ALTER TABLE "Membership" ADD CONSTRAINT "domain_member_no_overlap" EXCLUDE USING gist ("userId" WITH =, tstzrange(("startsAt" AT TIME ZONE 'UTC'::text), ("endsAt" AT TIME ZONE 'UTC'::text), '[)'::text) WITH &&) WHERE ("revokedAt" IS NULL);

ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_code_key" UNIQUE (code);

ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY (id);

ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_version_check" CHECK (version > 0);

ALTER TABLE "MembershipPlan" ADD CONSTRAINT "domain_MembershipPlan_0" UNIQUE (tier, days);

ALTER TABLE "MembershipPlan" ADD CONSTRAINT "domain_MembershipPlan_1" CHECK (tier >= 1 AND tier <= 3 AND (days = ANY (ARRAY[30, 90, 365])));

ALTER TABLE "MembershipPlanVersion" ADD CONSTRAINT "MembershipPlanVersion_pkey" PRIMARY KEY (id);

ALTER TABLE "MembershipPlanVersion" ADD CONSTRAINT "domain_MembershipPlanVersion_0" UNIQUE ("planId", "releaseNo");

ALTER TABLE "MembershipPlanVersion" ADD CONSTRAINT "domain_MembershipPlanVersion_1" CHECK (tier >= 1 AND tier <= 3 AND days > 0);

ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_pkey" PRIMARY KEY (id);

ALTER TABLE "Note" ADD CONSTRAINT "Note_pkey" PRIMARY KEY (id);

ALTER TABLE "Note" ADD CONSTRAINT "Note_version_check" CHECK (version > 0);

ALTER TABLE "Note" ADD CONSTRAINT "domain_Note_0" CHECK ("rangeStart" IS NULL AND "rangeEnd" IS NULL OR "rangeStart" >= 0 AND "rangeEnd" > "rangeStart");

ALTER TABLE "NoteExport" ADD CONSTRAINT "NoteExport_pkey" PRIMARY KEY (id);

ALTER TABLE "NoteExport" ADD CONSTRAINT "NoteExport_version_check" CHECK (version > 0);

ALTER TABLE "NoteExport" ADD CONSTRAINT "domain_NoteExport_0" UNIQUE ("userId", "requestKey");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_pkey" PRIMARY KEY (id);

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_version_check" CHECK (version > 0);

ALTER TABLE "Notification" ADD CONSTRAINT "domain_Notification_0" UNIQUE ("userId", "eventKey");

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_deliveryKey_key" UNIQUE ("deliveryKey");

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY (id);

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_version_check" CHECK (version > 0);

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "domain_NotificationDelivery_0" CHECK (attempts >= 0);

ALTER TABLE "OfflineLicense" ADD CONSTRAINT "OfflineLicense_licenseHash_key" UNIQUE ("licenseHash");

ALTER TABLE "OfflineLicense" ADD CONSTRAINT "OfflineLicense_pkey" PRIMARY KEY (id);

ALTER TABLE "OfflineLicense" ADD CONSTRAINT "OfflineLicense_version_check" CHECK (version > 0);

ALTER TABLE "OperatingService" ADD CONSTRAINT "OperatingService_pkey" PRIMARY KEY (id);

ALTER TABLE "OperatingService" ADD CONSTRAINT "OperatingService_version_check" CHECK (version > 0);

ALTER TABLE "Order" ADD CONSTRAINT "Order_check" CHECK (total = (subtotal + shipping));

ALTER TABLE "Order" ADD CONSTRAINT "Order_closed_state" CHECK ((status = 'CLOSED'::"OrderStatus") = ("closedAt" IS NOT NULL));

ALTER TABLE "Order" ADD CONSTRAINT "Order_pkey" PRIMARY KEY (id);

ALTER TABLE "Order" ADD CONSTRAINT "Order_shipping_check" CHECK (shipping >= 0);

ALTER TABLE "Order" ADD CONSTRAINT "Order_subtotal_check" CHECK (subtotal >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_check" CHECK (subtotal = ("unitPrice" * quantity));

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_pkey" PRIMARY KEY (id);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_check" CHECK (quantity >= 1 AND quantity <= 99);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitPrice_check" CHECK ("unitPrice" >= 0);

ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY (id);

ALTER TABLE "OtpChallenge" ADD CONSTRAINT "domain_OtpChallenge_0" CHECK (attempts >= 0 AND attempts <= 5);

ALTER TABLE "OutboxJob" ADD CONSTRAINT "OutboxJob_eventKey_key" UNIQUE ("eventKey");

ALTER TABLE "OutboxJob" ADD CONSTRAINT "OutboxJob_pkey" PRIMARY KEY (id);

ALTER TABLE "OutboxJob" ADD CONSTRAINT "OutboxJob_version_check" CHECK (version > 0);

ALTER TABLE "OutboxJob" ADD CONSTRAINT "domain_OutboxJob_0" CHECK (attempts >= 0);

ALTER TABLE "OutboxJob" ADD CONSTRAINT "domain_OutboxJob_1" CHECK (state = ANY (ARRAY['READY'::text, 'RUNNING'::text, 'DONE'::text, 'DEAD'::text]));

ALTER TABLE "Partner" ADD CONSTRAINT "Partner_code_key" UNIQUE (code);

ALTER TABLE "Partner" ADD CONSTRAINT "Partner_pkey" PRIMARY KEY (id);

ALTER TABLE "Partner" ADD CONSTRAINT "Partner_version_check" CHECK (version > 0);

ALTER TABLE "PartnerContract" ADD CONSTRAINT "PartnerContract_pkey" PRIMARY KEY (id);

ALTER TABLE "PartnerContract" ADD CONSTRAINT "domain_PartnerContract_0" UNIQUE ("contractNo", revision);

ALTER TABLE "PartnerContract" ADD CONSTRAINT "domain_PartnerContract_1" CHECK ("rateBasisPoints" >= 0 AND "rateBasisPoints" <= 10000);

ALTER TABLE "PartnerContract" ADD CONSTRAINT "domain_PartnerContract_2" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY (id);

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_requestKey_key" UNIQUE ("requestKey");

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_version_check" CHECK (version > 0);

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "domain_PaymentAttempt_0" CHECK (amount >= 0);

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "domain_PaymentAttempt_1" CHECK (state = ANY (ARRAY['CREATED'::text, 'PENDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CLOSED'::text]));

ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY (id);

ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "domain_PaymentTransaction_0" UNIQUE (channel, "appScope", "externalTransactionId");

ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "domain_PaymentTransaction_1" CHECK (amount >= 0 AND "channelFee" >= 0);

ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "domain_PaymentTransaction_2" CHECK (disposition = ANY (ARRAY['ACCEPTED'::text, 'DUPLICATE'::text, 'LATE'::text, 'AMOUNT_MISMATCH'::text, 'REFUND_REQUIRED'::text]));

ALTER TABLE "PlanBenefit" ADD CONSTRAINT "PlanBenefit_pkey" PRIMARY KEY (id);

ALTER TABLE "PlanBenefit" ADD CONSTRAINT "domain_PlanBenefit_0" UNIQUE ("planVersionId", "definitionId");

ALTER TABLE "PlanBenefit" ADD CONSTRAINT "domain_PlanBenefit_1" CHECK (quota IS NULL OR quota >= 0);

ALTER TABLE "PointsAccount" ADD CONSTRAINT "PointsAccount_pkey" PRIMARY KEY (id);

ALTER TABLE "PointsAccount" ADD CONSTRAINT "PointsAccount_userId_key" UNIQUE ("userId");

ALTER TABLE "PointsAccount" ADD CONSTRAINT "PointsAccount_version_check" CHECK (version > 0);

ALTER TABLE "PointsAccount" ADD CONSTRAINT "domain_PointsAccount_0" CHECK (balance >= reserved AND reserved >= 0);

ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_eventKey_key" UNIQUE ("eventKey");

ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_pkey" PRIMARY KEY (id);

ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_reversalOfId_key" UNIQUE ("reversalOfId");

ALTER TABLE "PointsLedger" ADD CONSTRAINT "domain_PointsLedger_0" CHECK (delta <> 0 AND "balanceAfter" >= 0);

ALTER TABLE "PointsRedemption" ADD CONSTRAINT "PointsRedemption_pkey" PRIMARY KEY (id);

ALTER TABLE "PointsRedemption" ADD CONSTRAINT "PointsRedemption_version_check" CHECK (version > 0);

ALTER TABLE "PointsRedemption" ADD CONSTRAINT "domain_PointsRedemption_0" UNIQUE ("userId", "requestKey");

ALTER TABLE "PointsRedemption" ADD CONSTRAINT "domain_PointsRedemption_1" CHECK ("pointsCost" > 0);

ALTER TABLE "PointsReservation" ADD CONSTRAINT "PointsReservation_pkey" PRIMARY KEY (id);

ALTER TABLE "PointsReservation" ADD CONSTRAINT "PointsReservation_requestKey_key" UNIQUE ("requestKey");

ALTER TABLE "PointsReservation" ADD CONSTRAINT "PointsReservation_version_check" CHECK (version > 0);

ALTER TABLE "PointsReservation" ADD CONSTRAINT "domain_PointsReservation_0" CHECK (points > 0);

ALTER TABLE "PointsReservation" ADD CONSTRAINT "domain_PointsReservation_1" CHECK (state = ANY (ARRAY['HELD'::text, 'CONSUMED'::text, 'RELEASED'::text]));

ALTER TABLE "PointsReward" ADD CONSTRAINT "PointsReward_pkey" PRIMARY KEY (id);

ALTER TABLE "PointsReward" ADD CONSTRAINT "PointsReward_version_check" CHECK (version > 0);

ALTER TABLE "PointsReward" ADD CONSTRAINT "domain_PointsReward_0" CHECK (num_nonnulls("couponTemplateId", "offerId", "benefitDefinitionId") = 1);

ALTER TABLE "PointsReward" ADD CONSTRAINT "domain_PointsReward_1" CHECK ("pointsCost" > 0 AND stock >= reserved AND reserved >= 0 AND "perUserDaily" > 0);

ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pkey" PRIMARY KEY (id);

ALTER TABLE "PollOption" ADD CONSTRAINT "domain_PollOption_0" UNIQUE ("pollId", "position");

ALTER TABLE "PollOption" ADD CONSTRAINT "domain_PollOption_1" UNIQUE (id, "pollId");

ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_pkey" PRIMARY KEY (id);

ALTER TABLE "PollVote" ADD CONSTRAINT "domain_PollVote_1" UNIQUE ("pollId", "userId", "optionId");

ALTER TABLE "PracticeCheckin" ADD CONSTRAINT "PracticeCheckin_pkey" PRIMARY KEY (id);

ALTER TABLE "PracticeCheckin" ADD CONSTRAINT "PracticeCheckin_rewardEventKey_key" UNIQUE ("rewardEventKey");

ALTER TABLE "PracticeCheckin" ADD CONSTRAINT "PracticeCheckin_version_check" CHECK (version > 0);

ALTER TABLE "PracticeCheckin" ADD CONSTRAINT "domain_PracticeCheckin_0" UNIQUE ("taskId", "userId", "businessDay");

ALTER TABLE "PracticeLog" ADD CONSTRAINT "PracticeLog_pkey" PRIMARY KEY (id);

ALTER TABLE "PracticeLog" ADD CONSTRAINT "PracticeLog_version_check" CHECK (version > 0);

ALTER TABLE "PracticeLog" ADD CONSTRAINT "domain_PracticeLog_0" UNIQUE ("userId", day);

ALTER TABLE "PracticeTask" ADD CONSTRAINT "PracticeTask_pkey" PRIMARY KEY (id);

ALTER TABLE "PracticeTask" ADD CONSTRAINT "PracticeTask_version_check" CHECK (version > 0);

ALTER TABLE "PracticeTask" ADD CONSTRAINT "domain_PracticeTask_0" CHECK ("requiredDays" > 0);

ALTER TABLE "PracticeTask" ADD CONSTRAINT "domain_PracticeTask_1" CHECK ("endsOn" IS NULL OR "startsOn" IS NULL OR "endsOn" >= "startsOn");

ALTER TABLE "Product" ADD CONSTRAINT "Product_pkey" PRIMARY KEY (id);

ALTER TABLE "Product" ADD CONSTRAINT "Product_resourceKind_check" CHECK ("resourceKind" = 'PRODUCT'::text);

ALTER TABLE "Product" ADD CONSTRAINT "domain_Product_0" CHECK (type = ANY (ARRAY['PHYSICAL'::"ProductType", 'DIGITAL'::"ProductType", 'SERVICE'::"ProductType"]));

ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_code_key" UNIQUE (code);

ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_inventory_check" CHECK (stock >= reserved AND reserved >= 0);

ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_pkey" PRIMARY KEY (id);

ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_price_check" CHECK (price >= 0);

ALTER TABLE "ProductSku" ADD CONSTRAINT "domain_ProductSku_0" CHECK (stock >= reserved AND reserved >= 0);

ALTER TABLE "ProductSku" ADD CONSTRAINT "domain_ProductSku_1" CHECK (num_nonnulls("digitalReleaseId", "serviceOfferingId") <= 1);

ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_pkey" PRIMARY KEY (id);

ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_version_check" CHECK (version > 0);

ALTER TABLE "Promotion" ADD CONSTRAINT "domain_Promotion_0" CHECK ("endsAt" > "startsAt");

ALTER TABLE "PromotionOffer" ADD CONSTRAINT "PromotionOffer_pkey" PRIMARY KEY (id);

ALTER TABLE "PromotionOffer" ADD CONSTRAINT "PromotionOffer_version_check" CHECK (version > 0);

ALTER TABLE "PromotionOffer" ADD CONSTRAINT "domain_PromotionOffer_0" UNIQUE ("promotionId", "offerId");

ALTER TABLE "PromotionOffer" ADD CONSTRAINT "domain_PromotionOffer_1" CHECK (price IS NULL OR price >= 0);

ALTER TABLE "PromotionOffer" ADD CONSTRAINT "domain_PromotionOffer_2" CHECK (reserved >= 0 AND sold >= 0 AND (capacity IS NULL OR capacity >= (reserved + sold)));

ALTER TABLE "PromotionOffer" ADD CONSTRAINT "domain_PromotionOffer_3" CHECK ("perUserLimit" > 0);

ALTER TABLE "ProviderCallback" ADD CONSTRAINT "ProviderCallback_pkey" PRIMARY KEY (id);

ALTER TABLE "ProviderCallback" ADD CONSTRAINT "ProviderCallback_version_check" CHECK (version > 0);

ALTER TABLE "ProviderCallback" ADD CONSTRAINT "domain_ProviderCallback_0" UNIQUE (provider, "appScope", "externalEventId");

ALTER TABLE "ProviderCallback" ADD CONSTRAINT "domain_ProviderCallback_1" CHECK (attempts >= 0);

ALTER TABLE "RateLimit" ADD CONSTRAINT "RateLimit_id_key" UNIQUE (id);

ALTER TABLE "RateLimit" ADD CONSTRAINT "RateLimit_pkey" PRIMARY KEY (key);

ALTER TABLE "RateLimit" ADD CONSTRAINT "RateLimit_version_check" CHECK (version > 0);

ALTER TABLE "RateLimit" ADD CONSTRAINT "domain_RateLimit_0" CHECK (count >= 0);

ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_pkey" PRIMARY KEY (id);

ALTER TABLE "Reaction" ADD CONSTRAINT "domain_Reaction_0" UNIQUE ("userId", "resourceId", kind);

ALTER TABLE "Reaction" ADD CONSTRAINT "domain_Reaction_1" CHECK (kind = ANY (ARRAY['LIKE'::text, 'FAVORITE'::text]));

ALTER TABLE "ReadingEvent" ADD CONSTRAINT "ReadingEvent_eventKey_key" UNIQUE ("eventKey");

ALTER TABLE "ReadingEvent" ADD CONSTRAINT "ReadingEvent_pkey" PRIMARY KEY (id);

ALTER TABLE "ReadingEvent" ADD CONSTRAINT "domain_ReadingEvent_0" CHECK ("dwellSeconds" >= 0);

ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_pkey" PRIMARY KEY (id);

ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_version_check" CHECK (version > 0);

ALTER TABLE "Reconciliation" ADD CONSTRAINT "domain_Reconciliation_0" UNIQUE (channel, "appScope", "businessDay");

ALTER TABLE "Referral" ADD CONSTRAINT "Referral_pkey" PRIMARY KEY (id);

ALTER TABLE "Referral" ADD CONSTRAINT "Referral_version_check" CHECK (version > 0);

ALTER TABLE "Referral" ADD CONSTRAINT "domain_Referral_0" CHECK ("promoterId" <> "buyerId" AND "expiresAt" > "firstValidAt");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_channelRequestKey_key" UNIQUE ("channelRequestKey");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_pkey" PRIMARY KEY (id);

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_version_check" CHECK (version > 0);

ALTER TABLE "Refund" ADD CONSTRAINT "domain_Refund_0" UNIQUE ("userId", "requestKey");

ALTER TABLE "Refund" ADD CONSTRAINT "domain_Refund_1" CHECK (kind = ANY (ARRAY['REFUND_ONLY'::text, 'RETURN_REFUND'::text, 'EXCHANGE'::text]));

ALTER TABLE "Refund" ADD CONSTRAINT "domain_Refund_2" CHECK (state = ANY (ARRAY['REQUESTED'::text, 'REVIEW'::text, 'REJECTED'::text, 'APPROVED'::text, 'RETURNING'::text, 'REFUNDING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'CANCELLED'::text]));

ALTER TABLE "Refund" ADD CONSTRAINT "domain_Refund_3" CHECK ("requestedAmount" >= 0 AND ("approvedAmount" IS NULL OR "approvedAmount" >= 0 AND "approvedAmount" <= "requestedAmount"));

ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_pkey" PRIMARY KEY (id);

ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_version_check" CHECK (version > 0);

ALTER TABLE "RefundItem" ADD CONSTRAINT "domain_RefundItem_0" UNIQUE ("refundId", "orderItemId");

ALTER TABLE "RefundItem" ADD CONSTRAINT "domain_RefundItem_1" CHECK (quantity > 0 AND amount >= 0 AND "revokeQuantity" >= 0 AND "revokeQuantity" <= quantity AND "returnStockQuantity" >= 0 AND "returnStockQuantity" <= quantity);

ALTER TABLE "RefundTransaction" ADD CONSTRAINT "RefundTransaction_pkey" PRIMARY KEY (id);

ALTER TABLE "RefundTransaction" ADD CONSTRAINT "domain_RefundTransaction_0" UNIQUE (channel, "appScope", "externalRefundId");

ALTER TABLE "RefundTransaction" ADD CONSTRAINT "domain_RefundTransaction_1" CHECK (amount > 0);

ALTER TABLE "Report" ADD CONSTRAINT "Report_pkey" PRIMARY KEY (id);

ALTER TABLE "Report" ADD CONSTRAINT "Report_version_check" CHECK (version > 0);

ALTER TABLE "Report" ADD CONSTRAINT "domain_Report_0" CHECK (num_nonnulls("resourceId", "commentId") = 1);

ALTER TABLE "Resource" ADD CONSTRAINT "Resource_pkey" PRIMARY KEY (id);

ALTER TABLE "Resource" ADD CONSTRAINT "Resource_version_check" CHECK (version > 0);

ALTER TABLE "Resource" ADD CONSTRAINT "domain_Resource_0" UNIQUE (id, kind);

ALTER TABLE "Resource" ADD CONSTRAINT "domain_Resource_1" CHECK (kind = ANY (ARRAY['ARTICLE'::text, 'TEACHER'::text, 'COURSE'::text, 'PRODUCT'::text, 'EVENT'::text, 'LIVE'::text, 'THREAD'::text]));

ALTER TABLE "Resource" ADD CONSTRAINT "domain_Resource_2" CHECK ("publishState" = ANY (ARRAY['DRAFT'::text, 'REVIEW'::text, 'PUBLISHED'::text, 'REJECTED'::text, 'ARCHIVED'::text]));

ALTER TABLE "Resource" ADD CONSTRAINT "domain_Resource_3" CHECK (visibility = ANY (ARRAY['PUBLIC'::text, 'MEMBER'::text, 'COURSE'::text, 'PRIVATE'::text]));

ALTER TABLE "Resource" ADD CONSTRAINT "domain_Resource_4" CHECK ("membershipTier" IS NULL OR "membershipTier" >= 1 AND "membershipTier" <= 3);

ALTER TABLE "ResourceEvidence" ADD CONSTRAINT "ResourceEvidence_pkey" PRIMARY KEY (id);

ALTER TABLE "ResourceEvidence" ADD CONSTRAINT "domain_ResourceEvidence_0" UNIQUE ("resourceId", "evidenceId", purpose);

ALTER TABLE "ResourceTag" ADD CONSTRAINT "ResourceTag_pkey" PRIMARY KEY (id);

ALTER TABLE "ResourceTag" ADD CONSTRAINT "domain_ResourceTag_0" UNIQUE ("resourceId", "tagId");

ALTER TABLE "SaleOffer" ADD CONSTRAINT "SaleOffer_pkey" PRIMARY KEY (id);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "SaleOffer_version_check" CHECK (version > 0);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_0" CHECK (kind = ANY (ARRAY['COURSE'::text, 'PHYSICAL'::text, 'DIGITAL'::text, 'MEMBERSHIP'::text, 'CONSULTATION'::text, 'EVENT'::text, 'GIFT'::text, 'OPERATING_SERVICE'::text]));

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_1" CHECK (num_nonnulls("courseReleaseId", "skuId", "membershipVersionId", "serviceOfferingId", "eventTicketId", "giftId", "operatingServiceId") = 1);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_2" CHECK (price >= 0 AND "quantityLimit" > 0);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_3" CHECK ("validUntil" IS NULL OR "validFrom" IS NULL OR "validUntil" > "validFrom");

ALTER TABLE "ServiceOffering" ADD CONSTRAINT "ServiceOffering_pkey" PRIMARY KEY (id);

ALTER TABLE "ServiceOffering" ADD CONSTRAINT "ServiceOffering_version_check" CHECK (version > 0);

ALTER TABLE "ServiceOffering" ADD CONSTRAINT "domain_ServiceOffering_0" CHECK (mode = ANY (ARRAY['PHONE'::text, 'EXTERNAL_MEETING'::text, 'ONSITE'::text, 'IN_APP_RTC'::text]));

ALTER TABLE "ServiceOffering" ADD CONSTRAINT "domain_ServiceOffering_1" CHECK ("durationMinutes" > 0 AND "leadMinutes" >= 0 AND "cancelBeforeMinutes" >= 0);

ALTER TABLE "ServiceOffering" ADD CONSTRAINT "domain_ServiceOffering_2" UNIQUE (id, "teacherId");

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_pkey" PRIMARY KEY (id);

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_transferId_key" UNIQUE ("transferId");

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_version_check" CHECK (version > 0);

ALTER TABLE "Settlement" ADD CONSTRAINT "domain_Settlement_0" CHECK (num_nonnulls("partnerId", "promoterId") = 1);

ALTER TABLE "Settlement" ADD CONSTRAINT "domain_Settlement_1" CHECK ("periodEnd" >= "periodStart");

ALTER TABLE "Settlement" ADD CONSTRAINT "domain_Settlement_2" CHECK ("grossAmount" >= 0 AND "feeAmount" >= 0 AND "refundAmount" >= 0);

ALTER TABLE "Settlement" ADD CONSTRAINT "domain_Settlement_3" CHECK ("netAmount" = ("grossAmount" - "feeAmount" - "refundAmount"));

ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_commissionId_key" UNIQUE ("commissionId");

ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_eventKey_key" UNIQUE ("eventKey");

ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_giftAllocationId_key" UNIQUE ("giftAllocationId");

ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_pkey" PRIMARY KEY (id);

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_pkey" PRIMARY KEY (id);

ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_version_check" CHECK (version > 0);

ALTER TABLE "Shipment" ADD CONSTRAINT "domain_Shipment_0" CHECK (kind = ANY (ARRAY['OUTBOUND'::text, 'RETURN'::text, 'EXCHANGE'::text]));

ALTER TABLE "Shipment" ADD CONSTRAINT "domain_Shipment_1" UNIQUE ("carrierCode", "trackingNo");

ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY (id);

ALTER TABLE "ShipmentItem" ADD CONSTRAINT "domain_ShipmentItem_0" UNIQUE ("shipmentId", "orderItemId");

ALTER TABLE "ShipmentItem" ADD CONSTRAINT "domain_ShipmentItem_1" CHECK (quantity > 0);

ALTER TABLE "ShippingZone" ADD CONSTRAINT "ShippingZone_pkey" PRIMARY KEY (id);

ALTER TABLE "ShippingZone" ADD CONSTRAINT "ShippingZone_version_check" CHECK (version > 0);

ALTER TABLE "ShippingZone" ADD CONSTRAINT "domain_ShippingZone_0" UNIQUE ("templateId", "regionCode");

ALTER TABLE "ShippingZone" ADD CONSTRAINT "domain_ShippingZone_1" CHECK ("baseFee" >= 0 AND surcharge >= 0 AND "incrementFee" >= 0);

ALTER TABLE "ShippingZone" ADD CONSTRAINT "domain_ShippingZone_2" CHECK ("freeAbove" IS NULL OR "freeAbove" >= 0);

ALTER TABLE "ShippingZone" ADD CONSTRAINT "domain_ShippingZone_3" CHECK ("priorityFee" IS NULL OR "priorityFee" >= 0);

ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_pkey" PRIMARY KEY (id);

ALTER TABLE "SourceEvidence" ADD CONSTRAINT "SourceEvidence_version_check" CHECK (version > 0);

ALTER TABLE "SourceEvidence" ADD CONSTRAINT "domain_SourceEvidence_0" CHECK ("validUntil" IS NULL OR "validFrom" IS NULL OR "validUntil" > "validFrom");

ALTER TABLE "StudyEvent" ADD CONSTRAINT "StudyEvent_pkey" PRIMARY KEY (id);

ALTER TABLE "StudyEvent" ADD CONSTRAINT "domain_StudyEvent_0" UNIQUE ("userId", id);

ALTER TABLE "StudyProgress" ADD CONSTRAINT "StudyProgress_pkey" PRIMARY KEY (id);

ALTER TABLE "StudyProgress" ADD CONSTRAINT "StudyProgress_version_check" CHECK (version > 0);

ALTER TABLE "StudyProgress" ADD CONSTRAINT "domain_StudyProgress_0" UNIQUE ("userId", "lessonId");

ALTER TABLE "StudyProgress" ADD CONSTRAINT "domain_StudyProgress_1" CHECK ("positionSeconds" >= 0 AND "watchedSeconds" >= 0);

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_pkey" PRIMARY KEY (id);

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_version_check" CHECK (version > 0);

ALTER TABLE "Submission" ADD CONSTRAINT "domain_Submission_0" UNIQUE ("assignmentId", "userId", revision);

ALTER TABLE "Submission" ADD CONSTRAINT "domain_Submission_1" CHECK (revision > 0);

ALTER TABLE "Tag" ADD CONSTRAINT "Tag_code_key" UNIQUE (code);

ALTER TABLE "Tag" ADD CONSTRAINT "Tag_pkey" PRIMARY KEY (id);

ALTER TABLE "Tag" ADD CONSTRAINT "Tag_version_check" CHECK (version > 0);

ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_pkey" PRIMARY KEY (id);

ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_resourceKind_check" CHECK ("resourceKind" = 'TEACHER'::text);

ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_userId_key" UNIQUE ("userId");

ALTER TABLE "TeacherAnswer" ADD CONSTRAINT "TeacherAnswer_pkey" PRIMARY KEY (id);

ALTER TABLE "TeacherAnswer" ADD CONSTRAINT "TeacherAnswer_version_check" CHECK (version > 0);

ALTER TABLE "TeacherQuestion" ADD CONSTRAINT "TeacherQuestion_pkey" PRIMARY KEY (id);

ALTER TABLE "TeacherQuestion" ADD CONSTRAINT "TeacherQuestion_version_check" CHECK (version > 0);

ALTER TABLE "TeacherQuestion" ADD CONSTRAINT "domain_TeacherQuestion_0" CHECK (visibility = ANY (ARRAY['PRIVATE'::text, 'PUBLIC'::text]));

ALTER TABLE "TeacherQuestion" ADD CONSTRAINT "domain_TeacherQuestion_1" CHECK (state = ANY (ARRAY['OPEN'::text, 'ANSWERED'::text, 'CLOSED'::text, 'REJECTED'::text]));

ALTER TABLE "TeacherReview" ADD CONSTRAINT "TeacherReview_pkey" PRIMARY KEY (id);

ALTER TABLE "TeacherReview" ADD CONSTRAINT "TeacherReview_version_check" CHECK (version > 0);

ALTER TABLE "TeacherReview" ADD CONSTRAINT "domain_TeacherReview_0" CHECK (num_nonnulls("submissionId", "checkinId") = 1);

ALTER TABLE "TeacherReview" ADD CONSTRAINT "domain_TeacherReview_1" CHECK (score IS NULL OR score >= 0 AND score <= 100);

ALTER TABLE "TeacherStaff" ADD CONSTRAINT "TeacherStaff_pkey" PRIMARY KEY (id);

ALTER TABLE "TeacherStaff" ADD CONSTRAINT "TeacherStaff_version_check" CHECK (version > 0);

ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_orderNo_key" UNIQUE ("orderNo");

ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_pkey" PRIMARY KEY (id);

ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_version_check" CHECK (version > 0);

ALTER TABLE "TradeOrder" ADD CONSTRAINT "domain_TradeOrder_0" UNIQUE ("userId", "requestKey");

ALTER TABLE "TradeOrder" ADD CONSTRAINT "domain_TradeOrder_1" CHECK (state = ANY (ARRAY['PENDING'::text, 'PAID'::text, 'FULFILLING'::text, 'COMPLETED'::text, 'CLOSED'::text]));

ALTER TABLE "TradeOrder" ADD CONSTRAINT "domain_TradeOrder_2" CHECK (subtotal >= 0 AND "discountTotal" >= 0 AND "shippingTotal" >= 0 AND "payableTotal" = (subtotal - "discountTotal" + "shippingTotal") AND "payableTotal" >= 0);

ALTER TABLE "TradeOrder" ADD CONSTRAINT "domain_TradeOrder_3" CHECK ("paidTotal" >= 0 AND "refundedTotal" >= 0 AND "refundedTotal" <= "paidTotal");

ALTER TABLE "TradeOrder" ADD CONSTRAINT "domain_TradeOrder_4" CHECK (kind = ANY (ARRAY['COURSE'::text, 'PHYSICAL'::text, 'DIGITAL'::text, 'MEMBERSHIP'::text, 'CONSULTATION'::text, 'EVENT'::text, 'GIFT'::text, 'OPERATING_SERVICE'::text]));

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "TradeOrderItem_pkey" PRIMARY KEY (id);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "TradeOrderItem_version_check" CHECK (version > 0);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_0" UNIQUE ("orderId", "lineNo");

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_1" CHECK (quantity >= 1 AND quantity <= 99);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_2" CHECK ("unitPrice" >= 0 AND subtotal = ("unitPrice" * quantity));

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_3" CHECK ("discountAllocated" >= 0 AND "shippingAllocated" >= 0 AND payable = (subtotal - "discountAllocated" + "shippingAllocated") AND payable >= 0);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_4" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= payable);

ALTER TABLE "User" ADD CONSTRAINT "User_phoneHash_key" UNIQUE ("phoneHash");

ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);

ALTER TABLE "User" ADD CONSTRAINT "User_version_check" CHECK (version > 0);

ALTER TABLE "User" ADD CONSTRAINT "domain_User_0" CHECK (status = ANY (ARRAY['ACTIVE'::"AccountStatus", 'FROZEN'::"AccountStatus", 'DELETED'::"AccountStatus"]));

ALTER TABLE "User" ADD CONSTRAINT "domain_User_1" CHECK ((status = 'DELETED'::"AccountStatus") = ("deletedAt" IS NOT NULL));

ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_pkey" PRIMARY KEY (id);

ALTER TABLE "UserBlock" ADD CONSTRAINT "domain_UserBlock_0" UNIQUE ("userId", "blockedId");

ALTER TABLE "UserBlock" ADD CONSTRAINT "domain_UserBlock_1" CHECK ("userId" <> "blockedId");

ALTER TABLE "UserCoupon" ADD CONSTRAINT "UserCoupon_claimKey_key" UNIQUE ("claimKey");

ALTER TABLE "UserCoupon" ADD CONSTRAINT "UserCoupon_pkey" PRIMARY KEY (id);

ALTER TABLE "UserCoupon" ADD CONSTRAINT "UserCoupon_redeemKey_key" UNIQUE ("redeemKey");

ALTER TABLE "UserCoupon" ADD CONSTRAINT "UserCoupon_version_check" CHECK (version > 0);

ALTER TABLE "UserCoupon" ADD CONSTRAINT "domain_UserCoupon_0" CHECK (state = ANY (ARRAY['AVAILABLE'::text, 'LOCKED'::text, 'USED'::text, 'EXPIRED'::text, 'REVOKED'::text]));

ALTER TABLE "UserRestriction" ADD CONSTRAINT "UserRestriction_pkey" PRIMARY KEY (id);

ALTER TABLE "UserRestriction" ADD CONSTRAINT "UserRestriction_version_check" CHECK (version > 0);

ALTER TABLE "UserRestriction" ADD CONSTRAINT "domain_UserRestriction_0" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");

ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_pkey" PRIMARY KEY (id);

ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_version_check" CHECK (version > 0);

ALTER TABLE "UserTag" ADD CONSTRAINT "UserTag_pkey" PRIMARY KEY (id);

ALTER TABLE "UserTag" ADD CONSTRAINT "domain_UserTag_0" UNIQUE ("userId", "tagId");

ALTER TABLE "VirtualGift" ADD CONSTRAINT "VirtualGift_code_key" UNIQUE (code);

ALTER TABLE "VirtualGift" ADD CONSTRAINT "VirtualGift_pkey" PRIMARY KEY (id);

ALTER TABLE "VirtualGift" ADD CONSTRAINT "VirtualGift_version_check" CHECK (version > 0);

ALTER TABLE "VirtualGift" ADD CONSTRAINT "domain_VirtualGift_0" CHECK ("creditCost" > 0);

ALTER TABLE "WithdrawalAllocation" ADD CONSTRAINT "WithdrawalAllocation_pkey" PRIMARY KEY (id);

ALTER TABLE "WithdrawalAllocation" ADD CONSTRAINT "WithdrawalAllocation_version_check" CHECK (version > 0);

ALTER TABLE "WithdrawalAllocation" ADD CONSTRAINT "domain_WithdrawalAllocation_0" UNIQUE ("withdrawalId", "commissionId");

ALTER TABLE "WithdrawalAllocation" ADD CONSTRAINT "domain_WithdrawalAllocation_1" CHECK (amount > 0);

ALTER TABLE "WithdrawalAllocation" ADD CONSTRAINT "domain_WithdrawalAllocation_2" CHECK (state = ANY (ARRAY['HELD'::text, 'PAID'::text, 'RELEASED'::text]));

ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_externalTransferId_key" UNIQUE ("externalTransferId");

ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY (id);

ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_version_check" CHECK (version > 0);

ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "domain_WithdrawalRequest_0" UNIQUE ("userId", "requestKey");

ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "domain_WithdrawalRequest_1" CHECK (amount > 0);

ALTER TABLE "WritingCampaign" ADD CONSTRAINT "WritingCampaign_pkey" PRIMARY KEY (id);

ALTER TABLE "WritingCampaign" ADD CONSTRAINT "WritingCampaign_version_check" CHECK (version > 0);

ALTER TABLE "WritingCampaign" ADD CONSTRAINT "domain_WritingCampaign_0" CHECK ("endsAt" > "startsAt");

ALTER TABLE "AdCampaign" ADD CONSTRAINT "domain_AdCampaign_creativeAssetId_fk" FOREIGN KEY ("creativeAssetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "AdCampaign" ADD CONSTRAINT "domain_AdCampaign_operatingServiceId_fk" FOREIGN KEY ("operatingServiceId") REFERENCES "OperatingService"(id);

ALTER TABLE "AdCampaign" ADD CONSTRAINT "domain_AdCampaign_placementId_fk" FOREIGN KEY ("placementId") REFERENCES "AdPlacement"(id);

ALTER TABLE "AdCampaign" ADD CONSTRAINT "domain_AdCampaign_targetResourceId_fk" FOREIGN KEY ("targetResourceId") REFERENCES "Resource"(id);

ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

ALTER TABLE "Address" ADD CONSTRAINT "domain_Address_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "Appointment" ADD CONSTRAINT "domain_Appointment_benefitUsageId_fk" FOREIGN KEY ("benefitUsageId") REFERENCES "BenefitUsage"(id);

ALTER TABLE "Appointment" ADD CONSTRAINT "domain_Appointment_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "Appointment" ADD CONSTRAINT "domain_Appointment_slotId_fk" FOREIGN KEY ("slotId") REFERENCES "AppointmentSlot"(id);

ALTER TABLE "Appointment" ADD CONSTRAINT "domain_Appointment_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "domain_AppointmentSlot_4" FOREIGN KEY ("offeringId", "teacherId") REFERENCES "ServiceOffering"(id, "teacherId");

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "domain_AppointmentSlot_offeringId_fk" FOREIGN KEY ("offeringId") REFERENCES "ServiceOffering"(id);

ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "domain_AppointmentSlot_teacherId_fk" FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id);

ALTER TABLE "Article" ADD CONSTRAINT "domain_Article_0" FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind);

ALTER TABLE "Article" ADD CONSTRAINT "domain_Article_1" FOREIGN KEY ("currentReleaseId", id) REFERENCES "ArticleRelease"(id, "articleId");

ALTER TABLE "Article" ADD CONSTRAINT "domain_Article_authorUserId_fk" FOREIGN KEY ("authorUserId") REFERENCES "User"(id);

ALTER TABLE "Article" ADD CONSTRAINT "domain_Article_currentReleaseId_fk" FOREIGN KEY ("currentReleaseId") REFERENCES "ArticleRelease"(id);

ALTER TABLE "ArticleBlock" ADD CONSTRAINT "domain_ArticleBlock_citationEvidenceId_fk" FOREIGN KEY ("citationEvidenceId") REFERENCES "SourceEvidence"(id);

ALTER TABLE "ArticleBlock" ADD CONSTRAINT "domain_ArticleBlock_mediaId_fk" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"(id);

ALTER TABLE "ArticleBlock" ADD CONSTRAINT "domain_ArticleBlock_releaseId_fk" FOREIGN KEY ("releaseId") REFERENCES "ArticleRelease"(id);

ALTER TABLE "ArticleRelease" ADD CONSTRAINT "domain_ArticleRelease_articleId_fk" FOREIGN KEY ("articleId") REFERENCES "Article"(id);

ALTER TABLE "ArticleRelease" ADD CONSTRAINT "domain_ArticleRelease_reviewerId_fk" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);

ALTER TABLE "Assignment" ADD CONSTRAINT "domain_Assignment_cohortId_fk" FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id);

ALTER TABLE "Assignment" ADD CONSTRAINT "domain_Assignment_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "Course"(id);

ALTER TABLE "Assignment" ADD CONSTRAINT "domain_Assignment_lessonId_fk" FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_assetId_fk" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_checkinId_fk" FOREIGN KEY ("checkinId") REFERENCES "PracticeCheckin"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_feedbackId_fk" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_feedbackReplyId_fk" FOREIGN KEY ("feedbackReplyId") REFERENCES "FeedbackReply"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_logId_fk" FOREIGN KEY ("logId") REFERENCES "PracticeLog"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_noteId_fk" FOREIGN KEY ("noteId") REFERENCES "Note"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_operatingServiceId_fk" FOREIGN KEY ("operatingServiceId") REFERENCES "OperatingService"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_refundId_fk" FOREIGN KEY ("refundId") REFERENCES "Refund"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_reportId_fk" FOREIGN KEY ("reportId") REFERENCES "Report"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_submissionId_fk" FOREIGN KEY ("submissionId") REFERENCES "Submission"(id);

ALTER TABLE "AttachmentBinding" ADD CONSTRAINT "domain_AttachmentBinding_threadId_fk" FOREIGN KEY ("threadId") REFERENCES "ForumThread"(id);

ALTER TABLE "AuditLog" ADD CONSTRAINT "domain_AuditLog_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "User"(id);

ALTER TABLE "AuthIdentity" ADD CONSTRAINT "domain_AuthIdentity_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "AuthSession" ADD CONSTRAINT "domain_AuthSession_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "domain_BenefitGrant_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "User"(id);

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "domain_BenefitGrant_definitionId_fk" FOREIGN KEY ("definitionId") REFERENCES "BenefitDefinition"(id);

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "domain_BenefitGrant_growthLedgerId_fk" FOREIGN KEY ("growthLedgerId") REFERENCES "GrowthLedger"(id);

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "domain_BenefitGrant_offerId_fk" FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id);

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "domain_BenefitGrant_redemptionId_fk" FOREIGN KEY ("redemptionId") REFERENCES "PointsRedemption"(id);

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "domain_BenefitGrant_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "BenefitGrant" ADD CONSTRAINT "domain_BenefitGrant_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "BenefitScope" ADD CONSTRAINT "domain_BenefitScope_offerId_fk" FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id);

ALTER TABLE "BenefitScope" ADD CONSTRAINT "domain_BenefitScope_planBenefitId_fk" FOREIGN KEY ("planBenefitId") REFERENCES "PlanBenefit"(id);

ALTER TABLE "BenefitScope" ADD CONSTRAINT "domain_BenefitScope_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "domain_BenefitUsage_definitionId_fk" FOREIGN KEY ("definitionId") REFERENCES "BenefitDefinition"(id);

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "domain_BenefitUsage_grantId_fk" FOREIGN KEY ("grantId") REFERENCES "BenefitGrant"(id);

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "domain_BenefitUsage_periodId_fk" FOREIGN KEY ("periodId") REFERENCES "Membership"(id);

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "domain_BenefitUsage_reversalOfId_fk" FOREIGN KEY ("reversalOfId") REFERENCES "BenefitUsage"(id);

ALTER TABLE "BenefitUsage" ADD CONSTRAINT "domain_BenefitUsage_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "CampaignEntry" ADD CONSTRAINT "domain_CampaignEntry_authorizationId_fk" FOREIGN KEY ("authorizationId") REFERENCES "ContentAuthorization"(id);

ALTER TABLE "CampaignEntry" ADD CONSTRAINT "domain_CampaignEntry_campaignId_fk" FOREIGN KEY ("campaignId") REFERENCES "WritingCampaign"(id);

ALTER TABLE "CampaignEntry" ADD CONSTRAINT "domain_CampaignEntry_judgeId_fk" FOREIGN KEY ("judgeId") REFERENCES "User"(id);

ALTER TABLE "CampaignEntry" ADD CONSTRAINT "domain_CampaignEntry_threadId_fk" FOREIGN KEY ("threadId") REFERENCES "ForumThread"(id);

ALTER TABLE "CampaignEntry" ADD CONSTRAINT "domain_CampaignEntry_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"(id) ON DELETE CASCADE;

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;

ALTER TABLE "CartItem" ADD CONSTRAINT "domain_CartItem_offerId_fk" FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id);

ALTER TABLE "CartItem" ADD CONSTRAINT "domain_CartItem_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "ChannelProductMapping" ADD CONSTRAINT "domain_ChannelProductMapping_offerId_fk" FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id);

ALTER TABLE "Comment" ADD CONSTRAINT "domain_Comment_authorId_fk" FOREIGN KEY ("authorId") REFERENCES "User"(id);

ALTER TABLE "Comment" ADD CONSTRAINT "domain_Comment_parentId_fk" FOREIGN KEY ("parentId") REFERENCES "Comment"(id);

ALTER TABLE "Comment" ADD CONSTRAINT "domain_Comment_quoteBlockId_fk" FOREIGN KEY ("quoteBlockId") REFERENCES "ArticleBlock"(id);

ALTER TABLE "Comment" ADD CONSTRAINT "domain_Comment_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "CommissionLedger" ADD CONSTRAINT "domain_CommissionLedger_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "CommissionLedger" ADD CONSTRAINT "domain_CommissionLedger_promoterId_fk" FOREIGN KEY ("promoterId") REFERENCES "User"(id);

ALTER TABLE "CommissionLedger" ADD CONSTRAINT "domain_CommissionLedger_referralId_fk" FOREIGN KEY ("referralId") REFERENCES "Referral"(id);

ALTER TABLE "CommissionLedger" ADD CONSTRAINT "domain_CommissionLedger_reversalOfId_fk" FOREIGN KEY ("reversalOfId") REFERENCES "CommissionLedger"(id);

ALTER TABLE "ConsentRecord" ADD CONSTRAINT "domain_ConsentRecord_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "ConsumedRefresh" ADD CONSTRAINT "ConsumedRefresh_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "ConsumedRefresh" ADD CONSTRAINT "domain_ConsumedRefresh_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"(id);

ALTER TABLE "ContentAuthorization" ADD CONSTRAINT "domain_ContentAuthorization_logId_fk" FOREIGN KEY ("logId") REFERENCES "PracticeLog"(id);

ALTER TABLE "ContentAuthorization" ADD CONSTRAINT "domain_ContentAuthorization_noteId_fk" FOREIGN KEY ("noteId") REFERENCES "Note"(id);

ALTER TABLE "ContentAuthorization" ADD CONSTRAINT "domain_ContentAuthorization_targetReleaseId_fk" FOREIGN KEY ("targetReleaseId") REFERENCES "CourseRelease"(id);

ALTER TABLE "ContentAuthorization" ADD CONSTRAINT "domain_ContentAuthorization_threadId_fk" FOREIGN KEY ("threadId") REFERENCES "ForumThread"(id);

ALTER TABLE "ContentAuthorization" ADD CONSTRAINT "domain_ContentAuthorization_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "ContentRelation" ADD CONSTRAINT "domain_ContentRelation_approvedBy_fk" FOREIGN KEY ("approvedBy") REFERENCES "User"(id);

ALTER TABLE "ContentRelation" ADD CONSTRAINT "domain_ContentRelation_fromId_fk" FOREIGN KEY ("fromId") REFERENCES "Resource"(id);

ALTER TABLE "ContentRelation" ADD CONSTRAINT "domain_ContentRelation_toId_fk" FOREIGN KEY ("toId") REFERENCES "Resource"(id);

ALTER TABLE "Course" ADD CONSTRAINT "Course_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "Course" ADD CONSTRAINT "domain_Course_2" FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind);

ALTER TABLE "Course" ADD CONSTRAINT "domain_Course_3" FOREIGN KEY ("publishedReleaseId", id) REFERENCES "CourseRelease"(id, "courseId");

ALTER TABLE "Course" ADD CONSTRAINT "domain_Course_publishedReleaseId_fk" FOREIGN KEY ("publishedReleaseId") REFERENCES "CourseRelease"(id);

ALTER TABLE "Course" ADD CONSTRAINT "domain_Course_teacherId_fk" FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id);

ALTER TABLE "CourseChapter" ADD CONSTRAINT "CourseChapter_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "CourseChapter" ADD CONSTRAINT "domain_CourseChapter_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "Course"(id);

ALTER TABLE "CourseChapter" ADD CONSTRAINT "domain_CourseChapter_mediaId_fk" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"(id);

ALTER TABLE "CourseCohort" ADD CONSTRAINT "domain_CourseCohort_3" FOREIGN KEY ("releaseId", "courseId") REFERENCES "CourseRelease"(id, "courseId");

ALTER TABLE "CourseCohort" ADD CONSTRAINT "domain_CourseCohort_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "Course"(id);

ALTER TABLE "CourseCohort" ADD CONSTRAINT "domain_CourseCohort_releaseId_fk" FOREIGN KEY ("releaseId") REFERENCES "CourseRelease"(id);

ALTER TABLE "CourseRelease" ADD CONSTRAINT "CourseRelease_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "CourseRelease" ADD CONSTRAINT "domain_CourseRelease_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "Course"(id);

ALTER TABLE "CourseStaff" ADD CONSTRAINT "domain_CourseStaff_1" FOREIGN KEY ("cohortId", "courseId") REFERENCES "CourseCohort"(id, "courseId");

ALTER TABLE "CourseStaff" ADD CONSTRAINT "domain_CourseStaff_cohortId_fk" FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id);

ALTER TABLE "CourseStaff" ADD CONSTRAINT "domain_CourseStaff_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "Course"(id);

ALTER TABLE "CourseStaff" ADD CONSTRAINT "domain_CourseStaff_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "DeviceToken" ADD CONSTRAINT "domain_DeviceToken_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "DigitalDelivery" ADD CONSTRAINT "domain_DigitalDelivery_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "DigitalDelivery" ADD CONSTRAINT "domain_DigitalDelivery_releaseId_fk" FOREIGN KEY ("releaseId") REFERENCES "DigitalRelease"(id);

ALTER TABLE "DigitalDelivery" ADD CONSTRAINT "domain_DigitalDelivery_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "DigitalRelease" ADD CONSTRAINT "domain_DigitalRelease_productId_fk" FOREIGN KEY ("productId") REFERENCES "Product"(id);

ALTER TABLE "DigitalReleaseAsset" ADD CONSTRAINT "domain_DigitalReleaseAsset_assetId_fk" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "DigitalReleaseAsset" ADD CONSTRAINT "domain_DigitalReleaseAsset_releaseId_fk" FOREIGN KEY ("releaseId") REFERENCES "DigitalRelease"(id);

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "CourseRelease"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "Enrollment" ADD CONSTRAINT "domain_Enrollment_0" FOREIGN KEY ("releaseId", "courseId") REFERENCES "CourseRelease"(id, "courseId");

ALTER TABLE "Enrollment" ADD CONSTRAINT "domain_Enrollment_2" FOREIGN KEY ("cohortId", "courseId") REFERENCES "CourseCohort"(id, "courseId");

ALTER TABLE "Enrollment" ADD CONSTRAINT "domain_Enrollment_cohortId_fk" FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id);

ALTER TABLE "Enrollment" ADD CONSTRAINT "domain_Enrollment_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "Course"(id);

ALTER TABLE "Enrollment" ADD CONSTRAINT "domain_Enrollment_grantActorId_fk" FOREIGN KEY ("grantActorId") REFERENCES "User"(id);

ALTER TABLE "Enrollment" ADD CONSTRAINT "domain_Enrollment_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "Enrollment" ADD CONSTRAINT "domain_Enrollment_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "Event" ADD CONSTRAINT "domain_Event_0" FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind);

ALTER TABLE "Event" ADD CONSTRAINT "domain_Event_organizerPartnerId_fk" FOREIGN KEY ("organizerPartnerId") REFERENCES "Partner"(id);

ALTER TABLE "Event" ADD CONSTRAINT "domain_Event_responsibleUserId_fk" FOREIGN KEY ("responsibleUserId") REFERENCES "User"(id);

ALTER TABLE "Event" ADD CONSTRAINT "domain_Event_teacherId_fk" FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id);

ALTER TABLE "EventCheckin" ADD CONSTRAINT "domain_EventCheckin_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "User"(id);

ALTER TABLE "EventCheckin" ADD CONSTRAINT "domain_EventCheckin_registrationId_fk" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"(id);

ALTER TABLE "EventRegistration" ADD CONSTRAINT "domain_EventRegistration_benefitUsageId_fk" FOREIGN KEY ("benefitUsageId") REFERENCES "BenefitUsage"(id);

ALTER TABLE "EventRegistration" ADD CONSTRAINT "domain_EventRegistration_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "EventRegistration" ADD CONSTRAINT "domain_EventRegistration_ticketTypeId_fk" FOREIGN KEY ("ticketTypeId") REFERENCES "EventTicketType"(id);

ALTER TABLE "EventRegistration" ADD CONSTRAINT "domain_EventRegistration_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "EventSession" ADD CONSTRAINT "domain_EventSession_eventId_fk" FOREIGN KEY ("eventId") REFERENCES "Event"(id);

ALTER TABLE "EventSession" ADD CONSTRAINT "domain_EventSession_rescheduledFromId_fk" FOREIGN KEY ("rescheduledFromId") REFERENCES "EventSession"(id);

ALTER TABLE "EventStaff" ADD CONSTRAINT "domain_EventStaff_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "EventSession"(id);

ALTER TABLE "EventStaff" ADD CONSTRAINT "domain_EventStaff_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "EventTicketType" ADD CONSTRAINT "domain_EventTicketType_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "EventSession"(id);

ALTER TABLE "EventWaitlist" ADD CONSTRAINT "domain_EventWaitlist_registrationId_fk" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"(id);

ALTER TABLE "EventWaitlist" ADD CONSTRAINT "domain_EventWaitlist_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "EventSession"(id);

ALTER TABLE "EventWaitlist" ADD CONSTRAINT "domain_EventWaitlist_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "FeatureConfig" ADD CONSTRAINT "domain_FeatureConfig_approvedBy_fk" FOREIGN KEY ("approvedBy") REFERENCES "User"(id);

ALTER TABLE "Feedback" ADD CONSTRAINT "domain_Feedback_assigneeId_fk" FOREIGN KEY ("assigneeId") REFERENCES "User"(id);

ALTER TABLE "Feedback" ADD CONSTRAINT "domain_Feedback_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "Feedback" ADD CONSTRAINT "domain_Feedback_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "FeedbackReply" ADD CONSTRAINT "domain_FeedbackReply_authorId_fk" FOREIGN KEY ("authorId") REFERENCES "User"(id);

ALTER TABLE "FeedbackReply" ADD CONSTRAINT "domain_FeedbackReply_feedbackId_fk" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"(id);

ALTER TABLE "FinanceEntry" ADD CONSTRAINT "domain_FinanceEntry_1" FOREIGN KEY ("accountCode") REFERENCES "FinanceAccount"(code);

ALTER TABLE "FinanceEntry" ADD CONSTRAINT "domain_FinanceEntry_journalId_fk" FOREIGN KEY ("journalId") REFERENCES "FinanceJournal"(id);

ALTER TABLE "FinanceEntry" ADD CONSTRAINT "domain_FinanceEntry_partnerId_fk" FOREIGN KEY ("partnerId") REFERENCES "Partner"(id);

ALTER TABLE "FinanceEntry" ADD CONSTRAINT "domain_FinanceEntry_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "FinanceJournal" ADD CONSTRAINT "domain_FinanceJournal_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "FinanceJournal" ADD CONSTRAINT "domain_FinanceJournal_refundId_fk" FOREIGN KEY ("refundId") REFERENCES "Refund"(id);

ALTER TABLE "FinanceJournal" ADD CONSTRAINT "domain_FinanceJournal_reversalOfId_fk" FOREIGN KEY ("reversalOfId") REFERENCES "FinanceJournal"(id);

ALTER TABLE "FinanceJournal" ADD CONSTRAINT "domain_FinanceJournal_transactionId_fk" FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"(id);

ALTER TABLE "ForumSection" ADD CONSTRAINT "domain_ForumSection_cohortId_fk" FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id);

ALTER TABLE "ForumSection" ADD CONSTRAINT "domain_ForumSection_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "Course"(id);

ALTER TABLE "ForumThread" ADD CONSTRAINT "domain_ForumThread_0" FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind);

ALTER TABLE "ForumThread" ADD CONSTRAINT "domain_ForumThread_authorId_fk" FOREIGN KEY ("authorId") REFERENCES "User"(id);

ALTER TABLE "ForumThread" ADD CONSTRAINT "domain_ForumThread_benefitUsageId_fk" FOREIGN KEY ("benefitUsageId") REFERENCES "BenefitUsage"(id);

ALTER TABLE "ForumThread" ADD CONSTRAINT "domain_ForumThread_citationReleaseId_fk" FOREIGN KEY ("citationReleaseId") REFERENCES "ArticleRelease"(id);

ALTER TABLE "ForumThread" ADD CONSTRAINT "domain_ForumThread_sectionId_fk" FOREIGN KEY ("sectionId") REFERENCES "ForumSection"(id);

ALTER TABLE "GiftCreditAllocation" ADD CONSTRAINT "domain_GiftCreditAllocation_contractId_fk" FOREIGN KEY ("contractId") REFERENCES "PartnerContract"(id);

ALTER TABLE "GiftCreditAllocation" ADD CONSTRAINT "domain_GiftCreditAllocation_creditLedgerId_fk" FOREIGN KEY ("creditLedgerId") REFERENCES "GiftLedger"(id);

ALTER TABLE "GiftCreditAllocation" ADD CONSTRAINT "domain_GiftCreditAllocation_debitLedgerId_fk" FOREIGN KEY ("debitLedgerId") REFERENCES "GiftLedger"(id);

ALTER TABLE "GiftCreditAllocation" ADD CONSTRAINT "domain_GiftCreditAllocation_reversalOfId_fk" FOREIGN KEY ("reversalOfId") REFERENCES "GiftCreditAllocation"(id);

ALTER TABLE "GiftLedger" ADD CONSTRAINT "domain_GiftLedger_giftId_fk" FOREIGN KEY ("giftId") REFERENCES "VirtualGift"(id);

ALTER TABLE "GiftLedger" ADD CONSTRAINT "domain_GiftLedger_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "GiftLedger" ADD CONSTRAINT "domain_GiftLedger_paymentTransactionId_fk" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"(id);

ALTER TABLE "GiftLedger" ADD CONSTRAINT "domain_GiftLedger_refundTransactionId_fk" FOREIGN KEY ("refundTransactionId") REFERENCES "RefundTransaction"(id);

ALTER TABLE "GiftLedger" ADD CONSTRAINT "domain_GiftLedger_reversalOfId_fk" FOREIGN KEY ("reversalOfId") REFERENCES "GiftLedger"(id);

ALTER TABLE "GiftLedger" ADD CONSTRAINT "domain_GiftLedger_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"(id);

ALTER TABLE "GiftLedger" ADD CONSTRAINT "domain_GiftLedger_walletId_fk" FOREIGN KEY ("walletId") REFERENCES "GiftWallet"(id);

ALTER TABLE "GiftWallet" ADD CONSTRAINT "domain_GiftWallet_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "GroupBuy" ADD CONSTRAINT "domain_GroupBuy_leaderId_fk" FOREIGN KEY ("leaderId") REFERENCES "User"(id);

ALTER TABLE "GroupBuy" ADD CONSTRAINT "domain_GroupBuy_offerId_fk" FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id);

ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "domain_GroupBuyMember_groupId_fk" FOREIGN KEY ("groupId") REFERENCES "GroupBuy"(id);

ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "domain_GroupBuyMember_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "GroupBuyMember" ADD CONSTRAINT "domain_GroupBuyMember_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "GrowthLedger" ADD CONSTRAINT "domain_GrowthLedger_reversalOfId_fk" FOREIGN KEY ("reversalOfId") REFERENCES "GrowthLedger"(id);

ALTER TABLE "GrowthLedger" ADD CONSTRAINT "domain_GrowthLedger_sourceResourceId_fk" FOREIGN KEY ("sourceResourceId") REFERENCES "Resource"(id);

ALTER TABLE "GrowthLedger" ADD CONSTRAINT "domain_GrowthLedger_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "domain_IdempotencyRecord_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "InventoryLedger" ADD CONSTRAINT "domain_InventoryLedger_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "User"(id);

ALTER TABLE "InventoryLedger" ADD CONSTRAINT "domain_InventoryLedger_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "InventoryLedger" ADD CONSTRAINT "domain_InventoryLedger_reservationId_fk" FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"(id);

ALTER TABLE "InventoryLedger" ADD CONSTRAINT "domain_InventoryLedger_skuId_fk" FOREIGN KEY ("skuId") REFERENCES "ProductSku"(id);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "domain_InventoryReservation_cohortId_fk" FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "domain_InventoryReservation_eventTicketId_fk" FOREIGN KEY ("eventTicketId") REFERENCES "EventTicketType"(id);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "domain_InventoryReservation_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "domain_InventoryReservation_promotionOfferId_fk" FOREIGN KEY ("promotionOfferId") REFERENCES "PromotionOffer"(id);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "domain_InventoryReservation_skuId_fk" FOREIGN KEY ("skuId") REFERENCES "ProductSku"(id);

ALTER TABLE "InventoryReservation" ADD CONSTRAINT "domain_InventoryReservation_slotId_fk" FOREIGN KEY ("slotId") REFERENCES "AppointmentSlot"(id);

ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "CourseRelease"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "Lesson" ADD CONSTRAINT "domain_Lesson_eventSessionId_fk" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"(id);

ALTER TABLE "Lesson" ADD CONSTRAINT "domain_Lesson_liveSessionId_fk" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"(id);

ALTER TABLE "Lesson" ADD CONSTRAINT "domain_Lesson_mediaId_fk" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"(id);

ALTER TABLE "Lesson" ADD CONSTRAINT "domain_Lesson_releaseId_fk" FOREIGN KEY ("releaseId") REFERENCES "CourseRelease"(id);

ALTER TABLE "LiveMicRequest" ADD CONSTRAINT "domain_LiveMicRequest_approvedBy_fk" FOREIGN KEY ("approvedBy") REFERENCES "User"(id);

ALTER TABLE "LiveMicRequest" ADD CONSTRAINT "domain_LiveMicRequest_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"(id);

ALTER TABLE "LiveMicRequest" ADD CONSTRAINT "domain_LiveMicRequest_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "LivePoll" ADD CONSTRAINT "domain_LivePoll_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"(id);

ALTER TABLE "LiveReplay" ADD CONSTRAINT "domain_LiveReplay_assetId_fk" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "LiveReplay" ADD CONSTRAINT "domain_LiveReplay_reviewerId_fk" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);

ALTER TABLE "LiveReplay" ADD CONSTRAINT "domain_LiveReplay_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"(id);

ALTER TABLE "LiveReservation" ADD CONSTRAINT "domain_LiveReservation_sessionId_fk" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"(id);

ALTER TABLE "LiveReservation" ADD CONSTRAINT "domain_LiveReservation_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "LiveRoom" ADD CONSTRAINT "domain_LiveRoom_1" FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind);

ALTER TABLE "LiveRoom" ADD CONSTRAINT "domain_LiveRoom_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "Course"(id);

ALTER TABLE "LiveRoom" ADD CONSTRAINT "domain_LiveRoom_teacherId_fk" FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id);

ALTER TABLE "LiveSession" ADD CONSTRAINT "domain_LiveSession_eventSessionId_fk" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"(id);

ALTER TABLE "LiveSession" ADD CONSTRAINT "domain_LiveSession_hostUserId_fk" FOREIGN KEY ("hostUserId") REFERENCES "User"(id);

ALTER TABLE "LiveSession" ADD CONSTRAINT "domain_LiveSession_roomId_fk" FOREIGN KEY ("roomId") REFERENCES "LiveRoom"(id);

ALTER TABLE "MediaAsset" ADD CONSTRAINT "domain_MediaAsset_uploaderId_fk" FOREIGN KEY ("uploaderId") REFERENCES "User"(id);

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "Membership" ADD CONSTRAINT "domain_Membership_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "User"(id);

ALTER TABLE "Membership" ADD CONSTRAINT "domain_Membership_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "Membership" ADD CONSTRAINT "domain_Membership_planVersionId_fk" FOREIGN KEY ("planVersionId") REFERENCES "MembershipPlanVersion"(id);

ALTER TABLE "Membership" ADD CONSTRAINT "domain_Membership_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "MembershipPlan" ADD CONSTRAINT "domain_MembershipPlan_currentVersionId_fk" FOREIGN KEY ("currentVersionId") REFERENCES "MembershipPlanVersion"(id);

ALTER TABLE "MembershipPlanVersion" ADD CONSTRAINT "domain_MembershipPlanVersion_planId_fk" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"(id);

ALTER TABLE "ModerationAction" ADD CONSTRAINT "domain_ModerationAction_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "User"(id);

ALTER TABLE "ModerationAction" ADD CONSTRAINT "domain_ModerationAction_appealOfId_fk" FOREIGN KEY ("appealOfId") REFERENCES "ModerationAction"(id);

ALTER TABLE "ModerationAction" ADD CONSTRAINT "domain_ModerationAction_commentId_fk" FOREIGN KEY ("commentId") REFERENCES "Comment"(id);

ALTER TABLE "ModerationAction" ADD CONSTRAINT "domain_ModerationAction_reportId_fk" FOREIGN KEY ("reportId") REFERENCES "Report"(id);

ALTER TABLE "ModerationAction" ADD CONSTRAINT "domain_ModerationAction_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "ModerationAction" ADD CONSTRAINT "domain_ModerationAction_targetUserId_fk" FOREIGN KEY ("targetUserId") REFERENCES "User"(id);

ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "Note" ADD CONSTRAINT "domain_Note_articleId_fk" FOREIGN KEY ("articleId") REFERENCES "Article"(id);

ALTER TABLE "Note" ADD CONSTRAINT "domain_Note_releaseId_fk" FOREIGN KEY ("releaseId") REFERENCES "ArticleRelease"(id);

ALTER TABLE "Note" ADD CONSTRAINT "domain_Note_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "NoteExport" ADD CONSTRAINT "domain_NoteExport_assetId_fk" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "NoteExport" ADD CONSTRAINT "domain_NoteExport_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "Notification" ADD CONSTRAINT "domain_Notification_appointmentId_fk" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"(id);

ALTER TABLE "Notification" ADD CONSTRAINT "domain_Notification_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "Notification" ADD CONSTRAINT "domain_Notification_registrationId_fk" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"(id);

ALTER TABLE "Notification" ADD CONSTRAINT "domain_Notification_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "Notification" ADD CONSTRAINT "domain_Notification_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "domain_NotificationDelivery_deviceTokenId_fk" FOREIGN KEY ("deviceTokenId") REFERENCES "DeviceToken"(id);

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "domain_NotificationDelivery_notificationId_fk" FOREIGN KEY ("notificationId") REFERENCES "Notification"(id);

ALTER TABLE "OfflineLicense" ADD CONSTRAINT "domain_OfflineLicense_assetId_fk" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "OfflineLicense" ADD CONSTRAINT "domain_OfflineLicense_lessonId_fk" FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id);

ALTER TABLE "OfflineLicense" ADD CONSTRAINT "domain_OfflineLicense_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "OperatingService" ADD CONSTRAINT "domain_OperatingService_contractId_fk" FOREIGN KEY ("contractId") REFERENCES "PartnerContract"(id);

ALTER TABLE "OperatingService" ADD CONSTRAINT "domain_OperatingService_partnerId_fk" FOREIGN KEY ("partnerId") REFERENCES "Partner"(id);

ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON DELETE CASCADE;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSku"(id);

ALTER TABLE "Partner" ADD CONSTRAINT "domain_Partner_qualificationEvidenceId_fk" FOREIGN KEY ("qualificationEvidenceId") REFERENCES "SourceEvidence"(id);

ALTER TABLE "Partner" ADD CONSTRAINT "domain_Partner_reviewerId_fk" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);

ALTER TABLE "PartnerContract" ADD CONSTRAINT "domain_PartnerContract_approvedBy_fk" FOREIGN KEY ("approvedBy") REFERENCES "User"(id);

ALTER TABLE "PartnerContract" ADD CONSTRAINT "domain_PartnerContract_partnerId_fk" FOREIGN KEY ("partnerId") REFERENCES "Partner"(id);

ALTER TABLE "PartnerContract" ADD CONSTRAINT "domain_PartnerContract_proofAssetId_fk" FOREIGN KEY ("proofAssetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "domain_PaymentAttempt_mappingId_fk" FOREIGN KEY ("mappingId") REFERENCES "ChannelProductMapping"(id);

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "domain_PaymentAttempt_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "domain_PaymentTransaction_attemptId_fk" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"(id);

ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "domain_PaymentTransaction_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "PlanBenefit" ADD CONSTRAINT "domain_PlanBenefit_definitionId_fk" FOREIGN KEY ("definitionId") REFERENCES "BenefitDefinition"(id);

ALTER TABLE "PlanBenefit" ADD CONSTRAINT "domain_PlanBenefit_planVersionId_fk" FOREIGN KEY ("planVersionId") REFERENCES "MembershipPlanVersion"(id);

ALTER TABLE "PointsAccount" ADD CONSTRAINT "domain_PointsAccount_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "PointsLedger" ADD CONSTRAINT "domain_PointsLedger_accountId_fk" FOREIGN KEY ("accountId") REFERENCES "PointsAccount"(id);

ALTER TABLE "PointsLedger" ADD CONSTRAINT "domain_PointsLedger_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "PointsLedger" ADD CONSTRAINT "domain_PointsLedger_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "PointsLedger" ADD CONSTRAINT "domain_PointsLedger_reversalOfId_fk" FOREIGN KEY ("reversalOfId") REFERENCES "PointsLedger"(id);

ALTER TABLE "PointsRedemption" ADD CONSTRAINT "domain_PointsRedemption_benefitUsageId_fk" FOREIGN KEY ("benefitUsageId") REFERENCES "BenefitUsage"(id);

ALTER TABLE "PointsRedemption" ADD CONSTRAINT "domain_PointsRedemption_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "PointsRedemption" ADD CONSTRAINT "domain_PointsRedemption_rewardId_fk" FOREIGN KEY ("rewardId") REFERENCES "PointsReward"(id);

ALTER TABLE "PointsRedemption" ADD CONSTRAINT "domain_PointsRedemption_userCouponId_fk" FOREIGN KEY ("userCouponId") REFERENCES "UserCoupon"(id);

ALTER TABLE "PointsRedemption" ADD CONSTRAINT "domain_PointsRedemption_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "PointsReservation" ADD CONSTRAINT "domain_PointsReservation_accountId_fk" FOREIGN KEY ("accountId") REFERENCES "PointsAccount"(id);

ALTER TABLE "PointsReservation" ADD CONSTRAINT "domain_PointsReservation_redemptionId_fk" FOREIGN KEY ("redemptionId") REFERENCES "PointsRedemption"(id);

ALTER TABLE "PointsReward" ADD CONSTRAINT "domain_PointsReward_benefitDefinitionId_fk" FOREIGN KEY ("benefitDefinitionId") REFERENCES "BenefitDefinition"(id);

ALTER TABLE "PointsReward" ADD CONSTRAINT "domain_PointsReward_couponTemplateId_fk" FOREIGN KEY ("couponTemplateId") REFERENCES "CouponTemplate"(id);

ALTER TABLE "PointsReward" ADD CONSTRAINT "domain_PointsReward_offerId_fk" FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id);

ALTER TABLE "PollOption" ADD CONSTRAINT "domain_PollOption_pollId_fk" FOREIGN KEY ("pollId") REFERENCES "LivePoll"(id);

ALTER TABLE "PollVote" ADD CONSTRAINT "domain_PollVote_0" FOREIGN KEY ("optionId", "pollId") REFERENCES "PollOption"(id, "pollId");

ALTER TABLE "PollVote" ADD CONSTRAINT "domain_PollVote_pollId_fk" FOREIGN KEY ("pollId") REFERENCES "LivePoll"(id);

ALTER TABLE "PollVote" ADD CONSTRAINT "domain_PollVote_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "PracticeCheckin" ADD CONSTRAINT "domain_PracticeCheckin_privateLogId_fk" FOREIGN KEY ("privateLogId") REFERENCES "PracticeLog"(id);

ALTER TABLE "PracticeCheckin" ADD CONSTRAINT "domain_PracticeCheckin_taskId_fk" FOREIGN KEY ("taskId") REFERENCES "PracticeTask"(id);

ALTER TABLE "PracticeCheckin" ADD CONSTRAINT "domain_PracticeCheckin_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "PracticeLog" ADD CONSTRAINT "PracticeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "PracticeLog" ADD CONSTRAINT "domain_PracticeLog_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "PracticeTask" ADD CONSTRAINT "domain_PracticeTask_cohortId_fk" FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id);

ALTER TABLE "PracticeTask" ADD CONSTRAINT "domain_PracticeTask_courseId_fk" FOREIGN KEY ("courseId") REFERENCES "Course"(id);

ALTER TABLE "PracticeTask" ADD CONSTRAINT "domain_PracticeTask_lessonId_fk" FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id);

ALTER TABLE "Product" ADD CONSTRAINT "domain_Product_1" FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind);

ALTER TABLE "Product" ADD CONSTRAINT "domain_Product_deliveryTemplateId_fk" FOREIGN KEY ("deliveryTemplateId") REFERENCES "DeliveryTemplate"(id);

ALTER TABLE "Product" ADD CONSTRAINT "domain_Product_partnerId_fk" FOREIGN KEY ("partnerId") REFERENCES "Partner"(id);

ALTER TABLE "ProductSku" ADD CONSTRAINT "ProductSku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"(id) ON DELETE CASCADE;

ALTER TABLE "ProductSku" ADD CONSTRAINT "domain_ProductSku_digitalReleaseId_fk" FOREIGN KEY ("digitalReleaseId") REFERENCES "DigitalRelease"(id);

ALTER TABLE "ProductSku" ADD CONSTRAINT "domain_ProductSku_productId_fk" FOREIGN KEY ("productId") REFERENCES "Product"(id);

ALTER TABLE "ProductSku" ADD CONSTRAINT "domain_ProductSku_serviceOfferingId_fk" FOREIGN KEY ("serviceOfferingId") REFERENCES "ServiceOffering"(id);

ALTER TABLE "PromotionOffer" ADD CONSTRAINT "domain_PromotionOffer_offerId_fk" FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id);

ALTER TABLE "PromotionOffer" ADD CONSTRAINT "domain_PromotionOffer_promotionId_fk" FOREIGN KEY ("promotionId") REFERENCES "Promotion"(id);

ALTER TABLE "Reaction" ADD CONSTRAINT "domain_Reaction_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "Reaction" ADD CONSTRAINT "domain_Reaction_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "ReadingEvent" ADD CONSTRAINT "domain_ReadingEvent_consentRecordId_fk" FOREIGN KEY ("consentRecordId") REFERENCES "ConsentRecord"(id);

ALTER TABLE "ReadingEvent" ADD CONSTRAINT "domain_ReadingEvent_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "ReadingEvent" ADD CONSTRAINT "domain_ReadingEvent_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "Reconciliation" ADD CONSTRAINT "domain_Reconciliation_reviewerId_fk" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);

ALTER TABLE "Referral" ADD CONSTRAINT "domain_Referral_buyerId_fk" FOREIGN KEY ("buyerId") REFERENCES "User"(id);

ALTER TABLE "Referral" ADD CONSTRAINT "domain_Referral_promoterId_fk" FOREIGN KEY ("promoterId") REFERENCES "User"(id);

ALTER TABLE "Refund" ADD CONSTRAINT "domain_Refund_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "Refund" ADD CONSTRAINT "domain_Refund_paymentTransactionId_fk" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"(id);

ALTER TABLE "Refund" ADD CONSTRAINT "domain_Refund_reviewerId_fk" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);

ALTER TABLE "Refund" ADD CONSTRAINT "domain_Refund_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "RefundItem" ADD CONSTRAINT "domain_RefundItem_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "RefundItem" ADD CONSTRAINT "domain_RefundItem_refundId_fk" FOREIGN KEY ("refundId") REFERENCES "Refund"(id);

ALTER TABLE "RefundTransaction" ADD CONSTRAINT "domain_RefundTransaction_paymentTransactionId_fk" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"(id);

ALTER TABLE "RefundTransaction" ADD CONSTRAINT "domain_RefundTransaction_refundId_fk" FOREIGN KEY ("refundId") REFERENCES "Refund"(id);

ALTER TABLE "Report" ADD CONSTRAINT "domain_Report_assigneeId_fk" FOREIGN KEY ("assigneeId") REFERENCES "User"(id);

ALTER TABLE "Report" ADD CONSTRAINT "domain_Report_commentId_fk" FOREIGN KEY ("commentId") REFERENCES "Comment"(id);

ALTER TABLE "Report" ADD CONSTRAINT "domain_Report_reporterId_fk" FOREIGN KEY ("reporterId") REFERENCES "User"(id);

ALTER TABLE "Report" ADD CONSTRAINT "domain_Report_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "Resource" ADD CONSTRAINT "domain_Resource_coverAssetId_fk" FOREIGN KEY ("coverAssetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "Resource" ADD CONSTRAINT "domain_Resource_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "User"(id);

ALTER TABLE "ResourceEvidence" ADD CONSTRAINT "domain_ResourceEvidence_evidenceId_fk" FOREIGN KEY ("evidenceId") REFERENCES "SourceEvidence"(id);

ALTER TABLE "ResourceEvidence" ADD CONSTRAINT "domain_ResourceEvidence_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "ResourceTag" ADD CONSTRAINT "domain_ResourceTag_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "ResourceTag" ADD CONSTRAINT "domain_ResourceTag_tagId_fk" FOREIGN KEY ("tagId") REFERENCES "Tag"(id);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_cohortId_fk" FOREIGN KEY ("cohortId") REFERENCES "CourseCohort"(id);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_courseReleaseId_fk" FOREIGN KEY ("courseReleaseId") REFERENCES "CourseRelease"(id);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_eventTicketId_fk" FOREIGN KEY ("eventTicketId") REFERENCES "EventTicketType"(id);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_giftId_fk" FOREIGN KEY ("giftId") REFERENCES "VirtualGift"(id);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_membershipVersionId_fk" FOREIGN KEY ("membershipVersionId") REFERENCES "MembershipPlanVersion"(id);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_operatingServiceId_fk" FOREIGN KEY ("operatingServiceId") REFERENCES "OperatingService"(id);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_serviceOfferingId_fk" FOREIGN KEY ("serviceOfferingId") REFERENCES "ServiceOffering"(id);

ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_skuId_fk" FOREIGN KEY ("skuId") REFERENCES "ProductSku"(id);

ALTER TABLE "ServiceOffering" ADD CONSTRAINT "domain_ServiceOffering_teacherId_fk" FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id);

ALTER TABLE "Settlement" ADD CONSTRAINT "domain_Settlement_partnerId_fk" FOREIGN KEY ("partnerId") REFERENCES "Partner"(id);

ALTER TABLE "Settlement" ADD CONSTRAINT "domain_Settlement_promoterId_fk" FOREIGN KEY ("promoterId") REFERENCES "User"(id);

ALTER TABLE "Settlement" ADD CONSTRAINT "domain_Settlement_proofAssetId_fk" FOREIGN KEY ("proofAssetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "Settlement" ADD CONSTRAINT "domain_Settlement_reviewerId_fk" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);

ALTER TABLE "SettlementItem" ADD CONSTRAINT "domain_SettlementItem_commissionId_fk" FOREIGN KEY ("commissionId") REFERENCES "CommissionLedger"(id);

ALTER TABLE "SettlementItem" ADD CONSTRAINT "domain_SettlementItem_contractId_fk" FOREIGN KEY ("contractId") REFERENCES "PartnerContract"(id);

ALTER TABLE "SettlementItem" ADD CONSTRAINT "domain_SettlementItem_giftAllocationId_fk" FOREIGN KEY ("giftAllocationId") REFERENCES "GiftCreditAllocation"(id);

ALTER TABLE "SettlementItem" ADD CONSTRAINT "domain_SettlementItem_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "SettlementItem" ADD CONSTRAINT "domain_SettlementItem_settlementId_fk" FOREIGN KEY ("settlementId") REFERENCES "Settlement"(id);

ALTER TABLE "Shipment" ADD CONSTRAINT "domain_Shipment_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "User"(id);

ALTER TABLE "Shipment" ADD CONSTRAINT "domain_Shipment_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "Shipment" ADD CONSTRAINT "domain_Shipment_refundId_fk" FOREIGN KEY ("refundId") REFERENCES "Refund"(id);

ALTER TABLE "ShipmentItem" ADD CONSTRAINT "domain_ShipmentItem_orderItemId_fk" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"(id);

ALTER TABLE "ShipmentItem" ADD CONSTRAINT "domain_ShipmentItem_shipmentId_fk" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"(id);

ALTER TABLE "ShippingZone" ADD CONSTRAINT "domain_ShippingZone_templateId_fk" FOREIGN KEY ("templateId") REFERENCES "DeliveryTemplate"(id);

ALTER TABLE "SourceEvidence" ADD CONSTRAINT "domain_SourceEvidence_proofAssetId_fk" FOREIGN KEY ("proofAssetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "SourceEvidence" ADD CONSTRAINT "domain_SourceEvidence_reviewerId_fk" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);

ALTER TABLE "StudyEvent" ADD CONSTRAINT "StudyEvent_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "StudyEvent" ADD CONSTRAINT "StudyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "StudyEvent" ADD CONSTRAINT "domain_StudyEvent_lessonId_fk" FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id);

ALTER TABLE "StudyEvent" ADD CONSTRAINT "domain_StudyEvent_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "StudyProgress" ADD CONSTRAINT "StudyProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "StudyProgress" ADD CONSTRAINT "StudyProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "StudyProgress" ADD CONSTRAINT "domain_StudyProgress_lessonId_fk" FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id);

ALTER TABLE "StudyProgress" ADD CONSTRAINT "domain_StudyProgress_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "Submission" ADD CONSTRAINT "domain_Submission_assignmentId_fk" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"(id);

ALTER TABLE "Submission" ADD CONSTRAINT "domain_Submission_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "Tag" ADD CONSTRAINT "domain_Tag_parentId_fk" FOREIGN KEY ("parentId") REFERENCES "Tag"(id);

ALTER TABLE "Teacher" ADD CONSTRAINT "domain_Teacher_0" FOREIGN KEY (id, "resourceKind") REFERENCES "Resource"(id, kind);

ALTER TABLE "Teacher" ADD CONSTRAINT "domain_Teacher_portraitAssetId_fk" FOREIGN KEY ("portraitAssetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "Teacher" ADD CONSTRAINT "domain_Teacher_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "TeacherAnswer" ADD CONSTRAINT "domain_TeacherAnswer_assetId_fk" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "TeacherAnswer" ADD CONSTRAINT "domain_TeacherAnswer_authorId_fk" FOREIGN KEY ("authorId") REFERENCES "User"(id);

ALTER TABLE "TeacherAnswer" ADD CONSTRAINT "domain_TeacherAnswer_questionId_fk" FOREIGN KEY ("questionId") REFERENCES "TeacherQuestion"(id);

ALTER TABLE "TeacherAnswer" ADD CONSTRAINT "domain_TeacherAnswer_reviewerId_fk" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);

ALTER TABLE "TeacherQuestion" ADD CONSTRAINT "domain_TeacherQuestion_benefitUsageId_fk" FOREIGN KEY ("benefitUsageId") REFERENCES "BenefitUsage"(id);

ALTER TABLE "TeacherQuestion" ADD CONSTRAINT "domain_TeacherQuestion_teacherId_fk" FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id);

ALTER TABLE "TeacherQuestion" ADD CONSTRAINT "domain_TeacherQuestion_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "TeacherReview" ADD CONSTRAINT "domain_TeacherReview_checkinId_fk" FOREIGN KEY ("checkinId") REFERENCES "PracticeCheckin"(id);

ALTER TABLE "TeacherReview" ADD CONSTRAINT "domain_TeacherReview_reviewerId_fk" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);

ALTER TABLE "TeacherReview" ADD CONSTRAINT "domain_TeacherReview_submissionId_fk" FOREIGN KEY ("submissionId") REFERENCES "Submission"(id);

ALTER TABLE "TeacherStaff" ADD CONSTRAINT "domain_TeacherStaff_teacherId_fk" FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id);

ALTER TABLE "TeacherStaff" ADD CONSTRAINT "domain_TeacherStaff_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "TradeOrder" ADD CONSTRAINT "domain_TradeOrder_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_contractVersionId_fk" FOREIGN KEY ("contractVersionId") REFERENCES "PartnerContract"(id);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_courseReleaseId_fk" FOREIGN KEY ("courseReleaseId") REFERENCES "CourseRelease"(id);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_digitalReleaseId_fk" FOREIGN KEY ("digitalReleaseId") REFERENCES "DigitalRelease"(id);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_membershipVersionId_fk" FOREIGN KEY ("membershipVersionId") REFERENCES "MembershipPlanVersion"(id);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_offerId_fk" FOREIGN KEY ("offerId") REFERENCES "SaleOffer"(id);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_orderId_fk" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "TradeOrderItem" ADD CONSTRAINT "domain_TradeOrderItem_slotId_fk" FOREIGN KEY ("slotId") REFERENCES "AppointmentSlot"(id);

ALTER TABLE "User" ADD CONSTRAINT "domain_User_avatarAssetId_fk" FOREIGN KEY ("avatarAssetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "UserBlock" ADD CONSTRAINT "domain_UserBlock_blockedId_fk" FOREIGN KEY ("blockedId") REFERENCES "User"(id);

ALTER TABLE "UserBlock" ADD CONSTRAINT "domain_UserBlock_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "UserCoupon" ADD CONSTRAINT "domain_UserCoupon_lockedOrderId_fk" FOREIGN KEY ("lockedOrderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "UserCoupon" ADD CONSTRAINT "domain_UserCoupon_templateId_fk" FOREIGN KEY ("templateId") REFERENCES "CouponTemplate"(id);

ALTER TABLE "UserCoupon" ADD CONSTRAINT "domain_UserCoupon_usedOrderId_fk" FOREIGN KEY ("usedOrderId") REFERENCES "TradeOrder"(id);

ALTER TABLE "UserCoupon" ADD CONSTRAINT "domain_UserCoupon_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "UserRestriction" ADD CONSTRAINT "domain_UserRestriction_actionId_fk" FOREIGN KEY ("actionId") REFERENCES "ModerationAction"(id);

ALTER TABLE "UserRestriction" ADD CONSTRAINT "domain_UserRestriction_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "Resource"(id);

ALTER TABLE "UserRestriction" ADD CONSTRAINT "domain_UserRestriction_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "UserRole" ADD CONSTRAINT "domain_UserRole_grantedBy_fk" FOREIGN KEY ("grantedBy") REFERENCES "User"(id);

ALTER TABLE "UserRole" ADD CONSTRAINT "domain_UserRole_roleId_fk" FOREIGN KEY ("roleId") REFERENCES "AccessRole"(id);

ALTER TABLE "UserRole" ADD CONSTRAINT "domain_UserRole_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "UserTag" ADD CONSTRAINT "domain_UserTag_tagId_fk" FOREIGN KEY ("tagId") REFERENCES "Tag"(id);

ALTER TABLE "UserTag" ADD CONSTRAINT "domain_UserTag_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "VirtualGift" ADD CONSTRAINT "domain_VirtualGift_iconAssetId_fk" FOREIGN KEY ("iconAssetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "WithdrawalAllocation" ADD CONSTRAINT "domain_WithdrawalAllocation_commissionId_fk" FOREIGN KEY ("commissionId") REFERENCES "CommissionLedger"(id);

ALTER TABLE "WithdrawalAllocation" ADD CONSTRAINT "domain_WithdrawalAllocation_withdrawalId_fk" FOREIGN KEY ("withdrawalId") REFERENCES "WithdrawalRequest"(id);

ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "domain_WithdrawalRequest_proofAssetId_fk" FOREIGN KEY ("proofAssetId") REFERENCES "MediaAsset"(id);

ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "domain_WithdrawalRequest_reviewerId_fk" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);

ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "domain_WithdrawalRequest_settlementId_fk" FOREIGN KEY ("settlementId") REFERENCES "Settlement"(id);

ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "domain_WithdrawalRequest_userId_fk" FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "WritingCampaign" ADD CONSTRAINT "domain_WritingCampaign_sectionId_fk" FOREIGN KEY ("sectionId") REFERENCES "ForumSection"(id);

CREATE INDEX "domain_AdCampaign_idx_0" ON public."AdCampaign" USING btree ("placementId", state, "startsAt", "endsAt");

CREATE UNIQUE INDEX "Address_one_default_per_user" ON public."Address" USING btree ("userId") WHERE ("isDefault" = true);

CREATE INDEX "Address_userId_isDefault_idx" ON public."Address" USING btree ("userId", "isDefault");

CREATE INDEX "domain_Address_idx_0" ON public."Address" USING btree ("userId", "isDefault");

CREATE UNIQUE INDEX "domain_Address_idx_1" ON public."Address" USING btree ("userId") WHERE ("isDefault" = true);

CREATE INDEX "domain_Appointment_idx_0" ON public."Appointment" USING btree ("slotId", state);

CREATE INDEX "domain_Appointment_idx_1" ON public."Appointment" USING btree ("userId", "createdAt");

CREATE INDEX "domain_AppointmentSlot_idx_0" ON public."AppointmentSlot" USING btree ("offeringId", state, "startsAt");

CREATE INDEX "Article_status_publishedAt_idx" ON public."Article" USING btree (status, "publishedAt");

CREATE INDEX "domain_Assignment_idx_0" ON public."Assignment" USING btree ("courseId", "cohortId", "dueAt");

CREATE INDEX "domain_AttachmentBinding_idx_0" ON public."AttachmentBinding" USING btree ("assetId");

CREATE INDEX "AuditLog_resource_resourceId_createdAt_idx" ON public."AuditLog" USING btree (resource, "resourceId", "createdAt");

CREATE INDEX "domain_AuditLog_idx_0" ON public."AuditLog" USING btree ("resourceType", "resourceKey", "createdAt");

CREATE INDEX "domain_AuditLog_idx_1" ON public."AuditLog" USING btree ("actorId", "createdAt");

CREATE INDEX "domain_AuthIdentity_idx_0" ON public."AuthIdentity" USING btree ("userId", provider);

CREATE UNIQUE INDEX "AuthSession_accessHash_key" ON public."AuthSession" USING btree ("accessHash");

CREATE UNIQUE INDEX "AuthSession_refreshHash_key" ON public."AuthSession" USING btree ("refreshHash");

CREATE INDEX "AuthSession_userId_revokedAt_idx" ON public."AuthSession" USING btree ("userId", "revokedAt");

CREATE INDEX "domain_AuthSession_idx_0" ON public."AuthSession" USING btree ("userId", "revokedAt");

CREATE INDEX "domain_BenefitGrant_idx_0" ON public."BenefitGrant" USING btree ("userId", "endsAt");

CREATE UNIQUE INDEX "domain_BenefitScope_idx_0" ON public."BenefitScope" USING btree ("planBenefitId", "resourceId") WHERE ("resourceId" IS NOT NULL);

CREATE UNIQUE INDEX "domain_BenefitScope_idx_1" ON public."BenefitScope" USING btree ("planBenefitId", "offerId") WHERE ("offerId" IS NOT NULL);

CREATE UNIQUE INDEX "domain_BenefitScope_idx_2" ON public."BenefitScope" USING btree ("planBenefitId", "categoryCode") WHERE ("categoryCode" IS NOT NULL);

CREATE INDEX "domain_BenefitUsage_idx_0" ON public."BenefitUsage" USING btree ("periodId", "definitionId", "windowStart", state);

CREATE UNIQUE INDEX "CartItem_userId_skuId_key" ON public."CartItem" USING btree ("userId", "skuId");

CREATE INDEX "domain_CartItem_idx_0" ON public."CartItem" USING btree ("userId", "updatedAt");

CREATE INDEX "domain_ChannelProductMapping_idx_0" ON public."ChannelProductMapping" USING btree ("offerId", channel, active);

CREATE INDEX "domain_Comment_idx_0" ON public."Comment" USING btree ("resourceId", "createdAt", id);

CREATE INDEX "domain_Comment_idx_1" ON public."Comment" USING btree ("parentId");

CREATE INDEX "domain_CommissionLedger_idx_0" ON public."CommissionLedger" USING btree ("promoterId", "availableAt");

CREATE INDEX "domain_ConsentRecord_idx_0" ON public."ConsentRecord" USING btree ("userId", purpose, "actedAt");

CREATE INDEX "domain_ConsumedRefresh_idx_0" ON public."ConsumedRefresh" USING btree ("expiresAt");

CREATE INDEX "domain_ContentAuthorization_idx_0" ON public."ContentAuthorization" USING btree ("userId", "grantedAt");

CREATE INDEX "domain_ContentRelation_idx_0" ON public."ContentRelation" USING btree ("fromId", "relationType", rank);

CREATE INDEX "Course_status_category_idx" ON public."Course" USING btree (status, category);

CREATE UNIQUE INDEX "CourseChapter_courseId_position_key" ON public."CourseChapter" USING btree ("courseId", "position");

CREATE UNIQUE INDEX "domain_CourseChapter_idx_0" ON public."CourseChapter" USING btree ("courseId", "position") WHERE ("archivedAt" IS NULL);

CREATE INDEX "domain_CourseCohort_idx_0" ON public."CourseCohort" USING btree ("courseId", "startsAt");

CREATE UNIQUE INDEX "CourseRelease_courseId_version_key" ON public."CourseRelease" USING btree ("courseId", version);

CREATE INDEX "domain_CourseStaff_idx_0" ON public."CourseStaff" USING btree ("courseId", "userId");

CREATE INDEX "domain_CourseStaff_idx_1" ON public."CourseStaff" USING btree ("cohortId", "userId");

CREATE INDEX "domain_DeviceToken_idx_0" ON public."DeviceToken" USING btree ("userId", enabled, "revokedAt");

CREATE INDEX "domain_DigitalDelivery_idx_0" ON public."DigitalDelivery" USING btree ("userId", "expiresAt");

CREATE UNIQUE INDEX "Enrollment_userId_courseId_key" ON public."Enrollment" USING btree ("userId", "courseId");

CREATE INDEX "domain_Enrollment_idx_0" ON public."Enrollment" USING btree ("userId", "courseId", "revokedAt", "expiresAt");

CREATE INDEX "Event_status_startsAt_idx" ON public."Event" USING btree (status, "startsAt");

CREATE INDEX "domain_EventRegistration_idx_0" ON public."EventRegistration" USING btree ("userId", "createdAt");

CREATE INDEX "domain_EventRegistration_idx_1" ON public."EventRegistration" USING btree ("ticketTypeId", state);

CREATE INDEX "domain_EventSession_idx_0" ON public."EventSession" USING btree ("eventId", "startsAt");

CREATE UNIQUE INDEX "domain_EventStaff_idx_0" ON public."EventStaff" USING btree ("sessionId", "userId") WHERE ("revokedAt" IS NULL);

CREATE INDEX "domain_EventTicketType_idx_0" ON public."EventTicketType" USING btree ("sessionId", active);

CREATE INDEX "domain_EventWaitlist_idx_0" ON public."EventWaitlist" USING btree ("sessionId", state, "createdAt");

CREATE UNIQUE INDEX "Favorite_userId_articleId_key" ON public."Favorite" USING btree ("userId", "articleId");

CREATE INDEX "domain_FeatureConfig_idx_0" ON public."FeatureConfig" USING btree ("configKey", "effectiveAt");

CREATE INDEX "domain_Feedback_idx_0" ON public."Feedback" USING btree (state, "createdAt");

CREATE INDEX "domain_Feedback_idx_1" ON public."Feedback" USING btree ("userId", "createdAt");

CREATE INDEX "domain_FeedbackReply_idx_0" ON public."FeedbackReply" USING btree ("feedbackId", "createdAt");

CREATE INDEX "domain_FinanceEntry_idx_0" ON public."FinanceEntry" USING btree ("journalId");

CREATE INDEX "domain_FinanceEntry_idx_1" ON public."FinanceEntry" USING btree ("accountCode", "createdAt");

CREATE INDEX "domain_ForumThread_idx_0" ON public."ForumThread" USING btree ("sectionId", "createdAt", id);

CREATE INDEX "domain_GiftCreditAllocation_idx_0" ON public."GiftCreditAllocation" USING btree ("creditLedgerId");

CREATE INDEX "domain_GiftLedger_idx_0" ON public."GiftLedger" USING btree ("walletId", "createdAt");

CREATE INDEX "domain_GroupBuy_idx_0" ON public."GroupBuy" USING btree (state, "expiresAt");

CREATE INDEX "domain_GrowthLedger_idx_0" ON public."GrowthLedger" USING btree ("userId", "businessDay");

CREATE INDEX "domain_IdempotencyRecord_idx_0" ON public."IdempotencyRecord" USING btree ("expiresAt");

CREATE INDEX "domain_InventoryLedger_idx_0" ON public."InventoryLedger" USING btree ("skuId", "createdAt");

CREATE INDEX "domain_InventoryReservation_idx_0" ON public."InventoryReservation" USING btree (state, "expiresAt");

CREATE INDEX "domain_InventoryReservation_idx_1" ON public."InventoryReservation" USING btree ("orderItemId");

CREATE UNIQUE INDEX "Lesson_releaseId_position_key" ON public."Lesson" USING btree ("releaseId", "position");

CREATE INDEX "domain_LiveMicRequest_idx_0" ON public."LiveMicRequest" USING btree ("sessionId", state, priority, "createdAt");

CREATE INDEX "domain_LiveReservation_idx_0" ON public."LiveReservation" USING btree ("sessionId", "cancelledAt");

CREATE INDEX "domain_LiveSession_idx_0" ON public."LiveSession" USING btree (state, "scheduledAt");

CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON public."MediaAsset" USING btree ("storageKey");

CREATE INDEX "domain_MediaAsset_idx_0" ON public."MediaAsset" USING btree ("uploaderId", "createdAt");

CREATE INDEX "domain_MediaAsset_idx_1" ON public."MediaAsset" USING btree (status, "createdAt");

CREATE INDEX "Membership_userId_startsAt_endsAt_idx" ON public."Membership" USING btree ("userId", "startsAt", "endsAt");

CREATE INDEX "domain_Membership_idx_0" ON public."Membership" USING btree ("userId", "startsAt", "endsAt");

CREATE UNIQUE INDEX "MembershipPlan_tier_days_key" ON public."MembershipPlan" USING btree (tier, days);

CREATE INDEX "domain_ModerationAction_idx_0" ON public."ModerationAction" USING btree ("resourceId", "createdAt");

CREATE INDEX "domain_ModerationAction_idx_1" ON public."ModerationAction" USING btree ("targetUserId", "createdAt");

CREATE INDEX "Note_userId_updatedAt_idx" ON public."Note" USING btree ("userId", "updatedAt");

CREATE INDEX "domain_Note_idx_0" ON public."Note" USING btree ("userId", "updatedAt", id);

CREATE INDEX "domain_NoteExport_idx_0" ON public."NoteExport" USING btree (state, "createdAt");

CREATE INDEX "domain_Notification_idx_0" ON public."Notification" USING btree ("userId", "createdAt", id);

CREATE INDEX "domain_NotificationDelivery_idx_0" ON public."NotificationDelivery" USING btree (state, "nextRetryAt");

CREATE INDEX "domain_OfflineLicense_idx_0" ON public."OfflineLicense" USING btree ("userId", "deviceId", "expiresAt");

CREATE INDEX "domain_OperatingService_idx_0" ON public."OperatingService" USING btree ("partnerId", state);

CREATE INDEX "Order_status_expiresAt_idx" ON public."Order" USING btree (status, "expiresAt");

CREATE INDEX "Order_userId_createdAt_idx" ON public."Order" USING btree ("userId", "createdAt");

CREATE UNIQUE INDEX "Order_userId_requestId_key" ON public."Order" USING btree ("userId", "requestId");

CREATE UNIQUE INDEX "OrderItem_orderId_skuId_key" ON public."OrderItem" USING btree ("orderId", "skuId");

CREATE INDEX "OtpChallenge_phone_createdAt_idx" ON public."OtpChallenge" USING btree (phone, "createdAt");

CREATE INDEX "domain_OtpChallenge_idx_0" ON public."OtpChallenge" USING btree ("phoneHash", purpose, "createdAt");

CREATE INDEX "domain_OutboxJob_idx_0" ON public."OutboxJob" USING btree (state, "availableAt");

CREATE INDEX "domain_PaymentAttempt_idx_0" ON public."PaymentAttempt" USING btree ("orderId", "createdAt");

CREATE INDEX "domain_PaymentAttempt_idx_1" ON public."PaymentAttempt" USING btree (state, "expiresAt");

CREATE UNIQUE INDEX "domain_PaymentTransaction_idx_0" ON public."PaymentTransaction" USING btree ("orderId") WHERE (disposition = 'ACCEPTED'::text);

CREATE INDEX "domain_PointsLedger_idx_0" ON public."PointsLedger" USING btree ("accountId", "createdAt");

CREATE INDEX "domain_PointsRedemption_idx_0" ON public."PointsRedemption" USING btree ("userId", "businessDay");

CREATE INDEX "domain_PointsRedemption_idx_1" ON public."PointsRedemption" USING btree (state, "createdAt");

CREATE INDEX "domain_PointsReservation_idx_0" ON public."PointsReservation" USING btree (state, "expiresAt");

CREATE INDEX "domain_PracticeCheckin_idx_0" ON public."PracticeCheckin" USING btree ("userId", "businessDay");

CREATE UNIQUE INDEX "PracticeLog_userId_day_key" ON public."PracticeLog" USING btree ("userId", day);

CREATE INDEX "domain_PracticeLog_idx_0" ON public."PracticeLog" USING btree ("userId", day);

CREATE INDEX "Product_status_category_idx" ON public."Product" USING btree (status, category);

CREATE INDEX "ProductSku_productId_active_idx" ON public."ProductSku" USING btree ("productId", active);

CREATE INDEX "domain_ProductSku_idx_0" ON public."ProductSku" USING btree ("productId", active);

CREATE INDEX "domain_ProviderCallback_idx_0" ON public."ProviderCallback" USING btree (state, "nextRetryAt");

CREATE INDEX "domain_RateLimit_idx_0" ON public."RateLimit" USING btree ("expiresAt");

CREATE INDEX "domain_Reaction_idx_0" ON public."Reaction" USING btree ("resourceId", kind);

CREATE INDEX "domain_ReadingEvent_idx_0" ON public."ReadingEvent" USING btree ("userId", "createdAt");

CREATE INDEX "domain_ReadingEvent_idx_1" ON public."ReadingEvent" USING btree ("resourceId", "businessDay");

CREATE INDEX "domain_Referral_idx_0" ON public."Referral" USING btree ("buyerId", "firstValidAt");

CREATE INDEX "domain_Refund_idx_0" ON public."Refund" USING btree ("orderId", "createdAt");

CREATE INDEX "domain_Refund_idx_1" ON public."Refund" USING btree (state, "updatedAt");

CREATE INDEX "domain_RefundTransaction_idx_0" ON public."RefundTransaction" USING btree ("paymentTransactionId");

CREATE INDEX "domain_RefundTransaction_idx_1" ON public."RefundTransaction" USING btree ("refundId");

CREATE INDEX "domain_Report_idx_0" ON public."Report" USING btree (state, "createdAt");

CREATE INDEX "domain_Resource_idx_0" ON public."Resource" USING btree (kind, "publishState", "publishedAt", id);

CREATE INDEX "domain_Resource_idx_1" ON public."Resource" USING btree (kind, "categoryCode", "publishState");

CREATE INDEX "domain_SaleOffer_idx_0" ON public."SaleOffer" USING btree (kind, active);

CREATE INDEX "domain_Settlement_idx_0" ON public."Settlement" USING btree ("partnerId", "periodStart");

CREATE INDEX "domain_Settlement_idx_1" ON public."Settlement" USING btree ("promoterId", "periodStart");

CREATE INDEX "domain_SettlementItem_idx_0" ON public."SettlementItem" USING btree ("settlementId");

CREATE INDEX "domain_Shipment_idx_0" ON public."Shipment" USING btree ("orderId", state);

CREATE INDEX "domain_StudyEvent_idx_0" ON public."StudyEvent" USING btree ("lessonId", "receivedAt");

CREATE UNIQUE INDEX "StudyProgress_userId_lessonId_key" ON public."StudyProgress" USING btree ("userId", "lessonId");

CREATE INDEX "domain_StudyProgress_idx_0" ON public."StudyProgress" USING btree ("userId", "updatedAt");

CREATE INDEX "domain_Submission_idx_0" ON public."Submission" USING btree ("assignmentId", state, "submittedAt");

CREATE INDEX "domain_TeacherAnswer_idx_0" ON public."TeacherAnswer" USING btree ("questionId", "createdAt");

CREATE INDEX "domain_TeacherQuestion_idx_0" ON public."TeacherQuestion" USING btree ("teacherId", state, "createdAt");

CREATE INDEX "domain_TeacherQuestion_idx_1" ON public."TeacherQuestion" USING btree ("userId", "createdAt");

CREATE INDEX "domain_TeacherReview_idx_0" ON public."TeacherReview" USING btree ("submissionId");

CREATE INDEX "domain_TeacherReview_idx_1" ON public."TeacherReview" USING btree ("checkinId");

CREATE UNIQUE INDEX "domain_TeacherStaff_idx_0" ON public."TeacherStaff" USING btree ("teacherId", "userId") WHERE ("revokedAt" IS NULL);

CREATE INDEX "domain_TradeOrder_idx_0" ON public."TradeOrder" USING btree ("userId", "createdAt", id);

CREATE INDEX "domain_TradeOrder_idx_1" ON public."TradeOrder" USING btree (state, "expiresAt");

CREATE INDEX "domain_TradeOrderItem_idx_0" ON public."TradeOrderItem" USING btree ("offerId");

CREATE INDEX "domain_TradeOrderItem_idx_1" ON public."TradeOrderItem" USING btree ("orderId", state);

CREATE UNIQUE INDEX "User_phone_key" ON public."User" USING btree (phone);

CREATE UNIQUE INDEX "User_username_key" ON public."User" USING btree (username);

CREATE INDEX "domain_UserCoupon_idx_0" ON public."UserCoupon" USING btree ("userId", state, "expiresAt");

CREATE UNIQUE INDEX "domain_UserCoupon_idx_1" ON public."UserCoupon" USING btree ("usedOrderId") WHERE ("usedOrderId" IS NOT NULL);

CREATE INDEX "domain_UserRestriction_idx_0" ON public."UserRestriction" USING btree ("userId", scope, "endsAt");

CREATE UNIQUE INDEX "domain_UserRole_idx_0" ON public."UserRole" USING btree ("userId", "roleId") WHERE ("revokedAt" IS NULL);

CREATE INDEX "domain_WithdrawalAllocation_idx_0" ON public."WithdrawalAllocation" USING btree ("commissionId", state);

CREATE INDEX "domain_WithdrawalRequest_idx_0" ON public."WithdrawalRequest" USING btree (state, "createdAt");

CREATE OR REPLACE FUNCTION public.domain_cart_offer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."offerId" IS NULL OR NEW."offerId"='' THEN NEW."offerId":='sku-offer-'||NEW."skuId"; END IF;
  IF NOT EXISTS(SELECT 1 FROM "SaleOffer" WHERE id=NEW."offerId" AND "skuId"=NEW."skuId") THEN
    RAISE EXCEPTION 'cart offer must belong to SKU' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.domain_favorite_sync()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN DELETE FROM "Reaction" WHERE "userId"=OLD."userId" AND "resourceId"=OLD."articleId" AND kind='FAVORITE'; RETURN OLD; END IF;
  INSERT INTO "Reaction"("userId","resourceId",kind) VALUES(NEW."userId",NEW."articleId",'FAVORITE') ON CONFLICT("userId","resourceId",kind) DO NOTHING;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.domain_membership_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE p "MembershipPlan"; selected_id text;
BEGIN
  SELECT * INTO p FROM "MembershipPlan" WHERE id=NEW."planId" FOR UPDATE;
  SELECT id INTO selected_id FROM "MembershipPlanVersion" WHERE "planId"=p.id ORDER BY "releaseNo" DESC LIMIT 1;
  IF selected_id IS NULL THEN
    selected_id:=gen_random_uuid()::text;
    INSERT INTO "MembershipPlanVersion" (id,"planId","releaseNo",tier,days,description,"termsSnapshot","publishedAt")
      VALUES(selected_id,p.id,1,p.tier,p.days,p.description,jsonb_build_object('legacyPrice',p.price),now());
    UPDATE "MembershipPlan" SET "currentVersionId"=selected_id WHERE id=p.id;
  END IF;
  NEW."planVersionId":=COALESCE(NEW."planVersionId",selected_id);
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.domain_plan_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE next_release integer; snapshot_id text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.tier,NEW.days,NEW.description,NEW.price) IS NOT DISTINCT FROM (OLD.tier,OLD.days,OLD.description,OLD.price) THEN RETURN NULL; END IF;
  END IF;
  SELECT COALESCE(max("releaseNo"),0)+1 INTO next_release FROM "MembershipPlanVersion" WHERE "planId"=NEW.id;
  snapshot_id:=gen_random_uuid()::text;
  INSERT INTO "MembershipPlanVersion" (id,"planId","releaseNo",tier,days,description,"termsSnapshot","publishedAt")
    VALUES(snapshot_id,NEW.id,next_release,NEW.tier,NEW.days,NEW.description,jsonb_build_object('legacyPrice',NEW.price),now());
  UPDATE "MembershipPlan" SET "currentVersionId"=snapshot_id WHERE id=NEW.id;
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.domain_product_offer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE "SaleOffer" SET active=NEW.status='PUBLISHED' AND s.active,"updatedAt"=now(),version="SaleOffer".version+1
    FROM "ProductSku" s WHERE "SaleOffer".id='sku-offer-'||s.id AND s."productId"=NEW.id;
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.domain_reaction_sync()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN NULL; END IF;
  IF TG_OP IN ('DELETE','UPDATE') THEN
    IF OLD.kind='FAVORITE' THEN DELETE FROM "Favorite" WHERE "userId"=OLD."userId" AND "articleId"=OLD."resourceId"; END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.kind='FAVORITE' AND EXISTS(SELECT 1 FROM "Article" WHERE id=NEW."resourceId") THEN
    INSERT INTO "Favorite"(id,"userId","articleId") VALUES(gen_random_uuid()::text,NEW."userId",NEW."resourceId") ON CONFLICT("userId","articleId") DO NOTHING;
  END IF;
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.domain_resource_sync()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE j jsonb; kind text := TG_ARGV[0]; resource_title text;
BEGIN
  IF TG_OP='DELETE' THEN DELETE FROM "Resource" WHERE id=OLD.id; RETURN OLD; END IF;
  j:=to_jsonb(NEW);
  resource_title:=COALESCE(NULLIF(j->>'name',''),NULLIF(j->>'title',''),(SELECT title FROM "Resource" WHERE id=NEW.id),kind);
  INSERT INTO "Resource" (id,kind,title,summary,"publishState",visibility,"categoryCode","isDemo",version,"ownerId")
  VALUES(NEW.id,kind,resource_title,COALESCE(j->>'summary',j->>'bio',''),COALESCE(j->>'status','DRAFT'),COALESCE(j->>'visibility','PUBLIC'),COALESCE(j->>'category',''),COALESCE((j->>'isDemo')::boolean,false),COALESCE((j->>'version')::integer,1),NULLIF(j->>'userId',''))
  ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,
    "publishState"=CASE WHEN j ? 'status' THEN EXCLUDED."publishState" ELSE "Resource"."publishState" END,
    visibility=CASE WHEN j ? 'visibility' THEN EXCLUDED.visibility ELSE "Resource".visibility END,
    "categoryCode"=CASE WHEN j ? 'category' THEN EXCLUDED."categoryCode" ELSE "Resource"."categoryCode" END,
    "isDemo"=CASE WHEN j ? 'isDemo' THEN EXCLUDED."isDemo" ELSE "Resource"."isDemo" END,
    "updatedAt"=now(),version=EXCLUDED.version;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.domain_role_sync()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE j jsonb; role_code text; target_user text;
BEGIN
  j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  SELECT code INTO role_code FROM "AccessRole" WHERE id=j->>'roleId'; target_user:=j->>'userId';
  IF TG_OP<>'DELETE' AND j->>'revokedAt' IS NULL THEN
    UPDATE "User" SET roles=ARRAY(SELECT DISTINCT unnest(roles || ARRAY[role_code::"Role"])) WHERE id=target_user;
  ELSIF NOT EXISTS(SELECT 1 FROM "UserRole" WHERE "userId"=target_user AND "roleId"=j->>'roleId' AND "revokedAt" IS NULL) THEN
    UPDATE "User" SET roles=COALESCE(NULLIF(array_remove(roles,role_code::"Role"),'{}'::"Role"[]),ARRAY['USER']::"Role"[]) WHERE id=target_user;
  END IF;
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.domain_sku_offer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE product_kind text; product_status text;
BEGIN
  SELECT type::text,status::text INTO product_kind,product_status FROM "Product" WHERE id=NEW."productId";
  IF product_kind='SERVICE' THEN product_kind:='CONSULTATION'; END IF;
  INSERT INTO "SaleOffer" (id,kind,"skuId",price,active,"policySnapshot")
    VALUES('sku-offer-'||NEW.id,product_kind,NEW.id,NEW.price,NEW.active AND product_status='PUBLISHED',jsonb_build_object('source','sku','skuId',NEW.id))
    ON CONFLICT(id) DO UPDATE SET price=EXCLUDED.price,active=EXCLUDED.active,"updatedAt"=now(),version="SaleOffer".version+1;
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.domain_user_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status='DELETED' AND NEW."deletedAt" IS NULL THEN NEW."deletedAt":=now(); END IF;
  IF NEW.status<>'DELETED' THEN NEW."deletedAt":=NULL; END IF;
  RETURN NEW;
END $function$
;

CREATE TRIGGER domain_article_resource BEFORE INSERT OR UPDATE ON "Article" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('ARTICLE');

CREATE TRIGGER domain_article_resource_delete AFTER DELETE ON "Article" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('ARTICLE');

CREATE TRIGGER domain_cart_offer BEFORE INSERT OR UPDATE ON "CartItem" FOR EACH ROW EXECUTE FUNCTION domain_cart_offer();

CREATE TRIGGER domain_course_resource BEFORE INSERT OR UPDATE ON "Course" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('COURSE');

CREATE TRIGGER domain_course_resource_delete AFTER DELETE ON "Course" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('COURSE');

CREATE TRIGGER domain_event_resource BEFORE INSERT OR UPDATE ON "Event" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('EVENT');

CREATE TRIGGER domain_event_resource_delete AFTER DELETE ON "Event" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('EVENT');

CREATE TRIGGER domain_favorite_sync AFTER INSERT OR DELETE ON "Favorite" FOR EACH ROW EXECUTE FUNCTION domain_favorite_sync();

CREATE TRIGGER domain_live_resource BEFORE INSERT OR UPDATE ON "LiveRoom" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('LIVE');

CREATE TRIGGER domain_live_resource_delete AFTER DELETE ON "LiveRoom" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('LIVE');

CREATE TRIGGER domain_member_version BEFORE INSERT ON "Membership" FOR EACH ROW EXECUTE FUNCTION domain_membership_snapshot();

CREATE TRIGGER domain_plan_snapshot AFTER INSERT OR UPDATE ON "MembershipPlan" FOR EACH ROW EXECUTE FUNCTION domain_plan_snapshot();

CREATE TRIGGER domain_product_offer AFTER UPDATE OF status ON "Product" FOR EACH ROW EXECUTE FUNCTION domain_product_offer();

CREATE TRIGGER domain_product_resource BEFORE INSERT OR UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('PRODUCT');

CREATE TRIGGER domain_product_resource_delete AFTER DELETE ON "Product" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('PRODUCT');

CREATE TRIGGER domain_reaction_sync AFTER INSERT OR DELETE OR UPDATE ON "Reaction" FOR EACH ROW EXECUTE FUNCTION domain_reaction_sync();

CREATE TRIGGER domain_role_sync AFTER INSERT OR DELETE OR UPDATE ON "UserRole" FOR EACH ROW EXECUTE FUNCTION domain_role_sync();

CREATE TRIGGER domain_sku_offer AFTER INSERT OR UPDATE ON "ProductSku" FOR EACH ROW EXECUTE FUNCTION domain_sku_offer();

CREATE TRIGGER domain_teacher_resource BEFORE INSERT OR UPDATE ON "Teacher" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('TEACHER');

CREATE TRIGGER domain_teacher_resource_delete AFTER DELETE ON "Teacher" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('TEACHER');

CREATE TRIGGER domain_thread_resource BEFORE INSERT OR UPDATE ON "ForumThread" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('THREAD');

CREATE TRIGGER domain_thread_resource_delete AFTER DELETE ON "ForumThread" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('THREAD');

CREATE TRIGGER domain_user_deleted BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION domain_user_deleted();
