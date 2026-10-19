> 已被 [13交付报告](../13-content-review-and-delivery.md) 取代。此文件保留旧设计供审查；ShareLink新增表和文中固定域名没有作为最终实现。

# AR11 可打开的内容分享链接 - 实施说明

## 功能概述

用户可以为文章、课程、名师、商品、活动生成分享链接，复制后分享给他人。接收者点击链接后可以直接打开对应的详情页面。

## 已完成的工作

### 1. 数据库模型

在 `schema.prisma` 中添加了 `ShareLink` 模型：

```prisma
model ShareLink {
  id           String    @id @default(cuid())
  code         String    @unique
  resourceType String    @map("resource_type")
  resourceId   String    @map("resource_id")
  title        String
  description  String?
  coverUrl     String?   @map("cover_url")
  createdBy    String?   @map("created_by")
  user         User?     @relation(fields: [createdBy], references: [id])
  viewCount    Int       @default(0) @map("view_count")
  createdAt    DateTime  @default(now()) @map("created_at")
  expiresAt    DateTime? @map("expires_at")

  @@index([resourceType, resourceId])
  @@index([createdBy])
  @@index([createdAt])
  @@map("share_links")
}
```

### 2. 后端 API

创建了 `apps/api/src/share.ts`，包含：

**端点：**
- `POST /share/links` - 生成分享链接
- `GET /share/links/:code/resolve` - 解析分享链接

**DTO：**
- `CreateShareLinkDto` - 创建分享链接的请求体
- `ShareLinkDto` - 分享链接响应

**服务：**
- `ShareService` - 处理分享链接的业务逻辑
  - 使用 nanoid 生成 8 位短码
  - 检查是否已有相同资源的链接（1小时内）
  - 记录创建者和访问统计

### 3. App 前端

更新了 5 个详情页的分享功能：

- `pages/article/detail.uvue` - 文章分享
- `pages/course/detail.uvue` - 课程分享
- `pages/teacher/detail.uvue` - 名师分享
- `pages/product/detail.uvue` - 商品分享
- `pages/event/detail.uvue` - 活动分享

创建了分享链接处理页面：
- `pages/shared/index.uvue` - 解析短码并跳转到对应详情页

### 4. 数据库迁移

创建了迁移文件：
- `prisma/migrations/20261009_add_share_links/migration.sql`

## 部署步骤

### 1. 安装依赖

```bash
cd apps/api
npm install nanoid
```

### 2. 运行数据库迁移

```bash
cd apps/api
npx prisma migrate deploy
```

或者手动执行 SQL：

```bash
psql -U postgres -d daoxue_dev -f prisma/migrations/20261009_add_share_links/migration.sql
```

### 3. 更新 Prisma Client

```bash
cd apps/api
npx prisma generate
```

### 4. 重启后端服务

```bash
pnpm dev:api
```

### 5. App 端测试

在 HBuilderX 中重新编译 App：
- Web 预览：直接运行
- Android：云构建 APK 后安装

## 测试场景

### 场景 1：生成分享链接

1. 打开任意详情页（文章/课程/名师/商品/活动）
2. 点击右上角的"分享"按钮
3. 系统应显示"分享链接已复制"提示
4. 粘贴剪贴板内容，应看到类似 `https://app.daoxue.cn/s/aBcD1234` 的短链接

### 场景 2：打开分享链接

**Web 测试：**
```
http://localhost:5173/pages/shared/index?code=aBcD1234
```

**App 测试（需要配置 URL Scheme）：**
```
daoxue://shared?code=aBcD1234
```

应自动跳转到对应的详情页。

### 场景 3：重复生成

同一个资源在 1 小时内重复点击分享，应返回相同的短链接。

### 场景 4：无效链接

访问不存在的短码，应显示错误提示。

## URL Scheme 配置（可选）

要支持从外部浏览器或其他 App 打开分享链接，需要在 `manifest.json` 中配置 URL Scheme：

```json
{
  "app-plus": {
    "distribute": {
      "android": {
        "schemes": ["daoxue"]
      },
      "ios": {
        "urlschemewhitelist": ["daoxue"]
      }
    }
  }
}
```

然后在 App 启动时监听 URL：

```typescript
// App.uvue
onLaunch(options) {
  if (options.query?.code) {
    uni.navigateTo({
      url: '/pages/shared/index?code=' + options.query.code
    });
  }
}
```

## Web 端配置（可选）

如果需要支持 Web 端短链接域名（如 `https://app.daoxue.cn/s/xxx`），需要：

1. 配置 Nginx 重写规则：

```nginx
location /s/ {
  rewrite ^/s/(.+)$ /pages/shared/index?code=$1 last;
}
```

2. 或在后端添加重定向端点：

```typescript
@Get('s/:code')
async redirect(@Param('code') code: string, @Res() res: Response) {
  const link = await this.shareService.resolve(code);
  const typeMap = {
    ARTICLE: 'article',
    COURSE: 'course',
    TEACHER: 'teacher',
    PRODUCT: 'product',
    EVENT: 'event'
  };
  const path = typeMap[link.resourceType];
  res.redirect(`/pages/${path}/detail?id=${link.resourceId}`);
}
```

## 注意事项

1. **nanoid 依赖**：必须安装 `nanoid@3` 版本（支持 CommonJS）
2. **短码长度**：当前使用 8 位，预计可支持约 2000 亿个唯一链接
3. **过期策略**：当前未设置过期时间，如需要可在创建时设置 `expiresAt`
4. **访问统计**：每次解析链接时 `viewCount` 会自动 +1
5. **安全性**：短码无法预测，但不建议用于敏感内容分享

## 后续优化建议

1. **分享海报**：生成带二维码的分享图片
2. **自定义短码**：允许用户自定义短链接后缀
3. **分享统计**：记录每次分享的来源和转化数据
4. **过期管理**：定期清理过期的分享链接
5. **权限控制**：检查用户是否有权限访问分享的资源

## 相关文件

- `apps/api/src/share.ts` - 后端服务
- `apps/api/prisma/schema.prisma` - 数据模型
- `apps/mobile/pages/shared/index.uvue` - 分享链接入口页
- `apps/mobile/pages/*/detail.uvue` - 各详情页的分享功能
