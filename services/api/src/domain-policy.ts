import registry from './domain-registry.json' with { type: 'json' };

export const domains = registry;
export type Entity = typeof domains[number];
export type Field = Entity['fields'][number];
// Business facts are created by their owning workflow, never by a data editor.
const facts = new Set(`auth_identity auth_session consumed_refresh otp_challenge rate_limit access_role user_role consent_record media_asset resource article_release article_block reading_event note_export appointment enrollment study_progress study_event offline_license moderation_action user_restriction content_authorization campaign_entry live_mic_request poll_vote gift_wallet gift_ledger course_release lesson digital_release digital_release_asset trade_order order_item inventory_reservation inventory_ledger payment_attempt payment_transaction provider_callback refund refund_item shipment shipment_item digital_delivery membership_plan_version plan_benefit benefit_scope membership_period benefit_usage growth_ledger points_account points_ledger points_reservation points_redemption event_registration event_checkin event_waitlist user_coupon group_buy group_buy_member referral commission_ledger withdrawal_request partner_contract settlement settlement_item finance_journal finance_entry reconciliation notification device_token notification_delivery audit_log outbox_job idempotency_record feature_config refund_transaction withdrawal_allocation benefit_grant gift_credit_allocation address`.split(' '));
// These records now belong to the teaching workflow; the generic editor cannot bypass course ownership or review state.
for (const key of ['assignment','course_staff','submission','teacher_review','attachment_binding']) facts.add(key);
const privateEntities = new Set('private_note practice_log address cart_item reaction user_tag user_block teacher_question submission practice_checkin live_reservation'.split(' '));
const financeEntities = new Set('trade_order order_item payment_attempt payment_transaction refund refund_item refund_transaction commission_ledger withdrawal_request withdrawal_allocation settlement settlement_item finance_journal finance_entry finance_account reconciliation partner_contract gift_credit_allocation'.split(' '));
const supportEntities = new Set('feedback feedback_reply report'.split(' '));
const identityEntities = new Set('app_user auth_identity auth_session consumed_refresh otp_challenge rate_limit access_role user_role consent_record audit_log provider_callback outbox_job idempotency_record feature_config'.split(' '));
const automatic = new Set('id createdAt updatedAt version deletedAt lastSeenAt publishedAt reviewerId reviewedAt approvedBy answeredAt grantActorId actorId grantedBy submittedAt rewardEventKey reminderSentAt reserved confirmed sold issuedCount balance counts chaptersCount currentReleaseId publishedReleaseId currentVersionId resourceKind'.split(' '));
export const hidden = (f: Field) => /Cipher$|Hash$|Secret|Token|StorageRef$/.test(f.name) || ['phone','recipient','detail','contact','csrfToken','storageKey','providerAssetId','variants','payload','response','beforeSnapshot','afterSnapshot','changes','pricingSnapshot','itemSnapshot','trackingSnapshot','subjectHash','unionSubjectHash'].includes(f.name);
export function access(e: Entity, roles: string[]) {
  const allowed = roles.includes('ADMIN') || (!identityEntities.has(e.key) && (financeEntities.has(e.key) ? roles.includes('FINANCE') : supportEntities.has(e.key) ? roles.includes('SUPPORT') || roles.includes('MODERATOR') : roles.includes('OPERATOR') || roles.includes('MODERATOR')));
  const write = allowed && !facts.has(e.key) && (roles.includes('ADMIN') || (supportEntities.has(e.key) ? roles.includes('SUPPORT') || roles.includes('MODERATOR') : !financeEntities.has(e.key) && roles.includes('OPERATOR')));
  return { read: allowed, create: write && e.key !== 'app_user', update: write, delete: write && e.key !== 'app_user', ownerOnly: privateEntities.has(e.key), mode: facts.has(e.key) ? 'workflow' : 'crud' };
}
export function writable(e: Entity, f: Field) {
  if (automatic.has(f.name) || hidden(f) && !f.name.endsWith('Cipher') || ['roles','phoneCipher','passwordHash','permissionCodes'].includes(f.name)) return false;
  if (e.key === 'app_user') return ['nickname','avatarAssetId','avatar','tags','status'].includes(f.name);
  if (f.name.endsWith('Cipher')) return true;
  if (e.key === 'membership_plan' && f.name === 'code') return true;
  return true;
}
export const resourceKinds: Record<string, string> = { article: 'ARTICLE', teacher: 'TEACHER', course: 'COURSE', product: 'PRODUCT', event: 'EVENT', live_room: 'LIVE', forum_thread: 'THREAD' };
