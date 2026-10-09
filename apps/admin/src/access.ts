export default function access(initialState: { currentUser?: API.CurrentUser } | undefined) {
  const roles = initialState?.currentUser?.roles ?? [];
  const canEdit = roles.some(role => ['ADMIN', 'OPERATOR'].includes(role));
  const canReview = roles.some(role => ['ADMIN', 'MODERATOR'].includes(role));
  return { canAdmin: roles.includes('ADMIN'), canEdit, canReview, canViewOrders: roles.some(role=>['ADMIN','SUPPORT','FINANCE'].includes(role)),
    canManageContent: canEdit || canReview };
}
