@echo off
REM Git index.lock cleanup script
REM Run this with administrator privileges if needed

echo Attempting to remove Git index.lock file...
del /F /Q ".git\index.lock" 2>nul

if %ERRORLEVEL% EQU 0 (
    echo Successfully removed index.lock
    echo You can now run git commands normally
) else (
    echo Failed to remove index.lock
    echo Please try one of these methods:
    echo 1. Close any Git GUI tools or IDEs that might be accessing the repository
    echo 2. Run this script as Administrator
    echo 3. Manually delete: .git\index.lock in Windows Explorer
)

pause
