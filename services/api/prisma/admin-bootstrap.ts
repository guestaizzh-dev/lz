import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Database } from '../src/database.ts';
import { passwordHash } from '../src/auth.ts';

// Operator chooses the initial identity; development credentials never have a public default.
const username = process.env.BOOTSTRAP_ADMIN_USERNAME ?? (process.env.NODE_ENV === 'production' ? '' : 'academy-admin');
if (!username || username.length < 3) throw new Error('BOOTSTRAP_ADMIN_USERNAME is required');
const suppliedPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (process.env.NODE_ENV === 'production' && !suppliedPassword) throw new Error('BOOTSTRAP_ADMIN_PASSWORD is required');
const file = resolve('../../.runtime/admin-bootstrap.json');
const saved = !suppliedPassword && process.env.NODE_ENV !== 'production' && existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : undefined;
if(saved && (saved.username!==username || typeof saved.password!=='string'))throw new Error('Local bootstrap identity does not match the requested administrator');
const password = suppliedPassword ?? saved?.password ?? randomBytes(18).toString('base64url');
if (password.length < 16) throw new Error('Initial password must have at least 16 characters');
const db = new Database();
try {
  if (await db.user.findUnique({ where: { username } })) throw new Error('Account already exists; bootstrap never overwrites an existing account');
  const hash=await passwordHash(password);
  await db.$transaction(async tx=>{
    const user=await tx.user.create({ data: { username, passwordHash:hash, nickname: '书院管理员', roles: ['USER'], tags: [] } });
    const role=await tx.accessRole.findUniqueOrThrow({where:{code:'ADMIN'}});
    const grant=await tx.userRole.create({data:{userId:user.id,roleId:role.id,grantedBy:user.id,reason:'初始化首个管理员'}});
    await tx.auditLog.create({data:{actorId:user.id,action:'role.bootstrap',resource:'user_role',resourceId:grant.id,changes:{role:'ADMIN'}}});
  });
  if (!suppliedPassword) {
    if(!saved) writeFileSync(file, JSON.stringify({ username, password }), { mode: 0o600, flag: 'wx' });
    console.log('Generated development credentials saved in ignored .runtime/admin-bootstrap.json (not printed).');
  } else console.log('Administrator created; credentials not printed.');
} finally { await db.$disconnect(); }
