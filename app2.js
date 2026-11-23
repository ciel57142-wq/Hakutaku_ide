'use strict';
/* App part 2: editor setup, panel, terminal, status bar, pages, commands, menus, boot. */
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const THEMES = [['dark', 'Juniper Dark'], ['light', 'Juniper Light'], ['nightfall', 'Nightfall']];
const TOKENS = {
  dark: { comment: '6b7689', keyword: '8fb1ec', string: 'a9cf9d', number: 'e2b877', regexp: 'e08f8f', type: '7fd1c7', tag: 'e08f8f', attr: 'e2b877', delim: '9aa3b3' },
  light: { comment: '7a8496', keyword: '2f5fb3', string: '2d7a43', number: 'a05f08', regexp: 'b33a3a', type: '0f7a72', tag: 'b33a3a', attr: 'a05f08', delim: '566072' },
};

/* ---------- editor ---------- */
function editorOptions() {
  const s = S.settings;
  return {
    fontFamily: cssVar('--font-mono'), fontSize: s.fontSize, lineHeight: Math.round(s.fontSize * 1.55), fontLigatures: s.ligatures,
    wordWrap: s.wordWrap ? 'on' : 'off', minimap: { enabled: s.minimap }, lineNumbers: s.lineNumbers ? 'on' : 'off',
    renderWhitespace: s.whitespace ? 'all' : 'selection', tabSize: s.tabSize, insertSpaces: true,
  };
}
function applyTheme() {
  const name = S.settings.theme;
  document.documentElement.dataset.ideTheme = name;
  if (S.monacoReady) {
    const t = TOKENS[name === 'light' ? 'light' : 'dark'];
    const rule = (token, color, fontStyle) => ({ token, foreground: color, fontStyle });
    monaco.editor.defineTheme('juniper', {
      base: name === 'light' ? 'vs' : 'vs-dark', inherit: true,
      rules: [
        rule('comment', t.comment, 'italic'), rule('keyword', t.keyword), rule('string', t.string), rule('number', t.number), rule('regexp', t.regexp),
        rule('type', t.type), rule('type.identifier', t.type), rule('tag', t.tag), rule('metatag', t.tag), rule('attribute.name', t.attr), rule('attribute.value', t.string),
        rule('delimiter', t.delim), rule('string.key.json', t.keyword), rule('string.value.json', t.string), rule('constant', t.number), rule('variable.predefined', t.type),
      ],
      colors: {
        'editor.background': cssVar('--bg-editor'), 'editor.foreground': cssVar('--fg'),
        'editorLineNumber.foreground': cssVar('--fg-dim') + 'aa', 'editorLineNumber.activeForeground': cssVar('--fg-strong'),
        'editorCursor.foreground': cssVar('--accent'), 'editor.lineHighlightBackground': cssVar('--bg-hover'), 'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': cssVar('--bg-select-strong'), 'editor.inactiveSelectionBackground': cssVar('--bg-select'),
        'editorWidget.background': cssVar('--bg-menu'), 'editorWidget.border': cssVar('--border'),
        'editorSuggestWidget.background': cssVar('--bg-menu'), 'editorSuggestWidget.border': cssVar('--border'), 'editorSuggestWidget.selectedBackground': cssVar('--bg-select-strong'),
        'editorHoverWidget.background': cssVar('--bg-menu'), 'editorHoverWidget.border': cssVar('--border'),
        'input.background': cssVar('--bg-input'), 'input.border': cssVar('--border'), focusBorder: cssVar('--accent'),
        'editorIndentGuide.background1': cssVar('--border'), 'editorGutter.background': cssVar('--bg-editor'),
        'minimap.background': cssVar('--bg-editor'), 'scrollbarSlider.background': '#8a92a233', 'scrollbarSlider.hoverBackground': '#8a92a255',
        'diffEditor.insertedTextBackground': cssVar('--git-add') + '33', 'diffEditor.removedTextBackground': cssVar('--git-del') + '33',
        'diffEditor.insertedLineBackground': cssVar('--git-add') + '1c', 'diffEditor.removedLineBackground': cssVar('--git-del') + '1c',
        'quickInput.background': cssVar('--bg-menu'), 'list.hoverBackground': cssVar('--bg-hover'), 'menu.background': cssVar('--bg-menu'), 'menu.foreground': cssVar('--fg'),
        'peekViewEditor.background': cssVar('--bg-side'), 'editorOverviewRuler.border': '#00000000',
      },
    });
    monaco.editor.setTheme('juniper');
  }
  for (const t of S.terms) t.term.options.theme = xtermTheme();
}
function xtermTheme() {
  const light = S.settings.theme === 'light';
  return {
    background: cssVar('--bg-editor'), foreground: cssVar('--fg'), cursor: cssVar('--accent'), cursorAccent: cssVar('--bg-editor'), selectionBackground: cssVar('--bg-select-strong'),
    black: light ? '#2a303b' : '#3a4150', red: cssVar('--git-del'), green: cssVar('--git-add'), yellow: cssVar('--git-mod'), blue: cssVar('--accent'),
    magenta: light ? '#8a4fa8' : '#c79be0', cyan: light ? '#0f7a72' : '#7fd1c7', white: cssVar('--fg'),
    brightBlack: cssVar('--fg-dim'), brightRed: cssVar('--err'), brightGreen: cssVar('--git-add'), brightYellow: cssVar('--warn'), brightBlue: cssVar('--accent'),
    brightMagenta: light ? '#8a4fa8' : '#c79be0', brightCyan: light ? '#0f7a72' : '#7fd1c7', brightWhite: cssVar('--fg-strong'),
  };
}
function applySettings() {
  applyTheme();
  if (S.monacoReady) {
    const o = editorOptions();
    editor.updateOptions(o);
    diffEditor.updateOptions(o);
    for (const [, m] of S.models) m.model.updateOptions({ tabSize: S.settings.tabSize, insertSpaces: true });
  }
  for (const t of S.terms) t.term.options.fontSize = S.settings.fontSize;
  fitTerms(); renderStatus(); persist();
}
function setSetting(key, value) { S.settings[key] = value; applySettings(); const t = curTab(); if (t && t.kind === 'settings') renderPage(t); }

