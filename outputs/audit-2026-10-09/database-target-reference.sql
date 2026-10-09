-- 目标R1/R2参考DDL，未执行、未迁移、未进行PostgreSQL实际解析。

-- 字符串UUID由应用生成；所有FK默认RESTRICT，审计/账本禁止级联删除。

-- 本DDL之外的跨行一致性和业务状态机需按设计文档补触发器或事务实现。

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE app_user (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  phone_cipher text,
  phone_hash text UNIQUE,
  username text UNIQUE,
  password_hash text,
  nickname text NOT NULL,
  avatar_asset_id text,
  status text NOT NULL DEFAULT 'ACTIVE',
  deleted_at timestamptz,
  last_seen_at timestamptz,
  CHECK (status IN ('ACTIVE','FROZEN','DELETED')),
  CHECK ((status='DELETED')=(deleted_at IS NOT NULL))
);

CREATE TABLE auth_identity (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  provider text NOT NULL,
  app_scope text NOT NULL,
  subject_hash text NOT NULL,
  union_subject_hash text,
  verified_at timestamptz NOT NULL,
  UNIQUE(provider,app_scope,subject_hash)
);

CREATE TABLE auth_session (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  kind text NOT NULL,
  access_hash text NOT NULL UNIQUE,
  refresh_hash text NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  csrf_hash text,
  device_id text,
  revoked_at timestamptz,
  CHECK(kind IN ('APP','ADMIN')),
  CHECK(refresh_expires_at>access_expires_at)
);

