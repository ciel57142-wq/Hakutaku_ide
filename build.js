// Builds dist/index.html (and dist/local.html for testing against node_modules).
const fs = require('fs'), path = require('path');
const R = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const walk = (dir, base = dir, out = {}) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out[path.relative(base, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  }
  return out;
};
const sample = walk(path.join(__dirname, 'sample'));
const font = fs.readFileSync(path.join(__dirname, 'node_modules/monaco-editor/min/vs/base/browser/ui/codicons/codicon/codicon.ttf')).toString('base64');
const monacoCss = R('node_modules/monaco-editor/min/vs/editor/editor.main.css')
  .replace('url(../base/browser/ui/codicons/codicon/codicon.ttf)', `url(data:font/ttf;base64,${font})`);
const xtermCss = R('node_modules/@xterm/xterm/css/xterm.css');
const js = ['core.js', 'shell.js', 'seed.js', 'runner.js', 'ui.js', 'app.js', 'app2.js'].filter(f => fs.existsSync(path.join(__dirname, 'src', f)))
  .map(f => `/* ===== ${f} ===== */\n` + R('src/' + f).replace(/^'use strict';\n/, '').replace(/^if \(typeof module !== 'undefined'\).*$/m, '')).join('\n');
const safe = s => s.replace(/<\/(script|style)/gi, '<\\/$1');
function build(out, urls) {
  let html = R('src/index.html');
  const rep = (k, v) => { if (!html.includes(k)) throw new Error('missing ' + k); html = html.split(k).join(v); };
  rep('/*__MONACO_CSS__*/', monacoCss.replace(/<\/style/gi, '<\\/style'));
  rep('/*__XTERM_CSS__*/', xtermCss);
  rep('/*__APP_CSS__*/', R('src/app.css'));
  rep('/*__APP_JS__*/', safe(`'use strict';\nconst CDN = ${JSON.stringify(urls)};\nconst SAMPLE = ${JSON.stringify(sample)};\n` + js));
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'dist', out), html);
  console.log(out, (html.length / 1024).toFixed(0) + ' KB');
}
build('index.html', {
  vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs',
  xterm: 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js',
  fit: 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js',
});
// Desktop (Electron) build: libraries come from node_modules, so it works offline.
build('desktop.html', {
  vs: '../node_modules/monaco-editor/min/vs',
  xterm: '../node_modules/@xterm/xterm/lib/xterm.js',
  fit: '../node_modules/@xterm/addon-fit/lib/addon-fit.js',
});
build('local.html', {
  vs: '/node_modules/monaco-editor/min/vs',
  xterm: '/node_modules/@xterm/xterm/lib/xterm.js',
  fit: '/node_modules/@xterm/addon-fit/lib/addon-fit.js',
});
