-- Enum extension commits before the domain constraints use the new values.
ALTER TYPE "LessonFormat" ADD VALUE 'LIVE';
ALTER TYPE "LessonFormat" ADD VALUE 'OFFLINE';
