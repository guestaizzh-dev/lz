# 数据库现状字典（源码证据）

审计日期：2026-10-09。共 29 个 Prisma 模型、8 个枚举、8 次迁移。

本次只读数据库连接返回 ECONNREFUSED，未核实实际实例的迁移、索引和约束是否已应用。下列是源码设计，不是生产数据库导出。完整 SQL 见 [database-current-migrations.sql](database-current-migrations.sql)，保留数据库特有约束。

## 读取规则

String→text，Int→integer，Boolean→boolean，DateTime→timestamp(3) without time zone，Json→jsonb，String[]→text[]，Role[]→Role[]。`?`表示可空。uuid()是Prisma生成字符串ID，不代表数据库列是uuid或有gen_random_uuid()默认值。@updatedAt由Prisma更新，并非数据库触发器。带模型类型的字段是关系虚拟字段，不占物理列。外键字段按下表及迁移认定，未声明关联的articleId/mediaId等不擅自补上外键。

## 枚举

- **Role**：USER, TEACHER, OPERATOR, MODERATOR, SUPPORT, FINANCE, ADMIN

- **AccountStatus**：ACTIVE, FROZEN, DELETED

- **PublishStatus**：DRAFT, REVIEW, PUBLISHED, REJECTED, ARCHIVED

- **Visibility**：PUBLIC, MEMBER

- **CourseFormat**：VIDEO, AUDIO, LIVE, COHORT, OFFLINE

- **ProductType**：PHYSICAL, DIGITAL, SERVICE

- **LessonFormat**：TEXT, VIDEO, AUDIO

- **OrderStatus**：PENDING, CLOSED

## User

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| phone | text | 是 | 是 | @unique |
| username | text | 是 | 是 | @unique |
| passwordHash | text | 是 | 是 | — |
| nickname | text | 否 | 否 | — |
| avatar | text | 是 | 是 | — |
| tags | text[] | 否 | 是 | — |
| roles | Role[] | 否 | 是 | @default([USER]) |
| status | AccountStatus | 否 | 否 | @default(ACTIVE) |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：无额外声明

关系（非物理列）：

- `sessions AuthSession[]`
- `notes Note[]`
- `favorites Favorite[]`
- `practiceLogs PracticeLog[]`
- `enrollments Enrollment[]`
- `memberships Membership[]`
- `studyProgress StudyProgress[]`
- `studyEvents StudyEvent[]`
- `addresses Address[]`
- `cartItems CartItem[]`
- `orders Order[]`

## AuthSession

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| userId | text | 否 | 否 | — |
| accessHash | text | 否 | 否 | @unique |
| accessExpiresAt | timestamp(3) | 否 | 否 | — |
| refreshHash | text | 否 | 否 | @unique |
| csrfToken | text | 否 | 否 | — |
| expiresAt | timestamp(3) | 否 | 否 | — |
| revokedAt | timestamp(3) | 是 | 是 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| kind | text | 否 | 否 | @default("ADMIN") |

索引/复合约束：`@@index([userId, revokedAt])`

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id])`
- `consumedTokens ConsumedRefresh[]`

## OtpChallenge

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| phone | text | 否 | 否 | — |
| codeHash | text | 否 | 否 | — |
| attempts | integer | 否 | 否 | @default(0) |
| consumedAt | timestamp(3) | 是 | 是 | — |
| expiresAt | timestamp(3) | 否 | 否 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |

索引/复合约束：`@@index([phone, createdAt])`

关系（非物理列）：

无 Prisma 关联；字符串资源引用不等于外键。

## Note

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| userId | text | 否 | 否 | — |
| articleId | text | 否 | 否 | — |
| articleTitle | text | 否 | 否 | — |
| articleVersion | integer | 否 | 否 | — |
| blockId | text | 否 | 否 | — |
| quote | text | 否 | 否 | — |
| text | text | 否 | 否 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：`@@index([userId, updatedAt])`

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id])`

## Favorite

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| userId | text | 否 | 否 | — |
| articleId | text | 否 | 否 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |

索引/复合约束：`@@unique([userId, articleId])`

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id])`

## PracticeLog

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| userId | text | 否 | 否 | — |
| day | text | 否 | 否 | — |
| text | text | 否 | 否 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：`@@unique([userId, day])`

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id])`

## ConsumedRefresh

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| hash | text | 否 | 否 | @id |
| sessionId | text | 否 | 否 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |

索引/复合约束：无额外声明

关系（非物理列）：

- `session AuthSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)`

## AuditLog

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| actorId | text | 否 | 否 | — |
| action | text | 否 | 否 | — |
| resource | text | 否 | 否 | — |
| resourceId | text | 是 | 是 | — |
| changes | jsonb | 否 | 否 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |

索引/复合约束：`@@index([resource, resourceId, createdAt])`

