@echo off
SETLOCAL ENABLEDELAYEDEXPANSION
title Legion Flyff - Production

cd /d "%~dp0"

echo.
echo ========================================
echo   Legion Flyff - Production Build
echo ========================================
echo.

:: 1. Install dependencies (optional - comment out if node_modules is already up to date)
echo [1/4] Installing dependencies...
call npm ci 2>nul
if errorlevel 1 call npm install
if errorlevel 1 (
    echo WARNING: npm install had issues. Continuing with existing node_modules...
)

:: 2. Build
echo.
echo [2/4] Building Next.js (production)...
call npx next build
if errorlevel 1 (
    echo.
    echo BUILD FAILED. Fix errors above and run again.
    pause
    exit /b 1
)

:: 3. Copy standalone assets (required when using output: 'standalone')
echo.
echo [3/4] Preparing standalone output...
if not exist ".next\standalone" (
    echo ERROR: .next\standalone not found. Check next.config.js has output: 'standalone'.
    pause
    exit /b 1
)
if not exist ".next\standalone\.next" mkdir ".next\standalone\.next"
if not exist ".next\standalone\public" mkdir ".next\standalone\public"
xcopy /E /I /Y ".next\static" ".next\standalone\.next\static" >nul
xcopy /E /I /Y "public" ".next\standalone\public" >nul

:: 4. Start server
echo.
echo [4/4] Starting production server...

:: Try PM2 first
where pm2 >nul 2>&1
if errorlevel 1 (
    echo PM2 not found. Starting with Node...
    cd .next\standalone
    echo.
    echo App running at http://localhost:3000
    echo Press Ctrl+C to stop.
    echo.
    node server.js
    cd ..\..
) else (
    pm2 delete next-app >nul 2>&1
    pm2 start ".next\standalone\server.js" --name next-app --env production --interpreter node
    echo.
    echo App is live: http://localhost:3000
    echo Use: pm2 status / pm2 logs next-app / pm2 stop next-app
)

echo.
pause
ENDLOCAL
