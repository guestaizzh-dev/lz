from pathlib import Path
import csv,json
OUT=Path.cwd()/'outputs/audit-2026-10-09'
groups={
'基础账号':('ID','services/api/src/identity.ts；auth.ts；apps/mobile/lib/session.ts；pages/auth/login.uvue；pages/profile/settings.uvue；outputs/ui/orders-api-tests.log', '''
P014|R2|未完成|微信一键登录及绑定|当前只有手机号登录，未发现微信登录或重复账号合并|真机微信授权成功，绑定不产生重复账号
P014|R1|已完成|手机号注册与登录基础链路|验证码挑战、服务端次数频率与消费控制、App登录和私人接口已实现；正式短信另项验收|开发环境验证码单次有效，跨用户权限隔离
P014|R1|未完成|正式短信发送与接收|腾讯短信签名实现存在，未有正式账号发送及手机接收证据|正式短信接收、超时、限流及失败提示通过
P014|R1|已完成|自主选择和修改道学兴趣标签|个人设置可修改tags；尚不影响推荐，推荐另项|标签保存后刷新仍保留，游客不强制填
P015|R1|未完成|昵称头像资料管理|User有字段，未发现完整修改资料及头像上传闭环|本人可编辑，上传受控，别人不能修改
P015|R1|未完成|个人订单和售后管理|入口为空态，真实订单和售后未开放|真实订单列表详情、支付和售后状态一致
P015|R1|已完成|个人当前会员与套餐查询|App请求真实套餐和有效会员，人工授权状态可查询；购买另项|生效和到期展示与服务端一致
P015|R1|未完成|完整学习档案|已有学习库、章节进度；没有作业和课程实践档案|已购、会员可学、完成、作业和实践可追溯
P015|R1|已完成|私人笔记存取及隔离|Note含文章版本、段落、原引用，服务端按本人读取|文章修改不覆写原引用，跨账号不可读
P015|R1|已完成|私人每日修行日志|PracticeLog按用户日期唯一，App记录和查询|同日可编辑，私密，按日期追溯
P015|R1|未完成|积分账户及明细|仅未开放入口，无积分账本|可看余额、来源、消费与冲正
P015|R1|未完成|站内消息中心|未开放空态，无消息表及业务通知|订单课程预约审核结果可读且标记已读
P016|R1|未完成|跨文章课程名师商品论坛综合搜索|首页搜索转文章检索，其他类别不纳入|分页分类结果只返回当前可见资源
P016/P071|R1|未完成|基于兴趣标签的内容活动推荐|保存tags但首页固定featured/time，不读取兴趣|修改标签改变推荐，给出推荐原因及空数据退路
P016/P071|R2|未完成|浏览购买行为个性化推荐|未发现行为事件与推荐策略|按明确同意和可配置权重排序，排除无权限正文
D6.1|R1|已完成|退出撤销与账号注销基础链路|会话撤销、私人数据清理和预占订单关闭已实现；正式交易保留待补|注销不可再用旧会话，个人数据按当前规则删除
D6.1|R1|未完成|安全持久登录与账号恢复|App令牌只存内存，未有Keychain/Keystore持久会话|重启可续会话，重放refresh撤销，冻结与注销立即失效
D6.1|R1|未完成|完整设置与权限说明|已有协议隐私页面；未见更新检查、缓存清理与完整权限管理|版本检查、缓存清理、按需授权及拒绝后浏览可用
'''),
'文章经典':('AR','services/api/src/catalog.ts；admin.ts；personal.ts；apps/mobile/pages/article/detail.uvue；lib/presentation.ts；outputs/ui/orders-api-tests.log', '''
P020|R1|已完成|四类文章分类浏览|经典原文、名师解读、实践心得、道学常识分类及目录详情已实现|公开分类目录与详情对应
P020/P093|R1|未完成|权威注释版本和授权证据|Article.source可填文字，缺作者授权、经典版次和核验记录|每篇经典有可核查来源，解释署名授权可追溯
P021|R1|未完成|图文正文发布与阅读|封面、paragraph/quote存在；正文图片块未支持|编辑上传图片后原生正文正确呈现，图片失败不阻断文字
P021|R1|未完成|文章音频视频发布与阅读|章节媒体工具不等于文章媒体块，未形成文章媒体链路|正文音视频上传审核、转码、播放和鉴权可用
P021|R2|未完成|古籍水墨书法排版工具|App装饰字体存在，后台专用排版模板未发现|模板块有稳定ID，窄屏可读，导入内容受控
D6.2|R1|已完成|文章草稿审核发布下架|后台状态流、乐观版本、API发布过滤和审计已有测试|未审和下架正文不可公开读取，审计可追踪
D6.2|R1|已完成|会员文章服务端鉴权|正文在服务端按会员判定，非单纯前端隐藏|无权益响应不含完整会员正文
P022|R1|未完成|文章点赞|未发现点赞表和接口|一人一赞可撤销，计数一致
P022|R1|已完成|文章收藏及个人收藏列表|Favorite唯一用户文章，App收藏及个人库可用|重复收藏不重复计数，用户隔离
P022|R1|未完成|文章评论与引用评论|按钮明确未开放，无评论与治理模型|回复可引用段落，先审规则和举报可执行
P022|R1|未完成|可打开的内容分享链接|仅复制标题及书院名，无资源URL和深链|分享链接可回到对应内容，会员正文不泄露
P022|R2|未完成|微信好友朋友圈社群分享|未有SDK或系统分享正式验收|按平台支持能力分享，失败和未安装有降级
P022|R1|已完成|按段落记私人笔记|Note保存blockId、articleVersion、quote；App弹层保存可用|原段落变动后仍可看原引用
P022|R2|未完成|文本范围标注|当前仅整段引用，无偏移范围模型|多段和精确范围可定位，版本变动仍有原摘录
P022|R2|未完成|笔记整理导出|未见导出任务、文件与分享|本人导出有权限和短期下载有效期
P023/P065|R1|未完成|文章导向对应名师课程直播|没有结构化内容关联表或文章购买入口|文章至对应课程确认页不超过3次主要操作
D6.2|R1|未完成|阅读历史去重及举报|未见read-event及文章举报链路|重复刷新不夸大阅读，举报可追踪处理
'''),
'名师服务':('TE','services/api/src/curriculum-admin.ts；catalog.ts；apps/mobile/pages/teacher/detail.uvue；services/api/prisma/schema.prisma', '''
P026|R1|已完成|名师基本档案及课程列表|简介、头衔、研究方向、审核、详情和老师课程筛选存在|未发布老师不公开，代表课程可进入详情
P026|R1|未完成|传承背景脉络与成就核验|只有bio文字，缺证据来源、审核与成就结构|背景经核验且有依据，展示不杜撰
P026|R1|未完成|独立授课方向及代表课编排|expertise与课程关联存在，缺指定代表课和授课方向结构|名师详情明确研究与授课方向、精选代表课
P026|R1|未完成|名师直播活动日程|Teacher未关联直播活动场次|详情统一展示可预约场次和正确状态
P026|R1|未完成|名师音视频信任内容|缺档案媒体关联与播放|审核后的访谈或讲解可播且标注来源
P027|R1|未完成|一对一咨询预约|咨询入口未开放，无时段库存|时段锁定支付确认、取消退款、双方通知贯通
P027|R2|未完成|App内实时一对一咨询|R1方案允许外部会议交付，App内RTC未接入|预约双方身份校验、音视频接入、结束及异常恢复完整
P027|R1|未完成|线下见面预约|活动目录不等于本人预约，无履约核销|时间地点、席位、支付、核销和取消一致
P027|R1|未完成|向名师提问与精选答复|问答空态，无问题和答复表|本人私问隔离，公开答复审核，老师只答自己的问题
P028|R1|未完成|名师会员独家解读权益|通用会员文章可控，但没有名师独家资源配置和呈现|权益对应真实名师解读资源并服务端鉴权
P028|R2|未完成|名师会员连麦优先|直播连麦与优先队列未实现|按权益排队且由老师审批
P028/P061|R2|未完成|签名书籍文创权益|未有签名商品、额度和领取履约|限量、实名领取、订单发货和退款处理可追踪
D4/D6.3|R1|未完成|老师账号绑定及资源归属工作台|有TEACHER枚举，无Teacher-user绑定和本人工作台|老师只能处理指定课程问答作业预约
'''),
'课程实践':('CO','services/api/src/learning.ts；curriculum-admin.ts；media.ts；apps/mobile/pages/course；outputs/ui/orders-api-tests.log；outputs/ui/app-021-native-progress-check.json', '''
P032|R1|已完成|四类课程目录|分类筛选及课程详情存在|经典、实践、生活、少儿四类可查
P032|R1|未完成|视频课程正式交付|章节发布和播放器已有；真实MP4/HLS、弱网与iOS未验收|真实视频双端可播续播，鉴权短期凭证、转码失败有提示
P032|R1|未完成|音频课程正式交付|WAV开发测试可播，正式音频内容双端未验收|真实音频双端后台中断恢复和进度同步
P032|R1|未完成|直播课程交付|LIVE枚举存在，后台拒绝该形式发布|购课绑定直播场次和回放，准入与权益一致
P032|R1|未完成|训练营课程交付|COHORT枚举存在，发布拒绝，无开营批次|开营、任务、助教、期限、社群与阶段提醒贯通
P032|R1|未完成|线下课程交付|OFFLINE枚举存在，发布拒绝|课程与活动席位统一，购课后可核销
P033|R1|已完成|课程标价与试听配置|Course.price、章节trial、售前规则可配置|详情价格和试听章节与后台一致；不代表已可支付
P033|R1|未完成|付费购课与自动授权|确认页禁用，只有免费加入及后台人工授权|支付验签后一次授权，重复回调无重复发放
P033|R2|未完成|课程优惠券|无券模板领取核销模型|适用渠道、门槛、锁定释放及退款规则明确
P033|R2|未完成|课程拼团|无团库存成员及成败退款|人数去重、截止成团、失败退款幂等
P033/P067|R2|未完成|单层会员课程推广分销|无推广归因佣金提现和退款回冲|一级佣金实收净额、冻结期、退款回冲和结算可对账
P034|R2|未完成|离线缓存与到期校验|未有离线下载受控许可证|过期或撤权不能继续解密播放，可清理缓存
P034|R1|未完成|完整倍速续播跨设备体验|倍速/续播代码及开发音频证据已有，双端正式媒体未完成|真实音视频双端倍速、重启续播、跨设备冲突可恢复
P034|R1|已完成|基础学习进度与事件幂等|StudyProgress/StudyEvent、事件哈希与开发进度验证存在|重复事件不重复计学习；文本章可标已读
P034|R1|未完成|弱网持久进度重试|客户端retry队列仅内存，退出后失败记录丢失|断网退出再进仍能幂等补报
P034|R1|未完成|作业文本图片提交|无Assignment/Submission|作业期限、修改版本和本人可见附件权限
P034|R1|未完成|老师助教点评答疑|无归属分派和Review/讨论|指定老师点评并通知学员，越权拒绝
P034|R1|未完成|课程实践打卡|私人日志存在但未绑定课程任务、图片和连续天数|按业务日期记录任务完成、图片和老师反馈
P034/P066|R1|未完成|购课自动课程社群|无课程讨论区和自动访问授予|购课或有效会员自动入课群，退款撤权仍保留本人私密记录
D6.4|R1|已完成|免费课程加入与人工补偿授权|免费enroll、后台grant/revoke、原因审计已测试|只允许已发布免费课程，人工操作可追踪
D6.4|R1|已完成|已购版本与独立访问权隔离|CourseRelease/Lesson快照，独立Enrollment不随会员过期失效，下架已授课可学|人工独立权益、会员到期及下架场景鉴权测试通过
D6.4|R1|未完成|已购版本升级与补偿处理|发布快照已有，章节删除重建，跨版本章映射和撤销补偿无闭环|新版本显式升级，不覆盖旧进度和已购售前承诺
'''),
'直播':('LI','apps/mobile/pages/live/index.uvue；services/api/prisma/schema.prisma；services/api/src/catalog.ts', '''
P038|R1|未完成|五类直播预告场次|App空静态列表，无直播实体|讲解答疑实践会员线下同步可建场次
P038|R1|未完成|直播预约和开播提醒|无预约及通知模型|取消不发提醒，开播事件幂等通知
P038/P094|R1|未完成|真实直播推流观看及稳定性|未发现推流会话、服务商回调与原生播放集成|公开购课会员准入、弱网重连和结束状态可验证
D6.5|R1|未完成|审核回放与原权益复用|静态回放入口，无资产与鉴权|回放审核后发布，地址签名，权限随原课和会员
P039|R1|未完成|直播弹幕评论和经典引用|未见房间互动API|引用经典可定位，禁言删除举报即时生效
P039|R2|未完成|直播连麦与主持人控制|无RTC会话及审批|申请同意开麦踢出、会员优先、权限撤销贯通
P039|R2|未完成|古风礼物打赏|无礼物商品和交易记账|支付渠道允许、未成年等账户控制与退款结算完整
P039|R2|未完成|直播投票问卷|无投票题目答卷|一人一票、截止控制、结果权限正确
P040|R1|未完成|直播课程商品活动卡和会员入口|无可配置关联卡片及购买返回|在直播中开详情确认，返回保持播放状态
P040|R2|未完成|直播秒杀限时营销|无活动价限量库存和时间校验|服务端活动时窗及库存一致，不超卖
D6.5|R2|未完成|老师App内开播|没有主播端SDK和会话|老师获得短期推流凭证，普通用户拿不到密钥
'''),
'论坛治理':('FO','apps/mobile/pages/community/index.uvue；services/api/prisma/schema.prisma；services/api/src/main.ts', '''
P044|R1|未完成|论坛六分区可用内容流|六个tab存在，无帖子实体API|各区发布审核、列表详情实际可用
P045|R1|未完成|图文发帖|无帖子编辑、上传、审核流|本人草稿编辑、审核后公开，附件权限安全
P045|R2|未完成|音视频发帖|无帖子媒体和审核|上传转码失败可恢复，发布前审核
P045|R1|未完成|回复与引用经典或文章|无帖子回复引用模型|原引用版本可追踪，删除有占位
P045|R1|未完成|论坛点赞收藏|未实现，文章Favorite不等于论坛收藏|幂等赞藏、个人列表和计数一致
P045|R1|未完成|话题标签及筛选|无forum-topic关联|话题聚合正确，审核帖子不泄露
P045|R1|未完成|精华和运营置顶|无运营管理接口|置顶有期限范围，精华有理由和审计
P045|R2|未完成|参与次数和质量成长评价|User没有成长账本，未有质量复核|审核发放、每日上限、撤回冲正，真实称号不过度背书
P046|R1|未完成|论坛内容审核|文章审核不能覆盖论坛|先审后发、敏感评论复核、申诉追踪
P046|R1|未完成|举报与封禁禁言|无Report/Restriction与处理工作台|多入口统一拦截，举报状态可追踪
P046|R1|未完成|屏蔽拉黑用户|无UserBlock|列表隐藏且直接互动限制符合规则
P046|R2|未完成|征文主题活动|无活动投稿和评选授权|报名投稿评审公示奖励可追溯
D6.6|R1|未完成|受限课程讨论区|无统一讨论实体和课程访问判定|无课权不得读正文，助教只管理指定课程
'''),
'商城交易':('SH','services/api/src/shopping.ts；orders.ts；apps/mobile/pages/product/detail.uvue；shop/cart.uvue；shop/addresses.uvue；order/confirm.uvue；outputs/ui/orders-api-tests.log；outputs/ui/app-022-native-cart-updated.png', '''
P050|R1|已完成|商城五类目录与实物详情|分类选项、实物规格价格和详情存在；数字与服务履约另项|典籍文创养生工具线下服务分类可查，目录不伪装履约
P050|R1|未完成|数字商品自动交付|DIGITAL发布被拒绝，无领取权益|付款后发放，签名地址，退款撤权
P050|R1|未完成|服务商品预约交付|SERVICE发布被拒绝，未关联时段|商城和名师预约复用唯一时段库存
P051|R1|已完成|商品SKU及购物车管理|SKU价格库存版本、添加更新移除、可售校验，Web和Android数量验证|无效下架SKU不可结算，数量幂等更新
P051|R1|已完成|收货地址管理|新增编辑删除默认地址、用户隔离与数据库条件唯一已实现|最多20条，一人最多一个默认地址，其他人不可改
P051|R1|未完成|App真实报价确认与下单|后端开发quote/reserve存在，App确认页不调用且按钮禁用|确认实收与运费折扣、价格变化重新确认后服务端创建
P051|R1|未完成|真实支付验签回调及查单|Order只有PENDING/CLOSED，不具生产支付能力|金额订单渠道一致，重复迟到通知可补偿，无假成功
P051|R1|未完成|订单历史详情与状态跟踪|App仍为空态，无履约状态链路|多端状态与服务端一致，取消和超时可追踪
P051|R1|未完成|发货物流单号签收|无Shipment和订单发货工作流|后台真实单号，跳转查询，不编造轨迹
P051|R2|未完成|物流轨迹查询接口|没有物流服务商集成|签收失败回调幂等，状态一致
P051|R1|未完成|退款退货换货与咨询|无售后申请审核渠道退款与回冲|部分退款、退件入库、换件补发和咨询可追踪
P051|R2|未完成|优先物流|只有基础地区运费，缺优先承运服务覆盖|售前明确可用地址服务费，不能承诺不可履约
D6.7|R1|已完成|基础实物地区运费配置与报价计算|DeliveryZone按省基础附加费免邮门槛，后端quote已有测试；App未联接另项|禁配送地区拒绝，标准运费按规则算
D6.7|R1|未完成|正式库存预占支付扣减与释放|预占仅非生产开关测试，进程timer清扫；无持久任务或支付后扣减|并发不超卖，宕机后恢复释放，支付迟到无错误履约
D6.7|R1|未完成|正式交易快照及退款分摊|开发预占有商品地址快照；没有真实交易折扣税费及退款分摊|改商品地址规则不改变历史实收，部分退款按项结算
P052|R1|未完成|新品热销及课程配套推荐|featured和列表时间排序已有；无热销统计和课程关系|真实销售热度、新品时窗、指定配套均可配置
P052|R2|未完成|折扣满减营销|无营销规则、订单分摊及叠加策略|服务端计价，价格变化重新确认，退款按分摊回冲
P052|R1|未完成|商品文化溯源及质量审核|已有culturalOrigin文字与商品审核，缺证据/供应方资质核验|来源和质检证据可追溯、误导说明可下架
D6.7|R1|已完成|商品草稿审核发布下架和审计基础|SKU有效性、实物才可发布、版本控制及审计存在|不完整商品拒绝发布，已下架不可加入可售项
'''),
'会员积分':('ME','services/api/src/learning.ts；curriculum-admin.ts；apps/mobile/pages/membership/index.uvue；services/api/prisma/schema.prisma；outputs/ui/membership-workflow-check.json', '''
P056|R1|已完成|三级月季年套餐基础配置|MembershipPlan含tier/days/price和后台配置，默认草案价格不是真实报价|三层30/90/365天套餐查询一致
P056/P076|R1|未完成|会员购买续费开通|App明确暂未开放开通，人工grant不算购买|真实付款后生效，续费及跨级排队售前明示
D6.8|R1|已完成|人工会员补偿及生效排队撤销|后台grant/revoke和audit，当前生效查询已有验证|同时间有效层级一致，补偿操作理由可追踪
P056|R1|未完成|消费互动打卡成长升级规则|当前决定付费/成长/积分分离，原文成长升会员未实现|明确成长是否赠权益；规则奖励账本可审计，禁止隐式收费升级
P058|R1|已完成|按层级访问指定文章课程基础|Article/Course membershipTier服务判定；不是任意单卖课免费|无权益仅预览试听，独立课权不因到期失效
P058|R1|未完成|新课优先学习|无优先时间窗或权益码|新课开放时间按有效权益计算且可解释
P059|R1|未完成|会员商品折扣|quote明确discountsEnabled=false|按有效会员及可折扣SKU计价，有历史权益快照
P059|R1|未完成|会员购课立减|只有准入，没有购课折扣计算|排除单卖或特殊平台产品有明确售前说明
P059|R1|未完成|会员免邮权益|运费通用freeAbove不等于会员免邮|分层门槛基础费优惠，附加费明示
P060|R2|未完成|会员论坛置顶申请|论坛未落地，也无权益额度|申请审核有期限，不覆盖治理限制
P060|R1|未完成|会员专属问答|缺问答和权益额度|用户可查额度，老师答复和使用记录可核查
P061|R1|未完成|公益活动免费或优惠|活动未有报名支付，也缺会员价规则|真实活动按权益优惠，取消返还额度
P061|R2|未完成|研学优先参与|无报名优先时窗席位模型|普通报名与优先时窗明确，同池席位不超售
P062|R1|未完成|消费互动打卡积分获取|无积分事件/流水/反作弊|退款冲正、审核奖励与每日限额可验收
P062|R1|未完成|积分兑换优惠券|没有积分券模板、核销和兑换单|原子扣积分发券，失败返还，取消不重复
P062|R2|未完成|积分兑换文创和咨询|没有奖品库存服务权益及兑换履约|原子扣积分发奖励，失败返还，实物发货或咨询预约可追踪
D6.8|R1|未完成|套餐版本权益快照与用量|Plan原记录可覆盖，只有tier/period局部快照|改价改权益不改历史订单；问答活动额度可扣可退
'''),
'联动活动':('LK','services/api/prisma/schema.prisma；services/api/src/catalog.ts；apps/mobile/pages/event/detail.uvue；pages/profile/index.uvue；pages/index/index.uvue', '''
P065|R1|未完成|文章直播名师课程双向关联|没有结构化ContentRelation|任一内容可到关联师课播，后台统一编排
P065|R2|未完成|优质心得老师点评成为课程案例|缺公开投稿、点评和授权|经用户明确授权且撤回可处理，不默认公开私人笔记
P066|R1|未完成|购课会员自动社群权限|论坛讨论与授权实体缺失，外部群入口未实现|购课会员按权益进入App课群；外部群可选非自动承诺
P066|R1|未完成|学习配套工具推荐|无课程商品关系及章节场景推荐|相关商品有文化说明，不干扰学习和内容信任
P067|R1|未完成|私人笔记日志自主分享为论坛帖|只有私密存取，无公开分享审核授权|明确选择后生成独立草稿，原私密记录不自动公开
P067|R2|未完成|精选内容运营推广|未有征稿精选审核与来源授权|精选入口、出处和授权可追溯
P070|R1|未完成|文章购课不超过三步|无文章相关课购买关系，真实支付未接|文章关联课程详情→确认→支付，登录返回原路径
P070|R1|未完成|简化直播预约商品下单|直播无预约，购物车无法结算|减少重复资料，保持播放上下文和订单确认
P070|R1|已完成|一键收藏与快速私人记录基础|文章收藏、个人今日日志实际保存|一次收藏，日志可迅速进入并保存；不等于课程实践完成
D6.3/D6.7/P078|R1|未完成|统一活动报名支付席位核销|Event目录API及页面已有，报名明确未开放；seed无实际活动|席位锁定支付核销退款及本人预约列表完整
P069|R1|未完成|高质量古风视觉和可读性验收|已参考用户设计并有Android截图，缺全页面一致性及18—70适老验收|同一字体空间体系、放大/安全区/对比度和真实内容验收
P072|R1|未完成|在线反馈表单及处理回执|客服与反馈为空态|用户提交、后台分派、回复通知和关闭有记录
P072|R1|未完成|真实在线电话客服渠道|尚未配置正式联系方式|真实联系方式可达；在线会话或工单可追踪
P072|运营|未完成|定期用户意见收集和版本迭代|未见运营执行记录|定期汇总意见，明确优先级与处理结果
'''),
'后台经营与上线':('OP','apps/admin/THIRD_PARTY.md；config/routes.ts；src/pages/dashboard/analysis；outputs/ui/admin-orders-build-retry.log；docs/03-development-progress.md；docs/02-technical-research-and-decisions.md', '''
U后台|R1|已完成|使用官方Ant Design Pro模板二开|THIRD_PARTY记录官方v6.0.3提交与MIT，非自行重写壳|保留模板来源许可，扩展业务路由
D后台|R1|未完成|最新后台可部署构建|orders相关最新build/retry发生esbuild Go内存崩溃，未有该版本成功产物|源码typecheck+完整build成功并可预览，不能以旧dist替代
D后台|R1|未完成|真实经营看板|analysis仍为官方示例统计图表|汇总真实支付学习履约，不把演示值当经营数据
D4/P080|R1|未完成|运营审核客服财务资源权限|API有角色校验，缺完整角色配置、Teacher归属和岗位工作台|菜单与API同授权，越权案例拒绝，关键操作审计
P075|R1|未完成|课程商城礼物平台收入及合作分成|无真实支付账本/合同和结算记录|按协议净实收、退款和费用形成可对账分成
P075/P076|R2|未完成|公益课程降低分成与公益会员|没有专项费率或公益授予闭环|资格审核、协议版本、优惠和结算可核查
P077|R2|未完成|广告推荐位与名师推广收费|featured不等于广告订单，未有付费推广与标识|排期广告标识、合同授权、投放统计和收入追踪
P078|R1|未完成|活动与运营服务收入记录|活动未付款、无服务协议及财务账|收费交付、退款、合作方结算与总账一致
P080/P081/P082|运营|未完成|真实名师品牌机构合作和分成落地|只有设计决定及示例档案，无已执行合作证据|协议、资质、分成、内容商品交付与曝光评估有记录
P085|R1|未完成|Android/iOS正式构建与核心链路验收|Android0.2.2开发包已成功打包安装；iOS、正式签名、真实支付媒体未验|两端正式包、冷启动离线弱网、真实设备关键业务通过
P085/P094|R1|未完成|生产部署HTTPS可靠任务和恢复|App硬编码localhost；队列对象存储等仍多为方案|正式域名、备份恢复、任务重放、告警与媒体签名验证
P085/P086|运营|未完成|真实内容商品种子内测|当前isDemo例数据，不是实际可交付课程库存|授权内容、名师课程商品、内测问题台账和处理证明
P087/P089|运营|未完成|上线推广及名师种子用户邀请|未见运营执行证据|正式包上线、邀请转化和推广复盘可核查
P090|运营|未完成|道学主题活动短视频社群引流|尚无活动运营闭环|真实主题活动、外部渠道、预约参与与回访数据
P090|运营|未完成|道学垂直推荐与内容获客|无实际投放或合作执行证据|投放有标识、成本归因和有效学习转化
P091|运营|未完成|线下线上活动联动回顾|活动直播均未形成闭环|线下核销、线上同步、经授权回顾内容可查
P093|运营|未完成|专业道学内容审核团队与准确性|有文章审核代码，不是专业团队已成立|审核标准、人员职责和专业校审记录
P094|运营|未完成|长期维护及直播视频稳定运维|无生产运行和服务等级验收|负责人、告警、故障演练、服务商支持与持续维护记录
P095|运营|未完成|合作方筛选及内容商品品质机制|缺合作资质材料、样品审核与复查记录|准入、复评、投诉追踪和退出流程
P096|运营|未完成|独家名师系统实践差异化成果|只有平台展示和学习基础，无独家实际内容实践证据|独家授权和完整研习实践点评社群路径能试用
''')}
rows=[]
evidence_paths={
'基础账号':['services/api/src/identity.ts','services/api/src/auth.ts','apps/mobile/lib/session.ts','apps/mobile/pages/auth/login.uvue','apps/mobile/pages/profile/settings.uvue','outputs/ui/orders-api-tests.log'],
'文章经典':['services/api/src/catalog.ts','services/api/src/admin.ts','services/api/src/personal.ts','apps/mobile/pages/article/detail.uvue','apps/mobile/lib/presentation.ts','outputs/ui/orders-api-tests.log'],
'名师服务':['services/api/src/curriculum-admin.ts','services/api/src/catalog.ts','apps/mobile/pages/teacher/detail.uvue','services/api/prisma/schema.prisma'],
'课程实践':['services/api/src/learning.ts','services/api/src/curriculum-admin.ts','services/api/src/media.ts','apps/mobile/pages/course','outputs/ui/orders-api-tests.log','outputs/ui/app-021-native-progress-check.json'],
'直播':['apps/mobile/pages/live/index.uvue','services/api/prisma/schema.prisma','services/api/src/catalog.ts'],
'论坛治理':['apps/mobile/pages/community/index.uvue','services/api/prisma/schema.prisma','services/api/src/main.ts'],
'商城交易':['services/api/src/shopping.ts','services/api/src/orders.ts','apps/mobile/pages/product/detail.uvue','apps/mobile/pages/shop/cart.uvue','apps/mobile/pages/shop/addresses.uvue','apps/mobile/pages/order/confirm.uvue','outputs/ui/orders-api-tests.log','outputs/ui/app-022-native-cart-updated.png'],
'会员积分':['services/api/src/learning.ts','services/api/src/curriculum-admin.ts','apps/mobile/pages/membership/index.uvue','services/api/prisma/schema.prisma','outputs/ui/admin-membership-workflow-check.json'],
'联动活动':['services/api/prisma/schema.prisma','services/api/src/catalog.ts','apps/mobile/pages/event/detail.uvue','apps/mobile/pages/profile/index.uvue','apps/mobile/pages/index/index.uvue'],
'后台经营与上线':['apps/admin/THIRD_PARTY.md','apps/admin/config/routes.ts','apps/admin/src/pages/dashboard/analysis','outputs/ui/admin-orders-build-retry.log','docs/03-development-progress.md','docs/02-technical-research-and-decisions.md']}
for module,(prefix,evidence,data) in groups.items():
    evidence='；'.join(evidence_paths[module])
    for i,line in enumerate(data.strip().splitlines(),1):
        source,phase,status,title,current,accept=line.split('|')
        rows.append(dict(id=f'{prefix}{i:02}',module=module,source=source,phase=phase,status=status,requirement=title,current=current,evidence=evidence,acceptance=accept))
