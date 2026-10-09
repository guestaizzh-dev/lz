@echo off
REM Git baseline initialization script
REM Run this after fixing the lock file

echo ============================================
echo Git Baseline Initialization
echo ============================================
echo.

REM Check if lock exists
if exist ".git\index.lock" (
    echo ERROR: .git\index.lock still exists
    echo Please run fix-git-lock.bat first
    pause
    exit /b 1
)

echo Step 1: Configuring Git user...
git config --local user.name "Daoxue Development"
git config --local user.email "dev@daoxue.local"
echo Done.
echo.

echo Step 2: Adding files to staging...
echo - Root configuration files...
git add .gitignore AGENTS.md package.json pnpm-lock.yaml pnpm-workspace.yaml

echo - Documentation...
git add docs/

echo - Services (API)...
git add services/

echo - Apps (Mobile + Admin)...
git add apps/

echo - Build scripts...
git add scripts/
echo Done.
echo.

echo Step 3: Checking status...
git status --short
echo.

echo Step 4: Creating initial commit...
git commit -m "chore: initial commit - project baseline

- Project structure: monorepo with pnpm workspace
- Backend: NestJS 12 + Prisma 7.10 + PostgreSQL 17
- Frontend: uni-app x (蒸汽模式) + Ant Design Pro v6.0.3
- Current status: 29 tables, basic auth/content/learning implemented
- Audit date: 2026-10-09
- Completion: 27/164 requirements (16.5%%)

Next phase: Complete database foundation (144 tables target)"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================
    echo SUCCESS: Baseline committed!
    echo ============================================
    git log --oneline -1
) else (
    echo.
    echo ERROR: Commit failed
    echo Please check the error message above
)

echo.
pause
