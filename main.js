// Desktop shell for Juniper IDE. Run with: npm start
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const page = path.join(__dirname, 'dist', 'desktop.html');

app.whenReady().then(() => {
  if (!fs.existsSync(page)) require('./build.js'); // build on first run if dist/ is missing
  Menu.setApplicationMenu(null); // the IDE draws its own menus and handles its own shortcuts
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 700, minHeight: 480,
    title: 'Juniper IDE', backgroundColor: '#1a1d23', autoHideMenuBar: true,
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(page);
  if (process.env.JUNIPER_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
});

app.on('window-all-closed', () => app.quit());
