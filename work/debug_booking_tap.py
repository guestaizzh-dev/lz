from pathlib import Path
p=Path('work/booking_schedule_browser.mjs');s=p.read_text(encoding='utf-8')
s=s.replace("mobile.on('console',m=>{if(m.text().startsWith('QA_MODAL'))console.log(m.text());});", "mobile.on('console',m=>{if(m.text().startsWith('QA_MODAL')||m.type()==='error')console.log('APP CONSOLE '+m.text());});")
s=s.replace("props:el.__vueParentComponent?.props,rect:", "props:el.__vueParentComponent?.props,handlerKeys:Object.keys(el.__vueParentComponent?.vnode.props??{}),handler:String(el.__vueParentComponent?.vnode.props?.onClick),rect:")
s=s.replace("await eventCard.locator('.schedule-accept').tap();const eventAccepted", "await eventCard.locator('.schedule-accept').tap();console.log('After accept tap',await eventCard.locator('.schedule-accept').evaluate(el=>({emitted:Object.keys(el.__vueParentComponent?.emitted??{}),target:document.elementFromPoint(190,518)?.outerHTML?.slice(0,250)})));const eventAccepted")
p.write_text(s,encoding='utf-8')
