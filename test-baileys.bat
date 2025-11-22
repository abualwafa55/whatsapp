@echo off
chcp 65001 > nul
echo ========================================
echo Basic Baileys Test
echo ========================================
echo.

cd baileys-server

if not exist node_modules (
    echo ❌ Packages not installed!
    echo Run setup.bat first
    pause
    exit /b 1
)

echo 🧪 Running simple Baileys test...
echo.
echo Note: QR Code will appear in Terminal
echo Scan it quickly from WhatsApp app
echo.
pause
node test-simple.js
