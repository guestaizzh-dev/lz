-- Preserve existing roles while making legacy/bootstrap assignments visible and revocable in account management.
WITH grants AS (
  INSERT INTO "UserRole" ("userId","roleId","grantedBy",reason)
  SELECT u.id,r.id,u.id,'登记已有管理角色，保留现有权限'
  FROM "User" u CROSS JOIN LATERAL unnest(u.roles) AS existing(code)
  JOIN "AccessRole" r ON r.code=existing.code::text
  WHERE u.status<>'DELETED' AND r.code<>'USER'
    AND NOT EXISTS(SELECT 1 FROM "UserRole" g WHERE g."userId"=u.id AND g."roleId"=r.id AND g."revokedAt" IS NULL)
  ON CONFLICT DO NOTHING
  RETURNING id,"userId","roleId"
)
INSERT INTO "AuditLog" (id,"actorId",action,resource,"resourceId",changes,reason)
SELECT gen_random_uuid()::text,g."userId",'role.baseline','user_role',g.id,
  jsonb_build_object('userId',g."userId",'role',r.code),'登记已有管理角色，保留现有权限'
FROM grants g JOIN "AccessRole" r ON r.id=g."roleId";
