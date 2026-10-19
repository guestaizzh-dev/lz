import {readFileSync,writeFileSync} from 'node:fs';
function edit(path,changes){let text=readFileSync(path,'utf8');for(const [before,after] of changes){if(!text.includes(before))throw Error('Missing match: '+before.slice(0,60));text=text.replace(before,after);}writeFileSync(path,text);}
edit('apps/mobile/pages/cohort/purchase.uvue',[[".policy{padding:16px", ".text-button{background-color:transparent;border-width:0;border-style:solid;color:#245564;font-size:13px;line-height:22px;min-height:44px;padding:10px 0;margin:4px 0;}.policy{padding:16px"]]);
edit('apps/admin/src/pages/cohort-orders/index.tsx',[["<Descriptions column={1} bordered", "<Descriptions column={1} bordered styles={{label:{width:120}}}"]]);
edit('scripts/browser/cohort-compensation.mjs',[
  ["await mobile.screenshot({path:output+'/app-cohort-proposal.png'", "await mobile.locator('.proposal').scrollIntoViewIfNeeded();await mobile.screenshot({path:output+'/app-cohort-proposal.png'"],
  ["await mobile.getByText(/本人已于/).waitFor();assert.equal", "await mobile.getByText(/本人已于/).waitFor();await mobile.getByText('已退出 · 部分退款',{exact:true}).waitFor();assert.equal"],
]);
