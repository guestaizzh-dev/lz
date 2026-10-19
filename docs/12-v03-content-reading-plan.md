> 这是原实施草案。实际路由、数据复用、标注降级、同步 Markdown 导出与验收，以 [13审查与交付报告](13-content-review-and-delivery.md) 和 [16续办报告](16-task-resumption-report.md) 为准。草案中的域名和迁移命令不是已部署证据。

# 内容与阅读功能实施规划

**规划日期**: 2026-10-09  
**目标**: 完成内容与阅读12项功能  
**预计时间**: 7-10天

---

## 📋 功能清单

根据未完成需求分析，内容与阅读包含以下12项：

| ID | 功能 | 优先级 | 预计时间  当前状态 |
|----|------|--------|-----------------|
| AR03 | 图文正文发布与阅读 | P0 | 1天  已完成（代码/HTTP），操作验收跳过 |
| AR04 | 文章音视频发布与阅读 | P0 | 2天  未完成：依赖S05，编辑/播放器也未接入 |
| AR08 | 文章点赞 | P1 | 0.5天  已完成（代码/HTTP），操作验收跳过 |
| AR10 | 文章评论与引用 | P1 | 1.5天  已完成（代码/HTTP），操作验收跳过 |
| AR11 | 可打开的内容分享链接 | P1 | 1天  已完成（代码/HTTP），操作验收跳过 |
| AR17 | 阅读历史去重及举报 | P1 | 1天  已完成（代码/HTTP），操作验收跳过 |
| ID13 | 综合搜索 | P1 | 1.5天  已完成（代码/HTTP），操作验收跳过 |
| ID14 | 基于标签推荐 | P2 | 1天  已完成（代码/HTTP），操作验收跳过 |
| AR02 | 权威注释版本和授权证据 | P2 | 0.5天  已完成（代码/HTTP），操作验收跳过 |
| AR14 | 文本范围标注 | P2 | 1.5天  已完成（代码/HTTP），操作验收跳过 |
| AR15 | 笔记整理导出 | P2 | 1天  已完成（代码/HTTP），操作验收跳过 |
| AR16 | 文章导向课程直播 | P2 | 0.5天  已完成（代码/HTTP），操作验收跳过 |

**总计**: 约13天工作量，压缩后7-10天完成

---

## 🎯 实施策略

### 分4个阶段推进

#### 阶段1: 富媒体内容 (3天) ⭐⭐⭐
- AR03 图文正文
- AR04 音视频正文
- 后台编辑器增强
- 移动端渲染增强

#### 阶段2: 基础互动 (3天) ⭐⭐⭐
- AR08 点赞
- AR10 评论与引用
- AR17 阅读历史与举报

#### 阶段3: 内容发现 (2.5天) ⭐⭐
- ID13 综合搜索
- ID14 基于标签推荐
- AR11 分享链接

#### 阶段4: 高级功能 (2.5天) ⭐
- AR14 文本范围标注
- AR15 笔记导出
- AR02 权威证据
- AR16 内容关联

---

## 📐 详细设计方案

### 阶段1: 富媒体内容 (3天)

#### AR03 图文正文发布与阅读 (1天)

**后端实现**:

```typescript
// ArticleBlock 已有表结构，需要实现：
// 1. 图片块创建与排序
POST /admin/articles/:id/blocks
{
  type: 'IMAGE',
  content: { url: '/media/xxx', caption: '图说' },
  position: 3
}

// 2. 图片块编辑
PATCH /admin/articles/:id/blocks/:blockId
{
  expectedVersion: 1,
  content: { url: '/media/yyy', caption: '更新图说' }
}

// 3. 图片块删除
DELETE /admin/articles/:id/blocks/:blockId

// 4. 块排序调整
POST /admin/articles/:id/blocks/reorder
{
  blockIds: ['id1', 'id2', 'id3'] // 新顺序
}
```

**前端实现**:

