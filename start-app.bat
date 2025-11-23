@echo off
chcp 65001 > nul
echo ========================================
echo Start Web Client Only
echo ========================================
echo.

if not exist web-client (
	echo ❌ web-client folder not found!
	pause
	exit /b 1
)

if not exist web-client\node_modules (
	echo Installing npm packages...
	pushd web-client
	call npm install
	if errorlevel 1 (
		popd
		echo ❌ Failed to install npm packages
		pause
		exit /b 1
	)
	popd
)

echo ⚠️ تأكد من تشغيل السيرفر عبر start-server.bat أولاً
echo.
pushd web-client
npm run dev
popd
