from pathlib import Path

root=Path(__file__).resolve().parent.parent
current='2026-10-12当前续办：A05工作人员按场次委派、15分钟临时二维码、逐人幂等核销和误签到撤销已完成本地验证；88关联/7末次专项（重叠）及6真实页面通过，API/Pro/App Web通过。第34迁移本地应用，160表含元数据/159模型，原规范数据保持。下一活动结束后的实际履约记录；完整A05/付费结算及商用38/131仍未完成，未部署/更新APK，见[46](46-event-checkin-operations.md)。\n\n'
for name in ['01-product-requirements.md','02-technical-research-and-decisions.md','07-database-and-crud.md','33-development-status-summary.md']:
    p=root/'docs'/name
    p.write_text(current+p.read_text(encoding='utf-8'),encoding='utf-8')
p=root/'docs/README.md'
s=p.read_text(encoding='utf-8')
s=s.replace('# 开发文档入口\n', '# 开发文档入口\n\n'+current,1)
s=s.replace('3. 按[26剩余开发计划](26-remaining-development-plan.md)第7节当前停点续办；A01免费子流程与A03报名/独立研习子流程本地验证已完成，下一完成A03营期老师/助教、作业打卡与点评，再接延期。','3. 按[26剩余开发计划](26-remaining-development-plan.md)第7节当前停点续办；A03免费营期子流程与A05委派核销已本地验证，下一活动实际履约记录。')
p.write_text(s,encoding='utf-8')
p=root/'docs/26-remaining-development-plan.md'
s=p.read_text(encoding='utf-8')
s=s.replace('已实现运营逐人签到、时间窗、幂等及未确认延期禁签到/履约；委派EventStaff、核销凭证/撤销与结算待补','运营委派有效老师/助教、场次CHECKIN/REVOKE权限、15分钟临时二维码、逐人核销/误签到撤销已本地验证；全部到场不代表实际服务完成，下一实际履约记录；付费/结算积分待补')
s=s.replace('39；新安排未确认拒绝、接受后签到/履约及历史冻结通过；实际现场、委派及二维码未验收','46；88关联及7末次专项（重叠）/6真实页面通过，API/Pro/App Web通过；第34迁移本地应用，规范数据保持；二维码/粘贴消费已验证，摄像头/现场及商用未验收')
s=s.replace('付费订单与完整核销待补','委派、二维码和现场工作台已本地验证（46）；付费订单及实际履约/结算待补')
s=s.replace('付费、现场委派核销与正式验收未完成','场次委派核销已本地验证（46）；付费/实际履约及正式验收未完成')
s=s.replace('付费、委派核销/二维码及正式履约未完成','委派核销/临时二维码已本地验证（46）；付费及正式履约未完成')
start=s.index('**当前停点（2026-10-12）：')
end=s.index('**',start+2)+2
s=s[:start]+'**当前停点（2026-10-12）：A05委派、临时二维码、逐人核销和误签到撤销已完成本地验证，见46。88关联及7末次专项（重叠）/6真实页面通过；API/Pro/App Web通过，第34迁移本地应用，160表/159模型及规范数据保持。下一实际履约记录与学员结果；付费/结算积分和正式现场仍未完成。完整A05保持进行中，商用38/131不变，未部署/更新APK。**'+s[end:]
anchor='技术任务当前已完成5/99'
idx=s.index(anchor)
s=s[:idx]+'### A05子流程清单\n\n- [x] 工作人员按场次委派与即时撤权（46）。\n- [x] 本人临时二维码、刷新及完整凭证复制（46）。\n- [x] 逐人幂等核销、误签到撤销与重新签到事实（46）。\n- [x] Pro/App工作台、脱敏分页名单及登录回跳（46）。\n- [ ] 活动实际履约记录与学员结果。\n- [ ] 付费履约、退款、结算积分与正式现场/原生验收。\n\n'+s[idx:]
s+='\n| 2026-10-12 | A05现场核销子流程 | 子流程本地验证完成；完整A05仍进行中 | 场次委派/临时二维码/逐人核销/撤销及历史；88关联/7末次专项（重叠）/6真实页面与三端构建通过，第34迁移本地应用，规范数据保持，见46 | 下一实际履约结果；付费、结算积分、原生及现场未完成，未部署/更新APK，商用38/131保持 |\n'
p.write_text(s,encoding='utf-8')
