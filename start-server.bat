@echo off
chcp 65001 > nul
title Baileys Server
echo ========================================
echo Start Baileys Server Only
echo ========================================
echo.

if not exist baileys-server (
    echo ❌ baileys-server folder not found!
    pause
    exit /b 1
)

if not exist baileys-server\node_modules (
    echo ❌ Node.js packages not installed!
    echo Run setup.bat first
    pause
    exit /b 1
)

cd baileys-server
echo 🚀 Starting server on port 3000...
echo.
node server.js
