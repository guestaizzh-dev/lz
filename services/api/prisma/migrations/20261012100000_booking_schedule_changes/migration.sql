ALTER TABLE "AppointmentSlot" ADD COLUMN "scheduleVersion" integer NOT NULL DEFAULT 1 CHECK ("scheduleVersion" > 0), ADD COLUMN "changeReason" text;
ALTER TABLE "EventSession" ADD COLUMN "scheduleVersion" integer NOT NULL DEFAULT 1 CHECK ("scheduleVersion" > 0), ADD COLUMN "changeReason" text;
ALTER TABLE "Appointment" ADD COLUMN "acceptedScheduleVersion" integer NOT NULL DEFAULT 1 CHECK ("acceptedScheduleVersion" > 0), ADD COLUMN "scheduleSnapshot" jsonb;
ALTER TABLE "EventRegistration" ADD COLUMN "acceptedScheduleVersion" integer NOT NULL DEFAULT 1 CHECK ("acceptedScheduleVersion" > 0), ADD COLUMN "scheduleSnapshot" jsonb;
CREATE INDEX "booking_appointment_slot_state" ON "Appointment" ("slotId", state, id);
CREATE INDEX "booking_registration_ticket_notice" ON "EventRegistration" ("ticketTypeId", "confirmedAt", id);