CREATE TABLE consumed_refresh (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  token_hash text NOT NULL UNIQUE,
  session_id text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE otp_challenge (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  phone_hash text NOT NULL,
  purpose text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  provider_request_id text,
  delivery_state text NOT NULL,
  CHECK(attempts BETWEEN 0 AND 5)
);

CREATE TABLE rate_limit (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  limit_key text NOT NULL UNIQUE,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK(count>=0)
);

CREATE TABLE access_role (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  permission_codes text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE user_role (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  role_id text NOT NULL,
  granted_by text NOT NULL,
  reason text NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE tag (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id text,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE user_tag (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text NOT NULL,
  tag_id text NOT NULL,
  UNIQUE(user_id,tag_id)
);

CREATE TABLE consent_record (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text NOT NULL,
  policy_code text NOT NULL,
  policy_version text NOT NULL,
  purpose text NOT NULL,
  accepted boolean NOT NULL,
  acted_at timestamptz NOT NULL,
  source text NOT NULL
);

CREATE TABLE media_asset (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  uploader_id text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  name text NOT NULL,
  mime text NOT NULL,
  bytes bigint NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL,
  visibility text NOT NULL,
  duration_seconds integer,
  provider_asset_id text,
  variants jsonb NOT NULL DEFAULT '{}',
  failure_code text,
  CHECK(bytes>=0),
  CHECK(duration_seconds IS NULL OR duration_seconds>=0),
  CHECK(status IN ('UPLOADING','PROCESSING','REVIEW','READY','REJECTED','DELETED'))
);

CREATE TABLE resource (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  kind text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  cover_asset_id text,
  owner_id text,
  publish_state text NOT NULL DEFAULT 'DRAFT',
  visibility text NOT NULL DEFAULT 'PUBLIC',
  membership_tier integer,
  category_code text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  featured_rank integer,
  published_at timestamptz,
  UNIQUE(id,kind),
  CHECK(kind IN ('ARTICLE','TEACHER','COURSE','PRODUCT','EVENT','LIVE','THREAD')),
  CHECK(publish_state IN ('DRAFT','REVIEW','PUBLISHED','REJECTED','ARCHIVED')),
  CHECK(visibility IN ('PUBLIC','MEMBER','COURSE','PRIVATE')),
  CHECK(membership_tier IS NULL OR membership_tier BETWEEN 1 AND 3)
);

CREATE TABLE resource_tag (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  resource_id text NOT NULL,
  tag_id text NOT NULL,
  UNIQUE(resource_id,tag_id)
);

CREATE TABLE source_evidence (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  kind text NOT NULL,
  title text NOT NULL,
  author text,
  edition text,
  source_url text,
  proof_asset_id text,
  rights_holder text,
  license_scope text,
  valid_from timestamptz,
  valid_until timestamptz,
  review_state text NOT NULL,
  reviewer_id text,
  review_note text,
  CHECK(valid_until IS NULL OR valid_from IS NULL OR valid_until>valid_from)
);

CREATE TABLE resource_evidence (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  resource_id text NOT NULL,
  evidence_id text NOT NULL,
  purpose text NOT NULL,
  UNIQUE(resource_id,evidence_id,purpose)
);

CREATE TABLE content_relation (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  from_id text NOT NULL,
  to_id text NOT NULL,
  relation_type text NOT NULL,
  rank integer NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  approved_by text,
  UNIQUE(from_id,to_id,relation_type),
  CHECK(from_id<>to_id),
  CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at)
);

CREATE TABLE article (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_kind text NOT NULL DEFAULT 'ARTICLE' CHECK (resource_kind = 'ARTICLE'),
  author_display text NOT NULL,
  author_user_id text,
  current_release_id text,
  draft_blocks jsonb NOT NULL DEFAULT '[]',
  draft_source_snapshot jsonb NOT NULL DEFAULT '{}',
  draft_template_code text
);

CREATE TABLE article_release (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  article_id text NOT NULL,
  release_no integer NOT NULL,
  source_snapshot jsonb NOT NULL,
  author_snapshot jsonb NOT NULL,
  reviewer_id text NOT NULL,
  published_at timestamptz NOT NULL,
  UNIQUE(article_id,release_no),
  UNIQUE(id,article_id)
);

CREATE TABLE article_block (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  release_id text NOT NULL,
  stable_key text NOT NULL,
  position integer NOT NULL,
  kind text NOT NULL,
  body jsonb NOT NULL,
  media_id text,
  citation_evidence_id text,
  UNIQUE(release_id,stable_key),
  UNIQUE(release_id,position),
  CHECK(position>=0),
  CHECK(kind IN ('PARAGRAPH','QUOTE','IMAGE','AUDIO','VIDEO'))
);

CREATE TABLE reaction (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text NOT NULL,
  resource_id text NOT NULL,
  kind text NOT NULL,
  UNIQUE(user_id,resource_id,kind),
  CHECK(kind IN ('LIKE','FAVORITE'))
);

CREATE TABLE reading_event (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text,
  anonymous_hash text,
  resource_id text NOT NULL,
  event_key text NOT NULL UNIQUE,
  business_day date NOT NULL,
  dwell_seconds integer NOT NULL DEFAULT 0,
  consent_record_id text,
  CHECK(dwell_seconds>=0)
);

CREATE TABLE private_note (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  article_id text,
  release_id text,
  block_stable_key text NOT NULL,
  range_start integer,
  range_end integer,
  title_snapshot text NOT NULL,
  quote_snapshot text NOT NULL,
  note_text text NOT NULL,
  deleted_at timestamptz,
  CHECK((range_start IS NULL AND range_end IS NULL) OR (range_start>=0 AND range_end>range_start))
);

CREATE TABLE note_export (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  request_key text NOT NULL,
  filter_snapshot jsonb NOT NULL,
  format text NOT NULL,
  state text NOT NULL,
  asset_id text,
  expires_at timestamptz,
  error_code text,
  UNIQUE(user_id,request_key)
);

CREATE TABLE practice_log (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  business_day date NOT NULL,
  text text NOT NULL,
  deleted_at timestamptz,
  UNIQUE(user_id,business_day)
);

CREATE TABLE teacher (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_kind text NOT NULL DEFAULT 'TEACHER' CHECK (resource_kind = 'TEACHER'),
  user_id text UNIQUE,
  honor_title text NOT NULL,
  bio text NOT NULL,
  lineage_summary text,
  achievement_summary text,
  teaching_direction text NOT NULL,
  service_policy text,
  portrait_asset_id text
);

CREATE TABLE teacher_staff (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  teacher_id text NOT NULL,
  user_id text NOT NULL,
  scope_codes text[] NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE teacher_question (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  teacher_id text NOT NULL,
  user_id text NOT NULL,
  body text NOT NULL,
  visibility text NOT NULL,
  state text NOT NULL,
  benefit_usage_id text,
  answered_at timestamptz,
  CHECK(visibility IN ('PRIVATE','PUBLIC')),
  CHECK(state IN ('OPEN','ANSWERED','CLOSED','REJECTED'))
);

CREATE TABLE teacher_answer (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  question_id text NOT NULL,
  author_id text NOT NULL,
  body text NOT NULL,
  asset_id text,
  review_state text NOT NULL,
  featured boolean NOT NULL DEFAULT false,
  reviewer_id text
);

CREATE TABLE service_offering (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  teacher_id text NOT NULL,
  title text NOT NULL,
  mode text NOT NULL,
  duration_minutes integer NOT NULL,
  lead_minutes integer NOT NULL,
  cancel_before_minutes integer NOT NULL,
  location_policy text NOT NULL,
  delivery_policy text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  CHECK(mode IN ('PHONE','EXTERNAL_MEETING','ONSITE','IN_APP_RTC')),
  CHECK(duration_minutes>0 AND lead_minutes>=0 AND cancel_before_minutes>=0),
  UNIQUE(id,teacher_id)
);

CREATE TABLE appointment_slot (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  offering_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer NOT NULL DEFAULT 1,
  reserved integer NOT NULL DEFAULT 0,
  confirmed integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'OPEN',
  teacher_id text NOT NULL,
  UNIQUE(offering_id,starts_at),
  CHECK(ends_at>starts_at),
  CHECK(capacity>0 AND reserved>=0 AND confirmed>=0 AND reserved+confirmed<=capacity),
  CHECK(state IN ('OPEN','CLOSED','CANCELLED')),
  CHECK(capacity=1)
);

CREATE TABLE appointment (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  slot_id text NOT NULL,
  order_item_id text UNIQUE,
  request_key text NOT NULL,
  state text NOT NULL,
  contact_cipher text NOT NULL,
  service_snapshot jsonb NOT NULL,
  benefit_usage_id text,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancel_reason text,
  UNIQUE(user_id,request_key),
  CHECK(state IN ('PENDING','CONFIRMED','CANCEL_PENDING','CANCELLED','COMPLETED','NO_SHOW'))
);

CREATE TABLE course (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_kind text NOT NULL DEFAULT 'COURSE' CHECK (resource_kind = 'COURSE'),
  teacher_id text NOT NULL,
  format text NOT NULL,
  description text NOT NULL,
  current_release_id text,
  access_days integer,
  refund_policy text NOT NULL,
  completion_policy jsonb NOT NULL,
  CHECK(format IN ('VIDEO','AUDIO','LIVE','COHORT','OFFLINE')),
  CHECK(access_days IS NULL OR access_days>0)
);

CREATE TABLE course_chapter (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  course_id text NOT NULL,
  stable_key text NOT NULL,
  title text NOT NULL,
  position integer NOT NULL,
  kind text NOT NULL,
  body jsonb NOT NULL,
  asset_id text,
  duration_seconds integer NOT NULL DEFAULT 0,
  trial boolean NOT NULL DEFAULT false,
  required boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  UNIQUE(course_id,stable_key),
  CHECK(position>=0 AND duration_seconds>=0)
);

CREATE TABLE course_release (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  course_id text NOT NULL,
  release_no integer NOT NULL,
  title text NOT NULL,
  description_snapshot text NOT NULL,
  teacher_snapshot jsonb NOT NULL,
  access_days integer,
  refund_policy_snapshot jsonb NOT NULL,
  completion_policy_snapshot jsonb NOT NULL,
  UNIQUE(course_id,release_no),
  UNIQUE(id,course_id)
);

CREATE TABLE lesson (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  release_id text NOT NULL,
  stable_key text NOT NULL,
  position integer NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,
  body jsonb NOT NULL,
  asset_id text,
  live_session_id text,
  event_session_id text,
  duration_seconds integer NOT NULL DEFAULT 0,
  trial boolean NOT NULL,
  required boolean NOT NULL,
  UNIQUE(release_id,position),
  UNIQUE(release_id,stable_key),
  CHECK(kind IN ('TEXT','AUDIO','VIDEO','LIVE','OFFLINE')),
  CHECK(duration_seconds>=0)
);

CREATE TABLE course_cohort (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  course_id text NOT NULL,
  release_id text NOT NULL,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  enroll_deadline timestamptz NOT NULL,
  capacity integer NOT NULL,
  reserved integer NOT NULL DEFAULT 0,
  confirmed integer NOT NULL DEFAULT 0,
  state text NOT NULL,
  CHECK(ends_at>starts_at),
  CHECK(capacity>=0 AND reserved>=0 AND confirmed>=0 AND reserved+confirmed<=capacity),
  UNIQUE(id,course_id)
);

CREATE TABLE course_staff (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  course_id text NOT NULL,
  cohort_id text,
  user_id text NOT NULL,
  role text NOT NULL,
  revoked_at timestamptz,
  CHECK(role IN ('TEACHER','ASSISTANT'))
);

CREATE TABLE enrollment (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  course_id text NOT NULL,
  release_id text NOT NULL,
  cohort_id text,
  source text NOT NULL,
  order_item_id text UNIQUE,
  grant_key text NOT NULL UNIQUE,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  grant_actor_id text,
  grant_reason text,
  CHECK(expires_at IS NULL OR expires_at>starts_at)
);

CREATE TABLE study_progress (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  lesson_id text NOT NULL,
  position_seconds integer NOT NULL DEFAULT 0,
  verified_seconds integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  last_event_at timestamptz,
  device_id text,
  UNIQUE(user_id,lesson_id),
  CHECK(position_seconds>=0 AND verified_seconds>=0)
);

CREATE TABLE study_event (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text NOT NULL,
  lesson_id text NOT NULL,
  event_key text NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL,
  result jsonb NOT NULL,
  UNIQUE(user_id,event_key)
);

CREATE TABLE assignment (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  course_id text NOT NULL,
  lesson_id text,
  cohort_id text,
  title text NOT NULL,
  instructions jsonb NOT NULL,
  due_at timestamptz,
  required boolean NOT NULL,
  allowed_kinds text[] NOT NULL,
  state text NOT NULL
);

CREATE TABLE submission (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  assignment_id text NOT NULL,
  user_id text NOT NULL,
  revision integer NOT NULL,
  body text NOT NULL,
  state text NOT NULL,
  submitted_at timestamptz NOT NULL,
  UNIQUE(assignment_id,user_id,revision),
  CHECK(revision>0)
);

CREATE TABLE teacher_review (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  submission_id text,
  checkin_id text,
  reviewer_id text NOT NULL,
  body text NOT NULL,
  score integer,
  state text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  CHECK(num_nonnulls(submission_id,checkin_id)=1),
  CHECK(score IS NULL OR score BETWEEN 0 AND 100)
);

CREATE TABLE practice_task (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  course_id text NOT NULL,
  lesson_id text,
  cohort_id text,
  title text NOT NULL,
  instructions jsonb NOT NULL,
  frequency text NOT NULL,
  required_days integer NOT NULL,
  starts_on date,
  ends_on date,
  required boolean NOT NULL,
  CHECK(required_days>0),
  CHECK(ends_on IS NULL OR starts_on IS NULL OR ends_on>=starts_on)
);

CREATE TABLE practice_checkin (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  task_id text NOT NULL,
  user_id text NOT NULL,
  business_day date NOT NULL,
  body text NOT NULL,
  private_log_id text,
  state text NOT NULL,
  reward_event_key text UNIQUE,
  UNIQUE(task_id,user_id,business_day)
);

CREATE TABLE offline_license (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  device_id text NOT NULL,
  lesson_id text NOT NULL,
  asset_id text NOT NULL,
  entitlement_snapshot jsonb NOT NULL,
  license_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE forum_section (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  scope text NOT NULL,
  course_id text,
  cohort_id text,
  description text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  CHECK(scope IN ('PUBLIC','COURSE')),
  CHECK((scope='COURSE')=(course_id IS NOT NULL))
);

CREATE TABLE forum_thread (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_kind text NOT NULL DEFAULT 'THREAD' CHECK (resource_kind = 'THREAD'),
  section_id text NOT NULL,
  author_id text NOT NULL,
  blocks jsonb NOT NULL,
  citation_release_id text,
  essence boolean NOT NULL DEFAULT false,
  pinned_until timestamptz,
  pin_scope text,
  benefit_usage_id text,
  deleted_at timestamptz
);

CREATE TABLE comment (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_id text NOT NULL,
  author_id text NOT NULL,
  parent_id text,
  quote_block_id text,
  quote_snapshot text,
  body text NOT NULL,
  review_state text NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE user_block (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text NOT NULL,
  blocked_id text NOT NULL,
  UNIQUE(user_id,blocked_id),
  CHECK(user_id<>blocked_id)
);

CREATE TABLE report (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  reporter_id text NOT NULL,
  resource_id text,
  comment_id text,
  reason_code text NOT NULL,
  description text NOT NULL,
  state text NOT NULL,
  assignee_id text,
  resolved_at timestamptz,
  resolution text,
  CHECK(num_nonnulls(resource_id,comment_id)=1)
);

CREATE TABLE moderation_action (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id text NOT NULL,
  report_id text,
  resource_id text,
  comment_id text,
  target_user_id text,
  action text NOT NULL,
  reason text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  appeal_of_id text
);

CREATE TABLE user_restriction (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  resource_id text,
  scope text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  action_id text NOT NULL,
  revoked_at timestamptz,
  CHECK(ends_at IS NULL OR ends_at>starts_at)
);

CREATE TABLE content_authorization (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  thread_id text,
  note_id text,
  log_id text,
  source_snapshot jsonb NOT NULL,
  usage_scope text NOT NULL,
  agreement_version text NOT NULL,
  target_release_id text,
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK(num_nonnulls(thread_id,note_id,log_id)=1)
);

CREATE TABLE writing_campaign (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  title text NOT NULL,
  section_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  rules jsonb NOT NULL,
  reward_policy jsonb NOT NULL,
  state text NOT NULL,
  CHECK(ends_at>starts_at)
);

CREATE TABLE campaign_entry (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  campaign_id text NOT NULL,
  thread_id text NOT NULL,
  user_id text NOT NULL,
  authorization_id text,
  state text NOT NULL,
  rank integer,
  judge_id text,
  judge_note text,
  reward_key text UNIQUE,
  UNIQUE(campaign_id,thread_id)
);

CREATE TABLE live_room (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_kind text NOT NULL DEFAULT 'LIVE' CHECK (resource_kind = 'LIVE'),
  teacher_id text NOT NULL,
  provider text NOT NULL,
  provider_room_id text NOT NULL,
  category_code text NOT NULL,
  access_rule jsonb NOT NULL,
  course_id text,
  UNIQUE(provider,provider_room_id)
);

CREATE TABLE live_session (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  room_id text NOT NULL,
  host_user_id text NOT NULL,
  title text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  state text NOT NULL DEFAULT 'SCHEDULED',
  provider_session_id text,
  event_session_id text,
  access_rule_snapshot jsonb NOT NULL,
  push_secret_ref text,
  UNIQUE(room_id,scheduled_at),
  CHECK(state IN ('SCHEDULED','PREPARING','LIVE','ENDED','REPLAY_READY','CANCELLED')),
  CHECK(ended_at IS NULL OR started_at IS NULL OR ended_at>=started_at)
);

CREATE TABLE live_reservation (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  session_id text NOT NULL,
  user_id text NOT NULL,
  cancelled_at timestamptz,
  reminder_sent_at timestamptz,
  UNIQUE(session_id,user_id)
);

CREATE TABLE live_replay (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  session_id text NOT NULL UNIQUE,
  asset_id text NOT NULL,
  review_state text NOT NULL,
  access_rule_snapshot jsonb NOT NULL,
  published_at timestamptz,
  reviewer_id text
);

CREATE TABLE live_mic_request (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  session_id text NOT NULL,
  user_id text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  state text NOT NULL,
  approved_by text,
  rtc_session_id text,
  started_at timestamptz,
  ended_at timestamptz,
  CHECK(state IN ('WAITING','APPROVED','REJECTED','CONNECTED','ENDED','CANCELLED'))
);

CREATE TABLE live_poll (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  session_id text NOT NULL,
  question text NOT NULL,
  allow_multiple boolean NOT NULL DEFAULT false,
  closes_at timestamptz NOT NULL,
  result_visibility text NOT NULL,
  state text NOT NULL
);

CREATE TABLE poll_option (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  poll_id text NOT NULL,
  label text NOT NULL,
  position integer NOT NULL,
  UNIQUE(poll_id,position),
  UNIQUE(id,poll_id)
);

CREATE TABLE poll_vote (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  poll_id text NOT NULL,
  option_id text NOT NULL,
  user_id text NOT NULL,
  UNIQUE(poll_id,user_id,option_id)
);

CREATE TABLE virtual_gift (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  icon_asset_id text,
  credit_cost bigint NOT NULL,
  active boolean NOT NULL DEFAULT false,
  CHECK(credit_cost>0)
);

CREATE TABLE gift_wallet (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL UNIQUE,
  balance bigint NOT NULL DEFAULT 0,
  CHECK(balance>=0)
);

CREATE TABLE gift_ledger (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  wallet_id text NOT NULL,
  event_key text NOT NULL UNIQUE,
  delta bigint NOT NULL,
  kind text NOT NULL,
  order_item_id text,
  session_id text,
  gift_id text,
  quantity integer,
  reversal_of_id text UNIQUE,
  balance_after bigint NOT NULL,
  payment_transaction_id text,
  refund_transaction_id text,
  CHECK(delta<>0 AND balance_after>=0),
  CHECK(quantity IS NULL OR quantity>0)
);

CREATE TABLE product (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_kind text NOT NULL DEFAULT 'PRODUCT' CHECK (resource_kind = 'PRODUCT'),
  type text NOT NULL,
  description jsonb NOT NULL,
  cultural_origin text NOT NULL,
  partner_id text,
  delivery_template_id text,
  after_sales_policy jsonb NOT NULL,
  CHECK(type IN ('PHYSICAL','DIGITAL','SERVICE'))
);

CREATE TABLE product_sku (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  product_id text NOT NULL,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  specs jsonb NOT NULL,
  stock bigint NOT NULL DEFAULT 0,
  reserved bigint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT false,
  digital_release_id text,
  service_offering_id text,
  signed_copy boolean NOT NULL DEFAULT false,
  CHECK(stock>=reserved AND reserved>=0),
  CHECK(num_nonnulls(digital_release_id,service_offering_id)<=1)
);

CREATE TABLE digital_release (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  product_id text NOT NULL,
  release_no integer NOT NULL,
  description text NOT NULL,
  access_days integer,
  rights_snapshot jsonb NOT NULL,
  UNIQUE(product_id,release_no),
  CHECK(access_days IS NULL OR access_days>0)
);

CREATE TABLE digital_release_asset (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  release_id text NOT NULL,
  asset_id text NOT NULL,
  position integer NOT NULL,
  UNIQUE(release_id,asset_id),
  UNIQUE(release_id,position)
);

CREATE TABLE sale_offer (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  kind text NOT NULL,
  course_release_id text,
  cohort_id text,
  sku_id text,
  membership_version_id text,
  service_offering_id text,
  event_ticket_id text,
  gift_id text,
  operating_service_id text,
  currency char(3) NOT NULL DEFAULT 'CNY',
  price bigint NOT NULL,
  active boolean NOT NULL DEFAULT false,
  valid_from timestamptz,
  valid_until timestamptz,
  quantity_limit integer NOT NULL DEFAULT 99,
  policy_snapshot jsonb NOT NULL,
  CHECK(kind IN ('COURSE','PHYSICAL','DIGITAL','MEMBERSHIP','CONSULTATION','EVENT','GIFT','OPERATING_SERVICE')),
  CHECK(num_nonnulls(course_release_id,sku_id,membership_version_id,service_offering_id,event_ticket_id,gift_id,operating_service_id)=1),
  CHECK(price>=0 AND quantity_limit>0),
  CHECK(valid_until IS NULL OR valid_from IS NULL OR valid_until>valid_from)
);

CREATE TABLE channel_product_mapping (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  offer_id text NOT NULL,
  channel text NOT NULL,
  app_scope text NOT NULL,
  external_product_id text NOT NULL,
  product_type text NOT NULL,
  currency char(3) NOT NULL,
  price_minor bigint,
  minor_exponent integer NOT NULL DEFAULT 2,
  active boolean NOT NULL DEFAULT false,
  UNIQUE(channel,app_scope,external_product_id),
  CHECK(price_minor IS NULL OR price_minor>=0),
  CHECK(minor_exponent BETWEEN 0 AND 3)
);

CREATE TABLE cart_item (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  offer_id text NOT NULL,
  quantity integer NOT NULL,
  UNIQUE(user_id,offer_id),
  CHECK(quantity BETWEEN 1 AND 99)
);

CREATE TABLE address (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  recipient_cipher text NOT NULL,
  phone_cipher text NOT NULL,
  province_code text NOT NULL,
  city_code text NOT NULL,
  district_code text NOT NULL,
  detail_cipher text NOT NULL,
  is_default boolean NOT NULL DEFAULT false
);

CREATE TABLE delivery_template (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  name text NOT NULL,
  charge_basis text NOT NULL,
  priority_supported boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  CHECK(charge_basis IN ('ORDER','QUANTITY','WEIGHT'))
);

CREATE TABLE delivery_zone (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  template_id text NOT NULL,
  region_code text NOT NULL,
  base_fee bigint NOT NULL,
  surcharge bigint NOT NULL DEFAULT 0,
  increment_fee bigint NOT NULL DEFAULT 0,
  free_above bigint,
  priority_fee bigint,
  enabled boolean NOT NULL DEFAULT false,
  UNIQUE(template_id,region_code),
  CHECK(base_fee>=0 AND surcharge>=0 AND increment_fee>=0),
  CHECK(free_above IS NULL OR free_above>=0),
  CHECK(priority_fee IS NULL OR priority_fee>=0)
);

CREATE TABLE trade_order (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  order_no text NOT NULL UNIQUE,
  user_id text NOT NULL,
  kind text NOT NULL,
  request_key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  currency char(3) NOT NULL,
  minor_exponent integer NOT NULL DEFAULT 2,
  subtotal bigint NOT NULL,
  discount_total bigint NOT NULL DEFAULT 0,
  shipping_total bigint NOT NULL DEFAULT 0,
  payable_total bigint NOT NULL,
  paid_total bigint NOT NULL DEFAULT 0,
  refunded_total bigint NOT NULL DEFAULT 0,
  address_snapshot_cipher text,
  pricing_snapshot jsonb NOT NULL,
  quote_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  closed_at timestamptz,
  completed_at timestamptz,
  close_reason text,
  UNIQUE(user_id,request_key),
  CHECK(state IN ('PENDING','PAID','FULFILLING','COMPLETED','CLOSED')),
  CHECK(subtotal>=0 AND discount_total>=0 AND shipping_total>=0 AND payable_total=subtotal-discount_total+shipping_total AND payable_total>=0),
  CHECK(paid_total>=0 AND refunded_total>=0 AND refunded_total<=paid_total),
  CHECK(kind IN ('COURSE','PHYSICAL','DIGITAL','MEMBERSHIP','CONSULTATION','EVENT','GIFT','OPERATING_SERVICE'))
);

CREATE TABLE order_item (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  order_id text NOT NULL,
  line_no integer NOT NULL,
  offer_id text NOT NULL,
  quantity integer NOT NULL,
  unit_price bigint NOT NULL,
  subtotal bigint NOT NULL,
  discount_allocated bigint NOT NULL DEFAULT 0,
  shipping_allocated bigint NOT NULL DEFAULT 0,
  payable bigint NOT NULL,
  refunded_amount bigint NOT NULL DEFAULT 0,
  item_snapshot jsonb NOT NULL,
  benefit_snapshot jsonb NOT NULL,
  contract_version_id text,
  referral_snapshot jsonb,
  slot_id text,
  state text NOT NULL,
  digital_release_id text,
  course_release_id text,
  membership_version_id text,
  UNIQUE(order_id,line_no),
  CHECK(quantity BETWEEN 1 AND 99),
  CHECK(unit_price>=0 AND subtotal=unit_price*quantity),
  CHECK(discount_allocated>=0 AND shipping_allocated>=0 AND payable=subtotal-discount_allocated+shipping_allocated AND payable>=0),
  CHECK(refunded_amount BETWEEN 0 AND payable)
);

CREATE TABLE inventory_reservation (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  order_item_id text NOT NULL,
  sku_id text,
  slot_id text,
  event_ticket_id text,
  cohort_id text,
  quantity integer NOT NULL,
  state text NOT NULL DEFAULT 'HELD',
  expires_at timestamptz NOT NULL,
  converted_at timestamptz,
  released_at timestamptz,
  request_key text NOT NULL UNIQUE,
  promotion_offer_id text,
  CHECK(num_nonnulls(sku_id,slot_id,event_ticket_id,cohort_id)=1),
  CHECK(quantity>0),
  CHECK(state IN ('HELD','CONVERTED','RELEASED'))
);

CREATE TABLE inventory_ledger (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  sku_id text NOT NULL,
  reservation_id text,
  order_item_id text,
  stock_delta bigint NOT NULL,
  reserved_delta bigint NOT NULL,
  reason text NOT NULL,
  event_key text NOT NULL UNIQUE,
  actor_id text,
  stock_after bigint NOT NULL,
  reserved_after bigint NOT NULL,
  CHECK(stock_after>=reserved_after AND reserved_after>=0)
);

CREATE TABLE payment_attempt (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  order_id text NOT NULL,
  channel text NOT NULL,
  mapping_id text,
  request_key text NOT NULL UNIQUE,
  external_request_id text,
  state text NOT NULL,
  amount bigint NOT NULL,
  currency char(3) NOT NULL,
  expires_at timestamptz NOT NULL,
  failure_code text,
  last_queried_at timestamptz,
  CHECK(amount>=0),
  CHECK(state IN ('CREATED','PENDING','SUCCEEDED','FAILED','CLOSED'))
);

CREATE TABLE payment_transaction (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempt_id text,
  order_id text NOT NULL,
  channel text NOT NULL,
  app_scope text NOT NULL,
  external_transaction_id text NOT NULL,
  original_transaction_id text,
  amount bigint NOT NULL,
  currency char(3) NOT NULL,
  channel_fee bigint NOT NULL DEFAULT 0,
  verified_at timestamptz NOT NULL,
  paid_at timestamptz NOT NULL,
  disposition text NOT NULL,
  receipt_hash text NOT NULL,
  receipt_storage_ref text,
  settlement_amount bigint,
  settlement_currency char(3),
  UNIQUE(channel,app_scope,external_transaction_id),
  CHECK(amount>=0 AND channel_fee>=0),
  CHECK(disposition IN ('ACCEPTED','DUPLICATE','LATE','AMOUNT_MISMATCH','REFUND_REQUIRED'))
);

CREATE TABLE provider_callback (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  provider text NOT NULL,
  app_scope text NOT NULL,
  external_event_id text NOT NULL,
  kind text NOT NULL,
  payload_hash text NOT NULL,
  payload_storage_ref text NOT NULL,
  signature_verified boolean NOT NULL,
  state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_error_code text,
  handled_at timestamptz,
  UNIQUE(provider,app_scope,external_event_id),
  CHECK(attempts>=0)
);

CREATE TABLE refund (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  order_id text NOT NULL,
  user_id text NOT NULL,
  request_key text NOT NULL,
  kind text NOT NULL,
  state text NOT NULL,
  requested_amount bigint NOT NULL,
  approved_amount bigint,
  reason_code text NOT NULL,
  description text NOT NULL,
  reviewer_id text,
  review_note text,
  payment_transaction_id text,
  succeeded_at timestamptz,
  failure_code text,
  channel_request_key text UNIQUE,
  UNIQUE(user_id,request_key),
  CHECK(kind IN ('REFUND_ONLY','RETURN_REFUND','EXCHANGE')),
  CHECK(state IN ('REQUESTED','REVIEW','REJECTED','APPROVED','RETURNING','REFUNDING','SUCCEEDED','FAILED','CANCELLED')),
  CHECK(requested_amount>=0 AND (approved_amount IS NULL OR approved_amount BETWEEN 0 AND requested_amount))
);

CREATE TABLE refund_item (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  refund_id text NOT NULL,
  order_item_id text NOT NULL,
  quantity integer NOT NULL,
  amount bigint NOT NULL,
  revoke_quantity integer NOT NULL,
  return_stock_quantity integer NOT NULL DEFAULT 0,
  UNIQUE(refund_id,order_item_id),
  CHECK(quantity>0 AND amount>=0 AND revoke_quantity BETWEEN 0 AND quantity AND return_stock_quantity BETWEEN 0 AND quantity)
);

CREATE TABLE shipment (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  order_id text NOT NULL,
  refund_id text,
  kind text NOT NULL,
  carrier_code text NOT NULL,
  tracking_no text NOT NULL,
  state text NOT NULL,
  address_snapshot_cipher text NOT NULL,
  shipped_at timestamptz,
  delivered_at timestamptz,
  tracking_snapshot jsonb,
  actor_id text NOT NULL,
  CHECK(kind IN ('OUTBOUND','RETURN','EXCHANGE')),
  UNIQUE(carrier_code,tracking_no)
);

CREATE TABLE shipment_item (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  shipment_id text NOT NULL,
  order_item_id text NOT NULL,
  quantity integer NOT NULL,
  UNIQUE(shipment_id,order_item_id),
  CHECK(quantity>0)
);

CREATE TABLE digital_delivery (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  order_item_id text NOT NULL UNIQUE,
  release_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  grant_key text NOT NULL UNIQUE,
  CHECK(expires_at IS NULL OR expires_at>starts_at)
);

CREATE TABLE membership_plan (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  tier integer NOT NULL,
  days integer NOT NULL,
  active boolean NOT NULL DEFAULT false,
  current_version_id text,
  UNIQUE(tier,days),
  CHECK(tier BETWEEN 1 AND 3 AND days IN (30,90,365))
);

CREATE TABLE membership_plan_version (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  plan_id text NOT NULL,
  release_no integer NOT NULL,
  tier integer NOT NULL,
  days integer NOT NULL,
  description text NOT NULL,
  terms_snapshot jsonb NOT NULL,
  published_at timestamptz NOT NULL,
  UNIQUE(plan_id,release_no),
  CHECK(tier BETWEEN 1 AND 3 AND days>0)
);

CREATE TABLE benefit_definition (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL,
  parameter_schema jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false
);

CREATE TABLE plan_benefit (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  plan_version_id text NOT NULL,
  definition_id text NOT NULL,
  parameters jsonb NOT NULL,
  quota integer,
  period_kind text NOT NULL,
  UNIQUE(plan_version_id,definition_id),
  CHECK(quota IS NULL OR quota>=0)
);

CREATE TABLE membership_period (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  plan_version_id text NOT NULL,
  order_item_id text UNIQUE,
  tier integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  source text NOT NULL,
  grant_key text NOT NULL UNIQUE,
  actor_id text,
  reason text,
  revoked_at timestamptz,
  CHECK(tier BETWEEN 1 AND 3 AND ends_at>starts_at)
);

CREATE TABLE benefit_usage (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  period_id text,
  definition_id text NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  quantity integer NOT NULL,
  business_key text NOT NULL,
  state text NOT NULL,
  parameters_snapshot jsonb NOT NULL,
  reversal_of_id text UNIQUE,
  grant_id text,
  UNIQUE(user_id,business_key),
  CHECK(quantity>0 AND window_end>=window_start),
  CHECK(state IN ('HELD','CONSUMED','RELEASED','REVERSED')),
  CHECK(num_nonnulls(period_id,grant_id)=1)
);

CREATE TABLE growth_ledger (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text NOT NULL,
  delta integer NOT NULL,
  business_day date NOT NULL,
  event_key text NOT NULL UNIQUE,
  reason text NOT NULL,
  source_resource_id text,
  rule_snapshot jsonb NOT NULL,
  reversal_of_id text UNIQUE,
  CHECK(delta<>0)
);

CREATE TABLE points_account (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL UNIQUE,
  balance bigint NOT NULL DEFAULT 0,
  reserved bigint NOT NULL DEFAULT 0,
  CHECK(balance>=reserved AND reserved>=0)
);

CREATE TABLE points_ledger (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  account_id text NOT NULL,
  event_key text NOT NULL UNIQUE,
  delta bigint NOT NULL,
  reason text NOT NULL,
  order_item_id text,
  resource_id text,
  rule_snapshot jsonb NOT NULL,
  business_day date NOT NULL,
  reversal_of_id text UNIQUE,
  balance_after bigint NOT NULL,
  CHECK(delta<>0 AND balance_after>=0)
);

CREATE TABLE points_reservation (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  account_id text NOT NULL,
  request_key text NOT NULL UNIQUE,
  points bigint NOT NULL,
  state text NOT NULL,
  expires_at timestamptz NOT NULL,
  redemption_id text,
  CHECK(points>0),
  CHECK(state IN ('HELD','CONSUMED','RELEASED'))
);

CREATE TABLE points_reward (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  title text NOT NULL,
  kind text NOT NULL,
  points_cost bigint NOT NULL,
  coupon_template_id text,
  offer_id text,
  benefit_definition_id text,
  stock integer NOT NULL,
  reserved integer NOT NULL DEFAULT 0,
  per_user_daily integer NOT NULL,
  active boolean NOT NULL DEFAULT false,
  CHECK(num_nonnulls(coupon_template_id,offer_id,benefit_definition_id)=1),
  CHECK(points_cost>0 AND stock>=reserved AND reserved>=0 AND per_user_daily>0)
);

CREATE TABLE points_redemption (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  reward_id text NOT NULL,
  request_key text NOT NULL,
  points_cost bigint NOT NULL,
  reward_snapshot jsonb NOT NULL,
  state text NOT NULL,
  order_id text,
  user_coupon_id text,
  benefit_usage_id text,
  business_day date NOT NULL,
  completed_at timestamptz,
  UNIQUE(user_id,request_key),
  CHECK(points_cost>0)
);

CREATE TABLE event (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_kind text NOT NULL DEFAULT 'EVENT' CHECK (resource_kind = 'EVENT'),
  description jsonb NOT NULL,
  organizer_partner_id text,
  teacher_id text,
  cancel_policy jsonb NOT NULL,
  responsible_user_id text NOT NULL
);

CREATE TABLE event_session (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  event_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location text NOT NULL,
  contact_cipher text,
  state text NOT NULL,
  capacity integer NOT NULL,
  cancel_deadline timestamptz NOT NULL,
  public_open_at timestamptz NOT NULL,
  member_open_at timestamptz,
  rescheduled_from_id text,
  CHECK(ends_at>starts_at AND capacity>0),
  CHECK(member_open_at IS NULL OR member_open_at<=public_open_at)
);

CREATE TABLE event_ticket_type (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  session_id text NOT NULL,
  title text NOT NULL,
  capacity integer NOT NULL,
  reserved integer NOT NULL DEFAULT 0,
  confirmed integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT false,
  CHECK(capacity>=0 AND reserved>=0 AND confirmed>=0 AND reserved+confirmed<=capacity AND per_user_limit>0)
);

CREATE TABLE event_registration (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  ticket_type_id text NOT NULL,
  order_item_id text UNIQUE,
  request_key text NOT NULL,
  quantity integer NOT NULL,
  attendee_snapshot_cipher text NOT NULL,
  state text NOT NULL,
  checkin_hash text NOT NULL UNIQUE,
  benefit_usage_id text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  UNIQUE(user_id,request_key),
  CHECK(quantity>0)
);

CREATE TABLE event_checkin (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  registration_id text NOT NULL,
  attendee_no integer NOT NULL,
  actor_id text NOT NULL,
  request_key text NOT NULL UNIQUE,
  checked_at timestamptz NOT NULL,
  UNIQUE(registration_id,attendee_no),
  CHECK(attendee_no>0)
);

CREATE TABLE event_staff (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  session_id text NOT NULL,
  user_id text NOT NULL,
  scope_codes text[] NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE event_waitlist (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  session_id text NOT NULL,
  user_id text NOT NULL,
  quantity integer NOT NULL,
  state text NOT NULL,
  invited_until timestamptz,
  registration_id text,
  UNIQUE(session_id,user_id),
  CHECK(quantity>0)
);

CREATE TABLE coupon_template (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  discount_kind text NOT NULL,
  discount_value bigint NOT NULL,
  threshold bigint NOT NULL,
  max_discount bigint,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  valid_days integer,
  total_limit integer NOT NULL,
  issued_count integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL,
  allowed_channels text[] NOT NULL,
  scope jsonb NOT NULL,
  stacking_policy text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  CHECK(discount_value>0 AND threshold>=0 AND total_limit>=issued_count AND issued_count>=0 AND per_user_limit>0),
  CHECK(ends_at>starts_at)
);

CREATE TABLE user_coupon (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  template_id text NOT NULL,
  user_id text NOT NULL,
  claim_key text NOT NULL UNIQUE,
  state text NOT NULL,
  expires_at timestamptz NOT NULL,
  locked_order_id text,
  used_order_id text,
  terms_snapshot jsonb NOT NULL,
  redeem_key text UNIQUE,
  CHECK(state IN ('AVAILABLE','LOCKED','USED','EXPIRED','REVOKED'))
);

CREATE TABLE promotion (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  title text NOT NULL,
  kind text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  rules jsonb NOT NULL,
  allowed_channels text[] NOT NULL,
  state text NOT NULL,
  CHECK(ends_at>starts_at)
);

CREATE TABLE promotion_offer (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  promotion_id text NOT NULL,
  offer_id text NOT NULL,
  price bigint,
  capacity integer,
  reserved integer NOT NULL DEFAULT 0,
  sold integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL,
  UNIQUE(promotion_id,offer_id),
  CHECK(price IS NULL OR price>=0),
  CHECK(reserved>=0 AND sold>=0 AND (capacity IS NULL OR capacity>=reserved+sold)),
  CHECK(per_user_limit>0)
);

CREATE TABLE group_buy (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  offer_id text NOT NULL,
  leader_id text NOT NULL,
  required_members integer NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL,
  rule_snapshot jsonb NOT NULL,
  completed_at timestamptz,
  CHECK(required_members>=2)
);

CREATE TABLE group_buy_member (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  group_id text NOT NULL,
  user_id text NOT NULL,
  order_item_id text NOT NULL UNIQUE,
  state text NOT NULL,
  joined_at timestamptz NOT NULL,
  UNIQUE(group_id,user_id)
);

CREATE TABLE referral (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  promoter_id text NOT NULL,
  buyer_id text NOT NULL,
  code text NOT NULL,
  first_valid_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  approval_snapshot jsonb NOT NULL,
  CHECK(promoter_id<>buyer_id AND expires_at>first_valid_at)
);

CREATE TABLE commission_ledger (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  promoter_id text NOT NULL,
  order_item_id text NOT NULL,
  referral_id text NOT NULL,
  event_key text NOT NULL UNIQUE,
  delta bigint NOT NULL,
  currency char(3) NOT NULL,
  basis_snapshot jsonb NOT NULL,
  rate_basis_points integer NOT NULL,
  available_at timestamptz NOT NULL,
  reversal_of_id text UNIQUE,
  CHECK(delta<>0 AND rate_basis_points BETWEEN 0 AND 10000)
);

CREATE TABLE withdrawal_request (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  request_key text NOT NULL,
  amount bigint NOT NULL,
  currency char(3) NOT NULL,
  state text NOT NULL,
  recipient_cipher text NOT NULL,
  reviewer_id text,
  paid_at timestamptz,
  external_transfer_id text UNIQUE,
  proof_asset_id text,
  failure_code text,
  settlement_id text,
  UNIQUE(user_id,request_key),
  CHECK(amount>0)
);

CREATE TABLE partner (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  contact_cipher text,
  payee_cipher text,
  qualification_evidence_id text,
  reviewer_id text,
  reviewed_at timestamptz
);

CREATE TABLE partner_contract (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  partner_id text NOT NULL,
  contract_no text NOT NULL,
  revision integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  rate_basis_points integer NOT NULL,
  fee_policy jsonb NOT NULL,
  settlement_cycle text NOT NULL,
  proof_asset_id text NOT NULL,
  scope_snapshot jsonb NOT NULL,
  approved_by text NOT NULL,
  UNIQUE(contract_no,revision),
  CHECK(rate_basis_points BETWEEN 0 AND 10000),
  CHECK(ends_at IS NULL OR ends_at>starts_at)
);

CREATE TABLE settlement (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  partner_id text,
  promoter_id text,
  period_start date NOT NULL,
  period_end date NOT NULL,
  currency char(3) NOT NULL,
  gross_amount bigint NOT NULL,
  fee_amount bigint NOT NULL,
  refund_amount bigint NOT NULL,
  net_amount bigint NOT NULL,
  state text NOT NULL,
  reviewer_id text,
  paid_at timestamptz,
  transfer_id text UNIQUE,
  proof_asset_id text,
  CHECK(num_nonnulls(partner_id,promoter_id)=1),
  CHECK(period_end>=period_start),
  CHECK(gross_amount>=0 AND fee_amount>=0 AND refund_amount>=0),
  CHECK(net_amount=gross_amount-fee_amount-refund_amount)
);

CREATE TABLE settlement_item (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  settlement_id text NOT NULL,
  order_item_id text NOT NULL,
  event_key text NOT NULL UNIQUE,
  contract_id text,
  delta bigint NOT NULL,
  basis_snapshot jsonb NOT NULL,
  currency char(3) NOT NULL,
  commission_id text UNIQUE,
  gift_allocation_id text UNIQUE
);

CREATE TABLE finance_journal (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  order_id text,
  transaction_id text,
  refund_id text,
  currency char(3) NOT NULL,
  posted_at timestamptz NOT NULL,
  reversal_of_id text UNIQUE,
  description text NOT NULL
);

CREATE TABLE finance_entry (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  journal_id text NOT NULL,
  account_code text NOT NULL,
  partner_id text,
  user_id text,
  debit bigint NOT NULL DEFAULT 0,
  credit bigint NOT NULL DEFAULT 0,
  CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0))
);

CREATE TABLE reconciliation (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  channel text NOT NULL,
  app_scope text NOT NULL,
  business_day date NOT NULL,
  state text NOT NULL,
  bill_storage_ref text,
  bill_hash text,
  summary jsonb NOT NULL,
  differences jsonb NOT NULL,
  reviewer_id text,
  resolved_at timestamptz,
  UNIQUE(channel,app_scope,business_day)
);

CREATE TABLE operating_service (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  partner_id text NOT NULL,
  contract_id text NOT NULL,
  title text NOT NULL,
  delivery_spec jsonb NOT NULL,
  due_at timestamptz,
  state text NOT NULL
);

CREATE TABLE ad_placement (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE,
  surface text NOT NULL,
  format text NOT NULL,
  label text NOT NULL DEFAULT '推广',
  active boolean NOT NULL DEFAULT false
);

CREATE TABLE ad_campaign (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  placement_id text NOT NULL,
  operating_service_id text,
  target_resource_id text NOT NULL,
  creative_asset_id text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}',
  CHECK(ends_at>starts_at)
);

CREATE TABLE notification (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  event_key text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  resource_id text,
  order_id text,
  appointment_id text,
  registration_id text,
  read_at timestamptz,
  expires_at timestamptz,
  UNIQUE(user_id,event_key)
);

CREATE TABLE device_token (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  platform text NOT NULL,
  provider text NOT NULL,
  token_cipher text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  device_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  last_confirmed_at timestamptz
);

CREATE TABLE notification_delivery (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  notification_id text NOT NULL,
  device_token_id text,
  channel text NOT NULL,
  delivery_key text NOT NULL UNIQUE,
  state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  provider_message_id text,
  failure_code text,
  CHECK(attempts>=0)
);

CREATE TABLE feedback (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  order_id text,
  kind text NOT NULL,
  body text NOT NULL,
  contact_cipher text,
  state text NOT NULL,
  assignee_id text,
  closed_at timestamptz
);

CREATE TABLE feedback_reply (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  feedback_id text NOT NULL,
  author_id text NOT NULL,
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT false
);

CREATE TABLE audit_log (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_key text NOT NULL,
  request_id text NOT NULL,
  reason text,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  ip_hash text
);

CREATE TABLE outbox_job (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  event_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'READY',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL,
  locked_until timestamptz,
  worker_id text,
  last_error_code text,
  completed_at timestamptz,
  CHECK(attempts>=0),
  CHECK(state IN ('READY','RUNNING','DONE','DEAD'))
);

CREATE TABLE idempotency_record (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  operation text NOT NULL,
  request_key text NOT NULL,
  payload_hash text NOT NULL,
  state text NOT NULL,
  response_code integer,
  response jsonb,
  expires_at timestamptz NOT NULL,
  UNIQUE(user_id,operation,request_key)
);

CREATE TABLE feature_config (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  config_key text NOT NULL,
  revision integer NOT NULL,
  value jsonb NOT NULL,
  effective_at timestamptz NOT NULL,
  approved_by text NOT NULL,
  reason text NOT NULL,
  UNIQUE(config_key,revision),
  CHECK(revision>0)
);

CREATE TABLE attachment_binding (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  asset_id text NOT NULL,
  note_id text,
  log_id text,
  submission_id text,
  checkin_id text,
  thread_id text,
  report_id text,
  feedback_id text,
  refund_id text,
  operating_service_id text,
  position integer NOT NULL DEFAULT 0,
  caption text,
  resource_id text,
  purpose text NOT NULL DEFAULT 'ATTACHMENT',
  feedback_reply_id text,
  CHECK(num_nonnulls(resource_id,note_id,log_id,submission_id,checkin_id,thread_id,report_id,feedback_id,feedback_reply_id,refund_id,operating_service_id)=1),
  CHECK(position>=0)
);

CREATE TABLE benefit_scope (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  plan_benefit_id text NOT NULL,
  resource_id text,
  offer_id text,
  category_code text,
  CHECK(num_nonnulls(resource_id,offer_id,category_code)=1)
);

CREATE TABLE refund_transaction (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  refund_id text NOT NULL,
  payment_transaction_id text NOT NULL,
  channel text NOT NULL,
  app_scope text NOT NULL,
  external_refund_id text NOT NULL,
  amount bigint NOT NULL,
  currency char(3) NOT NULL,
  verified_at timestamptz NOT NULL,
  succeeded_at timestamptz NOT NULL,
  receipt_hash text NOT NULL,
  receipt_storage_ref text,
  UNIQUE(channel,app_scope,external_refund_id),
  CHECK(amount>0)
);

CREATE TABLE withdrawal_allocation (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  withdrawal_id text NOT NULL,
  commission_id text NOT NULL,
  amount bigint NOT NULL,
  state text NOT NULL,
  UNIQUE(withdrawal_id,commission_id),
  CHECK(amount>0),
  CHECK(state IN ('HELD','PAID','RELEASED'))
);

CREATE TABLE finance_account (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  kind text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE benefit_grant (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  user_id text NOT NULL,
  definition_id text NOT NULL,
  growth_ledger_id text,
  redemption_id text,
  resource_id text,
  offer_id text,
  source text NOT NULL,
  quota integer NOT NULL,
  parameters_snapshot jsonb NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  revoked_at timestamptz,
  grant_key text NOT NULL UNIQUE,
  actor_id text,
  reason text NOT NULL,
  CHECK(quota>0 AND ends_at>starts_at),
  CHECK(num_nonnulls(growth_ledger_id,redemption_id)<=1)
);

CREATE TABLE gift_credit_allocation (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  debit_ledger_id text NOT NULL,
  credit_ledger_id text NOT NULL,
  credits bigint NOT NULL,
  allocated_paid_minor bigint NOT NULL,
  allocated_fee_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  contract_id text,
  reversal_of_id text UNIQUE,
  UNIQUE(debit_ledger_id,credit_ledger_id),
  CHECK(credits>0 AND allocated_paid_minor>=0 AND allocated_fee_minor>=0)
);

ALTER TABLE app_user ADD FOREIGN KEY (avatar_asset_id) REFERENCES media_asset(id);

ALTER TABLE auth_identity ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE auth_session ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE consumed_refresh ADD FOREIGN KEY (session_id) REFERENCES auth_session(id);

ALTER TABLE user_role ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE user_role ADD FOREIGN KEY (role_id) REFERENCES access_role(id);

ALTER TABLE user_role ADD FOREIGN KEY (granted_by) REFERENCES app_user(id);

ALTER TABLE tag ADD FOREIGN KEY (parent_id) REFERENCES tag(id);

ALTER TABLE user_tag ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE user_tag ADD FOREIGN KEY (tag_id) REFERENCES tag(id);

ALTER TABLE consent_record ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE media_asset ADD FOREIGN KEY (uploader_id) REFERENCES app_user(id);

ALTER TABLE resource ADD FOREIGN KEY (cover_asset_id) REFERENCES media_asset(id);

ALTER TABLE resource ADD FOREIGN KEY (owner_id) REFERENCES app_user(id);

ALTER TABLE resource_tag ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE resource_tag ADD FOREIGN KEY (tag_id) REFERENCES tag(id);

ALTER TABLE source_evidence ADD FOREIGN KEY (proof_asset_id) REFERENCES media_asset(id);

ALTER TABLE source_evidence ADD FOREIGN KEY (reviewer_id) REFERENCES app_user(id);

ALTER TABLE resource_evidence ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE resource_evidence ADD FOREIGN KEY (evidence_id) REFERENCES source_evidence(id);

ALTER TABLE content_relation ADD FOREIGN KEY (from_id) REFERENCES resource(id);

ALTER TABLE content_relation ADD FOREIGN KEY (to_id) REFERENCES resource(id);

ALTER TABLE content_relation ADD FOREIGN KEY (approved_by) REFERENCES app_user(id);

ALTER TABLE article ADD FOREIGN KEY (author_user_id) REFERENCES app_user(id);

ALTER TABLE article ADD FOREIGN KEY (current_release_id) REFERENCES article_release(id);

ALTER TABLE article ADD FOREIGN KEY (id, resource_kind) REFERENCES resource(id, kind);

ALTER TABLE article ADD FOREIGN KEY(current_release_id,id) REFERENCES article_release(id,article_id);

ALTER TABLE article_release ADD FOREIGN KEY (article_id) REFERENCES article(id);

ALTER TABLE article_release ADD FOREIGN KEY (reviewer_id) REFERENCES app_user(id);

ALTER TABLE article_block ADD FOREIGN KEY (release_id) REFERENCES article_release(id);

ALTER TABLE article_block ADD FOREIGN KEY (media_id) REFERENCES media_asset(id);

ALTER TABLE article_block ADD FOREIGN KEY (citation_evidence_id) REFERENCES source_evidence(id);

ALTER TABLE reaction ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE reaction ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE reading_event ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE reading_event ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE reading_event ADD FOREIGN KEY (consent_record_id) REFERENCES consent_record(id);

ALTER TABLE private_note ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE private_note ADD FOREIGN KEY (article_id) REFERENCES article(id);

ALTER TABLE private_note ADD FOREIGN KEY (release_id) REFERENCES article_release(id);

ALTER TABLE note_export ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE note_export ADD FOREIGN KEY (asset_id) REFERENCES media_asset(id);

ALTER TABLE practice_log ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE teacher ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE teacher ADD FOREIGN KEY (portrait_asset_id) REFERENCES media_asset(id);

ALTER TABLE teacher ADD FOREIGN KEY (id, resource_kind) REFERENCES resource(id, kind);

ALTER TABLE teacher_staff ADD FOREIGN KEY (teacher_id) REFERENCES teacher(id);

ALTER TABLE teacher_staff ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE teacher_question ADD FOREIGN KEY (teacher_id) REFERENCES teacher(id);

ALTER TABLE teacher_question ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE teacher_question ADD FOREIGN KEY (benefit_usage_id) REFERENCES benefit_usage(id);

ALTER TABLE teacher_answer ADD FOREIGN KEY (question_id) REFERENCES teacher_question(id);

ALTER TABLE teacher_answer ADD FOREIGN KEY (author_id) REFERENCES app_user(id);

ALTER TABLE teacher_answer ADD FOREIGN KEY (asset_id) REFERENCES media_asset(id);

ALTER TABLE teacher_answer ADD FOREIGN KEY (reviewer_id) REFERENCES app_user(id);

ALTER TABLE service_offering ADD FOREIGN KEY (teacher_id) REFERENCES teacher(id);

ALTER TABLE appointment_slot ADD FOREIGN KEY (offering_id) REFERENCES service_offering(id);

ALTER TABLE appointment_slot ADD FOREIGN KEY (teacher_id) REFERENCES teacher(id);

ALTER TABLE appointment_slot ADD FOREIGN KEY(offering_id,teacher_id) REFERENCES service_offering(id,teacher_id);

ALTER TABLE appointment ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE appointment ADD FOREIGN KEY (slot_id) REFERENCES appointment_slot(id);

ALTER TABLE appointment ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE appointment ADD FOREIGN KEY (benefit_usage_id) REFERENCES benefit_usage(id);

ALTER TABLE course ADD FOREIGN KEY (teacher_id) REFERENCES teacher(id);

ALTER TABLE course ADD FOREIGN KEY (current_release_id) REFERENCES course_release(id);

ALTER TABLE course ADD FOREIGN KEY (id, resource_kind) REFERENCES resource(id, kind);

ALTER TABLE course ADD FOREIGN KEY(current_release_id,id) REFERENCES course_release(id,course_id);

ALTER TABLE course_chapter ADD FOREIGN KEY (course_id) REFERENCES course(id);

ALTER TABLE course_chapter ADD FOREIGN KEY (asset_id) REFERENCES media_asset(id);

ALTER TABLE course_release ADD FOREIGN KEY (course_id) REFERENCES course(id);

ALTER TABLE lesson ADD FOREIGN KEY (release_id) REFERENCES course_release(id);

ALTER TABLE lesson ADD FOREIGN KEY (asset_id) REFERENCES media_asset(id);

ALTER TABLE lesson ADD FOREIGN KEY (live_session_id) REFERENCES live_session(id);

ALTER TABLE lesson ADD FOREIGN KEY (event_session_id) REFERENCES event_session(id);

ALTER TABLE course_cohort ADD FOREIGN KEY (course_id) REFERENCES course(id);

ALTER TABLE course_cohort ADD FOREIGN KEY (release_id) REFERENCES course_release(id);

ALTER TABLE course_cohort ADD FOREIGN KEY(release_id,course_id) REFERENCES course_release(id,course_id);

ALTER TABLE course_staff ADD FOREIGN KEY (course_id) REFERENCES course(id);

ALTER TABLE course_staff ADD FOREIGN KEY (cohort_id) REFERENCES course_cohort(id);

ALTER TABLE course_staff ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE course_staff ADD FOREIGN KEY(cohort_id,course_id) REFERENCES course_cohort(id,course_id);

ALTER TABLE enrollment ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE enrollment ADD FOREIGN KEY (course_id) REFERENCES course(id);

ALTER TABLE enrollment ADD FOREIGN KEY (cohort_id) REFERENCES course_cohort(id);

ALTER TABLE enrollment ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE enrollment ADD FOREIGN KEY (grant_actor_id) REFERENCES app_user(id);

ALTER TABLE enrollment ADD FOREIGN KEY(release_id,course_id) REFERENCES course_release(id,course_id);

ALTER TABLE enrollment ADD FOREIGN KEY(cohort_id,course_id) REFERENCES course_cohort(id,course_id);

ALTER TABLE study_progress ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE study_progress ADD FOREIGN KEY (lesson_id) REFERENCES lesson(id);

ALTER TABLE study_event ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE study_event ADD FOREIGN KEY (lesson_id) REFERENCES lesson(id);

ALTER TABLE assignment ADD FOREIGN KEY (course_id) REFERENCES course(id);

ALTER TABLE assignment ADD FOREIGN KEY (lesson_id) REFERENCES lesson(id);

ALTER TABLE assignment ADD FOREIGN KEY (cohort_id) REFERENCES course_cohort(id);

ALTER TABLE submission ADD FOREIGN KEY (assignment_id) REFERENCES assignment(id);

ALTER TABLE submission ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE teacher_review ADD FOREIGN KEY (submission_id) REFERENCES submission(id);

ALTER TABLE teacher_review ADD FOREIGN KEY (checkin_id) REFERENCES practice_checkin(id);

ALTER TABLE teacher_review ADD FOREIGN KEY (reviewer_id) REFERENCES app_user(id);

ALTER TABLE practice_task ADD FOREIGN KEY (course_id) REFERENCES course(id);

ALTER TABLE practice_task ADD FOREIGN KEY (lesson_id) REFERENCES lesson(id);

ALTER TABLE practice_task ADD FOREIGN KEY (cohort_id) REFERENCES course_cohort(id);

ALTER TABLE practice_checkin ADD FOREIGN KEY (task_id) REFERENCES practice_task(id);

ALTER TABLE practice_checkin ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE practice_checkin ADD FOREIGN KEY (private_log_id) REFERENCES practice_log(id);

ALTER TABLE offline_license ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE offline_license ADD FOREIGN KEY (lesson_id) REFERENCES lesson(id);

ALTER TABLE offline_license ADD FOREIGN KEY (asset_id) REFERENCES media_asset(id);

ALTER TABLE forum_section ADD FOREIGN KEY (course_id) REFERENCES course(id);

ALTER TABLE forum_section ADD FOREIGN KEY (cohort_id) REFERENCES course_cohort(id);

ALTER TABLE forum_thread ADD FOREIGN KEY (section_id) REFERENCES forum_section(id);

ALTER TABLE forum_thread ADD FOREIGN KEY (author_id) REFERENCES app_user(id);

ALTER TABLE forum_thread ADD FOREIGN KEY (citation_release_id) REFERENCES article_release(id);

ALTER TABLE forum_thread ADD FOREIGN KEY (benefit_usage_id) REFERENCES benefit_usage(id);

ALTER TABLE forum_thread ADD FOREIGN KEY (id, resource_kind) REFERENCES resource(id, kind);

ALTER TABLE comment ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE comment ADD FOREIGN KEY (author_id) REFERENCES app_user(id);

ALTER TABLE comment ADD FOREIGN KEY (parent_id) REFERENCES comment(id);

ALTER TABLE comment ADD FOREIGN KEY (quote_block_id) REFERENCES article_block(id);

ALTER TABLE user_block ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE user_block ADD FOREIGN KEY (blocked_id) REFERENCES app_user(id);

ALTER TABLE report ADD FOREIGN KEY (reporter_id) REFERENCES app_user(id);

ALTER TABLE report ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE report ADD FOREIGN KEY (comment_id) REFERENCES comment(id);

ALTER TABLE report ADD FOREIGN KEY (assignee_id) REFERENCES app_user(id);

ALTER TABLE moderation_action ADD FOREIGN KEY (actor_id) REFERENCES app_user(id);

ALTER TABLE moderation_action ADD FOREIGN KEY (report_id) REFERENCES report(id);

ALTER TABLE moderation_action ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE moderation_action ADD FOREIGN KEY (comment_id) REFERENCES comment(id);

ALTER TABLE moderation_action ADD FOREIGN KEY (target_user_id) REFERENCES app_user(id);

ALTER TABLE moderation_action ADD FOREIGN KEY (appeal_of_id) REFERENCES moderation_action(id);

ALTER TABLE user_restriction ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE user_restriction ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE user_restriction ADD FOREIGN KEY (action_id) REFERENCES moderation_action(id);

ALTER TABLE content_authorization ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE content_authorization ADD FOREIGN KEY (thread_id) REFERENCES forum_thread(id);

ALTER TABLE content_authorization ADD FOREIGN KEY (note_id) REFERENCES private_note(id);

ALTER TABLE content_authorization ADD FOREIGN KEY (log_id) REFERENCES practice_log(id);

ALTER TABLE content_authorization ADD FOREIGN KEY (target_release_id) REFERENCES course_release(id);

ALTER TABLE writing_campaign ADD FOREIGN KEY (section_id) REFERENCES forum_section(id);

ALTER TABLE campaign_entry ADD FOREIGN KEY (campaign_id) REFERENCES writing_campaign(id);

ALTER TABLE campaign_entry ADD FOREIGN KEY (thread_id) REFERENCES forum_thread(id);

ALTER TABLE campaign_entry ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE campaign_entry ADD FOREIGN KEY (authorization_id) REFERENCES content_authorization(id);

ALTER TABLE campaign_entry ADD FOREIGN KEY (judge_id) REFERENCES app_user(id);

ALTER TABLE live_room ADD FOREIGN KEY (teacher_id) REFERENCES teacher(id);

ALTER TABLE live_room ADD FOREIGN KEY (course_id) REFERENCES course(id);

ALTER TABLE live_room ADD FOREIGN KEY (id, resource_kind) REFERENCES resource(id, kind);

ALTER TABLE live_session ADD FOREIGN KEY (room_id) REFERENCES live_room(id);

ALTER TABLE live_session ADD FOREIGN KEY (host_user_id) REFERENCES app_user(id);

ALTER TABLE live_session ADD FOREIGN KEY (event_session_id) REFERENCES event_session(id);

ALTER TABLE live_reservation ADD FOREIGN KEY (session_id) REFERENCES live_session(id);

ALTER TABLE live_reservation ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE live_replay ADD FOREIGN KEY (session_id) REFERENCES live_session(id);

ALTER TABLE live_replay ADD FOREIGN KEY (asset_id) REFERENCES media_asset(id);

ALTER TABLE live_replay ADD FOREIGN KEY (reviewer_id) REFERENCES app_user(id);

ALTER TABLE live_mic_request ADD FOREIGN KEY (session_id) REFERENCES live_session(id);

ALTER TABLE live_mic_request ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE live_mic_request ADD FOREIGN KEY (approved_by) REFERENCES app_user(id);

ALTER TABLE live_poll ADD FOREIGN KEY (session_id) REFERENCES live_session(id);

ALTER TABLE poll_option ADD FOREIGN KEY (poll_id) REFERENCES live_poll(id);

ALTER TABLE poll_vote ADD FOREIGN KEY (poll_id) REFERENCES live_poll(id);

ALTER TABLE poll_vote ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE poll_vote ADD FOREIGN KEY(option_id,poll_id) REFERENCES poll_option(id,poll_id);

ALTER TABLE virtual_gift ADD FOREIGN KEY (icon_asset_id) REFERENCES media_asset(id);

ALTER TABLE gift_wallet ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE gift_ledger ADD FOREIGN KEY (wallet_id) REFERENCES gift_wallet(id);

ALTER TABLE gift_ledger ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE gift_ledger ADD FOREIGN KEY (session_id) REFERENCES live_session(id);

ALTER TABLE gift_ledger ADD FOREIGN KEY (gift_id) REFERENCES virtual_gift(id);

ALTER TABLE gift_ledger ADD FOREIGN KEY (reversal_of_id) REFERENCES gift_ledger(id);

ALTER TABLE gift_ledger ADD FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id);

ALTER TABLE gift_ledger ADD FOREIGN KEY (refund_transaction_id) REFERENCES refund_transaction(id);

ALTER TABLE product ADD FOREIGN KEY (partner_id) REFERENCES partner(id);

ALTER TABLE product ADD FOREIGN KEY (delivery_template_id) REFERENCES delivery_template(id);

ALTER TABLE product ADD FOREIGN KEY (id, resource_kind) REFERENCES resource(id, kind);

ALTER TABLE product_sku ADD FOREIGN KEY (product_id) REFERENCES product(id);

ALTER TABLE product_sku ADD FOREIGN KEY (digital_release_id) REFERENCES digital_release(id);

ALTER TABLE product_sku ADD FOREIGN KEY (service_offering_id) REFERENCES service_offering(id);

ALTER TABLE digital_release ADD FOREIGN KEY (product_id) REFERENCES product(id);

ALTER TABLE digital_release_asset ADD FOREIGN KEY (release_id) REFERENCES digital_release(id);

ALTER TABLE digital_release_asset ADD FOREIGN KEY (asset_id) REFERENCES media_asset(id);

ALTER TABLE sale_offer ADD FOREIGN KEY (course_release_id) REFERENCES course_release(id);

ALTER TABLE sale_offer ADD FOREIGN KEY (cohort_id) REFERENCES course_cohort(id);

ALTER TABLE sale_offer ADD FOREIGN KEY (sku_id) REFERENCES product_sku(id);

ALTER TABLE sale_offer ADD FOREIGN KEY (membership_version_id) REFERENCES membership_plan_version(id);

ALTER TABLE sale_offer ADD FOREIGN KEY (service_offering_id) REFERENCES service_offering(id);

ALTER TABLE sale_offer ADD FOREIGN KEY (event_ticket_id) REFERENCES event_ticket_type(id);

ALTER TABLE sale_offer ADD FOREIGN KEY (gift_id) REFERENCES virtual_gift(id);

ALTER TABLE sale_offer ADD FOREIGN KEY (operating_service_id) REFERENCES operating_service(id);

ALTER TABLE channel_product_mapping ADD FOREIGN KEY (offer_id) REFERENCES sale_offer(id);

ALTER TABLE cart_item ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE cart_item ADD FOREIGN KEY (offer_id) REFERENCES sale_offer(id);

ALTER TABLE address ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE delivery_zone ADD FOREIGN KEY (template_id) REFERENCES delivery_template(id);

ALTER TABLE trade_order ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE order_item ADD FOREIGN KEY (order_id) REFERENCES trade_order(id);

ALTER TABLE order_item ADD FOREIGN KEY (offer_id) REFERENCES sale_offer(id);

ALTER TABLE order_item ADD FOREIGN KEY (contract_version_id) REFERENCES partner_contract(id);

ALTER TABLE order_item ADD FOREIGN KEY (slot_id) REFERENCES appointment_slot(id);

ALTER TABLE order_item ADD FOREIGN KEY (digital_release_id) REFERENCES digital_release(id);

ALTER TABLE order_item ADD FOREIGN KEY (course_release_id) REFERENCES course_release(id);

ALTER TABLE order_item ADD FOREIGN KEY (membership_version_id) REFERENCES membership_plan_version(id);

ALTER TABLE inventory_reservation ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE inventory_reservation ADD FOREIGN KEY (sku_id) REFERENCES product_sku(id);

ALTER TABLE inventory_reservation ADD FOREIGN KEY (slot_id) REFERENCES appointment_slot(id);

ALTER TABLE inventory_reservation ADD FOREIGN KEY (event_ticket_id) REFERENCES event_ticket_type(id);

ALTER TABLE inventory_reservation ADD FOREIGN KEY (cohort_id) REFERENCES course_cohort(id);

ALTER TABLE inventory_reservation ADD FOREIGN KEY (promotion_offer_id) REFERENCES promotion_offer(id);

ALTER TABLE inventory_ledger ADD FOREIGN KEY (sku_id) REFERENCES product_sku(id);

ALTER TABLE inventory_ledger ADD FOREIGN KEY (reservation_id) REFERENCES inventory_reservation(id);

ALTER TABLE inventory_ledger ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE inventory_ledger ADD FOREIGN KEY (actor_id) REFERENCES app_user(id);

ALTER TABLE payment_attempt ADD FOREIGN KEY (order_id) REFERENCES trade_order(id);

ALTER TABLE payment_attempt ADD FOREIGN KEY (mapping_id) REFERENCES channel_product_mapping(id);

ALTER TABLE payment_transaction ADD FOREIGN KEY (attempt_id) REFERENCES payment_attempt(id);

ALTER TABLE payment_transaction ADD FOREIGN KEY (order_id) REFERENCES trade_order(id);

ALTER TABLE refund ADD FOREIGN KEY (order_id) REFERENCES trade_order(id);

ALTER TABLE refund ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE refund ADD FOREIGN KEY (reviewer_id) REFERENCES app_user(id);

ALTER TABLE refund ADD FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id);

ALTER TABLE refund_item ADD FOREIGN KEY (refund_id) REFERENCES refund(id);

ALTER TABLE refund_item ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE shipment ADD FOREIGN KEY (order_id) REFERENCES trade_order(id);

ALTER TABLE shipment ADD FOREIGN KEY (refund_id) REFERENCES refund(id);

ALTER TABLE shipment ADD FOREIGN KEY (actor_id) REFERENCES app_user(id);

ALTER TABLE shipment_item ADD FOREIGN KEY (shipment_id) REFERENCES shipment(id);

ALTER TABLE shipment_item ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE digital_delivery ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE digital_delivery ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE digital_delivery ADD FOREIGN KEY (release_id) REFERENCES digital_release(id);

ALTER TABLE membership_plan ADD FOREIGN KEY (current_version_id) REFERENCES membership_plan_version(id);

ALTER TABLE membership_plan_version ADD FOREIGN KEY (plan_id) REFERENCES membership_plan(id);

ALTER TABLE plan_benefit ADD FOREIGN KEY (plan_version_id) REFERENCES membership_plan_version(id);

ALTER TABLE plan_benefit ADD FOREIGN KEY (definition_id) REFERENCES benefit_definition(id);

ALTER TABLE membership_period ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE membership_period ADD FOREIGN KEY (plan_version_id) REFERENCES membership_plan_version(id);

ALTER TABLE membership_period ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE membership_period ADD FOREIGN KEY (actor_id) REFERENCES app_user(id);

ALTER TABLE benefit_usage ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE benefit_usage ADD FOREIGN KEY (period_id) REFERENCES membership_period(id);

ALTER TABLE benefit_usage ADD FOREIGN KEY (definition_id) REFERENCES benefit_definition(id);

ALTER TABLE benefit_usage ADD FOREIGN KEY (reversal_of_id) REFERENCES benefit_usage(id);

ALTER TABLE benefit_usage ADD FOREIGN KEY (grant_id) REFERENCES benefit_grant(id);

ALTER TABLE growth_ledger ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE growth_ledger ADD FOREIGN KEY (source_resource_id) REFERENCES resource(id);

ALTER TABLE growth_ledger ADD FOREIGN KEY (reversal_of_id) REFERENCES growth_ledger(id);

ALTER TABLE points_account ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE points_ledger ADD FOREIGN KEY (account_id) REFERENCES points_account(id);

ALTER TABLE points_ledger ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE points_ledger ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE points_ledger ADD FOREIGN KEY (reversal_of_id) REFERENCES points_ledger(id);

ALTER TABLE points_reservation ADD FOREIGN KEY (account_id) REFERENCES points_account(id);

ALTER TABLE points_reservation ADD FOREIGN KEY (redemption_id) REFERENCES points_redemption(id);

ALTER TABLE points_reward ADD FOREIGN KEY (coupon_template_id) REFERENCES coupon_template(id);

ALTER TABLE points_reward ADD FOREIGN KEY (offer_id) REFERENCES sale_offer(id);

ALTER TABLE points_reward ADD FOREIGN KEY (benefit_definition_id) REFERENCES benefit_definition(id);

ALTER TABLE points_redemption ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE points_redemption ADD FOREIGN KEY (reward_id) REFERENCES points_reward(id);

ALTER TABLE points_redemption ADD FOREIGN KEY (order_id) REFERENCES trade_order(id);

ALTER TABLE points_redemption ADD FOREIGN KEY (user_coupon_id) REFERENCES user_coupon(id);

ALTER TABLE points_redemption ADD FOREIGN KEY (benefit_usage_id) REFERENCES benefit_usage(id);

ALTER TABLE event ADD FOREIGN KEY (organizer_partner_id) REFERENCES partner(id);

ALTER TABLE event ADD FOREIGN KEY (teacher_id) REFERENCES teacher(id);

ALTER TABLE event ADD FOREIGN KEY (responsible_user_id) REFERENCES app_user(id);

ALTER TABLE event ADD FOREIGN KEY (id, resource_kind) REFERENCES resource(id, kind);

ALTER TABLE event_session ADD FOREIGN KEY (event_id) REFERENCES event(id);

ALTER TABLE event_session ADD FOREIGN KEY (rescheduled_from_id) REFERENCES event_session(id);

ALTER TABLE event_ticket_type ADD FOREIGN KEY (session_id) REFERENCES event_session(id);

ALTER TABLE event_registration ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE event_registration ADD FOREIGN KEY (ticket_type_id) REFERENCES event_ticket_type(id);

ALTER TABLE event_registration ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE event_registration ADD FOREIGN KEY (benefit_usage_id) REFERENCES benefit_usage(id);

ALTER TABLE event_checkin ADD FOREIGN KEY (registration_id) REFERENCES event_registration(id);

ALTER TABLE event_checkin ADD FOREIGN KEY (actor_id) REFERENCES app_user(id);

ALTER TABLE event_staff ADD FOREIGN KEY (session_id) REFERENCES event_session(id);

ALTER TABLE event_staff ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE event_waitlist ADD FOREIGN KEY (session_id) REFERENCES event_session(id);

ALTER TABLE event_waitlist ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE event_waitlist ADD FOREIGN KEY (registration_id) REFERENCES event_registration(id);

ALTER TABLE user_coupon ADD FOREIGN KEY (template_id) REFERENCES coupon_template(id);

ALTER TABLE user_coupon ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE user_coupon ADD FOREIGN KEY (locked_order_id) REFERENCES trade_order(id);

ALTER TABLE user_coupon ADD FOREIGN KEY (used_order_id) REFERENCES trade_order(id);

ALTER TABLE promotion_offer ADD FOREIGN KEY (promotion_id) REFERENCES promotion(id);

ALTER TABLE promotion_offer ADD FOREIGN KEY (offer_id) REFERENCES sale_offer(id);

ALTER TABLE group_buy ADD FOREIGN KEY (offer_id) REFERENCES sale_offer(id);

ALTER TABLE group_buy ADD FOREIGN KEY (leader_id) REFERENCES app_user(id);

ALTER TABLE group_buy_member ADD FOREIGN KEY (group_id) REFERENCES group_buy(id);

ALTER TABLE group_buy_member ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE group_buy_member ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE referral ADD FOREIGN KEY (promoter_id) REFERENCES app_user(id);

ALTER TABLE referral ADD FOREIGN KEY (buyer_id) REFERENCES app_user(id);

ALTER TABLE commission_ledger ADD FOREIGN KEY (promoter_id) REFERENCES app_user(id);

ALTER TABLE commission_ledger ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE commission_ledger ADD FOREIGN KEY (referral_id) REFERENCES referral(id);

ALTER TABLE commission_ledger ADD FOREIGN KEY (reversal_of_id) REFERENCES commission_ledger(id);

ALTER TABLE withdrawal_request ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE withdrawal_request ADD FOREIGN KEY (reviewer_id) REFERENCES app_user(id);

ALTER TABLE withdrawal_request ADD FOREIGN KEY (proof_asset_id) REFERENCES media_asset(id);

ALTER TABLE withdrawal_request ADD FOREIGN KEY (settlement_id) REFERENCES settlement(id);

ALTER TABLE partner ADD FOREIGN KEY (qualification_evidence_id) REFERENCES source_evidence(id);

ALTER TABLE partner ADD FOREIGN KEY (reviewer_id) REFERENCES app_user(id);

ALTER TABLE partner_contract ADD FOREIGN KEY (partner_id) REFERENCES partner(id);

ALTER TABLE partner_contract ADD FOREIGN KEY (proof_asset_id) REFERENCES media_asset(id);

ALTER TABLE partner_contract ADD FOREIGN KEY (approved_by) REFERENCES app_user(id);

ALTER TABLE settlement ADD FOREIGN KEY (partner_id) REFERENCES partner(id);

ALTER TABLE settlement ADD FOREIGN KEY (promoter_id) REFERENCES app_user(id);

ALTER TABLE settlement ADD FOREIGN KEY (reviewer_id) REFERENCES app_user(id);

ALTER TABLE settlement ADD FOREIGN KEY (proof_asset_id) REFERENCES media_asset(id);

ALTER TABLE settlement_item ADD FOREIGN KEY (settlement_id) REFERENCES settlement(id);

ALTER TABLE settlement_item ADD FOREIGN KEY (order_item_id) REFERENCES order_item(id);

ALTER TABLE settlement_item ADD FOREIGN KEY (contract_id) REFERENCES partner_contract(id);

ALTER TABLE settlement_item ADD FOREIGN KEY (commission_id) REFERENCES commission_ledger(id);

ALTER TABLE settlement_item ADD FOREIGN KEY (gift_allocation_id) REFERENCES gift_credit_allocation(id);

ALTER TABLE finance_journal ADD FOREIGN KEY (order_id) REFERENCES trade_order(id);

ALTER TABLE finance_journal ADD FOREIGN KEY (transaction_id) REFERENCES payment_transaction(id);

ALTER TABLE finance_journal ADD FOREIGN KEY (refund_id) REFERENCES refund(id);

ALTER TABLE finance_journal ADD FOREIGN KEY (reversal_of_id) REFERENCES finance_journal(id);

ALTER TABLE finance_entry ADD FOREIGN KEY (journal_id) REFERENCES finance_journal(id);

ALTER TABLE finance_entry ADD FOREIGN KEY (partner_id) REFERENCES partner(id);

ALTER TABLE finance_entry ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE finance_entry ADD FOREIGN KEY(account_code) REFERENCES finance_account(code);

ALTER TABLE reconciliation ADD FOREIGN KEY (reviewer_id) REFERENCES app_user(id);

ALTER TABLE operating_service ADD FOREIGN KEY (partner_id) REFERENCES partner(id);

ALTER TABLE operating_service ADD FOREIGN KEY (contract_id) REFERENCES partner_contract(id);

ALTER TABLE ad_campaign ADD FOREIGN KEY (placement_id) REFERENCES ad_placement(id);

ALTER TABLE ad_campaign ADD FOREIGN KEY (operating_service_id) REFERENCES operating_service(id);

ALTER TABLE ad_campaign ADD FOREIGN KEY (target_resource_id) REFERENCES resource(id);

ALTER TABLE ad_campaign ADD FOREIGN KEY (creative_asset_id) REFERENCES media_asset(id);

ALTER TABLE notification ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE notification ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE notification ADD FOREIGN KEY (order_id) REFERENCES trade_order(id);

ALTER TABLE notification ADD FOREIGN KEY (appointment_id) REFERENCES appointment(id);

ALTER TABLE notification ADD FOREIGN KEY (registration_id) REFERENCES event_registration(id);

ALTER TABLE device_token ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE notification_delivery ADD FOREIGN KEY (notification_id) REFERENCES notification(id);

ALTER TABLE notification_delivery ADD FOREIGN KEY (device_token_id) REFERENCES device_token(id);

ALTER TABLE feedback ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE feedback ADD FOREIGN KEY (order_id) REFERENCES trade_order(id);

ALTER TABLE feedback ADD FOREIGN KEY (assignee_id) REFERENCES app_user(id);

ALTER TABLE feedback_reply ADD FOREIGN KEY (feedback_id) REFERENCES feedback(id);

ALTER TABLE feedback_reply ADD FOREIGN KEY (author_id) REFERENCES app_user(id);

ALTER TABLE audit_log ADD FOREIGN KEY (actor_id) REFERENCES app_user(id);

ALTER TABLE idempotency_record ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE feature_config ADD FOREIGN KEY (approved_by) REFERENCES app_user(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (asset_id) REFERENCES media_asset(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (note_id) REFERENCES private_note(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (log_id) REFERENCES practice_log(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (submission_id) REFERENCES submission(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (checkin_id) REFERENCES practice_checkin(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (thread_id) REFERENCES forum_thread(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (report_id) REFERENCES report(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (feedback_id) REFERENCES feedback(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (refund_id) REFERENCES refund(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (operating_service_id) REFERENCES operating_service(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE attachment_binding ADD FOREIGN KEY (feedback_reply_id) REFERENCES feedback_reply(id);

ALTER TABLE benefit_scope ADD FOREIGN KEY (plan_benefit_id) REFERENCES plan_benefit(id);

ALTER TABLE benefit_scope ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE benefit_scope ADD FOREIGN KEY (offer_id) REFERENCES sale_offer(id);

ALTER TABLE refund_transaction ADD FOREIGN KEY (refund_id) REFERENCES refund(id);

ALTER TABLE refund_transaction ADD FOREIGN KEY (payment_transaction_id) REFERENCES payment_transaction(id);

ALTER TABLE withdrawal_allocation ADD FOREIGN KEY (withdrawal_id) REFERENCES withdrawal_request(id);

ALTER TABLE withdrawal_allocation ADD FOREIGN KEY (commission_id) REFERENCES commission_ledger(id);

ALTER TABLE benefit_grant ADD FOREIGN KEY (user_id) REFERENCES app_user(id);

ALTER TABLE benefit_grant ADD FOREIGN KEY (definition_id) REFERENCES benefit_definition(id);

ALTER TABLE benefit_grant ADD FOREIGN KEY (growth_ledger_id) REFERENCES growth_ledger(id);

ALTER TABLE benefit_grant ADD FOREIGN KEY (redemption_id) REFERENCES points_redemption(id);

ALTER TABLE benefit_grant ADD FOREIGN KEY (resource_id) REFERENCES resource(id);

ALTER TABLE benefit_grant ADD FOREIGN KEY (offer_id) REFERENCES sale_offer(id);

ALTER TABLE benefit_grant ADD FOREIGN KEY (actor_id) REFERENCES app_user(id);

ALTER TABLE gift_credit_allocation ADD FOREIGN KEY (debit_ledger_id) REFERENCES gift_ledger(id);

ALTER TABLE gift_credit_allocation ADD FOREIGN KEY (credit_ledger_id) REFERENCES gift_ledger(id);

ALTER TABLE gift_credit_allocation ADD FOREIGN KEY (contract_id) REFERENCES partner_contract(id);

ALTER TABLE gift_credit_allocation ADD FOREIGN KEY (reversal_of_id) REFERENCES gift_credit_allocation(id);

CREATE INDEX ix_auth_identity_1 ON auth_identity (user_id,provider);

CREATE INDEX ix_auth_session_1 ON auth_session (user_id,revoked_at);

CREATE INDEX ix_consumed_refresh_1 ON consumed_refresh (expires_at);

CREATE INDEX ix_otp_challenge_1 ON otp_challenge (phone_hash,purpose,created_at);

CREATE INDEX ix_rate_limit_1 ON rate_limit (expires_at);

CREATE UNIQUE INDEX ix_user_role_1 ON user_role (user_id,role_id) WHERE revoked_at IS NULL;

CREATE INDEX ix_consent_record_1 ON consent_record (user_id,purpose,acted_at);

CREATE INDEX ix_media_asset_1 ON media_asset (uploader_id,created_at);

CREATE INDEX ix_media_asset_2 ON media_asset (status,created_at);

CREATE INDEX ix_resource_1 ON resource (kind,publish_state,published_at,id);

CREATE INDEX ix_resource_2 ON resource (kind,category_code,publish_state);

CREATE INDEX ix_content_relation_1 ON content_relation (from_id,relation_type,rank);

CREATE INDEX ix_reaction_1 ON reaction (resource_id,kind);

CREATE INDEX ix_reading_event_1 ON reading_event (user_id,created_at);

CREATE INDEX ix_reading_event_2 ON reading_event (resource_id,business_day);

CREATE INDEX ix_private_note_1 ON private_note (user_id,updated_at,id);

CREATE INDEX ix_note_export_1 ON note_export (state,created_at);

CREATE INDEX ix_practice_log_1 ON practice_log (user_id,business_day);

CREATE UNIQUE INDEX ix_teacher_staff_1 ON teacher_staff (teacher_id,user_id) WHERE revoked_at IS NULL;

CREATE INDEX ix_teacher_question_1 ON teacher_question (teacher_id,state,created_at);

CREATE INDEX ix_teacher_question_2 ON teacher_question (user_id,created_at);

CREATE INDEX ix_teacher_answer_1 ON teacher_answer (question_id,created_at);

CREATE INDEX ix_appointment_slot_1 ON appointment_slot (offering_id,state,starts_at);

CREATE INDEX ix_appointment_1 ON appointment (slot_id,state);

CREATE INDEX ix_appointment_2 ON appointment (user_id,created_at);

CREATE UNIQUE INDEX ix_course_chapter_1 ON course_chapter (course_id,position) WHERE archived_at IS NULL;

CREATE INDEX ix_course_cohort_1 ON course_cohort (course_id,starts_at);

CREATE INDEX ix_course_staff_1 ON course_staff (course_id,user_id);

CREATE INDEX ix_course_staff_2 ON course_staff (cohort_id,user_id);

CREATE INDEX ix_enrollment_1 ON enrollment (user_id,course_id,revoked_at,expires_at);

CREATE INDEX ix_study_progress_1 ON study_progress (user_id,updated_at);

CREATE INDEX ix_study_event_1 ON study_event (lesson_id,received_at);

CREATE INDEX ix_assignment_1 ON assignment (course_id,cohort_id,due_at);

CREATE INDEX ix_submission_1 ON submission (assignment_id,state,submitted_at);

CREATE INDEX ix_teacher_review_1 ON teacher_review (submission_id);

CREATE INDEX ix_teacher_review_2 ON teacher_review (checkin_id);

CREATE INDEX ix_practice_checkin_1 ON practice_checkin (user_id,business_day);

CREATE INDEX ix_offline_license_1 ON offline_license (user_id,device_id,expires_at);

CREATE INDEX ix_forum_thread_1 ON forum_thread (section_id,created_at,id);

CREATE INDEX ix_comment_1 ON comment (resource_id,created_at,id);

CREATE INDEX ix_comment_2 ON comment (parent_id);

CREATE INDEX ix_report_1 ON report (state,created_at);

CREATE INDEX ix_moderation_action_1 ON moderation_action (resource_id,created_at);

CREATE INDEX ix_moderation_action_2 ON moderation_action (target_user_id,created_at);

CREATE INDEX ix_user_restriction_1 ON user_restriction (user_id,scope,ends_at);

CREATE INDEX ix_content_authorization_1 ON content_authorization (user_id,granted_at);

CREATE INDEX ix_live_session_1 ON live_session (state,scheduled_at);

CREATE INDEX ix_live_reservation_1 ON live_reservation (session_id,cancelled_at);

CREATE INDEX ix_live_mic_request_1 ON live_mic_request (session_id,state,priority,created_at);

CREATE INDEX ix_gift_ledger_1 ON gift_ledger (wallet_id,created_at);

CREATE INDEX ix_product_sku_1 ON product_sku (product_id,active);

CREATE INDEX ix_sale_offer_1 ON sale_offer (kind,active);

CREATE INDEX ix_channel_product_mapping_1 ON channel_product_mapping (offer_id,channel,active);

CREATE INDEX ix_cart_item_1 ON cart_item (user_id,updated_at);

CREATE INDEX ix_address_1 ON address (user_id,is_default);

CREATE UNIQUE INDEX ix_address_2 ON address (user_id) WHERE is_default=true;

CREATE INDEX ix_trade_order_1 ON trade_order (user_id,created_at,id);

CREATE INDEX ix_trade_order_2 ON trade_order (state,expires_at);

CREATE INDEX ix_order_item_1 ON order_item (offer_id);

CREATE INDEX ix_order_item_2 ON order_item (order_id,state);

CREATE INDEX ix_inventory_reservation_1 ON inventory_reservation (state,expires_at);

CREATE INDEX ix_inventory_reservation_2 ON inventory_reservation (order_item_id);

CREATE INDEX ix_inventory_ledger_1 ON inventory_ledger (sku_id,created_at);

CREATE INDEX ix_payment_attempt_1 ON payment_attempt (order_id,created_at);

CREATE INDEX ix_payment_attempt_2 ON payment_attempt (state,expires_at);

CREATE UNIQUE INDEX ix_payment_transaction_1 ON payment_transaction (order_id) WHERE disposition='ACCEPTED';

CREATE INDEX ix_provider_callback_1 ON provider_callback (state,next_retry_at);

CREATE INDEX ix_refund_1 ON refund (order_id,created_at);

CREATE INDEX ix_refund_2 ON refund (state,updated_at);

CREATE INDEX ix_shipment_1 ON shipment (order_id,state);

CREATE INDEX ix_digital_delivery_1 ON digital_delivery (user_id,expires_at);

CREATE INDEX ix_membership_period_1 ON membership_period (user_id,starts_at,ends_at);

CREATE INDEX ix_benefit_usage_1 ON benefit_usage (period_id,definition_id,window_start,state);

CREATE INDEX ix_growth_ledger_1 ON growth_ledger (user_id,business_day);

CREATE INDEX ix_points_ledger_1 ON points_ledger (account_id,created_at);

CREATE INDEX ix_points_reservation_1 ON points_reservation (state,expires_at);

CREATE INDEX ix_points_redemption_1 ON points_redemption (user_id,business_day);

CREATE INDEX ix_points_redemption_2 ON points_redemption (state,created_at);

CREATE INDEX ix_event_session_1 ON event_session (event_id,starts_at);

CREATE INDEX ix_event_ticket_type_1 ON event_ticket_type (session_id,active);

CREATE INDEX ix_event_registration_1 ON event_registration (user_id,created_at);

CREATE INDEX ix_event_registration_2 ON event_registration (ticket_type_id,state);

CREATE UNIQUE INDEX ix_event_staff_1 ON event_staff (session_id,user_id) WHERE revoked_at IS NULL;

CREATE INDEX ix_event_waitlist_1 ON event_waitlist (session_id,state,created_at);

CREATE INDEX ix_user_coupon_1 ON user_coupon (user_id,state,expires_at);

CREATE UNIQUE INDEX ix_user_coupon_2 ON user_coupon (used_order_id) WHERE used_order_id IS NOT NULL;

CREATE INDEX ix_group_buy_1 ON group_buy (state,expires_at);

CREATE INDEX ix_referral_1 ON referral (buyer_id,first_valid_at);

CREATE INDEX ix_commission_ledger_1 ON commission_ledger (promoter_id,available_at);

CREATE INDEX ix_withdrawal_request_1 ON withdrawal_request (state,created_at);

CREATE INDEX ix_settlement_1 ON settlement (partner_id,period_start);

CREATE INDEX ix_settlement_2 ON settlement (promoter_id,period_start);

CREATE INDEX ix_settlement_item_1 ON settlement_item (settlement_id);

CREATE INDEX ix_finance_entry_1 ON finance_entry (journal_id);

CREATE INDEX ix_finance_entry_2 ON finance_entry (account_code,created_at);

CREATE INDEX ix_operating_service_1 ON operating_service (partner_id,state);

CREATE INDEX ix_ad_campaign_1 ON ad_campaign (placement_id,state,starts_at,ends_at);

CREATE INDEX ix_notification_1 ON notification (user_id,created_at,id);

CREATE INDEX ix_device_token_1 ON device_token (user_id,enabled,revoked_at);

CREATE INDEX ix_notification_delivery_1 ON notification_delivery (state,next_retry_at);

CREATE INDEX ix_feedback_1 ON feedback (state,created_at);

CREATE INDEX ix_feedback_2 ON feedback (user_id,created_at);

CREATE INDEX ix_feedback_reply_1 ON feedback_reply (feedback_id,created_at);

CREATE INDEX ix_audit_log_1 ON audit_log (resource_type,resource_key,created_at);

CREATE INDEX ix_audit_log_2 ON audit_log (actor_id,created_at);

CREATE INDEX ix_outbox_job_1 ON outbox_job (state,available_at);

CREATE INDEX ix_idempotency_record_1 ON idempotency_record (expires_at);

CREATE INDEX ix_feature_config_1 ON feature_config (config_key,effective_at);

CREATE INDEX ix_attachment_binding_1 ON attachment_binding (asset_id);

CREATE UNIQUE INDEX ix_benefit_scope_1 ON benefit_scope (plan_benefit_id,resource_id) WHERE resource_id IS NOT NULL;

CREATE UNIQUE INDEX ix_benefit_scope_2 ON benefit_scope (plan_benefit_id,offer_id) WHERE offer_id IS NOT NULL;

CREATE UNIQUE INDEX ix_benefit_scope_3 ON benefit_scope (plan_benefit_id,category_code) WHERE category_code IS NOT NULL;

CREATE INDEX ix_refund_transaction_1 ON refund_transaction (payment_transaction_id);

CREATE INDEX ix_refund_transaction_2 ON refund_transaction (refund_id);

CREATE INDEX ix_withdrawal_allocation_1 ON withdrawal_allocation (commission_id,state);

CREATE INDEX ix_benefit_grant_1 ON benefit_grant (user_id,ends_at);

CREATE INDEX ix_gift_credit_allocation_1 ON gift_credit_allocation (credit_ledger_id);

ALTER TABLE membership_period ADD CONSTRAINT membership_period_no_overlap EXCLUDE USING gist (user_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (revoked_at IS NULL);

ALTER TABLE appointment_slot ADD CONSTRAINT appointment_slot_no_overlap EXCLUDE USING gist (teacher_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (state <> 'CANCELLED');

COMMIT;
