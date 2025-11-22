@echo off
chcp 65001 > nul
echo ========================================
echo Clear Old Sessions
echo ========================================
echo.

if not exist baileys-server\sessions (
    echo ℹ️ No sessions to delete
    pause
    exit /b 0
)

echo ⚠️ This will delete all saved sessions
echo You will need to scan QR Code again
echo.
set /p confirm="Are you sure? (y/n): "

if /i not "%confirm%"=="y" (
    echo ❌ Cancelled
    pause
    exit /b 0
)

echo.
echo 🗑️ Deleting sessions...
rd /s /q baileys-server\sessions 2>nul
echo ✅ All sessions deleted successfully!
echo.
echo Now you can run the app again
pause
