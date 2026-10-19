INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES ('TEACHER_QUESTION','会员专属问答','QUOTA','{"priority":"boolean"}',true)
ON CONFLICT(code) DO NOTHING;
CREATE UNIQUE INDEX teacher_question_benefit_once ON "TeacherQuestion"("benefitUsageId") WHERE "benefitUsageId" IS NOT NULL;
-- Use existing TeacherQuestion.benefitUsageId and immutable BenefitUsage snapshots.
-- Do not add benefits to any purchased plan or manufacture past question usage.
