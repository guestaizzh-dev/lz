export type StudyProgress = { positionSeconds: number; watchedSeconds: number; completedAt: string | null };
export type LessonSummary = { id: string; title: string; position: number; format: string; durationSeconds: number; trial: boolean; accessible: boolean; required: boolean; progress: StudyProgress | null };
export type Curriculum = { course: { id: string; title: string; cover: string; refundPolicy: string; accessDays: number | null }; access: string; releaseId: string | null; lessons: LessonSummary[] };
export type LessonDetail = LessonSummary & { body: string; hasMedia: boolean };
export type Membership = { tier: number; startsAt: string; endsAt: string; plan: { title: string; description: string } };
export type MembershipPlan = { id: string; title: string; tier: number; days: number; price: number; description: string };
export const duration = (seconds: number): string => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
// Retry identifier only, never used for authentication or payment.
export const studyEventId = (): string => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); });
