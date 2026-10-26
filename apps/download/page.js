const download=document.getElementById('download');
const notice=document.getElementById('wechat');
const ua=navigator.userAgent;
const ios=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
if(ios){
  download.removeAttribute('href');download.removeAttribute('download');download.setAttribute('aria-disabled','true');download.classList.add('unavailable');download.textContent='iOS 版暂未开放';
  document.getElementById('device-note').textContent='此安装包仅适用于安卓手机，请勿在 iPhone 或 iPad 上安装。';
}else if(/MicroMessenger/i.test(ua)){
  notice.hidden=false;
  download.addEventListener('click',event=>{event.preventDefault();notice.scrollIntoView({behavior:'auto',block:'nearest'});});
}
document.getElementById('share-link').addEventListener('click',event=>event.currentTarget.select());
