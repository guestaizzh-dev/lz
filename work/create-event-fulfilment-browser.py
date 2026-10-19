from pathlib import Path
p=Path('scripts/browser/event-operations.mjs');s=p.read_text(encoding='utf-8')
s=s.replace('event-checkin-2026-10-12','event-fulfilment-2026-10-12')
s=s.replace("checks.push('App从我的预约出示真正PNG二维码并刷新15分钟凭证');", "checks.push('App从我的预约出示真正PNG二维码并刷新15分钟凭证');")
# Keep the learner's actual login state before the same page logs into the worker account.
pos=s.index("  await loginMobile('19900001003'")
s=s[:pos]+"  const learnerState=await mobile.context().storageState();\n"+s[pos:]
pos=s.index('  assert.equal(errors.length,0,JSON.stringify(errors));')
ext='''  await db.eventSession.update({where:{id:session.id},data:{startsAt:new Date(Date.now()-2*3600000),endsAt:new Date(Date.now()-60000)}}); // Isolated clock boundary fixture, not an actual event execution.
  await admin.reload();await admin.getByRole('button',{name:'履约记录',exact:true}).click();const fulfilModal=admin.locator('.ant-modal:visible');
  await fulfilModal.getByRole('textbox',{name:'学员可见结果',exact:true}).fill('本次共读与交流已按约完成，感谢参加。');await fulfilModal.getByRole('textbox',{name:'内部履约依据',exact:true}).fill('隔离流程验证：工作人员登记了两位参加者的共读交付情况。');await fulfilModal.getByRole('textbox',{name:'履约记录原因',exact:true}).fill('登记实际交付');
  const delivered=pending(admin.waitForResponse(r=>r.url().endsWith('/fulfilments')&&r.request().method()==='POST'));await fulfilModal.getByRole('button',{name:'保存结果并通知学员',exact:true}).click();assert.equal((await delivered).status(),201);await fulfilModal.getByText('当前结果 · 1',{exact:true}).waitFor();await admin.screenshot({path:output+'/admin-fulfilment.png',fullPage:true});checks.push('Pro结束后记录实际服务人数、内部依据与学员可见结果');
  await fulfilModal.getByRole('spinbutton',{name:'实际完成服务人数',exact:true}).fill('1');await fulfilModal.getByRole('textbox',{name:'学员可见结果',exact:true}).fill('复核后为部分完成，第二位后续服务将由书院联系安排。');await fulfilModal.getByRole('textbox',{name:'内部履约依据',exact:true}).fill('隔离更正验证：复核工作人员登记，第二位尚需补充实践交流。');await fulfilModal.getByRole('textbox',{name:'履约记录原因',exact:true}).fill('复核实际交付人数并更正');
  const corrected=pending(admin.waitForResponse(r=>r.url().endsWith('/fulfilments')&&r.request().method()==='POST'));await fulfilModal.getByRole('button',{name:'保存更正并通知学员',exact:true}).click();assert.equal((await corrected).status(),201);await fulfilModal.getByText('当前结果 · 2',{exact:true}).waitFor();await fulfilModal.getByText('历史版本 · 1',{exact:true}).waitFor();assert.equal(await db.eventFulfilment.count({where:{registrationId:registration.id}}),2);checks.push('Pro更正部分交付，保留旧版本与原因并通知一次');
  await mobile.context().addCookies(learnerState.cookies);await mobile.goto(mobileUrl+'/#/pages/booking/mine');await mobile.evaluate(state=>{localStorage.clear();for(const entry of state.origins[0]?.localStorage??[])localStorage.setItem(entry.name,entry.value);},learnerState);await mobile.reload();await mobile.getByText('部分完成 · 1 / 2人',{exact:true}).waitFor();await mobile.getByText('复核后为部分完成，第二位后续服务将由书院联系安排。',{exact:true}).waitFor();assert.equal((await mobile.locator('body').innerText()).includes('隔离更正验证'),false);await mobile.screenshot({path:output+'/app-fulfilment-result.png'});checks.push('学员我的报名展示最新真实结果和北京时间，内部依据不泄露');
'''
s=s[:pos]+ext+s[pos:]
Path('scripts/browser/event-fulfilment.mjs').write_text(s,encoding='utf-8')