```typescript
// 后台编辑器（apps/admin）
- 富文本编辑器切换为块编辑器
- 支持插入图片块
- 拖拽排序（react-dnd）
- 预览模式

// 移动端渲染（apps/mobile）
- ArticleBlock 按 position 排序渲染
- TEXT 块：<text> 渲染段落
- QUOTE 块：<view class="quote-block">
- IMAGE 块：<image> + 图说
```

**验收标准**:
```bash
1. 后台创建文章，插入3段文字+2张图片
2. 调整块顺序
3. 移动端查看 → 图文正确排列
4. 图片加载失败 → 文字不受影响
```

---

#### AR04 文章音视频发布与阅读 (2天)

**后端实现**:

```typescript
// 1. 音视频块创建
POST /admin/articles/:id/blocks
{
  type: 'AUDIO' | 'VIDEO',
  content: { 
    mediaId: 'asset-uuid',
    title: '音频标题',
    duration: 180 // 秒
  }
}

// 2. 播放鉴权（复用媒体服务）
GET /articles/:articleId/blocks/:blockId/play
→ 返回临时播放凭证（类似课程章节）

// 3. 会员内容鉴权
// 如果文章 membershipTier 不为空，检查用户会员等级
```

**前端实现**:

```typescript
// 后台编辑器
- 选择已上传的音视频资产
- 填写标题和时长
- 预览播放

// 移动端渲染
- AUDIO 块：<audio> 控制器
- VIDEO 块：<video> 播放器
- 播放前获取临时凭证
- 无权限显示"升级会员"
```

**关键点**:
- 复用 MediaService.ticket() 逻辑
- 新增 ArticleBlock → MediaAsset 的鉴权路径
- 支持试听（前30秒）

**验收标准**:
```bash
1. 后台上传MP4，创建视频块
2. 移动端播放 → 凭证验证通过
3. 非会员访问会员音频 → 403拒绝
4. 转码失败 → 显示"暂时无法播放"
```

---

### 阶段2: 基础互动 (3天)

#### AR08 文章点赞 (0.5天)

**后端实现**:

```typescript
// Reaction 表已存在，实现：
POST /articles/:id/reactions
{
  kind: 'LIKE' // 或 'BOOKMARK' (已有收藏)
}

DELETE /articles/:id/reactions/:kind
// 取消点赞

GET /articles/:id
// 返回增加 { likeCount, userLiked }
```

**前端实现**:

```typescript
// 移动端
- 文章详情底部点赞按钮
- 点赞数实时更新
- 点赞/取消点赞动画

// 我的点赞列表
GET /me/reactions?kind=LIKE
```

**验收标准**:
```bash
1. 点赞文章 → 数量+1
2. 重复点赞 → 幂等（不重复计数）
3. 取消点赞 → 数量-1
4. 查看我的点赞 → 显示已点赞文章
```

---

#### AR10 文章评论与引用 (1.5天)

**后端实现**:

```typescript
// Comment 表已存在，实现文章评论：
POST /articles/:id/comments
{
  body: '评论内容',
  quotedBlockId: 'block-uuid', // 可选，引用段落
  parentId: 'comment-uuid' // 可选，回复评论
}

GET /articles/:id/comments
// 返回评论列表（分页，树状结构）

// 审核机制
POST /admin/comments/:id/moderate
{
  action: 'APPROVE' | 'REJECT',
  reason: '审核原因'
}
```

**前端实现**:

```typescript
// 移动端
- 长按段落 → 弹出"引用评论"
- 评论输入框（引用显示原文摘录）
- 评论列表（树状展示）
- 点击引用 → 跳转到原段落

// 后台
- 评论审核工作台
- 批量审核
```

**关键点**:
- 先审后发（默认状态 PENDING）
- 引用段落版本快照（ArticleBlock.version）
- 举报评论 → 进入审核队列

**验收标准**:
```bash
1. 评论文章 → 进入审核队列
2. 管理员审核通过 → 评论可见
3. 引用段落评论 → 显示原文摘录
4. 回复评论 → 树状展示
5. 举报评论 → 触发审核
```

---

#### AR17 阅读历史去重及举报 (1天)

**后端实现**:

