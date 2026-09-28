@echo off
chcp 65001 >nul
echo.
echo ============================================
echo   LINE Stock Bot - Push to GitHub
echo   User: alphacho168-collab
echo ============================================
echo.

cd /d "D:\สำหรับรับงานลูกค้า\Line Stock Greenleaf"
git remote remove origin 2>nul
git remote add origin https://github.com/alphacho168-collab/line-stock-bot.git
git branch -M main

echo ============================================
echo   ใส่ GitHub Personal Access Token
echo ============================================
echo.
echo สร้าง Token ที่: https://github.com/settings/tokens
echo ติ๊กสิทธิ์: repo
echo.
set /p TOKEN="ใส่ Token: "
echo.
if "%TOKEN%"=="" (
    echo ERROR: ยังไม่ใส่ Token
    pause
    exit /b 1
)

echo กำลัง push...
git remote set-url origin https://alphacho168-collab:%TOKEN%@github.com/alphacho168-collab/line-stock-bot.git
git push -u origin main 2>&1
git remote set-url origin https://github.com/alphacho168-collab/line-stock-bot.git

echo.
echo ============================================
echo   Push เรียบร้อย! ไปตั้ง Secrets ได้เลย
echo ============================================
echo.
echo เข้า: https://github.com/alphacho168-collab/line-stock-bot/settings/secrets/actions
echo กด "New repository secret" เพิ่ม:
echo   - CF_ACCOUNT_ID
echo   - CF_API_TOKEN
echo.
pause
