@echo off
chcp 65001 > nul
title WhatsApp Manager

REM Check if server is running
tasklist /FI "WINDOWTITLE eq Baileys Server*" 2>NUL | find /I /N "cmd.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo Server is already running...
) else (
    echo Starting Baileys Server...
    cd baileys-server
    start "Baileys Server" /MIN cmd /k node server.js
    cd ..
    timeout /t 3 /nobreak >nul
)

REM Launch the app
if exist "WhatsApp-Manager.exe" (
    start "" "WhatsApp-Manager.exe"
) else (
    echo Starting Python version...
    python whatsapp_app.py
)

exit
