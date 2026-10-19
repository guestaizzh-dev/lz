// A post may contain two media items; playing one pauses the previous item.
let activeId='',pauseActive:(()=>void)|null=null;
export function claimForumPlayback(id:string,pause:()=>void){if(activeId===id)return;const previous=pauseActive;activeId=id;pauseActive=pause;previous?.();}
export function releaseForumPlayback(id:string){if(activeId===id){activeId='';pauseActive=null;}}
