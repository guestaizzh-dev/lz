-- Operational taxonomy, not demonstration posts or fictional users.
INSERT INTO "ForumSection" (code,title,scope,description,active) VALUES
('01-classics','经典探讨','PUBLIC','研读经典、推敲原文与译注。',true),
('02-practice','实践分享','PUBLIC','分享日用常行中的实践心得。',true),
('03-wellness','养生交流','PUBLIC','交流养生体会，不替代医疗建议。',true),
('04-life','生活应用','PUBLIC','讨论道学与日常生活的连接。',true),
('05-questions','名师问答','PUBLIC','交流研习疑问；指定老师提问请使用名师问答。',true),
('06-events','活动召集','PUBLIC','交流活动心得与相约研习。',true)
ON CONFLICT (code) DO NOTHING;
CREATE INDEX IF NOT EXISTS forum_section_recent ON "ForumThread" ("sectionId","createdAt" DESC,id DESC) WHERE "deletedAt" IS NULL;
