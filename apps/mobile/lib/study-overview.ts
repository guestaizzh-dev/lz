import type {Curriculum} from './learning';
export function studyOverview(item:Curriculum){
 const required=item.lessons.filter(l=>l.required),basis=required.length?required:item.lessons;
 const completed=basis.filter(l=>l.progress?.completedAt).length,finished=basis.length>0&&completed===basis.length;
 const started=item.lessons.some(l=>!!l.progress&&(l.progress.positionSeconds>0||l.progress.watchedSeconds>0||!!l.progress.completedAt));
 const recent=[...item.lessons].filter(l=>l.accessible&&l.progress&&!l.progress.completedAt).sort((a,b)=>(b.progress?.updatedAt??'').localeCompare(a.progress?.updatedAt??''));
 const next=recent.find(l=>l.progress!.positionSeconds>0||l.progress!.watchedSeconds>0)??item.lessons.find(l=>l.accessible&&!l.progress?.completedAt)??item.lessons.find(l=>l.accessible);
 const lastAt=item.lessons.reduce((latest,l)=>l.progress?.updatedAt&&l.progress.updatedAt>latest?l.progress.updatedAt:latest,'');
 return{completed,total:basis.length,percent:basis.length?Math.round(completed*100/basis.length):0,finished,started,next,lastAt};
}
