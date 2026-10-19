> 本轮设计已被用户否决，源码和当前Web预览已回滚。以下截图仅为历史，不是当前交付。

# 清墨书院 UI 审核入口

真实项目已完成本轮美化，详见[设计规范](../../docs/14-ink-academy-design.md)。[验收事实](acceptance.json)区分编译、Web操作与真机验收。

本机 App Web：<http://127.0.0.1:9071>。后台：<http://127.0.0.1:5173>。两者都使用本机开发 API 和测试内容，不是生产发布。

|页面|截图|
|---|---|
|首页|[390px](app-home.png)、[320px](app-home-320.png)、[430px](app-home-430.png)|
|学堂、发现|[学堂](app-academy.png)、[发现](app-discover.png)|
|好物、我的|[好物](app-shop.png)、[我的](app-profile.png)|
|搜索、阅读|[搜索](app-search.png)、[阅读](app-reading.png)、[21px正文](app-reading-large.png)|
|课程、商品|[课程](app-course.png)、[商品](app-product.png)|
|名师|[列表](app-teachers.png)、[详情](app-teacher-detail.png)|
|会员、空状态|[会员](app-membership.png)、[活动](app-events-state.png)、[社区](app-community-state.png)|
|登录|[App](app-login.png)、[后台](admin-login.png)|

已完成后端109项回归、Web与Android蒸汽字节码编译、后台正式构建。APK和管理员登录后的截图状态以验收JSON的最终记录为准；截图不代替真机验收。