function initMonaco() {
  const ts = monaco.languages.typescript;
  ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  ts.javascriptDefaults.setCompilerOptions({ allowNonTsExtensions: true, allowJs: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs });
  ts.typescriptDefaults.setCompilerOptions({ allowNonTsExtensions: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs, strict: true });
  S.monacoReady = true;
  applyTheme();
  const common = { theme: 'juniper', automaticLayout: true, smoothScrolling: true, scrollBeyondLastLine: false, padding: { top: 6 }, bracketPairColorization: { enabled: true }, fixedOverflowWidgets: true, lineDecorationsWidth: 14, renderLineHighlight: 'line', ...editorOptions() };
  editor = monaco.editor.create($('#monaco-host'), { model: null, ...common });
  diffEditor = monaco.editor.createDiffEditor($('#diff-host'), { ...common, originalEditable: false, renderSideBySide: true, minimap: { enabled: false } });
  editor.onDidChangeCursorPosition(() => renderStatus());
  editor.onDidChangeModel(() => renderStatus());
  editor.onDidChangeModelLanguage(() => renderStatus());
  diffEditor.getModifiedEditor().onDidChangeCursorPosition(() => renderStatus());
  monaco.editor.onDidChangeMarkers(() => { renderPanelTabs(); if (S.panelTab === 'problems') renderProblems(); renderStatus(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { try { monaco.editor.remeasureFonts(); } catch {} });
  activateTab(S.active);
}

let gutterTimer = null, gutterDecos = null;
function scheduleGutter() { clearTimeout(gutterTimer); gutterTimer = setTimeout(updateGutter, 220); }
function updateGutter() {
  if (!S.monacoReady) return;
  if (!gutterDecos) gutterDecos = editor.createDecorationsCollection([]);
  const t = curTab(), m = t && t.kind === 'file' && S.models.get(t.path);
  if (!m || !(t.path in git.index) || editor.getModel() !== m.model) { gutterDecos.clear(); return; }
  const changes = Core.lineChanges(Core.diffLines(git.content(git.index[t.path]), m.model.getValue()));
  const max = m.model.getLineCount();
  gutterDecos.set(changes.map(c => ({
    range: new monaco.Range(Math.min(c.start, max), 1, Math.min(c.end, max), 1),
    options: { isWholeLine: true, linesDecorationsClassName: 'gut-' + c.type + (c.atTop ? ' top' : '') },
  })));
}

/* ---------- layout ---------- */
function layout() {
  const app = $('#app');
  app.style.setProperty('--side-w', S.sideW + 'px');
  app.style.setProperty('--panel-h', S.panelH + 'px');
  $('#sidebar').hidden = $('#sash-side').hidden = !S.sideVisible;
  $('#panel').hidden = $('#sash-panel').hidden = !S.panelVisible;
  const lb = $('#layout-btns');
  lb.textContent = '';
  lb.append(
    iconBtn('sidebar', `Toggle Side Bar (${kbLabel('Ctrl+B')})`, () => runCmd('view.toggleSidebar'), S.sideVisible ? 'on' : ''),
    iconBtn('panel', `Toggle Panel (${kbLabel('Ctrl+J')})`, () => runCmd('view.togglePanel'), S.panelVisible ? 'on' : ''));
  renderActivity();
  if (S.panelVisible && S.panelTab === 'terminal') ensureTerm();
  fitTerms();
  persist();
}
function bindSashes() {
  let start = 0;
  const side = $('#sash-side'), pan = $('#sash-panel');
  side.addEventListener('pointerdown', () => { start = S.sideW; });
  makeSash(side, dx => { S.sideW = Math.max(170, Math.min(innerWidth - 220, start + dx)); $('#app').style.setProperty('--side-w', S.sideW + 'px'); }, () => { fitTerms(); persist(); });
  pan.addEventListener('pointerdown', () => { start = S.panelH; });
  makeSash(pan, (dx, dy) => { S.panelH = Math.max(90, Math.min(innerHeight - 170, start - dy)); $('#app').style.setProperty('--panel-h', S.panelH + 'px'); fitTerms(); }, () => { fitTerms(); persist(); });
}

/* ---------- panel ---------- */
function problems() {
  if (!S.monacoReady) return [];
  return monaco.editor.getModelMarkers({}).filter(m => m.severity >= 4 && m.resource.scheme === 'file');
}
function showPanel(tab) {
  S.panelVisible = true;
  if (tab) S.panelTab = tab;
  layout(); renderPanel();
}
function renderPanelTabs() {
  const host = $('#panel-tabs');
  host.textContent = '';
  const n = problems().length;
  for (const [id, label] of [['problems', 'Problems'], ['output', 'Output'], ['terminal', 'Terminal']]) {
    host.append(h('button', { class: 'ptab' + (S.panelTab === id ? ' active' : ''), type: 'button', role: 'tab', 'aria-selected': String(S.panelTab === id), onclick: () => { showPanel(id); if (id === 'terminal') focusTerm(); } }, label, id === 'problems' && n ? h('span', { class: 'count' }, String(n)) : null));
  }
}
function renderPanel() {
  renderPanelTabs();
  for (const id of ['problems', 'output', 'terminal']) $('#pane-' + id).hidden = S.panelTab !== id;
  const acts = $('#panel-actions');
  acts.textContent = '';
  if (S.panelTab === 'terminal') acts.append(iconBtn('plus', `New Terminal`, () => newTerm()), iconBtn('trash', 'Kill Terminal', () => runCmd('terminal.kill')));
  if (S.panelTab === 'output') acts.append(iconBtn('trash', 'Clear Output', () => { S.output = []; renderOutput(); }));
  acts.append(iconBtn('close', `Hide Panel (${kbLabel('Ctrl+J')})`, () => runCmd('view.togglePanel')));
  if (S.panelTab === 'problems') renderProblems();
  if (S.panelTab === 'output') renderOutput();
  if (S.panelTab === 'terminal') { ensureTerm(); fitTerms(); }
}
function renderProblems() {
  const host = $('#pane-problems');
  host.textContent = '';
  const list = problems();
  if (!list.length) { host.append(h('div', { class: 'hint' }, S.monacoReady ? 'No problems have been detected in the open files.' : 'Problems appear once the editor has loaded.')); return; }
  const groups = new Map();
  for (const m of list) { const p = m.resource.path.slice(1); if (!groups.has(p)) groups.set(p, []); groups.get(p).push(m); }
  for (const [path, ms] of groups) {
    host.append(h('div', { class: 'row', style: { paddingLeft: '10px' }, onclick: () => openFile(path) }, fileIcon(P.basename(path)), h('span', { class: 'label' }, P.basename(path)), h('span', { class: 'desc' }, P.dirname(path)), h('span', { class: 'count' }, String(ms.length))));
    ms.sort((a, b) => a.startLineNumber - b.startLineNumber);
    for (const m of ms) {
      const kind = m.severity >= 8 ? 'error' : 'warning';
      host.append(h('div', { class: 'row prob', style: { paddingLeft: '30px' }, title: m.message, onclick: () => openFile(path, { line: m.startLineNumber, col: m.startColumn, len: m.endLineNumber === m.startLineNumber ? m.endColumn - m.startColumn : 0 }) },
        icon(kind, 14), h('span', { class: 'label' }, m.message.split('\n')[0]), h('span', { class: 'desc' }, `${m.source || ''}${m.code ? `(${typeof m.code === 'object' ? m.code.value : m.code})` : ''} [Ln ${m.startLineNumber}, Col ${m.startColumn}]`)));
    }
  }
}
function renderOutput() {
  const host = $('#pane-output');
  host.textContent = '';
  if (!S.output.length) { host.append(h('span', { class: 't' }, 'Git commands run from the Source Control view are logged here.')); return; }
  for (const o of S.output) host.append(h('span', { class: 't' }, `[${o.time}] `), o.text + '\n');
  host.scrollTop = host.scrollHeight;
}

/* ---------- terminal ---------- */
class TermSession {
  constructor() {
    this.id = ++S.termSeq;
    this.el = h('div', { class: 'term-host' });
    $('#term-stack').append(this.el);
    this.term = new Terminal({ fontFamily: cssVar('--font-mono'), fontSize: S.settings.fontSize, lineHeight: 1.25, cursorBlink: true, theme: xtermTheme(), scrollback: 4000 });
    this.fit = new FitAddon.FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(this.el);
    try { this.fit.fit(); } catch {}
    this.buf = ''; this.pos = 0; this.hist = []; this.hi = -1; this.saved = ''; this.busy = false; this.proc = null; this.curRow = 0; this.col0 = true; this.dead = false;
    const self = this;
    this.shell = new Shell.Shell({
      vfs, git, get name() { return S.name; },
      write: s => self.write(s),
      clear: () => { self.term.write('\x1b[2J\x1b[3J\x1b[H'); self.col0 = true; },
      exit: () => setTimeout(() => killTerm(self.id), 0),
      open: p => openFile(p, { focus: false }),
      preview: p => openTab({ kind: 'preview', path: p }),
      history: () => self.hist,
      runNode: o => { const r = Runner.run({ vfs, entry: o.entry, code: o.code, cwd: o.cwd, argv: o.argv, out: o.out }); self.proc = r; return r.done; },
    });
    this.term.onData(d => this.onData(d));
    this.term.attachCustomKeyEventHandler(e => !(e.type === 'keydown' && KEYS[keyString(e)]));
    this.write(`\x1b[2mJuniper shell. Type \x1b[0mhelp\x1b[2m for commands. The files and git history live in this browser.\x1b[0m\n`);
    this.prompt();
  }
  write(s) {
    if (!s || this.dead) return;
    this.col0 = s.endsWith('\n');
    this.term.write(s.replace(/\r?\n/g, '\r\n'));
  }
  prompt() {
    if (!this.col0) this.write('\n');
    const p = this.shell.promptText();
    this.promptStr = p.text; this.promptLen = p.len;
    this.buf = ''; this.pos = 0; this.curRow = 0;
    this.term.write(p.text);
    this.col0 = false;
  }
  redraw() {
    const cols = this.term.cols, endAbs = this.promptLen + this.buf.length, curAbs = this.promptLen + this.pos;
    let s = (this.curRow > 0 ? `\x1b[${this.curRow}A` : '') + '\r\x1b[J' + this.promptStr + this.buf;
    if (endAbs % cols === 0) s += ' \b';
    const endRow = Math.floor(endAbs / cols), curRow = Math.floor(curAbs / cols), curCol = curAbs % cols;
    if (endRow > curRow) s += `\x1b[${endRow - curRow}A`;
    s += '\r' + (curCol ? `\x1b[${curCol}C` : '');
    this.curRow = curRow;
    this.term.write(s);
  }
  toEnd() {
    const cols = this.term.cols, endRow = Math.floor((this.promptLen + this.buf.length) / cols);
    this.term.write((endRow > this.curRow ? `\x1b[${endRow - this.curRow}B` : '') + '\r\n');
    this.col0 = true; this.curRow = 0;
  }
  insert(text) { this.buf = this.buf.slice(0, this.pos) + text + this.buf.slice(this.pos); this.pos += text.length; this.redraw(); }
  async submit() {
    const line = this.buf;
    this.toEnd();
    this.buf = ''; this.pos = 0; this.hi = -1;
    if (line.trim()) {
      if (this.hist[this.hist.length - 1] !== line) this.hist.push(line);
      this.busy = true;
      try { await this.shell.run(line); } catch (e) { this.write(`sh: ${e.message}\n`); }
      this.busy = false; this.proc = null;
    }
    if (!this.dead) this.prompt();
    refresh();
  }
  exec(cmd) {
    if (this.busy) return false;
    this.buf = cmd; this.pos = cmd.length;
    this.redraw();
    this.submit();
    return true;
  }
  complete() {
    const { word, cands } = this.shell.complete(this.buf.slice(0, this.pos));
    if (!cands.length) return;
    if (cands.length === 1) { this.insert(cands[0].slice(word.length)); return; }
    let pre = cands[0];
    for (const c of cands) while (!c.startsWith(pre)) pre = pre.slice(0, -1);
    pre = pre.trimEnd();
    if (pre.length > word.length) { this.insert(pre.slice(word.length)); return; }
    this.toEnd();
    this.term.write(cands.map(c => c.trim().split('/').filter(Boolean).pop() + (c.endsWith('/') ? '/' : '')).join('  ') + '\r\n');
    this.redraw();
  }
  onData(d) {
    if (this.busy) { if (d === '\x03' && this.proc) this.proc.kill(); return; }
    switch (d) {
      case '\r': this.submit(); return;
      case '\x7f': if (this.pos > 0) { this.buf = this.buf.slice(0, this.pos - 1) + this.buf.slice(this.pos); this.pos--; this.redraw(); } return;
      case '\x1b[3~': if (this.pos < this.buf.length) { this.buf = this.buf.slice(0, this.pos) + this.buf.slice(this.pos + 1); this.redraw(); } return;
      case '\x1b[D': if (this.pos > 0) { this.pos--; this.redraw(); } return;
      case '\x1b[C': if (this.pos < this.buf.length) { this.pos++; this.redraw(); } return;
      case '\x1b[H': case '\x01': this.pos = 0; this.redraw(); return;
      case '\x1b[F': case '\x05': this.pos = this.buf.length; this.redraw(); return;
      case '\x1b[A':
        if (!this.hist.length) return;
        if (this.hi === -1) { this.saved = this.buf; this.hi = this.hist.length; }
        this.hi = Math.max(0, this.hi - 1);
        this.buf = this.hist[this.hi]; this.pos = this.buf.length; this.redraw(); return;
      case '\x1b[B':
        if (this.hi === -1) return;
        this.hi++;
        if (this.hi >= this.hist.length) { this.hi = -1; this.buf = this.saved; } else this.buf = this.hist[this.hi];
        this.pos = this.buf.length; this.redraw(); return;
      case '\x03': this.toEnd(); this.term.write('^C\r\n'); this.prompt(); return;
      case '\x0c': this.term.write('\x1b[2J\x1b[3J\x1b[H'); this.curRow = 0; this.redraw(); return;
      case '\x15': this.buf = this.buf.slice(this.pos); this.pos = 0; this.redraw(); return;
      case '\x0b': this.buf = this.buf.slice(0, this.pos); this.redraw(); return;
      case '\x17': { const left = this.buf.slice(0, this.pos).replace(/\S+\s*$/, ''); this.buf = left + this.buf.slice(this.pos); this.pos = left.length; this.redraw(); return; }
      case '\t': this.complete(); return;
    }
    if (d.startsWith('\x1b')) return;
    const text = d.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1f]/g, '');
    if (text) this.insert(text);
  }
  dispose() {
    this.dead = true;
    if (this.proc) this.proc.kill();
    this.term.dispose();
    this.el.remove();
  }
}
const activeTerm = () => S.terms.find(t => t.id === S.activeTerm) || null;
function ensureTerm() {
  if (!S.xtermReady || S.terms.length) return;
  newTerm(false);
}
function newTerm(focus = true) {
  if (!S.xtermReady) { notify('The terminal is still loading.', 'info', 2500); return null; }
  if (!S.panelVisible || S.panelTab !== 'terminal') { S.panelVisible = true; S.panelTab = 'terminal'; layout(); renderPanel(); }
  let t;
  try { t = new TermSession(); } catch (e) { notify('The terminal could not start: ' + e.message, 'error'); return null; }
  S.terms.push(t);
  setActiveTerm(t.id, focus);
  return t;
}
function setActiveTerm(id, focus = true) {
  S.activeTerm = id;
  for (const t of S.terms) t.el.hidden = t.id !== id;
  renderTermList(); fitTerms();
  if (focus) focusTerm();
}
function killTerm(id) {
  const i = S.terms.findIndex(t => t.id === id);
  if (i < 0) return;
  S.terms[i].dispose();
  S.terms.splice(i, 1);
  if (!S.terms.length) { S.activeTerm = null; S.panelVisible = false; layout(); focusEditor(); }
  else setActiveTerm(S.terms[Math.min(i, S.terms.length - 1)].id);
  renderTermList();
}
function renderTermList() {
  const host = $('#term-list');
  host.hidden = S.terms.length < 2;
  host.textContent = '';
  S.terms.forEach((t, i) => host.append(h('div', { class: 'row' + (t.id === S.activeTerm ? ' sel' : ''), onclick: () => setActiveTerm(t.id) }, icon('terminal', 14), h('span', { class: 'label' }, `sh ${i + 1}`), h('span', { class: 'row-actions' }, iconBtn('trash', 'Kill Terminal', () => killTerm(t.id))))));
}
function fitTerms() {
  const t = activeTerm();
  if (!t || !S.panelVisible || S.panelTab !== 'terminal' || !t.el.offsetWidth) return;
  try { const before = t.term.cols; t.fit.fit(); if (before !== t.term.cols && !t.busy) t.redraw(); } catch {}
}
function focusTerm() { const t = activeTerm(); if (t) t.term.focus(); }
function runInTerminal(cmd) {
  showPanel('terminal');
  let t = activeTerm();
  if (!t || t.busy) t = newTerm(false);
  if (!t) { notify('The terminal is not available yet.', 'warning'); return; }
  t.exec(cmd);
  focusTerm();
}