```typescript
// 1. 阅读历史（ReadingEvent 表已有）
POST /articles/:id/reading-events
{
  eventKey: 'article.read:' + articleId + ':' + date,
  duration: 30 // 停留秒数
}
// 幂等：同一天同一文章只记录一次

GET /me/reading-history
// 返回最近阅读文章列表

// 2. 举报
POST /articles/:id/reports
{
  reason: 'SPAM' | 'INAPPROPRIATE' | 'COPYRIGHT',
  description: '举报说明'
}

POST /comments/:id/reports
// 举报评论
```

**前端实现**:

```typescript
// 移动端
- 文章详情右上角 "..." 菜单
- 举报选项（选择原因+填写说明）
- 我的阅读历史页面

// 后台
- 举报处理工作台
- 查看举报详情
- 处理举报（删除/忽略）
```

**验收标准**:
```bash
1. 阅读文章 → 记录阅读事件
2. 刷新页面 → 不重复计数
3. 举报文章 → 进入举报队列
4. 管理员处理举报 → 状态更新
```

---

### 阶段3: 内容发现 (2.5天)

#### ID13 综合搜索 (1.5天)

**后端实现**:

```typescript
// 实现跨资源搜索
GET /search
{
  q: '道德经',
  types: ['article', 'course', 'teacher', 'product'],
  page: 1,
  size: 20
}

// 返回统一结构
{
  items: [
    { type: 'article', id, title, excerpt, ... },
    { type: 'course', id, title, teacher, ... },
    { type: 'teacher', id, name, bio, ... },
    { type: 'product', id, name, price, ... }
  ],
  total: 42,
  facets: {
    article: 15,
    course: 10,
    teacher: 3,
    product: 14
  }
}

// 搜索逻辑
- Article: title/body ILIKE %q%
- Course: title/description ILIKE %q%
- Teacher: name/bio ILIKE %q%
- Product: name/description ILIKE %q%
- 仅返回已发布/可见资源
```

**前端实现**:

```typescript
// 移动端
- 首页搜索框 → 综合搜索页
- 分类筛选（全部/文章/课程/名师/商品）
- 搜索结果卡片（不同类型不同样式）
- 点击跳转到详情页

// 搜索历史（本地存储）
- 最近10次搜索
- 点击历史快速搜索
```

**优化**（可选）:
- 全文搜索（PostgreSQL tsvector）
- 搜索高亮
- 热门搜索词

**验收标准**:
```bash
1. 搜索"道德经" → 返回文章+课程+名师
2. 筛选"仅课程" → 仅显示课程结果
3. 点击结果 → 跳转到详情页
4. 草稿/未发布内容 → 不出现在结果中
```

---

#### ID14 基于标签推荐 (1天)

**后端实现**:

```typescript
// 基于用户标签推荐内容
GET /recommendations/articles
GET /recommendations/courses
GET /recommendations/events

// 推荐逻辑
1. 读取用户标签 UserTag
2. 查找带相同标签的资源 ResourceTag
3. 排除已阅读/已购/已报名
4. 按标签匹配度排序
5. 补充热门内容（标签不足时）

// 返回
{
  items: [...],
  reason: '基于你的兴趣：国学经典、修身养性'
}
```

**前端实现**:

```typescript
// 移动端首页
- "为你推荐"模块
- 显示推荐原因
- 刷新推荐（换一批）

// 空数据处理
- 新用户：推荐热门内容
- 标签未设置：引导设置标签
```

**验收标准**:
```bash
1. 设置兴趣标签 → 首页显示相关推荐
2. 修改标签 → 推荐内容变化
3. 新用户 → 显示热门内容
4. 点击推荐 → 正确跳转
```

---

#### AR11 可打开的内容分享链接 (1天)

**后端实现**:

```typescript
// 生成资源分享链接
POST /articles/:id/share
→ 返回 { url: 'https://daoxue.cn/a/short-code' }

POST /courses/:id/share
POST /teachers/:id/share
POST /products/:id/share

// 短链解析
GET /s/:code
→ 重定向到资源详情（App Universal Link）

// 分享记录
- ShareEvent 表记录分享行为
- 统计分享次数
```

