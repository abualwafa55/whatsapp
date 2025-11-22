@echo off
chcp 65001 > nul
echo ========================================
echo Install WhatsApp Desktop App
echo ========================================
echo.

REM Check Python
echo [1/4] Checking Python...
python --version > nul 2>&1
if errorlevel 1 (
    echo ❌ Python not installed!
    echo Please install Python from: https://www.python.org/downloads/
    pause
    exit /b 1
)
echo ✅ Python installed

REM Check Node.js
echo.
echo [2/4] Checking Node.js...
node --version > nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js not installed!
    echo Please install Node.js from: https://nodejs.org/
    pause
    exit /b 1
)
echo ✅ Node.js installed

REM Install Python libraries
echo.
echo [3/4] Installing Python libraries...
python -m pip install --upgrade pip >nul 2>&1
pip install requests Pillow qrcode
if errorlevel 1 (
    echo ❌ Failed to install Python libraries
    pause
    exit /b 1
)
echo ✅ Python libraries installed

REM Setup Baileys Server
echo.
echo [4/4] Setting up Baileys Server...
if not exist baileys-server (
    echo ⚠️ baileys-server folder not found
    echo You need to create baileys-server folder and its files manually
    echo Check README.md for details
    pause
) else (
    cd baileys-server
    echo Installing Node.js packages...
    call npm install
    if errorlevel 1 (
        echo ❌ Failed to install Node.js packages
        cd ..
        pause
        exit /b 1
    )
    cd ..
    echo ✅ Baileys Server setup complete
)

echo.
echo ========================================
echo ✅ Installation completed successfully!
echo ========================================
echo.
echo To run the app, use:
echo    .\run.bat
echo.
pause
