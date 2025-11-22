@echo off
chcp 65001 > nul
echo ========================================
echo Update WhatsApp Manager
echo ========================================
echo.

echo Installing Python packages...
pip install Pillow requests qrcode pyinstaller

echo.
echo Installing Node.js packages...
cd baileys-server
npm install qrcode
cd ..

echo.
echo ✅ Update complete!
echo.
echo New Features:
echo - QR Code now shows as image in the app
echo - No more CMD window needed
echo - Better user experience
echo.
pause
