CREATE TABLE "NotificationPreference" (
  "userId" text PRIMARY KEY REFERENCES "User"(id),
  "version" integer NOT NULL DEFAULT 1 CHECK (version>0),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "pushEnabled" boolean NOT NULL DEFAULT false,
  "transactions" boolean NOT NULL DEFAULT true,
  "learning" boolean NOT NULL DEFAULT true,
  "community" boolean NOT NULL DEFAULT true
);
ALTER TABLE "DeviceToken" ADD COLUMN "sessionId" text REFERENCES "AuthSession"(id), ADD COLUMN "boundAt" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "NotificationDelivery" ADD COLUMN "deviceVersion" integer NOT NULL DEFAULT 1;
CREATE INDEX "push_session" ON "DeviceToken"("sessionId");
CREATE OR REPLACE FUNCTION queue_notification_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "OutboxJob" ("eventKey",kind,"aggregateType","aggregateId",payload,"availableAt")
  VALUES ('notification.push:'||NEW.id,'NOTIFICATION_PUSH','NOTIFICATION',NEW.id,'{}'::jsonb,now()) ON CONFLICT ("eventKey") DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER notification_push_outbox AFTER INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION queue_notification_push();
