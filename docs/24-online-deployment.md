# 后端与后台线上部署记录

## 2026-10-21 运营简化上线（当前）

- 主机 `43.160.229.173`，发行 `20261021-operations-simplification-01`，替换直播录制发行。API源码 `5dc041d`，后台指南后补 `18414bd`；静态包单独备份和校验，保留旧哈希资源供已打开页面读取。
- 单管理员发布/履约、四类分类维护和批量归类、本地图片裁剪/素材库、章节内上传自动绑定试看、默认活动场次、九组菜单与操作指南上线；App公开API返回可读分类与稳定代码。
- 数据库与媒体备份SHA256通过；73→74迁移，public表192张（含迁移表）；新表运行账号权限实际通过。16类业务表记录数保持，未seed或删除现有内容。
- 18组公网检查通过，管理员会话已退出，无新业务记录。录制ready保持；环境仅API_IMAGE_TAG改变，支付/短信/推送与RTC/录制配置保持。
- 回退记录 `/opt/daoxue-academy/rollback-20261021-operations-simplification-01.txt`。新API启用后可能产生可空凭证/管理员自审事实，须前向修复，不得盲退旧Prisma客户端或还原旧库覆盖数据。
- API healthy，其他项目服务未改。磁盘剩余约5.3GB/使用91%，容量与正式长时验收仍待。Android0.3.14/code19已生成，49,968,152字节，生产HTTPS、原签名可覆盖；498源文件比对仅两项已授权无系统推送覆盖，ZIP/版本/原生模块/同证书/JAR签名通过；无手机/iOS验收，商用38/131不变。
- 证据 `outputs/deploy-2026-10-21-operations/`；完整改动见[88](88-admin-operations-simplification.md)。


## 2026-10-21 直播与服务端录制上线（历史）

- 服务器：`43.160.229.173`；发行 `20261021-live-recording-01`，替换 `20261020-live-console-06`，API healthy，后台HTTPS可访问。
- 发布包含85管理员统一直播、ZEGO官方Linux录制及86后台/嵌入播放器交互更新。SDK实际版本6.39.0.51681、FFmpeg 5.1.9；录制启用，管理员列表返回 `recording.ready=true`。
- 数据库72→73迁移，实际public表191张（含迁移记录）；`20261020120000_admin_live_recording`成功。数据库和媒体先备份并校验摘要，用户15/课程10/订单6/商品12/会员3/直播间4，前后计数一致。
- 环境仅改变 `API_IMAGE_TAG`、`ZEGO_LOCAL_RECORDING_ENABLED`。保留收款/短信/推送及RTC认证开关，未创建新业务记录；管理员验证临时会话已退出。
- 9组公网检查通过：健康、首页、后台登录/直播/指南入口，后台首页及播放器JS/CSS摘要一致，管理员登录及录制就绪。入口HTTP200不代表浏览器或真实开播全流程验收。
- 回退配置：`/opt/daoxue-academy/rollback-20261021-live-recording-01.txt`，环境备份 `production.env.before-20261021-live-recording-01`；`current`指向同名release。新增管理员直播后不能盲目回退旧Prisma客户端或还原旧库覆盖新数据，见85。
- 当前磁盘可用约5.7GB（占用91%），长期录像容量仍待扩充/验收。5条已过期撤销租约仍有清退重试，抽查ZEGO104（房间不存在）/流查询41004（流不存在），详85；没有把它报告成现有直播踢人验收通过。
- 证据：`outputs/deploy-2026-10-21-live/` 的manifest、build/deploy/after/final日志、备份状态和`public-checks.json`。本次未生成Android包、未完成新公网实录或长时原生验收；商用38/131保持。

2026-10-19 演示整理：发布 `20261019-polish-02`，开播台补充观看范围与状态细节，整理直播场次并开放演示训练营；无数据结构变更。

2026-10-19 开播台改版：发布 `20261019-live-studio-01`，后台开播台改为全屏演播室，播放器支持嵌入模式与预览流；健康、后台入口新包、播放器静态资源核对通过，未改数据结构。见 [84](84-live-studio-console.md)。

