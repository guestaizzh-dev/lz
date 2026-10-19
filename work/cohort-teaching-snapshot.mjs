import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require=createRequire(new URL('../services/api/package.json',import.meta.url)),{Pool}=require('pg');
const source=new URL(process.env.DATABASE_URL);
if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(source.hostname))throw Error('Local database only');
const pool=new Pool({connectionString:source.toString()});
try{
  const row=(await pool.query(`SELECT
    (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL) AS migrations,
    (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
    (SELECT count(*)::int FROM "User") AS users,
    (SELECT count(*)::int FROM "Course") AS courses,
    (SELECT count(*)::int FROM "TradeOrder") AS orders,
    (SELECT count(*)::int FROM "CourseCohort") AS cohorts,
    (SELECT count(*)::int FROM "CohortRegistration") AS registrations,
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb)::text) FROM "Enrollment" e WHERE "cohortId" IS NULL) AS ordinary_enrollment_digest,
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(c)-'scheduleFrozenAt' ORDER BY c.id),'[]'::jsonb)::text) FROM "CourseCohort" c) AS cohort_identity_digest
  `)).rows[0];
  const facts=(await pool.query(`SELECT
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)::text) FROM "Assignment" a) AS assignments_digest,
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb)::text) FROM "PracticeTask" t) AS tasks_digest,
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)::text) FROM "CourseStaff" s) AS staff_digest,
    (SELECT count(*)::int FROM "Submission") AS submissions,
    (SELECT count(*)::int FROM "PracticeCheckin") AS checkins
  `)).rows[0];Object.assign(row,facts);
  if(row.migrations>=31)row.schedules=(await pool.query('SELECT count(*)::int AS count FROM "CohortLessonSchedule"')).rows[0].count;
  await writeFile(new URL('../outputs/cohort-teaching-2026-10-12/local-'+process.argv[2]+'.json',import.meta.url),JSON.stringify(row,null,2));
  console.log(JSON.stringify(row));
}finally{await pool.end();}
