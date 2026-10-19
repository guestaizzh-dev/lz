ALTER TABLE "ArticleRelease" ADD COLUMN "templateCode" text NOT NULL DEFAULT 'PLAIN'
  CHECK ("templateCode" IN ('PLAIN','CLASSIC','INK'));
