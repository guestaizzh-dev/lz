import { api, setSession } from '@/api';
import type { Actor, Session } from '@/api';

function toCurrentUser(user: Actor): API.CurrentUser {
  return { userid: user.id, name: user.nickname, roles: user.roles, permissions:user.permissions,
    access: user.roles.includes('ADMIN') ? 'admin' : 'user' };
}
export async function currentUser(_options?: Record<string, unknown>) {
  const session = await api<Session>('/admin/auth/session');
  setSession(session);
  return { data: toCurrentUser(session.user) };
}
export async function outLogin() {
  await api('/admin/auth/logout', 'POST', {});
  setSession(null);
}
export async function login(body: API.LoginParams): Promise<API.LoginResult> {
  const session = await api<Session>('/admin/auth/login', 'POST', {
    username: body.username, password: body.password,
  });
  setSession(session);
  return { status: 'ok', type: 'account' };
}