2026-10-19 补发：线上从 `20261016-content-m06-01` 升级到 **`20261019-status-review-01`**，46→72 迁移、190 表；发布前每日备份与 sha256 校验通过，19 张业务表计数前后一致（Course 摘要变化来自新增列，行数不变）。发布后 `/health` 200、首页 4/4/4/2、`/points/rewards` 与 `/catalog/consumption-rule` 200、`/me/progression` 等登录路由 401、后台登录页 200。回退版本与配置保留在 `/opt/daoxue-academy/rollback-20261019-status-review-01.txt`。证据见 `outputs/deploy-2026-10-19/`。这次只补代码与结构，支付/短信/推送开关未动，38/131 不变。

2026-10-11最新会员续办：member-sales-02已部署，219项后端全量、42HTTPS及6项实际浏览器检查通过，API/Pro/App Web构建通过。Android会员购买/续期/排队、未来整段退款及退款期间内容/配额暂停、订单/注销/看板联动和表格宽度修复已实现；原规范数据和会员日期/版本保留。iOS、部分消费退款/奖励及退款取消后的交付恢复仍未完成，商用保持38/131（29.0%），50%未达到。见[31会员交易续办报告](31-membership-purchase-and-refund.md)。

2026-10-10 Apple与会员基础续办：长期课程Apple映射、持久归属、已验证恢复/全额撤销和会员九组合管理已实现并部署20261011-membership-01；196项后端、后台/App Web构建及29项实际HTTPS通过。九个配置中8个启用，保留旧停用套餐及会员历史；真实Apple/原生及会员购买仍未验收。C07退款撤回续办中，商用仍38/131（29.0%）。见[29续办报告](29-apple-and-membership-foundation.md)。

2026-10-10续办最新线上版本：`20261011-commerce-01`，API/database健康、edge运行。支付宝/购买交互/课程版本及停止交付补偿增量上线，迁移19个、表152张（含元数据），原规范样例与管理员保留；22项HTTPS与后台版本弹窗浏览器核查通过。正式支付保持关闭，手机端未验收。备份/迁移/回退边界详见[28录播续办报告](28-course-commerce-hardening.md)。

2026-10-10最新增量：当前版本为20261011-foundation-04，171项后端与19项线上HTTPS验证通过；规范演示展示开启但不可真实收款，私人字段在备份后兼容加密，业务数据数量保留。真实后台会员选择器冲突已修复，发布与恢复细节见[27最新交付](27-foundation-hardening.md)。下方20261010-1008为初次上线历史记录。

2026-10-10，目标`ubuntu@43.160.229.173`。按用户最终要求，使用指定管理员与现有完整规范测试数据。

## 地址与运行

- 后台：https://academy.43-160-229-173.sslip.io/user/login
- API：https://academy.43-160-229-173.sslip.io/api/v1 ，`/health`实查200。
- 公网443提供HTTPS，80跳转及证书验证；无公开数据库/API直连端口。
- 管理员`admin`，密码为用户明确指定值；本机忽略文件`.runtime/online-admin-access.json`保存访问资料。
- `/opt/daoxue-academy/current`链接到`releases/20261010-1008`；私有配置`production.env`权限600，`current/infra/.env`为链接。
- Compose项目`daoxue`，使用`compose.yaml`和`compose.shared-edge.yaml`，镜像`daoxue-api:20261010-1008`。
- `daoxue-api-1`、`daoxue-database-1`、`daoxue-edge-1`运行，API与数据库健康，迁移退出0；自动重启、日志10MB×3。
- PostgreSQL17.10，数据库`academy_manual_20261010`。API为`academy_app`，迁移为`academy_owner`；卷`daoxue_database`、`daoxue_media`持久化。
- 保留platform/chronic-care等原服务。原`platform-nginx`按书院独立域名转发到edge，诊断端口只绑定`127.0.0.1:18081`。
- sslip.io域名解析到目标IP。可信证书实签并验证通过，到期2027-01-08；后续可替换自有域名并同步证书和允许来源。

## 数据和验证

用原生`pg_dump`一致性快照和`pg_restore --exit-on-error --no-owner --no-acl`将本机`daoxue_dev`完整导入独立线上库，保留ID、关联关系、业务状态和配置，完成后切换服务。此前初始化库`academy`保留。