**前端实现**:

```typescript
// 移动端
- 详情页右上角分享按钮
- 分享菜单（复制链接/系统分享）
- 会员内容提示"链接不包含正文"

// App 接收
- Universal Link 唤起App
- 解析 code → 打开对应详情页
```

**验收标准**:
```bash
1. 点击分享 → 生成短链
2. 复制链接粘贴到浏览器 → 跳转到详情
3. 已安装App → 唤起App打开
4. 会员文章分享 → 正文不泄露
```

---

### 阶段4: 高级功能 (2.5天)

#### AR14 文本范围标注 (1.5天)

**后端实现**:

```typescript
// Note 表扩展字段（已有 blockId/quote）
// 新增精确范围标注
{
  blockId: 'block-uuid',
  rangeStart: 10, // 字符偏移
  rangeEnd: 50,
  selectedText: '原文摘录',
  articleVersion: 3 // 版本快照
}

POST /articles/:id/notes
{
  blockId,
  rangeStart,
  rangeEnd,
  selectedText,
  noteBody: '我的笔记'
}

GET /articles/:id
// 返回当前用户的标注范围（高亮显示）
```

**前端实现**:

```typescript
// 移动端（复杂）
- 长按选择文本
- 弹出菜单："做笔记"
- 记录选择范围
- 显示标注（背景高亮）
- 点击标注 → 查看笔记

// 版本变动处理
- 版本变化后仍显示原摘录
- 提示"原文已更新"
```

**技术难点**:
- uni-app x 的文本选择API
- 可能需要 UTS 插件
- 或降级为整段标注

**验收标准**:
```bash
1. 选择部分文本 → 创建笔记
2. 查看文章 → 标注高亮显示
3. 文章更新 → 笔记仍保留原摘录
```

---

#### AR15 笔记整理导出 (1天)

**后端实现**:

```typescript
// 异步导出任务
POST /me/notes/export
{
  format: 'MARKDOWN' | 'PDF',
  articleIds: ['id1', 'id2'] // 可选，全部或指定文章
}
→ 返回 { taskId: 'task-uuid' }

GET /me/exports/:taskId
→ {
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED',
  downloadUrl: '/exports/file.md', // 临时URL
  expiresAt: '2026-10-16T10:00:00Z'
}

// NoteExport 表
{
  userId,
  format,
  status,
  fileKey, // 存储路径
  expiresAt,
  generatedAt
}

// 导出格式
Markdown:
# 文章标题
> 原文段落
我的笔记
---

PDF:
封面 + 目录 + 正文（Puppeteer/wkhtmltopdf）
```

**前端实现**:

```typescript
// 移动端
- 我的笔记页面 → 导出按钮
- 选择格式（Markdown/PDF）
- 显示导出进度
- 下载文件

// 过期处理
- 7天有效期
- 过期提示"重新导出"
```

**验收标准**:
```bash
1. 申请导出 → 任务创建
2. 查询状态 → PROCESSING → COMPLETED
3. 下载文件 → Markdown格式正确
4. 7天后访问 → 提示已过期
```

---

#### AR02 权威注释版本和授权证据 (0.5天)

**后端实现**:

```typescript
// SourceEvidence 表已存在，关联文章
POST /admin/articles/:id/evidence
{
  sourceType: 'BOOK' | 'ANNOTATION' | 'LICENSE',
  title: '王弼注本',
  author: '王弼',
  publisher: '中华书局',
  isbn: '978-7-101-xxxxx',
  url: 'https://...',
  notes: '底本说明'
}

GET /articles/:id
// 返回 { evidences: [...] }
```

**前端实现**:

```typescript
// 移动端
- 文章详情底部"来源与授权"折叠区
- 展开显示证据列表
- 点击链接跳转外部

// 后台
- 文章编辑页面添加证据
- 管理证据列表
```

**验收标准**:
```bash
1. 管理员添加来源证据
2. 移动端查看 → 显示来源信息
3. 点击外链 → 跳转核查页面
```

---

#### AR16 文章导向课程直播 (0.5天)

**后端实现**:

