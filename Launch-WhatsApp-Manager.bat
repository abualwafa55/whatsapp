@echo off
chcp 65001 > nul
title WhatsApp Manager Launcher

if not exist run.bat (
    echo ❌ لم يتم العثور على run.bat
    pause
    exit /b 1
)

echo 🚀 تشغيل لوحة الويب الجديدة...
call run.bat
