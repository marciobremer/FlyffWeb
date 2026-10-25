@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

echo 🔧 [%time%] Building Next.js App (App Router mode)...
call npx next build

IF ERRORLEVEL 1 (
    echo ❌ Build failed. Exiting...
    pause
    exit /b
)

echo 🔄 [%time%] Copying static assets...
IF NOT EXIST ".next\standalone\.next" mkdir ".next\standalone\.next"
IF NOT EXIST ".next\standalone\public" mkdir ".next\standalone\public"

echo ✅ Copying .next/static
xcopy /E /I /Y ".next\static" ".next\standalone\.next\static"

echo ✅ Copying public
xcopy /E /I /Y "public" ".next\standalone\public"

echo 🚀 [%time%] Restarting PM2...
pm2 delete next-app >nul 2>&1
pm2 start ".next\standalone\server.js" --name next-app --env production --interpreter node

echo ✅ [%time%] App is live: http://localhost:3000
pause
ENDLOCAL