/* ---------- status bar ---------- */
function renderStatus() {
  const left = $('#status-left'), right = $('#status-right');
  left.textContent = ''; right.textContent = '';
  const changes = S.deco ? S.deco.files.size : 0;
  const ps = problems(), errs = ps.filter(m => m.severity >= 8).length, warns = ps.length - errs;
  left.append(
    h('button', { class: 'st', type: 'button', title: `Branch ${git.HEAD}${changes ? `, ${changes} pending change${changes === 1 ? '' : 's'}` : ''}. Click to switch.`, onclick: () => runCmd('git.checkout') }, icon('branch', 14), git.HEAD + (changes ? '*' : '')),
    h('button', { class: 'st', type: 'button', title: `${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}`, onclick: () => runCmd('view.problems') }, icon('error', 14), String(errs), icon('warning', 14), String(warns)));
  const ed = activeCodeEditor(), model = ed && ed.getModel();
  if (model) {
    const p = ed.getPosition() || { lineNumber: 1, column: 1 }, sel = ed.getSelection();
    const selLen = sel && !sel.isEmpty() ? model.getValueInRange(sel).length : 0;
    const lang = monaco.languages.getLanguages().find(l => l.id === model.getLanguageId());
    right.append(
      h('button', { class: 'st', type: 'button', title: 'Go to Line/Column', onclick: () => runCmd('go.line') }, `Ln ${p.lineNumber}, Col ${p.column}${selLen ? ` (${selLen} selected)` : ''}`),
      h('button', { class: 'st opt', type: 'button', title: 'Select Indentation', onclick: () => runCmd('editor.tabSize') }, `Spaces: ${model.getOptions().tabSize}`),
      h('span', { class: 'st opt' }, 'UTF-8'), h('span', { class: 'st opt' }, 'LF'),
      h('button', { class: 'st', type: 'button', title: 'Select Language Mode', onclick: () => runCmd('editor.language') }, (lang && lang.aliases && lang.aliases[0]) || model.getLanguageId()));
  }
  right.append(h('button', { class: 'st opt', type: 'button', title: 'Color Theme', onclick: () => runCmd('view.theme') }, (THEMES.find(t => t[0] === S.settings.theme) || THEMES[0])[1]));
}

