import { shallowRef } from 'vue';
import {privateStore} from './secure-storage';
import {apiBase} from './environment';
import {clearNoteExportFiles} from './note-export-files';
import {selectOfflineUser} from './offline-files';
import {createSessionState} from './session-state';
import type {AppUser,LoginResult} from './session-state';
export type {AppUser,LoginResult} from './session-state';
export const currentUser = shallowRef<AppUser | null>(null);
export const sessionNotice=shallowRef('');
const markerKey='academy.logout|'+apiBase;
const state=createSessionState(privateStore,{read:()=>uni.getStorageSync(markerKey)===true,write:value=>uni.setStorageSync(markerKey,value)},user=>{const previous=currentUser.value?.id;if(previous!==user?.id){if(previous)clearNoteExportFiles(previous);if(user)clearNoteExportFiles(user.id);}try{selectOfflineUser(user?.id??'');}catch(e){sessionNotice.value=(e as Error).message;}currentUser.value=user;});
export function restoreSession(){try{state.restore();sessionNotice.value='';}catch(e){sessionNotice.value=(e as Error).message;}}
export function saveSession(value:LoginResult,rotation=false){state.save(value,rotation);sessionNotice.value='';}
export function clearSession(){state.clear();}
export const accessToken=state.access,refreshToken=state.refresh,sessionGeneration=state.generation;
export const refreshRotation=state.rotation;
export function needLogin(returnUrl?:string) { if (currentUser.value) return false; uni.navigateTo({ url: '/pages/auth/login'+(returnUrl?'?redirect='+encodeURIComponent(returnUrl):'') }); return true; }
