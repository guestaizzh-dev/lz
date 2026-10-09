import { request, apiBase } from './api';
import { accessToken } from './session';
export type Assignment = {id:string;title:string;instructions:{text:string};required:boolean;state:string;dueAt:string|null;submission:{id:string;revision:number;state:string}|null};
export type AssignmentList = {items:Assignment[];summary:{total:number;submitted:number;reviewed:number;required:number;requiredReviewed:number}};
export type Submission = {id:string;body:string;revision:number;state:string;attachments:{assetId:string}[];reviews:{id:string;body:string;score:number|null;state:string;reviewedAt:string}[]};
export type Message = {id:string;title:string;body:string;kind:string;resourceId:string|null;createdAt:string;readAt:string|null};
export const teachingState = (state:string):string => ({DRAFT:'草稿',PUBLISHED:'可提交',CLOSED:'已关闭',SUBMITTED:'待老师点评',REVIEWED:'已完成研习',RETURNED:'请补充后重交'}[state]??state);
export async function uploadHomeworkImage(filePath:string):Promise<{id:string}> {
  const upload=()=>new Promise<{id:string}>((resolve,reject)=>uni.uploadFile({url:apiBase+'/learning/submission-images',filePath,name:'file',header:{Authorization:'Bearer '+accessToken()},success:r=>{let data:{id?:string;message?:string|string[]}={};try{data=(JSON.parse(r.data)??{}) as {id?:string;message?:string|string[]};}catch{}if(r.statusCode>=200&&r.statusCode<300&&data.id)resolve({id:data.id});else{const error=new Error(Array.isArray(data.message)?data.message.join('；'):data.message??'图片上传失败');(error as Error&{status:number}).status=r.statusCode;reject(error);}},fail:()=>reject(new Error('图片上传失败，请检查网络后重试'))}));
  try{return await upload();}catch(e){if((e as Error&{status:number}).status!==401)throw e;await request('/auth/me');return upload();}
}
