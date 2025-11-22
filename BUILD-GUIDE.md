# WhatsApp Manager - Packaging Guide

## 📦 How to Build EXE

### Option 1: Using build-exe.bat (Recommended)
```bash
.\build-exe.bat
```

This will:
- Install PyInstaller
- Build the EXE file
- Create distribution package in `dist\WhatsApp-Manager-Distribution\`

### Option 2: Manual Build
```bash
pip install pyinstaller
pyinstaller --onefile --windowed --name="WhatsApp-Manager" whatsapp_app.py
```

## 🎯 Distribution Package Contents

After building, you'll get:
```
WhatsApp-Manager-Distribution/
├── WhatsApp-Manager.exe          # Main application
├── Launch-WhatsApp-Manager.bat   # Launcher script
├── installer-win11.bat            # Windows 11 installer
├── baileys-server/                # API server files
│   ├── server.js
│   ├── package.json
│   └── test-simple.js
├── config.json                    # Configuration file
└── README.md                      # Documentation
```

## 🚀 Installation on Target Machine (Windows 11)

### For End Users:

1. **Extract the package** to any folder (e.g., `C:\Program Files\WhatsApp-Manager\`)

2. **Run installer:**
   ```
   Right-click installer-win11.bat → Run as Administrator
   ```

3. **Follow the wizard:**
   - It will check Node.js installation
   - Install npm packages automatically
   - Create desktop and start menu shortcuts
   - Create uninstaller

4. **Launch the app:**
   - Double-click desktop shortcut, OR
   - Find in Start Menu, OR
   - Run `Launch-WhatsApp-Manager.bat`

## ⚙️ System Requirements

- Windows 10/11 (64-bit)
- Node.js 14.0 or higher
- 4 GB RAM minimum
- 500 MB free disk space

## 📋 Configuration

Edit `config.json` to customize:
- API port (default: 3000)
- UI theme colors
- Auto-start behavior
- Session settings
- Logging preferences

## 🔧 Advanced Options

### Silent Installation
```bash
installer-win11.bat /silent
```

### Custom Install Location
Edit `installer-win11.bat` and change the `%CD%` path

### Portable Mode
Simply run `WhatsApp-Manager.exe` without installing
(Requires Node.js pre-installed and `npm install` in baileys-server folder)

## 🗑️ Uninstallation

Run `uninstall.bat` or manually:
1. Delete desktop shortcut
2. Delete start menu shortcut
3. Delete application folder

## 📝 Notes

- First launch may take 5-10 seconds
- Port 3000 must be available
- Internet connection required
- WhatsApp account needed for pairing

## 🐛 Troubleshooting

**EXE doesn't start:**
- Check if Node.js is installed
- Verify port 3000 is free
- Run as Administrator

**Server connection failed:**
- Ensure baileys-server folder exists
- Run `npm install` in baileys-server folder
- Check Windows Firewall settings

**QR Code not showing:**
- Restart the application
- Clear sessions: `.\clear-sessions.bat`
- Check server logs in terminal

## 📞 Support

For issues and updates, check the GitHub repository or documentation.
