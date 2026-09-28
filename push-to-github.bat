@echo off
chcp 65001 >nul
echo.
echo ============================================
echo   LINE Stock Bot - Push to GitHub
echo ============================================
echo.
set /p GITHUB_USER="ใส่ชื่อ GitHub ของคุณ: "
echo.
if "%GITHUB_USER%"=="" (
    echo ERROR: ยังไม่ใส่ชื่อผู้ใช้
    pause
    exit /b 1
)
echo.
cd /d "D:\สำหรับรับงานลูกค้า\Line Stock Greenleaf"
git remote remove origin 2>nul
git remote add origin https://github.com/%GITHUB_USER%/line-stock-bot.git
git branch -M main
git push -u origin main
echo.
echo ============================================
echo   Push เรียบร้อยแล้ว! %GITHUB_USER%/line-stock-bot
echo ============================================
echo.
echo ขั้นต่อไป:
echo   1. เข้า https://github.com/%GITHUB_USER%/line-stock-bot
echo   2. Settings → Secrets and variables → Actions
echo   3. กด "New repository secret" เพิ่ม 2 ตัว:
echo      - CF_ACCOUNT_ID
echo      - CF_API_TOKEN
echo.
echo สร้าง CF_API_TOKEN ที่:
echo   https://dash.cloudflare.com/profile/api-tokens
echo.
echo แล้วไปดูแท็บ Actions เพื่อเช็ค Backup!
echo.
pause