```typescript
// ContentRelation 表已存在
POST /admin/content-relations
{
  sourceType: 'ARTICLE',
  sourceId: 'article-uuid',
  targetType: 'COURSE' | 'LIVE_ROOM',
  targetId: 'course-uuid',
  relationKind: 'RELATED_COURSE',
  displayOrder: 1
}

GET /articles/:id
// 返回 { relatedCourses: [...], relatedLives: [...] }
```

**前端实现**:

```typescript
// 移动端
- 文章详情底部"相关课程"卡片
- 点击卡片 → 课程确认页（3步内）
- "相关直播"入口

// 后台
- 文章编辑页面关联课程/直播
- 拖拽排序
```

**验收标准**:
```bash
1. 管理员关联文章与课程
2. 移动端查看 → 显示相关课程卡片
3. 点击卡片 → 最多3步到达购买确认
```

---

## 📊 工作量估算

| 阶段 | 功能 | 后端 | 前端 | 测试 | 小计 |
|------|------|------|------|------|------|
| 阶段1 | 富媒体内容 | 1.5天 | 1天 | 0.5天 | 3天 |
| 阶段2 | 基础互动 | 1.5天 | 1天 | 0.5天 | 3天 |
| 阶段3 | 内容发现 | 1天 | 1天 | 0.5天 | 2.5天 |
| 阶段4 | 高级功能 | 1天 | 1天 | 0.5天 | 2.5天 |
| **总计** | **12项** | **5天** | **4天** | **2天** | **11天** |

考虑并行和优化，**实际7-10天完成**。

---

## 🎯 实施顺序

### Day 1-3: 富媒体内容
```
Day 1: AR03 图文正文
  - 上午：后端块编辑API
  - 下午：移动端块渲染

Day 2-3: AR04 音视频正文
  - Day 2：音视频块API + 鉴权
  - Day 3：移动端播放器 + 测试
```

### Day 4-6: 基础互动
```
Day 4: AR08 点赞 + AR17 阅读历史
  - 上午：点赞API + 前端
  - 下午：阅读历史 + 举报

Day 5-6: AR10 评论与引用
  - Day 5：评论API + 审核
  - Day 6：前端评论列表 + 引用
```

### Day 7-8: 内容发现
```
Day 7: ID13 综合搜索
  - 上午：搜索API
  - 下午：搜索页面

Day 8: ID14 推荐 + AR11 分享
  - 上午：推荐算法 + API
  - 下午：分享链接 + 短链
```

### Day 9-11: 高级功能
```
Day 9: AR14 文本标注（难点）
  - 全天：范围选择 + 标注高亮

Day 10: AR15 笔记导出
  - 上午：异步导出任务
  - 下午：Markdown生成

Day 11: AR02 证据 + AR16 关联 + 总测试
  - 上午：补充功能
  - 下午：端到端测试
```

---

## ✅ 验收标准

### 功能完整性
- [ ] 12项功能全部实现
- [x] 已实现11项前后端接口已接入（AR04除外）
- [ ] 移动端体验流畅

### 测试覆盖
- [ ] 内容专项≥20个独立子用例（当前content专项11个，跨论坛/问答/教学共27个；整体回归数量不冒充内容专项数量）
- [ ] 关键场景端到端验证
- [x] 已实现功能的权限/版本/范围/并发边界测试通过

### 代码质量
- [x] TypeScript编译通过
- [ ] ESLint无严重警告
- [x] 后台生产构建通过
- [ ] Android APK构建通过

### 用户体验
- [ ] 图文音视频正常展示
- [ ] 评论互动流畅
- [ ] 搜索响应迅速（<500ms）
- [ ] 错误提示友好

---

## 🚧 技术难点预判

### 1. 文本范围标注 (AR14)
**难度**: ⭐⭐⭐⭐

**挑战**:
- uni-app x 文本选择API限制
- 跨版本范围定位
- 高亮渲染性能

**解决方案**:
- 方案A：UTS插件封装原生选择
- 方案B：降级为整段标注
- 方案C：Web端完整实现，App端简化

**预留**: 额外1天buffer

