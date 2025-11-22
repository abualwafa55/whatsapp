@echo off
chcp 65001 > nul
title WhatsApp Manager - Installation Wizard
color 0A

echo.
echo ╔════════════════════════════════════════════════════════╗
echo ║                                                        ║
echo ║     WhatsApp Manager - Installation Wizard            ║
echo ║     Version 1.0.0 - Windows 11 Compatible             ║
echo ║                                                        ║
echo ╚════════════════════════════════════════════════════════╝
echo.
timeout /t 2 /nobreak >nul

REM Check Windows version
echo [■□□□□] Checking system requirements...
ver | findstr /i "10\.0\." > nul
if errorlevel 1 (
    echo ❌ This installer requires Windows 10 or later
    pause
    exit /b 1
)
echo ✅ Windows version compatible
timeout /t 1 /nobreak >nul

REM Check Node.js
echo.
echo [■■□□□] Checking Node.js installation...
node --version > nul 2>&1
if errorlevel 1 (
    echo.
    echo ⚠️ Node.js is not installed!
    echo.
    echo Node.js is required to run WhatsApp Manager.
    echo.
    set /p install_node="Would you like to download Node.js installer? (Y/N): "
    if /i "%install_node%"=="Y" (
        start https://nodejs.org/en/download/
        echo.
        echo Please install Node.js and run this installer again.
        pause
        exit /b 1
    ) else (
        echo Installation cancelled.
        pause
        exit /b 1
    )
)
echo ✅ Node.js is installed
timeout /t 1 /nobreak >nul

REM Check npm
echo.
echo [■■■□□] Checking npm...
npm --version > nul 2>&1
if errorlevel 1 (
    echo ❌ npm not found!
    pause
    exit /b 1
)
echo ✅ npm is available
timeout /t 1 /nobreak >nul

REM Install Node.js dependencies
echo.
echo [■■■■□] Installing Node.js packages...
echo This may take a few minutes...
cd baileys-server
call npm install --silent
if errorlevel 1 (
    echo ❌ Failed to install Node.js packages
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✅ Node.js packages installed
timeout /t 1 /nobreak >nul

REM Create desktop shortcut
echo.
echo [■■■■■] Creating shortcuts...

REM Create start menu shortcut
set SHORTCUT_PATH="%APPDATA%\Microsoft\Windows\Start Menu\Programs\WhatsApp Manager.lnk"
powershell -Command "$WS = New-Object -ComObject WScript.Shell; $SC = $WS.CreateShortcut('%SHORTCUT_PATH%'); $SC.TargetPath = '%CD%\Launch-WhatsApp-Manager.bat'; $SC.WorkingDirectory = '%CD%'; $SC.Description = 'WhatsApp Manager Desktop App'; $SC.Save()"

REM Create desktop shortcut
set DESKTOP_SHORTCUT="%USERPROFILE%\Desktop\WhatsApp Manager.lnk"
powershell -Command "$WS = New-Object -ComObject WScript.Shell; $SC = $WS.CreateShortcut('%DESKTOP_SHORTCUT%'); $SC.TargetPath = '%CD%\Launch-WhatsApp-Manager.bat'; $SC.WorkingDirectory = '%CD%'; $SC.Description = 'WhatsApp Manager Desktop App'; $SC.Save()"

echo ✅ Shortcuts created
timeout /t 1 /nobreak >nul

REM Create uninstaller
echo.
echo Creating uninstaller...
echo @echo off > uninstall.bat
echo title WhatsApp Manager - Uninstall >> uninstall.bat
echo echo Uninstalling WhatsApp Manager... >> uninstall.bat
echo del "%%USERPROFILE%%\Desktop\WhatsApp Manager.lnk" 2^>nul >> uninstall.bat
echo del "%%APPDATA%%\Microsoft\Windows\Start Menu\Programs\WhatsApp Manager.lnk" 2^>nul >> uninstall.bat
echo rd /s /q baileys-server\sessions 2^>nul >> uninstall.bat
echo rd /s /q baileys-server\node_modules 2^>nul >> uninstall.bat
echo echo Uninstall complete! >> uninstall.bat
echo pause >> uninstall.bat

echo ✅ Uninstaller created
timeout /t 1 /nobreak >nul

REM Installation complete
cls
echo.
echo ╔════════════════════════════════════════════════════════╗
echo ║                                                        ║
echo ║          Installation Completed Successfully!         ║
echo ║                                                        ║
echo ╚════════════════════════════════════════════════════════╝
echo.
echo ✅ WhatsApp Manager has been installed!
echo.
echo 📍 Installation Location: %CD%
echo.
echo 🚀 Launch Options:
echo    1. Double-click "WhatsApp Manager" shortcut on Desktop
echo    2. Find it in Start Menu
echo    3. Run Launch-WhatsApp-Manager.bat
echo.
echo 📝 Important Notes:
echo    - First launch may take a few seconds
echo    - Make sure port 3000 is not in use
echo    - Keep this folder, don't delete it!
echo.
echo 🗑️ To Uninstall:
echo    - Run uninstall.bat
echo.
set /p launch="Would you like to launch WhatsApp Manager now? (Y/N): "
if /i "%launch%"=="Y" (
    echo.
    echo Launching WhatsApp Manager...
    timeout /t 2 /nobreak >nul
    start Launch-WhatsApp-Manager.bat
)

echo.
echo Thank you for installing WhatsApp Manager!
echo.
pause