assert len(set(r['id'] for r in rows))==len(rows)
assert all(r['status'] in ('已完成','未完成') for r in rows)
with (OUT/'02-requirements.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
(OUT/'requirements-data.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
done=sum(r['status']=='已完成' for r in rows)
core=[r for r in rows if r['source'].startswith('P') and r['phase']!='运营']
stats={'total':len(rows),'done':done,'undone':len(rows)-done,'rate':round(done/len(rows)*100,1),'originalSoftwareTotal':len(core),'originalSoftwareDone':sum(r['status']=='已完成' for r in core)}
stats['originalSoftwareRate']=round(stats['originalSoftwareDone']/len(core)*100,1)
(OUT/'completion-stats.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
intro=f'''# 需求完成度逐项清单

审计日期：2026-10-09。原文索引见 [00-original-source.md](00-original-source.md)。

## 判定口径

只用“已完成”或“未完成”。“已完成”表示该条明确界定的基础功能已有前后端和历史验证证据，不代表已正式上线；部分实现、只有枚举/空页面/方案、端到端证据不足均标“未完成”，保留已实现部分说明。正式支付、正式短信、双端媒体、正式部署分别独立验收，不借人工授权或Android开发包替代。

P编号对应原始Word非空正文段落；D为现有产品契约派生的必要工程需求；U为用户明确的新要求。多段来源合并为一项时不重复计分。P中的复杂功能拆成能单独验收的条目，条目等权计数仅反映覆盖范围，不代表工时或商业价值完成率。

总清单 **{len(rows)}项，已完成{done}项、未完成{len(rows)-done}项，覆盖率{stats['rate']}%**；其中仅原文软件要求（排除D/U工程增补和运营执行）**{len(core)}项，已完成{stats['originalSoftwareDone']}项，覆盖率{stats['originalSoftwareRate']}%**。运营任务与功能开发分别统计；R3展望不计分母。R1未达成，R2未达成，七板块完整交付未达成。

完整可筛选清单：[02-requirements.csv](02-requirements.csv)。未完成独立汇总：[02a-unfinished-requirements.md](02a-unfinished-requirements.md)。

## 模块统计

| 模块 | 总数 | 已完成 | 未完成 |
|---|---:|---:|---:|
'''
for module in groups:
    rs=[r for r in rows if r['module']==module];d=sum(r['status']=='已完成' for r in rs)
    intro+=f'|{module}|{len(rs)}|{d}|{len(rs)-d}|\n'
intro+='\n## 分期统计\n\n| 分期 | 总数 | 已完成 | 未完成 |\n|---|---:|---:|---:|\n'
for phase in ('R1','R2','运营'):
    rs=[r for r in rows if r['phase']==phase];d=sum(r['status']=='已完成' for r in rs)
    intro+=f'|{phase}|{len(rs)}|{d}|{len(rs)-d}|\n'
for module,(_,evidence,_) in groups.items():
    evidence='；'.join(evidence_paths[module])
    intro+='\n## '+module+'\n\n证据入口（相对项目根目录）：`'+evidence.replace('；','`、`')+'`。此组各项未找到的能力均限于本次所检查范围；下方逐项说明，不以同组测试代表该组全部通过。\n\n'
    intro+='| ID | 原文/派生来源 | 阶段 | 状态 | 可验收需求 | 当前实现及缺口 | 完成验收条件 |\n|---|---|---|---|---|---|---|\n'
    for r in [r for r in rows if r['module']==module]:
        intro+='|'+'|'.join(r[k] for k in ('id','source','phase','status','requirement','current','acceptance'))+'|\n'
intro+='''
## 授权范围调整与R3（不计入上述分母）

| 原文/来源 | 当前处理 | 审计解释 |
|---|---|---|
| 小程序 | Android/iOS App | 用户明确改变，属于授权调整，不是偏离 |
| 面向全球 | 首期简中大陆 | 代理在模糊事项授权内的阶段选择，全球多语言多币种仍是未来范围，不能宣称全球运营完成 |
| 购买自动进入社群 | App课程讨论优先，外部群可选 | 社群目标保留；不承诺自动拉微信群，当前App课群本身也未完成 |
| 成长逐级升级会员 | 付费、成长、积分分离 | 代理解释，改变了原文获益语义；优化方案保留成长赠权益，需明确规则而不是静默删掉 |
| 商家/老师合作 | 自营审核合作，一级推广 | 不实施开放多商户入驻或多级分销；合作曝光与分成仍需实现 |
| 会员订阅 | R1手动续费 | 原文未明确自动扣款；不把套餐查询当会员购买完成 |
| P098 AI经典解读、虚拟名师、线上道场 | R3展望，未实施 | 不属于本次R1/R2承诺，不纳入未完成率；不能据此要求优先做AI |

## 证据时效和局限

- 2026-10-06历史集成测试：`outputs/ui/orders-api-tests.log`统计33通过、0失败，购物车测试日志28通过；覆盖的是当时基础/学习/购物/开发预占，不包含真实付款、直播、论坛或生产部署。
- Android0.2.2安装和购物车数量变更有历史真机截图；iOS没有构建验收证据。安装开发APK不代表正式包发布。
- 当前后台最新构建日志记录失败，未把typecheck或旧成功版本当最新部署成功。
- 本次只读数据库探测ECONNREFUSED，未重跑会写入fixture的集成测试、未启动/迁移/清理数据库，未重装手机。代码存在性与历史运行证据分开记录。
- 源码哈希和文件范围见`evidence-inventory.json`；数据库以schema与8次迁移为准，不能推断当前线上数据库已应用。
'''
(OUT/'02-requirements-completion.md').write_text(intro,encoding='utf-8')
undone=[r for r in rows if r['status']=='未完成']
txt=f'# 未完成需求独立汇总\n\n共{len(undone)}项，与完整清单逐条对应。部分实现仍算未完成；保留内容见完整清单。R3未计入。\n\n'
for module in groups:
    rs=[r for r in undone if r['module']==module]
    txt+='\n## '+module+f'（{len(rs)}项）\n\n| ID | 来源 | 阶段 | 未完成需求 | 补齐后验收 |\n|---|---|---|---|---|\n'
    for r in rs:txt+='|'+'|'.join(r[k] for k in ('id','source','phase','requirement','acceptance'))+'|\n'
(OUT/'02a-unfinished-requirements.md').write_text(txt,encoding='utf-8')
print(json.dumps(stats,ensure_ascii=False))
