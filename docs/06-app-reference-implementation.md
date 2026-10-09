# 用户设计图：App实施说明

日期：2026-10-06。此文档取代04、05文档中的App视觉方案；后台继续使用官方Ant Design Pro模板。

## 设计来源

用户提供的六核心页原图：design-reference/core-screens.png；完整页面体系：design-reference/page-system.png。原图完整保存，不改动用户源文件。优先服从原图构图和密度，文字与价格使用数据库实际内容，图中虚构数字不照抄。

色板：#17292D墨青、#245564黛青、#F4F0E7米白、#D8D4CA暖灰、#B95543朱砂。品牌和首页题字为Ma Shan Zheng书法字体，标题/文章使用Noto Serif SC，辅助信息/数字使用系统字体。均随包加载，无需运行时依赖Google。字体许可证随static/fonts保存。中文字体不以装饰字体代替操作提示或辅助文字。

## 页面与能力

| 页面 | 当前实现 |
| --- | --- |
| 首页 | 书法品牌、搜索、山水经典、七快捷入口、精选经典、推荐课、名师、直播状态，真实数据库目录 |
| 学堂/发现/好物 | 紧凑横向课程/文章行、分类/形式/搜索、分页、两列商品、价格排序、真实接口 |
| 课程详情/学习 | 封面、价格、老师、介绍/目录/评价、底部试听/购买；没有章节数据时如实显示未发布，不虚构目录与媒体 |
| 文章 | 山水封面、宋体正文、来源、固定工具栏、14—20px字号调整、收藏、稳定段落私人笔记；保存后可回看 |
| 商品/确认订单 | 实际商品信息、溯源/说明、数量、金额参考；规格/库存/支付未接入时禁止创建订单 |
| 我的/登录 | 游客/登录状态、会员条、10项菜单；真实短信挑战/OTP/协议、倒计时、防重复提交与返回 |
| 名师/活动 | 公开列表/详情，按老师查课，实际发布状态与生产示例过滤；预约未开放时不返回假成功 |
| 会员/直播/社区/个人服务 | 按原图搭建页面，提供未发布或未开放状态；这些业务服务仍待实现 |
| 收藏/私人笔记/日志/设置 | 实际个人API、数据隔离、删除与确认、兴趣保存、退出、注销；日志编辑等待初次加载，避免输入被覆盖 |

## 图片与字体

ArtImage使用用户原始核心页板作为临时图片图集，仅通过原生视图裁切山水、器物、茶室和小舟区域，不把整页截图作为UI。布局、标题、价格、输入框、筛选和按钮均为真实组件。当前图集素材受所提供图片分辨率限制；真实上传的非示例封面URL优先使用，发布时应提供独立高清图与实际商品/老师素材。

Ma Shan Zheng源：https://github.com/google/fonts/tree/main/ofl/mashanzheng；字体由Google Fonts官方字体分发提供。当前书法子集只覆盖固定品牌及题字，动态文字仍使用宋体/系统字体。Noto Serif SC及书法字体均保留OFL。

原生加载采用DCloud的uni.loadFontFace，文档：https://doc.dcloud.net.cn/uni-app-x/api/load-font-face.html。Web使用本地@font-face。原生图片、样式、页面与TS经Android蒸汽编译验证；Android14设备已安装云构建APK，原生运行修正与验收记录见下文。

## 验证与边界

outputs/ui/app-reference-*-375.png、*-390.png、*-430.png为实际编译Web的页面截图；构建日志、登录状态及笔记/收藏/日志回看截图在同目录。03进度文档保持完整R1/R2任务未完成状态，不能将这些UI页面视为交易/媒体/会员/论坛全部实现。

后端15项真实PostgreSQL检查通过。开发API为本机127.0.0.1:3000，App真机必须配置可访问的开发地址或正式HTTPS服务；会话仍只在内存，原生安全存储尚待验证。已在Android14荣耀JDY-AN00安装云构建APK；iOS签名/运行未完成，不代表双端或上线交付完成。

## Android USB预览配置

手机USB调试已授权；Windows针对已连接Honor ADB接口补充标准Android接口GUID，保留原GUID与注册表备份，未替换其他USB接口驱动。驱动记录在outputs/ui/connected-adb-driver-repair.log与connected-adb-registry-backup.json。

ADB使用D:/HBuilderX/plugins/launcher-tools/tools/adbs/adb.exe。开发API仍为http://127.0.0.1:3000/api/v1，通过adb reverse tcp:3000 tcp:3000访问电脑端正在运行的Nest服务。断开USB或停止本机API后无法加载内容，这是开发预览包，正式构建必须换成实际HTTPS服务地址。

自定义AndroidManifest.xml与nativeResources/android/res/xml/academy_network_security.xml默认禁止HTTP，只对127.0.0.1/localhost开放开发例外；远程地址继续要求HTTPS。依据[DCloud原生资源配置](https://doc.dcloud.net.cn/uni-app-x/collocation/app-nativeresource-android.html)与[Android网络安全配置](https://developer.android.com/privacy-and-security/security-config)。正式发布删除本地例外。

原生字体显式设置行高，避免内置字体度量将题字、品牌和辅助信息撑高。图标与空文本按钮作为同层子元素，避免Android原生button不支持子组件而丢失图标，同时保留button的操作标签。
最终云包ticket：b2b348e0-c156-11f1-bed1-1761d76168e1；APK路径outputs/android/daoxue-academy-0.1.0.apk；SHA256 d7397d1cfef1a6004be617f5cf043c5f8a8edc1fe803824d56bf4b70e8757318。2026-10-06在荣耀JDY-AN00 Android14更新安装成功。9个核心/详情页面已检查，目录、导航和OTP请求/倒计时通过；完整原生OTP登录及私人数据保存回看尚待完成，Web相关流程已通过。真机截图app-native-{home,academy,discover,shop,profile,login,article,course,product}.png，状态数据app-reference-verification.json。