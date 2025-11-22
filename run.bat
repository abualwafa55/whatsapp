@echo off
chcp 65001 > nul
echo ========================================
echo Run WhatsApp Desktop App
echo ========================================
echo.

REM Check baileys-server exists
if not exist baileys-server (
    echo ❌ baileys-server folder not found!
    echo Please create Baileys Server first
    pause
    exit /b 1
)

REM Check node_modules exists
if not exist baileys-server\node_modules (
    echo ❌ Node.js packages not installed!
    echo Run setup.bat first
    pause
    exit /b 1
)

echo [1/2] Starting Baileys Server in background...
cd baileys-server
start "Baileys Server" cmd /k node server.js
cd ..

echo ⏳ Waiting for server to start...
timeout /t 5 /nobreak > nul

REM Check if server is running
echo 🔍 Checking server connection...
curl -s http://localhost:3000/ > nul 2>&1
if errorlevel 1 (
    echo ⚠️ Server may need more time to start
    timeout /t 5 /nobreak > nul
)

echo ✅ Baileys Server ready

echo.
echo [2/2] Starting Python app...
python whatsapp_app.py

echo.
echo.
echo Closing application...
echo Press any key to close Baileys Server too
pause > nul
taskkill /F /FI "WindowTitle eq Baileys Server*" > nul 2>&1
echo ✅ All processes closed
