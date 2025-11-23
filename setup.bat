@echo off
chcp 65001 > nul
setlocal
echo ========================================
echo Install WhatsApp Web Dashboard
echo ========================================
echo.

REM Check Node.js
echo [1/3] Checking Node.js...
node --version > nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js not installed!
    echo Please install Node.js 20.19+ or 22.12+ from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo ✅ Using Node %NODE_VER%

REM Install Baileys server dependencies
echo.
echo [2/3] Installing API server packages...
if not exist baileys-server (
    echo ❌ Directory baileys-server غير موجود
    pause
    exit /b 1
)
pushd baileys-server
call npm install
if errorlevel 1 (
    popd
    echo ❌ Failed to install server packages
    pause
    exit /b 1
)
popd
echo ✅ Server ready

REM Install web client dependencies
echo.
echo [3/3] Installing web client packages...
if not exist web-client (
    echo ❌ Directory web-client غير موجود
    pause
    exit /b 1
)
pushd web-client
call npm install
if errorlevel 1 (
    popd
    echo ❌ Failed to install web client packages
    pause
    exit /b 1
)
popd
echo ✅ Web client ready

echo.
echo ========================================
echo ✅ Installation completed successfully!
echo ========================================
echo.
echo To run the app, use:
echo    .\run.bat   ^(يشغل السيرفر والواجهة^)
echo.
pause
