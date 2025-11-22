@echo off
chcp 65001 > nul
echo ========================================
echo Build WhatsApp Desktop App to EXE
echo ========================================
echo.

REM Check Python
python --version > nul 2>&1
if errorlevel 1 (
    echo ❌ Python not installed!
    pause
    exit /b 1
)

REM Install PyInstaller
echo [1/3] Installing PyInstaller...
pip install pyinstaller pillow requests >nul 2>&1
if errorlevel 1 (
    echo ❌ Failed to install PyInstaller
    pause
    exit /b 1
)
echo ✅ PyInstaller installed

REM Build EXE
echo.
echo [2/3] Building EXE file...
echo This may take a few minutes...
pyinstaller --onefile --windowed --name="WhatsApp-Manager" --icon=NONE --add-data="baileys-server;baileys-server" whatsapp_app.py

if errorlevel 1 (
    echo ❌ Build failed!
    pause
    exit /b 1
)
echo ✅ Build complete

REM Create distribution folder
echo.
echo [3/3] Creating distribution package...
if not exist "dist\WhatsApp-Manager-Distribution" mkdir "dist\WhatsApp-Manager-Distribution"

REM Copy files
copy "dist\WhatsApp-Manager.exe" "dist\WhatsApp-Manager-Distribution\" >nul
xcopy "baileys-server" "dist\WhatsApp-Manager-Distribution\baileys-server" /E /I /Y >nul
copy "README.md" "dist\WhatsApp-Manager-Distribution\" >nul
copy "requirements.txt" "dist\WhatsApp-Manager-Distribution\" >nul

REM Create launcher
echo @echo off > "dist\WhatsApp-Manager-Distribution\Launch-WhatsApp-Manager.bat"
echo chcp 65001 ^> nul >> "dist\WhatsApp-Manager-Distribution\Launch-WhatsApp-Manager.bat"
echo echo Starting WhatsApp Manager... >> "dist\WhatsApp-Manager-Distribution\Launch-WhatsApp-Manager.bat"
echo start WhatsApp-Manager.exe >> "dist\WhatsApp-Manager-Distribution\Launch-WhatsApp-Manager.bat"

echo ✅ Distribution package created

echo.
echo ========================================
echo ✅ Build completed successfully!
echo ========================================
echo.
echo 📁 Location: dist\WhatsApp-Manager-Distribution\
echo 📦 Files:
echo    - WhatsApp-Manager.exe
echo    - baileys-server folder
echo    - Launch-WhatsApp-Manager.bat
echo.
echo 📝 Note: You need to run 'npm install' in baileys-server folder
echo    before first use on target machine.
echo.
pause
