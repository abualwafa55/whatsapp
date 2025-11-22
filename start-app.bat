@echo off
chcp 65001 > nul
echo ========================================
echo Start Python App Only
echo ========================================
echo.

echo ⚠️ Make sure Baileys Server is running first!
echo    If not running, execute: start-server.bat
echo.
timeout /t 3 /nobreak
python whatsapp_app.py