关系（非物理列）：

无 Prisma 关联；字符串资源引用不等于外键。

## RateLimit

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| key | text | 否 | 否 | @id |
| count | integer | 否 | 否 | — |
| expiresAt | timestamp(3) | 否 | 否 | — |

索引/复合约束：无额外声明

关系（非物理列）：

无 Prisma 关联；字符串资源引用不等于外键。

## Teacher

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| version | integer | 否 | 否 | @default(1) |
| name | text | 否 | 否 | — |
| title | text | 否 | 否 | — |
| bio | text | 否 | 否 | — |
| portrait | text | 是 | 是 | — |
| expertise | text[] | 否 | 是 | — |
| status | PublishStatus | 否 | 否 | @default(DRAFT) |
| isDemo | boolean | 否 | 否 | @default(false) |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：无额外声明

关系（非物理列）：

- `courses Course[]`

## Article

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| version | integer | 否 | 否 | @default(1) |
| title | text | 否 | 否 | — |
| summary | text | 否 | 否 | — |
| category | text | 否 | 否 | — |
| author | text | 否 | 否 | — |
| source | text | 否 | 否 | — |
| cover | text | 否 | 否 | — |
| blocks | jsonb | 否 | 否 | — |
| tags | text[] | 否 | 是 | — |
| visibility | Visibility | 否 | 否 | @default(PUBLIC) |
| membershipTier | integer | 否 | 否 | @default(1) |
| status | PublishStatus | 否 | 否 | @default(DRAFT) |
| isDemo | boolean | 否 | 否 | @default(false) |
| featured | boolean | 否 | 否 | @default(false) |
| publishedAt | timestamp(3) | 是 | 是 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：`@@index([status, publishedAt])`

关系（非物理列）：

无 Prisma 关联；字符串资源引用不等于外键。

## Course

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| version | integer | 否 | 否 | @default(1) |
| publishedReleaseId | text | 是 | 是 | — |
| membershipTier | integer | 是 | 是 | — |
| accessDays | integer | 是 | 是 | — |
| refundPolicy | text | 否 | 否 | @default("未开始学习可申请退款，具体以订单售前规则为准") |
| title | text | 否 | 否 | — |
| subtitle | text | 否 | 否 | — |
| description | text | 否 | 否 | — |
| category | text | 否 | 否 | — |
| format | CourseFormat | 否 | 否 | @default(VIDEO) |
| cover | text | 否 | 否 | — |
| price | integer | 否 | 否 | — |
| chaptersCount | integer | 否 | 否 | @default(0) |
| durationMinutes | integer | 否 | 否 | @default(0) |
| tags | text[] | 否 | 是 | — |
| teacherId | text | 否 | 否 | — |
| status | PublishStatus | 否 | 否 | @default(DRAFT) |
| featured | boolean | 否 | 否 | @default(false) |
| isDemo | boolean | 否 | 否 | @default(false) |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：`@@index([status, category])`

关系（非物理列）：

- `teacher Teacher @relation(fields: [teacherId], references: [id])`
- `chapters CourseChapter[]`
- `releases CourseRelease[]`
- `enrollments Enrollment[]`

## CourseChapter

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| courseId | text | 否 | 否 | — |
| title | text | 否 | 否 | — |
| position | integer | 否 | 否 | — |
| format | LessonFormat | 否 | 否 | — |
| body | text | 否 | 否 | @default("") |
| mediaId | text | 是 | 是 | — |
| durationSeconds | integer | 否 | 否 | @default(0) |
| trial | boolean | 否 | 否 | @default(false) |
| required | boolean | 否 | 否 | @default(true) |

索引/复合约束：`@@unique([courseId, position])`

关系（非物理列）：

- `course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)`

## CourseRelease

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| courseId | text | 否 | 否 | — |
| version | integer | 否 | 否 | — |
| title | text | 否 | 否 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |

索引/复合约束：`@@unique([courseId, version])`

关系（非物理列）：

- `course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)`
- `lessons Lesson[]`
- `enrollments Enrollment[]`

## Lesson

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| releaseId | text | 否 | 否 | — |
| sourceId | text | 否 | 否 | — |
| title | text | 否 | 否 | — |
| position | integer | 否 | 否 | — |
| format | LessonFormat | 否 | 否 | — |
| body | text | 否 | 否 | — |
| mediaId | text | 是 | 是 | — |
| durationSeconds | integer | 否 | 否 | — |
| trial | boolean | 否 | 否 | — |
| required | boolean | 否 | 否 | — |

索引/复合约束：`@@unique([releaseId, position])`

关系（非物理列）：

- `release CourseRelease @relation(fields: [releaseId], references: [id], onDelete: Cascade)`
- `progress StudyProgress[]`
- `events StudyEvent[]`

