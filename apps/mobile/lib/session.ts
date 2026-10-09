import { shallowRef } from 'vue';
export type AppUser = { id: string; nickname: string; avatar: string | null; tags: string[]; roles: string[] };
export type LoginResult = { user: AppUser; accessToken: string; refreshToken: string; expiresIn: number };
export const currentUser = shallowRef<AppUser | null>(null);
let access = '', refresh = '';
// Session is memory-only until Keychain/Keystore native storage has passed device checks.
// Never put refresh tokens in uni.setStorage or Web localStorage.
export function saveSession(value: LoginResult) { access = value.accessToken; refresh = value.refreshToken; currentUser.value = value.user; }
export function clearSession() { access = ''; refresh = ''; currentUser.value = null; }
export const accessToken = () => access;
export const refreshToken = () => refresh;
export function needLogin() { if (currentUser.value) return false; uni.navigateTo({ url: '/pages/auth/login' }); return true; }
