@echo off
chcp 65001 > nul
setlocal
echo ========================================
echo Run WhatsApp Web Dashboard
echo ========================================
echo.

REM Ensure directories exist
if not exist baileys-server (
    echo ❌ Missing folder: baileys-server
    pause
    exit /b 1
)

if not exist web-client (
    echo ❌ Missing folder: web-client
    pause
    exit /b 1
)

REM Ensure server dependencies
if not exist baileys-server\node_modules (
    echo Installing server dependencies...
    pushd baileys-server
    call npm install
    if errorlevel 1 (
        popd
        echo ❌ Failed to install server dependencies
        pause
        exit /b 1
    )
    popd
)

REM Ensure client dependencies
if not exist web-client\node_modules (
    echo Installing web client dependencies...
    pushd web-client
    call npm install
    if errorlevel 1 (
        popd
        echo ❌ Failed to install web client dependencies
        pause
        exit /b 1
    )
    popd
)

echo [1/2] Starting Baileys API server...
pushd baileys-server
start "Baileys Server" cmd /k npm start
popd

echo ⏳ Waiting for server to warm up...
timeout /t 5 /nobreak > nul

echo [2/2] Starting web client (Vite)...
pushd web-client
start "Web Client" cmd /k npm run dev
popd

echo.
echo ✅ كل شيء يعمل الآن.
echo افتح المتصفح على: http://localhost:5173/
echo.
echo لإيقاف التشغيل أغلق نوافذ "Baileys Server" و "Web Client" يدويًا.
echo.
pause
