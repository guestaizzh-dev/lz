CREATE INDEX "OfflineLicense_userId_deviceId_lessonId_idx" ON "OfflineLicense"("userId", "deviceId", "lessonId");
CREATE INDEX "OfflineLicense_userId_expiresAt_idx" ON "OfflineLicense"("userId", "expiresAt");
