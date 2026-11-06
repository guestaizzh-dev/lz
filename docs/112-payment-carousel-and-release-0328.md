# 支付、首页轮播与 Android 0.3.28 发布

日期：2026-11-01。状态：API/后台与 Android 下载已发布；真实资金及双端真机验收仍待。

## 需求与结果

- 原五张截图：会员中心、我的、好物、学堂、首页调整已包含在 Android 0.3.28，详[111](111-screenshot-ui-adjustments.md)。
- ¥3课程无法购买：课程分类为 AUDIO、正式收费章节为 VIDEO；后台允许混合课件，售卖校验却错误要求章节形式与分类一致。本次仅取消该相等限制，保留正式收费章节、文件存在/大小、媒体 READY、MIME 与时长验证。线上该课程 `paymentEnabled=true`，微信 Native 启用，模拟支付保持关闭。
- 四张轮播图：核查时生产配置 revision8 已保存四个不同有效素材，四个公开图片均返回200，后台预览加载及保存按钮可用；原失败请求未留存，不能据截图认定是数量超限或唯一根因。原服务端将重复素材、非法标识、图片视频并存等全部合并成“最多10张”提示，现分别说明原因，并在后台保存前拦截重复选择。现有四图和顺序未修改，无需重新上传。
- 付款页：公共按钮内边距与页面大行高叠加导致文字下沉；改为零垂直内边距、独立文字和双向居中，主次按钮统一48px，整理金额及间距。保留保存付款码、主动查单、自动查单、订单返回及避免重复付款提示。

## 验证证据

- API 与官方 Pro 构建通过；Web 构建、76页 Android 蒸汽资源及云端签名成功。
- 课程混合交付专项1项、原课程/Native回归42项通过（见上一轮 `.runtime/payment-fix-tests.log`）；轮播4项测试通过，包含四张图片上传/保存/排序、重复/超限/非法标识、权限并发及视频切换。
- 付款页8项实际API/隔离数据库流程通过，0 JS运行异常；320/390/768宽度无横向溢出，文字与按钮中心偏差小于1.5px；已付款仅查单、查询失败提醒及确认后发权益通过。外部微信网关在此组中为测试替身，不作为真实收款证据。
- 线上四图配置与预览、公开图片HTTP200、保存按钮、重复请求400且配置未变、课程Native报价及健康通过，0 JS异常；见 `outputs/payment-launch-0328/online-checks.json` 与截图。
- `outputs/payment-ui-0328/` 为本地流程截图和检查记录；`outputs/android-preview-0328/source-verification.json` 比对506文件，仅两项既有授权的无系统推送覆盖。

## 后端与后台发布

- 主机43.160.229.173，当前发行 `20261101-payment-ui-03`，上版为 `20261101-payment-ui-02`；02修复课程交付校验，03完善轮播校验及后台提示。
- 03复用02基础镜像，仅替换构建验证后的 `system-config.js` 及对应源码；后台按源码重新构建。无需重复下载录制器和安装依赖。正式完整Dockerfile保留，补丁构建定义见发行中的 `infra/hero-fix.Dockerfile`。
- 84迁移不变，17类业务记录计数前后一致，环境只修改API_IMAGE_TAG；未seed、未更改素材/套餐/价格，API healthy，watch/backup timer active。
- 数据库与媒体备份 `academy-20261101T111340Z-TnPZzD.dump`（两项SHA256通过）；回退说明 `/opt/daoxue-academy/rollback-20261101-payment-ui-03.txt`。上版备份 `academy-20261101T102928Z-Kqgzgn.dump`。保留当前及前版镜像与数据；禁止还原旧库覆盖新业务。
- 发布后磁盘约6.5GB可用/89%；本次无新迁移。

## Android 与固定下载

- Android **0.3.28 / code33**，包名 `cn.daoxue.academy`，50,098,472字节。
- SHA256：`055d8e549454bed5709c7242d413a9b041d36f161b1303a8160c85c5dbe849cc`。
- 同原云证书：`81d6c07aa2d22b2e022bcc6f00148f984c8bc5aac427f60207e1233c1e8df248`；ZIP、JAR签名、版本、生产HTTPS、Native与原生安全/RTC/离线模块验证通过。
- 本地 `outputs/android/daoxue-academy-0.3.28.apk` 及同名JSON；公开入口 https://cuecanvas.top/download/ ，原二维码不变。10个下载发行文件逐项哈希通过，公网整包SHA256/大小一致、Range206、页面及release.json版本一致；FeatureConfig.release revision10指向0.3.28/33。
- 0.3.27/code32已构建但未发布，因随后插入按钮修复，最终直接发布0.3.28以保留产物可追溯性。

## 未关闭的验收

未进行真机安装/相册识别或iOS构建；当前仅微信Native启用，微信App SDK及支付宝仍未配置，不得宣称全部渠道已开通。只读复核生产已验证Native收款记录与已处理成功通知均为0（见 `outputs/payment-launch-0328/payment-acceptance-readonly.txt`）；生产真实扣款→通知解密→到账→原路退款到账仍缺证据，不以报价可用、付款码或隔离测试代替资金验收。会员当前无可售套餐，未虚构套餐价格。商用38/131保持。
