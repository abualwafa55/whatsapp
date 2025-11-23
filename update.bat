@echo off
chcp 65001 > nul
setlocal
echo ========================================
echo Update WhatsApp Web Dashboard
echo ========================================
echo.

echo 🔄 Updating Baileys server dependencies...
pushd baileys-server
call npm install
if errorlevel 1 (
	popd
	echo ❌ Failed to update server dependencies
	pause
	exit /b 1
)
popd

echo.
echo 🔄 Updating web client dependencies...
pushd web-client
call npm install
if errorlevel 1 (
	popd
	echo ❌ Failed to update web client dependencies
	pause
	exit /b 1
)
popd

echo.
echo ✅ Update complete! You can now run .\run.bat
echo.
pause