## Enrollment

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| userId | text | 否 | 否 | — |
| courseId | text | 否 | 否 | — |
| releaseId | text | 否 | 否 | — |
| source | text | 否 | 否 | — |
| expiresAt | timestamp(3) | 是 | 是 | — |
| revokedAt | timestamp(3) | 是 | 是 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |

索引/复合约束：`@@unique([userId, courseId])`

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
- `course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)`
- `release CourseRelease @relation(fields: [releaseId], references: [id])`

## MembershipPlan

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| title | text | 否 | 否 | — |
| tier | integer | 否 | 否 | — |
| days | integer | 否 | 否 | — |
| price | integer | 否 | 否 | — |
| description | text | 否 | 否 | — |
| active | boolean | 否 | 否 | @default(false) |

索引/复合约束：`@@unique([tier, days])`

关系（非物理列）：

- `memberships Membership[]`

## Membership

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| userId | text | 否 | 否 | — |
| planId | text | 否 | 否 | — |
| tier | integer | 否 | 否 | — |
| startsAt | timestamp(3) | 否 | 否 | — |
| endsAt | timestamp(3) | 否 | 否 | — |
| source | text | 否 | 否 | — |
| revokedAt | timestamp(3) | 是 | 是 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |

索引/复合约束：`@@index([userId, startsAt, endsAt])`

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
- `plan MembershipPlan @relation(fields: [planId], references: [id])`

## StudyProgress

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| userId | text | 否 | 否 | — |
| lessonId | text | 否 | 否 | — |
| positionSeconds | integer | 否 | 否 | @default(0) |
| watchedSeconds | integer | 否 | 否 | @default(0) |
| completedAt | timestamp(3) | 是 | 是 | — |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：`@@unique([userId, lessonId])`

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
- `lesson Lesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)`

## StudyEvent

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id |
| userId | text | 否 | 否 | — |
| lessonId | text | 否 | 否 | — |
| payloadHash | text | 否 | 否 | — |
| result | jsonb | 否 | 否 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |

索引/复合约束：无额外声明

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
- `lesson Lesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)`

## MediaAsset

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| storageKey | text | 否 | 否 | @unique |
| name | text | 否 | 否 | — |
| mime | text | 否 | 否 | — |
| bytes | integer | 否 | 否 | — |
| uploaderId | text | 否 | 否 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |

索引/复合约束：无额外声明

关系（非物理列）：

无 Prisma 关联；字符串资源引用不等于外键。

## Product

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| version | integer | 否 | 否 | @default(1) |
| title | text | 否 | 否 | — |
| subtitle | text | 否 | 否 | — |
| description | text | 否 | 否 | — |
| category | text | 否 | 否 | — |
| type | ProductType | 否 | 否 | @default(PHYSICAL) |
| cover | text | 否 | 否 | — |
| price | integer | 否 | 否 | — |
| culturalOrigin | text | 否 | 否 | — |
| status | PublishStatus | 否 | 否 | @default(DRAFT) |
| featured | boolean | 否 | 否 | @default(false) |
| isDemo | boolean | 否 | 否 | @default(false) |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：`@@index([status, category])`

关系（非物理列）：

- `skus ProductSku[]`

## ProductSku

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| productId | text | 否 | 否 | — |
| title | text | 否 | 否 | — |
| price | integer | 否 | 否 | — |
| stock | integer | 否 | 否 | @default(0) |
| reserved | integer | 否 | 否 | @default(0) |
| active | boolean | 否 | 否 | @default(false) |
| version | integer | 否 | 否 | @default(1) |

索引/复合约束：`@@index([productId, active])`

关系（非物理列）：

- `product Product @relation(fields: [productId], references: [id], onDelete: Cascade)`
- `cartItems CartItem[]`
- `orderItems OrderItem[]`

## DeliveryZone

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| province | text | 否 | 否 | @id |
| fee | integer | 否 | 否 | — |
| surcharge | integer | 否 | 否 | @default(0) |
| freeAbove | integer | 是 | 是 | — |
| enabled | boolean | 否 | 否 | @default(false) |
| version | integer | 否 | 否 | @default(1) |

索引/复合约束：无额外声明

关系（非物理列）：

无 Prisma 关联；字符串资源引用不等于外键。

## Order

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| userId | text | 否 | 否 | — |
| requestId | text | 否 | 否 | — |
| requestHash | text | 否 | 否 | — |
| status | OrderStatus | 否 | 否 | @default(PENDING) |
| address | jsonb | 否 | 否 | — |
| subtotal | integer | 否 | 否 | — |
| shipping | integer | 否 | 否 | — |
| total | integer | 否 | 否 | — |
| quoteId | text | 否 | 否 | — |
| expiresAt | timestamp(3) | 否 | 否 | — |
| closedAt | timestamp(3) | 是 | 是 | — |
| closeReason | text | 是 | 是 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |

