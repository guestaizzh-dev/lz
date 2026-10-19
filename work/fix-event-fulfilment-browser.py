from pathlib import Path
p=Path('scripts/browser/event-fulfilment.mjs');s=p.read_text(encoding='utf-8')
s=s.replace('  for(const [page,isMobile] of [[admin,false],[mobile,true]]){','  async function configurePage(page,isMobile){')
s=s.replace("  await admin.goto(adminUrl+'/events');", "  await configurePage(admin,false);await configurePage(mobile,true);\n  await admin.goto(adminUrl+'/events');")
s=s.replace('  const learnerState=await mobile.context().storageState();', "  const learner=mobile;mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await configurePage(mobile,true);")
start=s.index('  await mobile.context().addCookies(learnerState.cookies);')
end=s.index("await mobile.getByText('部分完成 · 1 / 2人'",start)
s=s[:start]+"  mobile=learner;await mobile.getByRole('button',{name:'返回',exact:true}).click();"+s[end:]
p.write_text(s,encoding='utf-8')