/* ---------- pages: empty state, welcome, settings, preview ---------- */
const SHORTCUTS = [['Show All Commands', 'Ctrl+Shift+P', 'F1'], ['Go to File', 'Ctrl+P'], ['Find in Files', 'Ctrl+Shift+F'], ['Toggle Terminal', 'Ctrl+`'], ['Toggle Side Bar', 'Ctrl+B'], ['Save', 'Ctrl+S'], ['Run Active File', 'F5']];
const keysGrid = list => h('div', { class: 'keys' }, list.map(([label, ...kbs]) => [h('span', null, label), h('span', null, kbs.map((kb, i) => [i ? ' or ' : '', kbLabel(kb).split('+').map((k, j) => [j ? ' ' : '', h('kbd', null, k)])]))]));
function renderEmpty() {
  const host = $('#empty-host');
  host.textContent = '';
  const mark = h('div', { class: 'mark' });
  mark.innerHTML = LOGO(88);
  host.append(mark, keysGrid(SHORTCUTS.slice(0, 5)));
}
let previewTimer = null;
function previewHtml(path) {
  let html = vfs.read(path) ?? '';
  const dir = P.dirname(path);
  const res = href => {
    if (/^([a-z]+:|\/\/|#)/i.test(href)) return null;
    const clean = href.split(/[?#]/)[0];
    const p = clean.startsWith('/') ? P.norm(clean) : P.join(dir, clean);
    return vfs.isFile(p) ? p : null;
  };
  html = html.replace(/<link\b[^>]*>/gi, tag => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const m = /href\s*=\s*["']([^"']+)["']/i.exec(tag), p = m && res(m[1]);
    return p ? `<style data-from="${p}">\n${vfs.read(p).replace(/<\/style/gi, '<\\/style')}\n</style>` : tag;
  });
  html = html.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => {
    const p = res(src);
    return p ? `<script${a}${b} data-from="${p}">\n${vfs.read(p).replace(/<\/script/gi, '<\\/script')}\n</script>` : tag;
  });
  return html;
}
function refreshPreview() {
  const t = curTab();
  if (!t || t.kind !== 'preview') return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const frame = $('#preview-frame');
    if (!frame || !vfs.isFile(t.path)) return;
    const html = previewHtml(t.path);
    if (frame.dataset.src !== html) { frame.dataset.src = html; frame.srcdoc = html; }
  }, 250);
}
function renderPage(t) {
  const host = $('#page-host');
  host.textContent = '';
  host.scrollTop = 0;
  if (t.kind === 'preview') {
    const html = previewHtml(t.path);
    const frame = h('iframe', { id: 'preview-frame', title: `Preview of ${t.path}`, sandbox: 'allow-scripts allow-forms' });
    frame.dataset.src = html; frame.srcdoc = html;
    host.append(h('div', { class: 'preview-wrap' },
      h('div', { class: 'preview-bar' }, icon('preview', 14), h('span', { class: 'grow' }, `${t.path} · reloads when files are saved`),
        iconBtn('refresh', 'Reload Preview', () => { frame.srcdoc = previewHtml(t.path); }), iconBtn('file', 'Open Source File', () => openFile(t.path))),
      frame));
    return;
  }
  const page = h('div', { class: 'page' });
  host.append(page);
  if (t.kind === 'settings') {
    const s = S.settings;
    const row = (id, label, help, control) => h('div', { class: 'set-row' }, h('label', { for: id }, label, h('small', null, help)), control);
    const check = (id, key) => h('input', { id, type: 'checkbox', class: 'check', checked: s[key], onchange: e => setSetting(key, e.target.checked) });
    const select = (id, opts, cur, on) => h('select', { id, class: 'inp', onchange: e => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(cur) }, l)));
    page.append(
      h('h1', null, 'Settings'), h('p', null, 'Settings are stored in this browser together with the workspace.'),
      h('h2', null, 'Appearance'),
      row('set-theme', 'Color Theme', 'Colors of the workbench, editor and terminal.', select('set-theme', THEMES, s.theme, v => setSetting('theme', v))),
      row('set-font', 'Font Size', 'Editor and terminal text size in pixels.', h('input', { id: 'set-font', class: 'inp', type: 'number', min: '10', max: '28', value: s.fontSize, onchange: e => setSetting('fontSize', Math.max(10, Math.min(28, +e.target.value || 13))) })),
      row('set-minimap', 'Minimap', 'Show the code overview on the right of the editor.', check('set-minimap', 'minimap')),
      row('set-lines', 'Line Numbers', 'Show line numbers in the gutter.', check('set-lines', 'lineNumbers')),
      row('set-lig', 'Font Ligatures', 'Join sequences like => and !== into single glyphs.', check('set-lig', 'ligatures')),
      h('h2', null, 'Editing'),
      row('set-tab', 'Tab Size', 'Number of spaces inserted for one indent.', select('set-tab', [[2, '2'], [4, '4'], [8, '8']], s.tabSize, v => setSetting('tabSize', +v))),
      row('set-wrap', 'Word Wrap', 'Wrap long lines at the edge of the editor.', check('set-wrap', 'wordWrap')),
      row('set-ws', 'Render Whitespace', 'Show dots for every space, not only in selections.', check('set-ws', 'whitespace')),
      row('set-autosave', 'Auto Save', 'Save files about a second after you stop typing.', check('set-autosave', 'autoSave')),
      h('h2', null, 'Git'),
      row('set-gname', 'Author Name', 'Recorded on the commits you make.', h('input', { id: 'set-gname', class: 'inp', type: 'text', value: git.user.name, onchange: e => { git.user.name = e.target.value.trim() || 'Dev'; persist(); } })),
      row('set-gmail', 'Author Email', 'Recorded on the commits you make.', h('input', { id: 'set-gmail', class: 'inp', type: 'text', value: git.user.email, onchange: e => { git.user.email = e.target.value.trim() || 'dev@juniper.local'; persist(); } })));
    return;
  }
  const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '6px' } });
  head.innerHTML = LOGO(44);
  head.append(h('h1', null, 'Juniper IDE'));
  const link = (ic, label, fn) => h('button', { class: 'linkish', type: 'button', onclick: fn }, icon(ic, 16), label);
  page.append(head,
    h('p', null, 'A code editor that runs entirely in this page: a file explorer, tabbed editor, search, source control and a terminal over a workspace kept in your browser.'),
    h('h2', null, 'Start'),
    h('div', { class: 'start-list' },
      link('newFile', 'New File…', () => runCmd('file.new')),
      link('upload', 'Open Files from Your Computer…', () => runCmd('file.openFiles')),
      vfs.isFile('README.md') ? link('file', 'Open README.md', () => openFile('README.md')) : null,
      link('terminal', 'Run the Tests (npm test)', () => runInTerminal('npm test')),
      link('branch', 'Review Changes in Source Control', () => showView('scm'))),
    h('h2', null, 'Keyboard'), keysGrid(SHORTCUTS),
    h('h2', null, 'What runs where'),
    h('p', null, 'Files, settings and git history are saved in this browser and stay on this device. Use File › Open Files to bring code in.'),
    h('p', null, 'Git is built in and local: stage, commit, branch, merge, stash and diff all work, and there are no remotes to push to or pull from.'),
    h('p', null, 'The terminal is a simulated shell. `node file.js` runs CommonJS JavaScript in a background worker; npm packages, Python and network tools are not available.'));
}