索引/复合约束：`@@unique([userId, requestId])`; `@@index([status, expiresAt])`; `@@index([userId, createdAt])`

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id])`
- `items OrderItem[]`

## OrderItem

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| orderId | text | 否 | 否 | — |
| skuId | text | 否 | 否 | — |
| productId | text | 否 | 否 | — |
| title | text | 否 | 否 | — |
| skuTitle | text | 否 | 否 | — |
| cover | text | 否 | 否 | — |
| unitPrice | integer | 否 | 否 | — |
| quantity | integer | 否 | 否 | — |
| subtotal | integer | 否 | 否 | — |

索引/复合约束：`@@unique([orderId, skuId])`

关系（非物理列）：

- `order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)`
- `sku ProductSku @relation(fields: [skuId], references: [id])`

## CartItem

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| userId | text | 否 | 否 | — |
| skuId | text | 否 | 否 | — |
| quantity | integer | 否 | 否 | — |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：`@@unique([userId, skuId])`

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
- `sku ProductSku @relation(fields: [skuId], references: [id], onDelete: Cascade)`

## Address

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| userId | text | 否 | 否 | — |
| recipient | text | 否 | 否 | — |
| phone | text | 否 | 否 | — |
| province | text | 否 | 否 | — |
| city | text | 否 | 否 | — |
| district | text | 否 | 否 | — |
| detail | text | 否 | 否 | — |
| isDefault | boolean | 否 | 否 | @default(false) |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：`@@index([userId, isDefault])`

关系（非物理列）：

- `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`

## Event

| 字段 | PostgreSQL类型 | Prisma可空 | 迁移SQL可空 | 主键/唯一/默认/更新规则 |
|---|---|---|---|---|
| id | text | 否 | 否 | @id @default(uuid()) |
| title | text | 否 | 否 | — |
| description | text | 否 | 否 | — |
| category | text | 否 | 否 | — |
| cover | text | 否 | 否 | — |
| location | text | 否 | 否 | — |
| startsAt | timestamp(3) | 否 | 否 | — |
| endsAt | timestamp(3) | 否 | 否 | — |
| capacity | integer | 否 | 否 | — |
| price | integer | 否 | 否 | — |
| status | PublishStatus | 否 | 否 | @default(DRAFT) |
| isDemo | boolean | 否 | 否 | @default(false) |
| createdAt | timestamp(3) | 否 | 否 | @default(now()) |
| updatedAt | timestamp(3) | 否 | 否 | @updatedAt |

索引/复合约束：`@@index([status, startsAt])`

关系（非物理列）：

无 Prisma 关联；字符串资源引用不等于外键。

## 迁移中特有的约束与缺口

- Address_one_default_per_user：userId 条件唯一索引，WHERE isDefault=true；Prisma未表达，迁移时必须保留。
- ProductSku_inventory_check：stock≥reserved≥0；price≥0。stock当前表示尚未消耗的总库存，可售=stock-reserved，不是单独可售列。
- CartItem、OrderItem：quantity∈[1,99]。OrderItem subtotal=unitPrice×quantity。
- Order：subtotal、shipping≥0；total=subtotal+shipping；status=CLOSED 当且仅当 closedAt 非空。DeliveryZone运费/附加费/免邮门槛非负。
- 这些CHECK来自迁移；其他业务规则主要在服务代码，不能声称均有数据库CHECK。
- Note.articleId / Favorite.articleId、Article.author、Course.publishedReleaseId、Chapter/Lesson.mediaId、MediaAsset.uploaderId、AuditLog.actorId、OrderItem.productId未全部建立Prisma外键；快照字段与关系字段必须区分。
- AuthSession.kind为字符串；Order仅PENDING/CLOSED；没有支付、发货、售后与财务实体；Event只有目录定义，没有席位与报名记录。
- 金额现为integer分，完整交易及账本建议迁至bigint分；当前DateTime无时区，迁移需明确旧数据采用UTC还是本地，不能直接猜。
- Note保留标题/版本/引用是正确的历史快照；目标设计仍保留，不应按文章最新版本覆写。

## 迁移清单

- 20261006035656_catalog_foundation
- 20261006040323_admin_identity_audit
- 20261006041548_app_identity_private_data
- 20261006041655_note_source_version
- 20261006075056_learning_membership_media
- 20261006080308_teacher_version
- 20261006102000_shopping_cart_addresses
- 20261006111500_pending_orders

Prisma必填数组不等于SQL NOT NULL：User.tags/roles、Teacher.expertise、Article.tags、Course.tags的迁移声明未设NOT NULL，物理层可空。API通常赋数组，仍需处理历史NULL；目标采用关系表或NOT NULL默认空数组。
