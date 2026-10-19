# 发布与恢复操作说明

2026-10-10最新实部署：后端与后台已部署，完整规范测试数据按用户指令导入线上；Linux构建、HTTPS、登录、表/媒体核对和定时备份通过。地址与维护见[24部署记录](24-online-deployment.md)。下文2026-10-09未部署描述为历史基线，完整业务上线边界仍需区分。

2026-10-09。这是已保存的发布配置与操作契约，**不是生产部署成功证明**。当前 Windows 环境未安装 Docker，也没有真实域名、TLS/商户/Apple/云媒体/短信/推送资料；全功能上线仍受16报告中的业务缺口限制。

## 本机运行

Node 24.18、HBuilderX 5.26、PostgreSQL 17；后台沿用官方Ant Design Pro。首装使用锁文件，现有Windows依赖软链接不要跨盘复制或原地更换包管理器版本。

```powershell
node scripts/dev-db.mjs start
cd services/api
node node_modules/typescript/bin/tsc -p tsconfig.json
node --env-file=.env dist/main.js
```

另一个终端进入 `apps/admin`，运行 `node node_modules/@umijs/max/bin/max.js dev`；开发配置使用5173端口。Web预览是HBuilderX导出的 `apps/mobile/unpackage/dist/build/web`，9071为本机静态预览，后端3000，数据库55432。开发验证码仅在明确的开发环境有效；后台密码由原有引导流程配置，本文件不保存密码。

## 正式环境准备

1. 使用Linux Docker Compose v2节点；复制 `infra/.env.example` 为 `infra/.env`，填真实配置并设文件权限600。数据库所有者与API账号使用不同随机十六进制密码；迁移账号持有DDL权，API账号只有业务DML权限。不要提交环境文件或密钥。
2. 配置两个已解析的域名 `ADMIN_HOST` 与 `APP_HOST`；TLS目录含覆盖两个域名的 `fullchain.pem` 与 `privkey.pem`。App Web仅用于公共分享和兼容预览，不代替Android/iOS包。
3. 填真实腾讯云短信签名、模板、SDK AppID及API密钥；三个服务密钥独立生成。DOMAIN_ENCRYPTION_KEY/MEDIA_TOKEN_SECRET各为64位十六进制；OTP_HASH_SECRET不少于32字节。加密密钥备份到独立受控位置，丢失后不能解密原数据。
4. `node scripts/configure-mobile-api.mjs https://实际App域名/api/v1` 配置正式端点并移除Android开发HTTP例外；`node scripts/configure-mobile-api.mjs --check` 为分发前检查。当前源码继续使用本机联调地址，尚未执行正式切换。恢复本机时用 `http://127.0.0.1:3000/api/v1 --development`。
5. 重新构建后台与App；HBuilderX正式签名、iOS和商店材料另行准备。禁止把本轮Web构建描述成新的APK/IPA。
6. 审核实际可履约内容、授权与服务；补完正式支付/退款、媒体、库存交付等16中的未完成事项后，才能启用对应功能。

```bash
cd infra
docker compose build
docker compose up -d
docker compose ps
```

Compose先等数据库就绪，运行 `prisma migrate deploy`，迁移成功后再启动API，API健康后启动Nginx。已有迁移只新增/变更结构，不重置生产库。API以node普通用户运行，私有媒体持久化到独立卷；数据库与API不向宿主机暴露端口。代理只信任固定Nginx地址，覆盖客户端伪造的转发IP；真实源IP用于登录限流。若网络网段冲突，须同时修改Compose子网、edge地址和TRUST_PROXY。

正式API启动时拒绝测试验证码、预占订单开关、缺失短信、无效密钥或HTTP公开端点；配置缺失直接停止，不能产生假成功。录播课程微信服务端协议、查单、退款及PostgreSQL持久恢复任务现已实现，详见18；开启收款时缺支付密钥/HTTPS回调/系统账本科目会拒绝启动，生产禁止关闭恢复任务。Redis/BullMQ通用worker、COS/VOD仍未完成，不能因配置文件存在而宣称这些能力上线。

## 备份与恢复

在维护窗口执行 `bash infra/backup.sh /绝对备份目录`，输出PostgreSQL自定义格式dump、私有媒体tar.gz及SHA256校验。文件权限由umask077限制；生产需将加密备份发送到独立存储，并单独备份密钥、正式构建、版本及环境配置。脚本不会自动安排定时任务。

恢复演练只能针对**新建的独立数据库**，不能直接对业务库执行 `--clean`、drop或覆盖卷：先校验SHA256，在数据库容器建立如 `academy_restore_check_日期` 的空库，用 `pg_restore --exit-on-error --no-owner --no-acl` 导入；核实结构、业务数量、外键/约束及关键私人附件，再运行隔离环境HTTP用例。媒体解压到演练卷，不能覆盖在线媒体卷。演练成功后保留记录再按明确目标清理演练资源。

上线回滚保留上一版镜像与静态产物。仅当新旧代码兼容已执行迁移时才能换回旧镜像；数据恢复必须先冻结写入、验证备份与密钥，并明确恢复点。当前尚未进行Linux镜像、TLS、备份恢复或100并发演练，Q03未完成，主清单保持待外部配置。

## 后台升级部署补充（2026-10-09）

先执行services/api的`pnpm db:migrate`应用角色策略与角色基线两项迁移，再启动最新API及后台。已有角色通过授权记录登记，不重置账号或密码；引导管理员用`pnpm admin:bootstrap`并遵循环境变量配置，禁止在文档保存凭据。2026-10-10起API全量测试使用`pnpm test`，自动创建、迁移和删除唯一命名的本机临时数据库，并串行执行权限/配置测试；不在日常开发库创建测试夹具。运行测试的本机数据库账号须有创建/删除临时库的权限，生产及非本机服务器拒绝执行。见21。

角色策略每请求生效，后台会在重新激活窗口或403后刷新菜单；若当前账号没有任何能力，显示无访问权限提示。系统配置通过后台表单及修订流程更新，禁止直接插入或覆盖最新配置以绕开审计和并发校验。本机API3000与后台5173已运行，最新健康检查通过；这不表示已部署正式环境。交付与验证见20报告。