/* ---------- commands ---------- */
const CMD = {}, KEYS = {};
function defCmd(id, title, run, opts = {}) { CMD[id] = { id, title, run, ...opts }; if (opts.kb && opts.global !== false) KEYS[opts.kb] = id; for (const k of opts.also || []) KEYS[k] = id; }
function runCmd(id) {
  const c = CMD[id];
  if (!c || (c.when && !c.when())) return;
  try { c.run(); } catch (e) { notify(e.message, 'error'); }
}
function menuItem(id) {
  if (id === '-') return '-';
  const c = CMD[id];
  if (!c || (c.when && !c.when())) return null;
  return { label: c.title.replace(/^[^:]+: /, ''), kb: c.kb, run: () => runCmd(id), checked: c.checked ? c.checked() : false, disabled: c.enabled ? !c.enabled() : false };
}
function editorAction(id) {
  return () => { const ed = activeCodeEditor(); if (!ed) { notify('Open a file first.', 'info', 2500); return; } ed.focus(); ed.trigger('menu', id, null); };
}
const hasEditor = () => !!activeCodeEditor();
function keyString(e) {
  let k = e.key;
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (e.code === 'Backquote') k = '`';
  else if (e.code === 'Comma') k = ',';
  else if (k && k.length === 1) k = k.toUpperCase();
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.altKey ? 'Alt+' : '') + k;
}