- 151表逐表核对，包括150业务表与Prisma记录，业务数据数量无差异；17项迁移完成。
- 15用户、10文章、8课程、8商品，会员、作业、学习、社区、订单、配置及审核记录完整复制。
- 4个私有媒体文件同步并逐个核对字节数和SHA256；公共封面SVG保持`/static/art/`路径。
- 保留源数据加密密钥；设置指定管理员密码，只失效旧登录会话和未使用验证码，新增部署审计。登录、限流、审计记录随后随验证增加。
- 样例内容及授权/交易/直播的测试属性保留。

最终线上API专项16项通过：登录、Secure/HttpOnly Cookie、40项权限、健康、概览、账号、配置与历史、审计、文章，以及未登录401、非法来源403、短信关闭503和退出。

真实浏览器登录、概览、课程、商品、账号及配置通过，无失败响应。课程/商品各8行；账号列表排除已删除账号显示14用户，数据库仍保留15条。证据在`outputs/deployment-2026-10-10/`：`api-checks.json`、`import-verification.json`、`browser-summary.json`和截图。

## 部署修正

- API与迁移共用明确镜像标签，修复迁移镜像缺失。
- edge固定地址改为`172.30.89.254`并同步TRUST_PROXY，修复原地址与数据库动态地址冲突。共享入口当前`172.18.0.3`，若改变须同步`nginx.shared-edge.conf`。
- Linux镜像补CA/OpenSSL，Prisma生成与后端编译通过。
- SPA回退与相对跳转修复登录HTTP降级和尾斜杠；部署公共封面。
- 后台独立部署不填写不存在的App Web落地页，API继续提供分享摘要。
- 显式`SMS_ENABLED=false`允许部署后台能力，短信请求503；默认或开启时仍要求真实配置。其余生产门禁保留，新增回归2项通过。
- 数据库名称可配置，备份读取实际数据库名。

## 维护与恢复

`academy-backup.timer`已启用，每日北京时间04:30备份当前库与媒体到`/opt/daoxue-academy/backups`。初始及数据导入后备份实跑成功，dump、媒体tar.gz、SHA256生成，归档解析与校验通过。

现有`certbot.timer`续期；专用钩子`/etc/letsencrypt/renewal-hooks/deploy/daoxue-academy.sh`只处理书院证书，复制到挂载目录并校验/重载Nginx，实跑通过。

```bash
cd /opt/daoxue-academy/current/infra
sudo docker compose ps
sudo docker compose logs --tail 100 api
sudo systemctl status academy-backup.timer
sudo systemctl start academy-backup.service
curl -f https://academy.43-160-229-173.sslip.io/api/v1/health
```

首个线上版本无上一版业务镜像。数据切换前配置`production.env.bak-before-data-import`指向独立初始化库；如需回退，先备份当前库/配置，恢复该文件，再运行`docker compose up -d --no-build`。新库数据保留，禁止覆盖或删除当前卷。

公共入口原配置备份`/opt/platform/docker/nginx.conf.bak-daoxue-20261010`。撤除入口只移除书院server块；整体恢复须确认无其他后续变更，校验`nginx -t`后重载。

备份尚未异地保存或完整灾难恢复演练。真实短信、支付、COS/VOD、直播、iOS内购未开通。测试手机号的本地固定验证码不适用于生产环境。本次未更改App本机联调地址、重新打包或手机验收；部署成功不等于七板块全部正式业务完成。

## 2026-10-11 member-sales-03增量上线

当前发布`/opt/daoxue-academy/releases/20261011-member-sales-03`；后端healthy，后台HTTPS正常。新增Apple会员映射/购买确认/恢复撤销和渠道CLOSED退款取消，正式开关保持关闭；234后端全量及末次14发布专项、45HTTPS、4实际浏览器通过。数据库/媒体备份academy-20261011T074219Z-c3IILj校验成功；25迁移、155表，原规范样例/所有套餐及会员字段完整保留，未生成正式交易或改变admin/admin123。详细证据和未完成正式验收见32，未操作其他项目服务。


