# Git 初始化说明

## 当前状况

Git仓库已初始化，但存在 `.git/index.lock` 文件阻止操作。这通常发生在：
- Git进程被中断
- IDE/编辑器仍在访问仓库
- 权限问题

## 解决方案（按顺序尝试）

### 方案1：运行清理脚本

```bash
cd C:\Users\l6658\Documents\ChatGPT\道学书院
scripts\fix-git-lock.bat
```

如果失败，尝试**以管理员身份运行**。

### 方案2：手动删除（推荐）

在Windows资源管理器中：
1. 导航到项目目录
2. 显示隐藏文件（查看 → 隐藏的项目）
3. 进入 `.git` 文件夹
4. 删除 `index.lock` 文件
5. 如果删除被拒绝，关闭所有可能访问该目录的程序（IDE、Git GUI工具）

### 方案3：命令行强制删除

以管理员身份打开PowerShell：

```powershell
cd "C:\Users\l6658\Documents\ChatGPT\道学书院"
Remove-Item -Force .git\index.lock
```

## 完成初始化

删除lock文件后，运行：

```bash
scripts\git-init-baseline.bat
```

这将：
1. 配置Git用户信息
2. 添加所有源文件（node_modules等已忽略）
3. 创建初始提交

## 验证成功

运行以下命令应该看到提交历史：

```bash
git log --oneline
git status
```

## 手动操作（如果脚本失败）

```bash
# 1. 配置用户
git config --local user.name "Daoxue Development"
git config --local user.email "dev@daoxue.local"

# 2. 添加文件
git add .gitignore AGENTS.md package.json pnpm-lock.yaml pnpm-workspace.yaml
git add docs/ services/ apps/ scripts/

# 3. 提交
git commit -m "chore: initial commit - project baseline"

# 4. 验证
git log --oneline
```

## 下一步

初始化完成后，创建开发分支：

```bash
git checkout -b feat/database-foundation-layer1
```

开始第一层（身份与资源）的数据库设计。