function paletteProvider(v) {
  if (v.startsWith('>')) {
    const q = v.slice(1).trim();
    const items = [];
    for (const c of Object.values(CMD)) {
      if (c.hidden || (c.when && !c.when())) continue;
      const m = fuzzy(q, c.title);
      if (m) items.push({ label: c.title, pos: m.pos, kb: c.kb, cmd: c.id, score: m.score });
    }
    const ed = activeCodeEditor();
    if (ed && q) for (const a of ed.getSupportedActions()) {
      if (!a.label || /toggleHighContrast|quickCommand|gotoLine|inspectTokens/.test(a.id) || items.some(i => i.label.endsWith(a.label))) continue;
      const m = fuzzy(q, a.label);
      if (m) items.push({ label: a.label, pos: m.pos, action: a, desc: 'editor', score: m.score - 50 });
    }
    items.sort(q ? (a, b) => b.score - a.score : (a, b) => a.label.localeCompare(b.label));
    return { items, empty: 'No matching commands' };
  }
  if (v.startsWith(':')) {
    const n = parseInt(v.slice(1), 10);
    return { items: [{ label: n ? `Go to line ${n}` : 'Type a line number', line: n || 0 }] };
  }
  const q = v.trim(), items = [];
  const recent = S.mru.map(id => S.tabs.find(t => t.id === id)).filter(t => t && t.kind === 'file').map(t => t.path);
  for (const path of vfs.allFiles()) {
    if (git.ignored(path)) continue;
    const base = P.basename(path);
    const mb = fuzzy(q, base), mp = mb ? null : fuzzy(q, path);
    if (!mb && !mp) continue;
    const r = recent.indexOf(path);
    items.push({ label: base, desc: P.dirname(path), pos: mb ? mb.pos : [], path, icon: fileIcon(base), score: (mb ? mb.score + 500 : mp.score) + (r >= 0 ? 30 - r : 0), r });
  }
  items.sort(q ? (a, b) => b.score - a.score : (a, b) => (a.r < 0 ? 999 : a.r) - (b.r < 0 ? 999 : b.r) || a.path.localeCompare(b.path));
  return { items, empty: 'No matching files' };
}
function openPalette(prefix = '') {
  quickPick({
    placeholder: 'Search files by name (type > for commands, : to go to a line)', value: prefix, provider: paletteProvider,
    onAccept: it => {
      if (!it) return;
      if (it.cmd) runCmd(it.cmd);
      else if (it.action) { focusEditor(); it.action.run(); }
      else if (it.path) openFile(it.path);
      else if (it.line) { const ed = activeCodeEditor(); if (ed) { ed.setPosition({ lineNumber: it.line, column: 1 }); ed.revealLineInCenter(it.line); ed.focus(); } }
    },
  });
}
function pickTheme() {
  const before = S.settings.theme;
  quickPick({
    placeholder: 'Select Color Theme',
    provider: v => THEMES.map(([id, label]) => ({ id, label, m: fuzzy(v, label) })).filter(x => x.m).sort((a, b) => b.m.score - a.m.score).map(x => ({ label: x.label, pos: x.m.pos, id: x.id, desc: x.id === before ? 'current' : '' })),
    onAccept: it => it && setSetting('theme', it.id),
  });
}
async function resetWorkspace() {
  const r = await dialog({
    title: 'Reset the workspace to the sample project?',
    detail: 'Every file and the whole git history in this browser will be replaced. This cannot be undone.',
    buttons: [{ label: 'Cancel', value: null }, { label: 'Reset Workspace', value: 'yes', primary: true }],
  });
  if (r !== 'yes') return;
  for (const [, m] of S.models) m.dirty = false;
  for (const t of [...S.tabs]) removeTab(t.id);
  vfs.load({ files: {}, dirs: [] });
  git.load({});
  git._hc.clear();
  S.name = Seed.name; S.expanded = new Set(['src', 'styles']); S.selected = null; S.scm.message = ''; S.scm.openCommit = null;
  Seed.apply(vfs, git);
  for (const t of S.terms) t.shell.cwd = '';
  S.deco = gitDeco();
  openDefaultTabs();
  buildSide(); renderCmdCenter();
  refresh();
}
function openDefaultTabs() {
  for (const p of ['README.md', 'styles/main.css', 'src/ratio.js']) if (vfs.isFile(p)) openTab({ kind: 'file', path: p }, { background: true });
  const first = S.tabs.find(t => t.path === 'src/ratio.js') || S.tabs[0];
  activateTab(first ? first.id : null);
}
function downloadZip() {
  const files = vfs.allFiles().filter(p => !/(^|\/)node_modules\//.test(p)).map(p => ({ name: `${S.name}/${p}`, data: vfs.read(p) }));
  if (!files.length) { notify('The workspace is empty.', 'info'); return; }
  const zip = Core.makeZip(files);
  S.downloads.save({ filename: `${S.name}.zip`, data: new Blob([zip]) }).then(
    () => notify(`Saved ${S.name}.zip with ${files.length} files.`, 'info', 3500),
    e => { if (!e || e.code !== 'declined') notify('The download did not go through' + (e && e.message ? `: ${e.message}` : '.'), 'error'); });
}
function cycleTab(step) {
  if (S.tabs.length < 2) return;
  const i = S.tabs.findIndex(t => t.id === S.active);
  activateTab(S.tabs[(i + step + S.tabs.length) % S.tabs.length].id);
  focusEditor();
}
function defineCommands() {
  const st = () => (S.deco || gitDeco()).st;
  defCmd('file.new', 'File: New File…', () => newEntry('file'), { kb: 'Alt+N' });
  defCmd('file.newFolder', 'File: New Folder…', () => newEntry('folder'));
  defCmd('file.openFiles', 'File: Open Files from Computer…', () => $('#file-input').click());
  defCmd('file.openFolder', 'File: Open Folder from Computer…', () => $('#folder-input').click());
  defCmd('file.save', 'File: Save', () => { const t = curTab(); const p = t && tabModelPath(t); if (p) saveFile(p); }, { kb: 'Ctrl+S', enabled: () => !!(curTab() && tabModelPath(curTab())) });
  defCmd('file.saveAll', 'File: Save All', saveAll, { kb: 'Ctrl+Alt+S' });
  defCmd('file.autoSave', 'File: Auto Save', () => setSetting('autoSave', !S.settings.autoSave), { checked: () => S.settings.autoSave });
  defCmd('file.downloadZip', 'File: Download Workspace as Zip…', downloadZip, { when: () => !!S.downloads });
  defCmd('file.close', 'View: Close Editor', () => { if (S.active) closeTab(S.active); }, { kb: 'Alt+W', enabled: () => !!S.active });
  defCmd('file.closeAll', 'View: Close All Editors', () => closeTabs(S.tabs), { enabled: () => S.tabs.length > 0 });
  defCmd('workspace.reset', 'Workspace: Reset to Sample Project…', resetWorkspace);

  defCmd('edit.undo', 'Edit: Undo', editorAction('undo'), { kb: 'Ctrl+Z', global: false, enabled: hasEditor });
  defCmd('edit.redo', 'Edit: Redo', editorAction('redo'), { kb: 'Ctrl+Shift+Z', global: false, enabled: hasEditor });
  defCmd('edit.find', 'Edit: Find', editorAction('actions.find'), { kb: 'Ctrl+F', global: false, enabled: hasEditor });
  defCmd('edit.replace', 'Edit: Replace', editorAction('editor.action.startFindReplaceAction'), { kb: 'Ctrl+H', global: false, enabled: hasEditor });
  defCmd('edit.findInFiles', 'Search: Find in Files', () => {
    const ed = activeCodeEditor(), sel = ed && ed.getSelection(), text = sel && !sel.isEmpty() ? ed.getModel().getValueInRange(sel) : '';
    if (text && !text.includes('\n')) S.search.q = text;
    showView('search');
    if (text) runSearch();
  }, { kb: 'Ctrl+Shift+F' });
  defCmd('edit.comment', 'Edit: Toggle Line Comment', editorAction('editor.action.commentLine'), { kb: 'Ctrl+/', global: false, enabled: hasEditor });
  defCmd('edit.format', 'Edit: Format Document', editorAction('editor.action.formatDocument'), { kb: 'Shift+Alt+F', global: false, enabled: hasEditor });

  defCmd('sel.all', 'Selection: Select All', editorAction('editor.action.selectAll'), { kb: 'Ctrl+A', global: false, enabled: hasEditor });
  defCmd('sel.expand', 'Selection: Expand Selection', editorAction('editor.action.smartSelect.expand'), { kb: 'Shift+Alt+→', global: false, enabled: hasEditor });
  defCmd('sel.copyUp', 'Selection: Copy Line Up', editorAction('editor.action.copyLinesUpAction'), { kb: 'Shift+Alt+↑', global: false, enabled: hasEditor });
  defCmd('sel.copyDown', 'Selection: Copy Line Down', editorAction('editor.action.copyLinesDownAction'), { kb: 'Shift+Alt+↓', global: false, enabled: hasEditor });
  defCmd('sel.moveUp', 'Selection: Move Line Up', editorAction('editor.action.moveLinesUpAction'), { kb: 'Alt+↑', global: false, enabled: hasEditor });
  defCmd('sel.moveDown', 'Selection: Move Line Down', editorAction('editor.action.moveLinesDownAction'), { kb: 'Alt+↓', global: false, enabled: hasEditor });
  defCmd('sel.cursorAbove', 'Selection: Add Cursor Above', editorAction('editor.action.insertCursorAbove'), { kb: 'Ctrl+Alt+↑', global: false, enabled: hasEditor });
  defCmd('sel.cursorBelow', 'Selection: Add Cursor Below', editorAction('editor.action.insertCursorBelow'), { kb: 'Ctrl+Alt+↓', global: false, enabled: hasEditor });
  defCmd('sel.nextMatch', 'Selection: Add Next Occurrence', editorAction('editor.action.addSelectionToNextFindMatch'), { kb: 'Ctrl+D', global: false, enabled: hasEditor });

  defCmd('view.palette', 'View: Command Palette…', () => openPalette('>'), { kb: 'Ctrl+Shift+P', also: ['F1'] });
  defCmd('view.explorer', 'View: Show Explorer', () => showView('explorer'), { kb: 'Ctrl+Shift+E' });
  defCmd('view.search', 'View: Show Search', () => showView('search'));
  defCmd('view.scm', 'View: Show Source Control', () => showView('scm'), { kb: 'Ctrl+Shift+G' });
  defCmd('view.run', 'View: Show Run', () => showView('run'), { kb: 'Ctrl+Shift+D' });
  defCmd('view.problems', 'View: Show Problems', () => showPanel('problems'), { kb: 'Ctrl+Shift+M' });
  defCmd('view.output', 'View: Show Output', () => showPanel('output'));
  defCmd('view.terminal', 'View: Toggle Terminal', () => {
    const t = activeTerm();
    if (S.panelVisible && S.panelTab === 'terminal' && t && t.el.contains(document.activeElement)) { S.panelVisible = false; layout(); focusEditor(); }
    else { showPanel('terminal'); focusTerm(); }
  }, { kb: 'Ctrl+`' });
  defCmd('view.toggleSidebar', 'View: Toggle Side Bar', () => { S.sideVisible = !S.sideVisible; if (S.sideVisible) buildSide(); layout(); }, { kb: 'Ctrl+B', checked: () => S.sideVisible });
  defCmd('view.togglePanel', 'View: Toggle Panel', () => { S.panelVisible = !S.panelVisible; layout(); if (S.panelVisible) renderPanel(); }, { kb: 'Ctrl+J', checked: () => S.panelVisible });
  defCmd('view.wordWrap', 'View: Toggle Word Wrap', () => setSetting('wordWrap', !S.settings.wordWrap), { kb: 'Alt+Z', checked: () => S.settings.wordWrap });
  defCmd('view.minimap', 'View: Toggle Minimap', () => setSetting('minimap', !S.settings.minimap), { checked: () => S.settings.minimap });
  defCmd('view.zoomIn', 'View: Increase Font Size', () => setSetting('fontSize', Math.min(28, S.settings.fontSize + 1)), { kb: 'Ctrl+Alt+=' });
  defCmd('view.zoomOut', 'View: Decrease Font Size', () => setSetting('fontSize', Math.max(10, S.settings.fontSize - 1)), { kb: 'Ctrl+Alt+-' });
  defCmd('view.theme', 'Preferences: Color Theme', pickTheme);
  defCmd('view.settings', 'Preferences: Open Settings', () => openTab({ kind: 'settings' }), { kb: 'Ctrl+,' });

  defCmd('go.file', 'Go: Go to File…', () => openPalette(''), { kb: 'Ctrl+P' });
  defCmd('go.line', 'Go: Go to Line…', () => { if (hasEditor()) openPalette(':'); }, { kb: 'Ctrl+G', enabled: hasEditor });
  defCmd('go.symbol', 'Go: Go to Symbol in Editor…', editorAction('editor.action.quickOutline'), { kb: 'Ctrl+Shift+O', global: false, enabled: hasEditor });
  defCmd('go.nextTab', 'Go: Next Editor', () => cycleTab(1), { kb: 'Alt+]' });
  defCmd('go.prevTab', 'Go: Previous Editor', () => cycleTab(-1), { kb: 'Alt+[' });
  defCmd('editor.language', 'Editor: Change Language Mode', () => {
    const ed = activeCodeEditor(); if (!ed) return;
    const langs = monaco.languages.getLanguages().map(l => ({ id: l.id, name: (l.aliases && l.aliases[0]) || l.id }));
    quickPick({ placeholder: 'Select Language Mode', provider: v => langs.map(l => ({ l, m: fuzzy(v, l.name) })).filter(x => x.m).sort((a, b) => (v ? b.m.score - a.m.score : a.l.name.localeCompare(b.l.name))).map(x => ({ label: x.l.name, pos: x.m.pos, desc: x.l.id, id: x.l.id })), onAccept: it => it && monaco.editor.setModelLanguage(ed.getModel(), it.id) });
  }, { enabled: hasEditor });
  defCmd('editor.tabSize', 'Editor: Select Indentation', () => quickPick({ placeholder: 'Select tab size', provider: () => [2, 4, 8].map(n => ({ label: `${n} spaces`, n, desc: n === S.settings.tabSize ? 'current' : '' })), onAccept: it => it && setSetting('tabSize', it.n) }));

  defCmd('run.active', 'Run: Run Active File', () => {
    const t = curTab();
    if (!t || t.kind !== 'file') { notify('Open a .js or .html file to run it.', 'info', 3000); return; }
    const ext = P.ext(t.path);
    if (['html', 'htm'].includes(ext)) { saveFile(t.path); openTab({ kind: 'preview', path: t.path }); }
    else if (['js', 'cjs', 'mjs'].includes(ext)) { saveAll(); runInTerminal('node ' + t.path); }
    else notify(`There is no runner for .${ext || 'this kind of'} files. JavaScript runs in the terminal and HTML opens in a preview.`, 'info');
  }, { kb: 'F5' });
  defCmd('run.preview', 'Run: Open Preview', () => {
    const t = curTab();
    const path = t && t.path && /\.html?$/.test(t.path) ? t.path : vfs.isFile('index.html') ? 'index.html' : null;
    if (!path) { notify('Open an .html file to preview it.', 'info', 3000); return; }
    saveAll();
    openTab({ kind: 'preview', path });
  });
  defCmd('run.test', 'Run: npm test', () => { saveAll(); runInTerminal('npm test'); });
  defCmd('terminal.new', 'Terminal: New Terminal', () => newTerm(), { kb: 'Ctrl+Shift+`' });
  defCmd('terminal.kill', 'Terminal: Kill Active Terminal', () => { if (S.activeTerm) killTerm(S.activeTerm); }, { enabled: () => !!S.activeTerm });
  defCmd('terminal.clear', 'Terminal: Clear', () => { const t = activeTerm(); if (t && !t.busy) { t.term.write('\x1b[2J\x1b[3J\x1b[H'); t.curRow = 0; t.redraw(); } }, { enabled: () => !!S.activeTerm });

  defCmd('git.commit', 'Git: Commit', () => gitCommit(), { enabled: () => st().staged.length + st().unstaged.length > 0 });
  defCmd('git.stageAll', 'Git: Stage All Changes', () => { saveAll(); gitTry('git add -A', () => git.add('')); }, { enabled: () => st().unstaged.length > 0 });
  defCmd('git.unstageAll', 'Git: Unstage All Changes', () => gitTry('git restore --staged .', () => git.unstage('')), { enabled: () => st().staged.length > 0 });
  defCmd('git.discardAll', 'Git: Discard All Changes', async () => {
    const list = st().unstaged, tracked = list.filter(x => x.status !== 'U'), un = list.length - tracked.length;
    const r = await dialog({
      title: `Discard all changes in ${list.length} file${list.length === 1 ? '' : 's'}?`,
      detail: `${tracked.length} modified or deleted file${tracked.length === 1 ? '' : 's'} will be restored${un ? ` and ${un} untracked file${un === 1 ? '' : 's'} will be deleted` : ''}. This cannot be undone.`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Discard All', value: 'yes', primary: true }],
    });
    if (r !== 'yes') return;
    for (const [, m] of S.models) m.dirty = false;
    gitTry('git restore . && git clean -fd', () => git.discard('', { untracked: true }));
    onFsChange();
  }, { enabled: () => st().unstaged.length > 0 });
  defCmd('git.branch', 'Git: Create Branch…', gitCreateBranch);
  defCmd('git.checkout', 'Git: Switch Branch…', () => gitPickBranch('Select a branch to switch to', name => { if (name !== git.HEAD) gitCheckout(name); }));
  defCmd('git.merge', 'Git: Merge Branch…', () => gitPickBranch(`Select a branch to merge into ${git.HEAD}`, name => gitMerge(name)), { enabled: () => Object.keys(git.branches).length > 1 });
  defCmd('git.stash', 'Git: Stash Changes', () => { saveAll(); if (gitTry('git stash', () => git.stash())) notify('Changes stashed.', 'info', 2500); });
  defCmd('git.stashPop', 'Git: Pop Latest Stash', () => { if (gitTry('git stash pop', () => git.stashPop())) notify('Stash applied.', 'info', 2500); }, { enabled: () => git.stashes.length > 0 });

  defCmd('help.welcome', 'Help: Welcome', () => openTab({ kind: 'welcome' }));
  defCmd('help.shortcuts', 'Help: Keyboard Shortcuts', () => openTab({ kind: 'welcome' }));
  defCmd('help.about', 'Help: About', () => dialog({
    title: 'Juniper IDE',
    detail: 'A browser-based code editor.\n\nThe editor component is Monaco and the terminal is xterm.js, both open source. The file system, git engine and shell are built into this page and keep their data in your browser.',
    buttons: [{ label: 'OK', value: 1, primary: true }],
  }));
}

/* ---------- menu bar ---------- */
const MENUS = [
  ['File', ['file.new', 'file.newFolder', '-', 'file.openFiles', 'file.openFolder', '-', 'file.save', 'file.saveAll', 'file.autoSave', '-', 'file.downloadZip', '-', 'file.close', 'file.closeAll', '-', 'workspace.reset']],
  ['Edit', ['edit.undo', 'edit.redo', '-', 'edit.find', 'edit.replace', '-', 'edit.findInFiles', '-', 'edit.comment', 'edit.format']],
  ['Selection', ['sel.all', 'sel.expand', '-', 'sel.copyUp', 'sel.copyDown', 'sel.moveUp', 'sel.moveDown', '-', 'sel.cursorAbove', 'sel.cursorBelow', 'sel.nextMatch']],
  ['View', ['view.palette', '-', 'view.explorer', 'edit.findInFiles', 'view.scm', 'view.run', '-', 'view.problems', 'view.output', 'view.terminal', '-', 'view.toggleSidebar', 'view.togglePanel', '-', 'view.wordWrap', 'view.minimap', 'view.zoomIn', 'view.zoomOut', '-', 'view.theme', 'view.settings']],
  ['Go', ['go.file', 'go.symbol', 'go.line', '-', 'go.nextTab', 'go.prevTab']],
  ['Run', ['run.active', 'run.preview', '-', 'run.test']],
  ['Terminal', ['terminal.new', 'terminal.kill', 'terminal.clear']],
  ['Help', ['help.welcome', 'help.shortcuts', '-', 'help.about']],
];
let menubarOpen = null;
function renderMenubar() {
  const bar = $('#menubar');
  bar.textContent = '';
  const btns = [];
  const open = i => {
    const [name, ids] = MENUS[i], btn = btns[i];
    closeMenu();
    menubarOpen = name;
    btn.classList.add('open');
    showMenu(ids.map(menuItem), btn, {
      keepOpenWithin: bar,
      onClose: () => { btn.classList.remove('open'); if (menubarOpen === name) menubarOpen = null; },
      onKey: e => { if (e.key === 'ArrowRight') { e.preventDefault(); open((i + 1) % MENUS.length); } else if (e.key === 'ArrowLeft') { e.preventDefault(); open((i - 1 + MENUS.length) % MENUS.length); } },
    });
  };
  MENUS.forEach(([name], i) => {
    const b = h('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'menu', onclick: () => { if (menubarOpen === name) closeMenu(); else open(i); }, onmouseenter: () => { if (menubarOpen && menubarOpen !== name) open(i); } }, name);
    btns.push(b); bar.append(b);
  });
}
function renderCmdCenter() {
  const b = $('#cmd-center');
  b.textContent = '';
  b.append(icon('search', 13), S.name);
}

/* ---------- boot ---------- */
async function boot() {
  const restored = loadState();
  if (!restored) Seed.apply(vfs, git);
  if (innerWidth < 760) S.sideVisible = false;
  document.documentElement.dataset.ideTheme = S.settings.theme;
  $('#logo').innerHTML = LOGO(18);
  defineCommands();
  renderMenubar(); renderCmdCenter(); bindTabs(); bindSashes();
  $('#cmd-center').addEventListener('click', () => openPalette(''));
  for (const id of ['file-input', 'folder-input']) $('#' + id).addEventListener('change', e => { if (e.target.files.length) importFiles(e.target.files, id === 'file-input' ? selectedDir() : ''); e.target.value = ''; });
  window.addEventListener('keydown', e => {
    if ($('.scrim')) return;
    const id = KEYS[keyString(e)];
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    closeMenu();
    runCmd(id);
  }, true);
  window.addEventListener('unhandledrejection', e => { if (e.reason && (e.reason.name === 'Canceled' || e.reason.message === 'Canceled')) e.preventDefault(); });
  window.addEventListener('beforeunload', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  new ResizeObserver(debounce(fitTerms, 60)).observe($('#term-stack'));
  vfs.on(onFsChange);
  git.on(refresh);
  S.deco = gitDeco();
  buildSide(); layout(); renderPanel(); renderStatus();
  if (restored && S.restore) {
    for (const p of S.restore.tabs) openTab({ kind: 'file', path: p }, { background: true });
    const t = S.tabs.find(x => x.path === S.restore.active) || S.tabs[0];
    activateTab(t ? t.id : null);
  } else openDefaultTabs();
  if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then(d => { S.downloads = d || null; }, () => {});

  const fontWait = document.fonts && document.fonts.load ? Promise.race([document.fonts.load('13px "JetBrains Mono"'), new Promise(r => setTimeout(r, 1500))]).catch(() => {}) : Promise.resolve();
  try {
    await loadScript(CDN.xterm);
    await loadScript(CDN.fit);
    await fontWait;
    S.xtermReady = true;
    if (S.panelVisible && S.panelTab === 'terminal') ensureTerm();
  } catch (e) {
    $('#term-stack').append(h('div', { class: 'hint' }, 'The terminal component could not be loaded from the CDN. Check the network connection and reload the page.'));
  }
  try {
    const vsAbs = new URL(CDN.vs, location.href).href;
    let workerUrl = null;
    window.MonacoEnvironment = {
      getWorkerUrl: () => {
        // Same origin (desktop build or own server): the worker script can be loaded directly.
        if (new URL(vsAbs).protocol === 'file:' || new URL(vsAbs).origin === location.origin) return vsAbs + '/base/worker/workerMain.js';
        if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([`self.MonacoEnvironment={baseUrl:${JSON.stringify(vsAbs.replace(/vs$/, ''))}};importScripts(${JSON.stringify(vsAbs + '/base/worker/workerMain.js')});`], { type: 'text/javascript' }));
        return workerUrl;
      },
    };
    await loadScript(CDN.vs + '/loader.js');
    await new Promise((res, rej) => {
      window.require.config({ paths: { vs: vsAbs }, 'vs/css': { disabled: true } });
      window.require(['vs/editor/editor.main'], res, rej);
    });
    initMonaco();
  } catch (e) {
    const host = $('#load-host');
    host.textContent = '';
    host.append(h('div', null, 'The editor component could not be loaded from the CDN.\nCheck the network connection and reload the page.'));
    console.error(e);
  }
}
boot();