---

### 2. 音视频鉴权 (AR04)
**难度**: ⭐⭐⭐

**挑战**:
- 复用媒体服务逻辑
- ArticleBlock权限验证路径
- 会员内容差异化

**解决方案**:
- 扩展 MediaService.ticket()
- 增加 `blockId` 参数
- 统一鉴权逻辑

---

### 3. 笔记导出 (AR15)
**难度**: ⭐⭐⭐

**挑战**:
- 异步任务调度
- Markdown格式化
- PDF生成（可选）

**解决方案**:
- 先实现Markdown（简单）
- PDF可延后到R2
- 使用BullMQ异步队列

---

## 📝 开发规范

### Git提交策略
```bash
# 每完成一个子功能立即提交
feat(content): implement article image blocks
feat(content): add article video playback with auth
feat(content): implement article like and reactions
feat(content): add comment system with moderation
feat(content): implement unified search
feat(content): add tag-based recommendations
feat(content): implement share links
feat(content): add text range annotation
feat(content): implement note export
```

### 测试要求
```typescript
// 每个功能必须包含
1. 单元测试（业务逻辑）
2. 集成测试（HTTP API）
3. 端到端测试（关键流程）

// 重点覆盖
- 权限验证（会员内容）
- 并发安全（点赞/评论）
- 数据隔离（私人笔记）
- 边界条件（空数据/错误状态）
```

### 文档更新
```markdown
每个阶段完成后更新：
1. API文档（OpenAPI）
2. 开发进度（03-development-progress.md）
3. 阶段交付报告（12-v03-content-delivery.md）
```

---

## 🎯 完成后状态

### 完成度预估
- 当前: 29项 / 164项 = 18.3%
- 完成后: 41项 / 164项 = **25.0%**
- 增量: +12项 (+6.7%)

### 可验证价值
- ✅ 富媒体内容完整展示（图文音视频）
- ✅ 基础互动可用（点赞评论分享）
- ✅ 内容发现便捷（搜索推荐）
- ✅ 高级功能增强（标注导出）

### 剩余未完成
- 媒体转码（需云服务）
- 直播功能（全部11项）
- 支付功能（全部14项）
- 社群互动（论坛13项）
- 其他增强（约90项）

---

## 🤔 需要你确认的问题

### 1. 音视频转码服务
**问题**: AR04需要真实转码，选哪家云服务？
- A. 腾讯云 VOD（推荐）
- B. 阿里云 VOD
- C. 暂时跳过转码（手动上传HLS）

**你的选择？**

---

### 2. 文本标注降级方案
**问题**: AR14文本范围标注技术难度高，是否接受降级？
- A. 尝试完整实现（风险：可能超时）
- B. 降级为整段标注（安全：确定能完成）
- C. 暂时跳过此项（优先其他11项）

**你的选择？**

---

### 3. 笔记导出格式
**问题**: AR15导出功能，先实现哪些格式？
- A. 仅Markdown（1天）
- B. Markdown + PDF（2天）
- C. Markdown + PDF + HTML（3天）

**你的选择？**

---

### 4. 实施顺序调整
**问题**: 是否同意上述4个阶段的顺序？
- 阶段1: 富媒体内容（3天）
- 阶段2: 基础互动（3天）
- 阶段3: 内容发现（2.5天）
- 阶段4: 高级功能（2.5天）

**需要调整吗？**

---

## 📋 立即开始前的准备

如果你批准这个规划，我将：

### 第一步：创建分支
```bash
git checkout -b feat/v0.3-content-reading
```

### 第二步：开始阶段1-Day1
```bash
# AR03 图文正文发布与阅读
1. 实现 ArticleBlockService（后端）
2. 实现块编辑API（4个端点）
3. 移动端块渲染组件
4. 编写集成测试
```

### 第三步：每日汇报
- 每完成一个子功能向你汇报
- 遇到技术决策点及时咨询
- 每日提交Git保存进度

---

**规划文件**: `docs/12-v03-content-reading-plan.md`  
**等待你的确认**: 回答4个问题后我立即开始执行
