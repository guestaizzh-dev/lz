ALTER TABLE "LivePoll" ADD COLUMN kind text NOT NULL DEFAULT 'POLL' CHECK(kind IN ('POLL','SURVEY')),
  ADD COLUMN questions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(questions)='array');
CREATE INDEX "LivePoll_sessionId_createdAt_idx" ON "LivePoll"("sessionId","createdAt");
CREATE TABLE "PollResponse"(
  id text PRIMARY KEY,
  "pollId" text NOT NULL REFERENCES "LivePoll"(id),
  "userId" text NOT NULL REFERENCES "User"(id),
  "answersCipher" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("pollId","userId")
);
CREATE INDEX "PollResponse_userId_idx" ON "PollResponse"("userId");
