'use strict';
/* App part 1: state, persistence, models, tabs, side bar views. */
const { P, VFS, Git } = Core;
const STORE_KEY = 'juniper-ide:v1';
const vfs = new VFS(), git = new Git(vfs);
const S = {
  name: Seed.name,
  tabs: [], active: null, mru: [],
  models: new Map(), diff: null,
  expanded: new Set(['src', 'styles']), collapsed: new Set(['openEditors', 'branches']),
  selected: null, pending: null, renaming: null,
  view: 'explorer', sideVisible: true, panelVisible: true, panelTab: 'terminal', sideW: 280, panelH: 250,
  settings: { theme: 'dark', fontSize: 13, tabSize: 2, wordWrap: false, minimap: true, lineNumbers: true, autoSave: false, ligatures: false, whitespace: false },
  search: { q: '', replace: '', cs: false, word: false, rx: false, results: null, error: '', closed: new Set() },
  scm: { message: '', openCommit: null },
  terms: [], activeTerm: null, termSeq: 0,
  output: [], deco: null, monacoReady: false, xtermReady: false, downloads: null, restore: null,
};
let editor = null, diffEditor = null;

const curTab = () => S.tabs.find(t => t.id === S.active) || null;
const tabModelPath = t => (t.kind === 'file' || (t.kind === 'diff' && t.mode === 'working') ? t.path : null);
const tabKey = t => (t.kind === 'file' ? 'file:' + t.path : t.kind === 'diff' ? `diff:${t.mode}:${t.commit || ''}:${t.path}` : t.kind === 'preview' ? 'preview:' + t.path : t.kind);

/* ---------- persistence ---------- */
function saveNow() {
  try {
    const t = curTab();
    localStorage.setItem(STORE_KEY, JSON.stringify({
      v: 1, name: S.name, vfs: vfs.toJSON(), git: git.toJSON(), settings: S.settings,
      ui: {
        view: S.view, sideVisible: S.sideVisible, panelVisible: S.panelVisible, panelTab: S.panelTab, sideW: S.sideW, panelH: S.panelH,
        expanded: [...S.expanded], tabs: S.tabs.filter(x => x.kind === 'file').map(x => x.path), active: t && t.kind === 'file' ? t.path : null,
      },
    }));
  } catch {}
}
const persist = debounce(saveNow, 400);
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const j = JSON.parse(raw);
    if (!j || j.v !== 1 || !j.vfs || !j.git) return false;
    vfs.load(j.vfs); git.load(j.git);
    Object.assign(S.settings, j.settings || {});
    S.name = j.name || S.name;
    const u = j.ui || {};
    for (const k of ['view', 'sideVisible', 'panelVisible', 'panelTab', 'sideW', 'panelH']) if (u[k] !== undefined) S[k] = u[k];
    S.expanded = new Set(u.expanded || []);
    S.restore = { tabs: (u.tabs || []).filter(p => vfs.isFile(p)), active: u.active };
    return true;
  } catch { return false; }
}

/* ---------- output channel ---------- */
function logOutput(text) {
  S.output.push({ time: new Date().toTimeString().slice(0, 8), text });
  if (S.output.length > 500) S.output.shift();
  if (S.panelTab === 'output') renderOutput();
}
function gitTry(label, fn) {
  try { const r = fn(); logOutput('> ' + label); return r === undefined ? true : r; }
  catch (e) { logOutput(`> ${label}\n${e.message}`); notify(e.message, 'error', 9000); return null; }
}

/* ---------- models ---------- */
function getModel(path) {
  let m = S.models.get(path);
  if (!m) {
    const model = monaco.editor.createModel(vfs.read(path) ?? '', undefined, monaco.Uri.file('/' + path));
    model.updateOptions({ tabSize: S.settings.tabSize, insertSpaces: true });
    m = { model, viewState: null, dirty: false, timer: null };
    S.models.set(path, m);
    model.onDidChangeContent(() => onModelEdit(path));
  }
  return m;
}
function onModelEdit(path) {
  const m = S.models.get(path);
  if (!m) return;
  const was = m.dirty;
  m.dirty = m.model.getValue() !== vfs.read(path);
  if (was !== m.dirty) { renderTabs(); if (S.view === 'explorer') updateSide(); }
  scheduleGutter();
  if (S.settings.autoSave && m.dirty) { clearTimeout(m.timer); m.timer = setTimeout(() => saveFile(path), 900); }
}
function saveFile(path) {
  const m = S.models.get(path);
  if (!m || !vfs.isFile(path) && !m.dirty) return;
  clearTimeout(m.timer);
  vfs.write(path, m.model.getValue());
}
function saveAll() { for (const [p, m] of S.models) if (m.dirty) saveFile(p); }
const dirtyPaths = () => [...S.models].filter(([, m]) => m.dirty).map(([p]) => p);

function onFsChange() {
  for (const [path, m] of [...S.models]) {
    if (!vfs.isFile(path)) continue;
    const disk = vfs.read(path), val = m.model.getValue();
    if (val !== disk && !m.dirty) m.model.setValue(disk);
    else m.dirty = val !== disk;
  }
  for (const t of [...S.tabs]) if ((t.kind === 'file' || t.kind === 'preview') && !vfs.isFile(t.path)) removeTab(t.id);
  if (S.selected && !vfs.exists(S.selected)) S.selected = null;
  for (const d of [...S.expanded]) if (!vfs.isDir(d)) S.expanded.delete(d);
  refresh();
}

/* ---------- refresh ---------- */
let refreshQueued = false;
function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => { refreshQueued = false; doRefresh(); });
}
function gitDeco() {
  const st = git.status(), files = new Map(), dirs = new Map();
  for (const x of st.staged) files.set(x.path, x.status);
  for (const x of st.unstaged) files.set(x.path, x.status);
  for (const [p, s] of files) {
    const mod = s !== 'U' && s !== 'A';
    for (let d = P.dirname(p); d; d = P.dirname(d)) if (mod || !dirs.has(d)) dirs.set(d, mod ? 'M' : 'U');
  }
  return { st, files, dirs };
}
function doRefresh() {
  S.deco = gitDeco();
  if (S.view === 'search' && S.search.q) runSearch(true);
  updateSide();
  renderActivity();
  renderTabs();
  renderTabActions();
  renderStatus();
  refreshDiff();
  refreshPreview();
  scheduleGutter();
  persist();
}

/* ---------- tabs ---------- */
function openTab(t, opts = {}) {
  t.id = tabKey(t);
  let ex = S.tabs.find(x => x.id === t.id);
  if (!ex) {
    const i = S.tabs.findIndex(x => x.id === S.active);
    S.tabs.splice(i < 0 ? S.tabs.length : i + 1, 0, t);
    ex = t;
  }
  if (opts.background) renderTabs(); else activateTab(ex.id);
  return ex;
}
function openFile(path, opts = {}) {
  if (!vfs.isFile(path)) return;
  for (let d = P.dirname(path); d; d = P.dirname(d)) S.expanded.add(d);
  S.selected = path;
  openTab({ kind: 'file', path }, opts);
  if (opts.background) return;
  if (editor && S.monacoReady) {
    if (opts.line) {
      const col = opts.col || 1;
      editor.setSelection(new monaco.Range(opts.line, col, opts.line, col + (opts.len || 0)));
      editor.revealLineInCenterIfOutsideViewport(opts.line);
    }
    if (opts.focus !== false) editor.focus();
  }
  if (S.view === 'explorer') updateSide();
}
function openDiff(path, mode, commit) { openTab({ kind: 'diff', path, mode, commit }); }

function showHost(name) {
  for (const id of ['monaco', 'diff', 'page', 'empty', 'load']) $(`#${id}-host`).hidden = id !== name;
}
function activateTab(id) {
  const prev = curTab();
  if (editor && prev && prev.kind === 'file' && S.models.has(prev.path) && editor.getModel() === S.models.get(prev.path).model) S.models.get(prev.path).viewState = editor.saveViewState();
  if (S.diff && (!id || S.diff.id !== id)) clearDiff();
  S.active = id;
  if (id) S.mru = [id, ...S.mru.filter(x => x !== id)];
  const t = curTab();
  if (!t) { showHost('empty'); renderEmpty(); }
  else if (t.kind === 'file' || t.kind === 'diff') {
    if (!S.monacoReady) showHost('load');
    else if (t.kind === 'file') {
      const m = getModel(t.path);
      if (editor.getModel() !== m.model) { editor.setModel(m.model); if (m.viewState) editor.restoreViewState(m.viewState); }
      showHost('monaco');
      S.selected = t.path;
    } else { setupDiff(t); showHost('diff'); }
  } else { showHost('page'); renderPage(t); }
  renderTabs(); renderCrumbs(); renderTabActions(); renderStatus(); scheduleGutter();
  if (S.view === 'explorer') updateSide();
  persist();
}
function removeTab(id) {
  const i = S.tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const t = S.tabs[i];
  if (S.diff && S.diff.id === id) clearDiff();
  S.tabs.splice(i, 1);
  S.mru = S.mru.filter(x => x !== id);
  const p = tabModelPath(t);
  if (p && !S.tabs.some(x => tabModelPath(x) === p)) {
    const m = S.models.get(p);
    if (m) {
      clearTimeout(m.timer);
      if (editor && editor.getModel() === m.model) editor.setModel(null);
      m.model.dispose();
      S.models.delete(p);
    }
  }
  if (S.active === id) {
    S.active = null;
    const next = S.mru.find(x => S.tabs.some(y => y.id === x)) || (S.tabs[Math.min(i, S.tabs.length - 1)] || {}).id || null;
    activateTab(next);
  } else { renderTabs(); persist(); }
}
async function closeTab(id, force) {
  const t = S.tabs.find(x => x.id === id);
  if (!t) return true;
  const p = tabModelPath(t), m = p && S.models.get(p);
  if (!force && m && m.dirty && !S.tabs.some(x => x !== t && tabModelPath(x) === p)) {
    activateTab(id);
    const r = await dialog({
      title: `Do you want to save the changes you made to ${P.basename(p)}?`,
      detail: "Your changes will be lost if you don't save them.",
      buttons: [{ label: "Don't Save", value: 'discard' }, { label: 'Cancel', value: null }, { label: 'Save', value: 'save', primary: true }],
    });
    if (!r) return false;
    if (r === 'save') saveFile(p);
  }
  removeTab(id);
  return true;
}
async function closeTabs(list) { for (const t of [...list]) if (!(await closeTab(t.id))) break; }

function tabInfo(t) {
  const base = t.path ? P.basename(t.path) : '';
  if (t.kind === 'file') {
    const twin = S.tabs.some(x => x !== t && x.kind === 'file' && P.basename(x.path) === base);
    return { label: base, desc: twin ? P.dirname(t.path) || '.' : '', title: t.path, icon: fileIcon(base), dirty: !!(S.models.get(t.path) || {}).dirty, git: S.deco && S.deco.files.get(t.path) };
  }
  if (t.kind === 'diff') {
    const what = t.mode === 'working' ? 'Working Tree' : t.mode === 'staged' ? 'Index' : git.short(t.commit);
    return { label: `${base} (${what})`, title: `${t.path} (${what})`, icon: icon('diff', 14), dirty: t.mode === 'working' && !!(S.models.get(t.path) || {}).dirty && !S.tabs.some(x => x.kind === 'file' && x.path === t.path) };
  }
  if (t.kind === 'preview') return { label: `Preview ${base}`, title: `Preview of ${t.path}`, icon: icon('preview', 14) };
  if (t.kind === 'settings') return { label: 'Settings', title: 'Settings', icon: icon('gear', 14) };
  return { label: 'Welcome', title: 'Welcome', icon: h('span', { class: 'ico' }, '') };
}
function renderTabs() {
  const host = $('#tabs');
  host.textContent = '';
  for (const t of S.tabs) {
    const info = tabInfo(t);
    const el = h('div', { class: 'tab' + (t.id === S.active ? ' active' : '') + (info.dirty ? ' dirty' : ''), role: 'tab', 'aria-selected': t.id === S.active ? 'true' : 'false', title: info.title, draggable: 'true', dataset: { id: t.id } },
      info.icon, h('span', { class: 'label' + (info.git ? ' g-' + info.git : '') }, info.label), info.desc ? h('span', { class: 'desc' }, info.desc) : null,
      h('button', { class: 'tab-close', type: 'button', title: 'Close', 'aria-label': `Close ${info.label}` }, icon('close', 14)));
    if (t.kind === 'welcome') el.querySelector('.ico').innerHTML = LOGO(14);
    host.append(el);
  }
  const act = host.querySelector('.tab.active');
  if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function bindTabs() {
  const host = $('#tabs');
  const idOf = e => { const el = e.target.closest('.tab'); return el ? el.dataset.id : null; };
  host.addEventListener('click', e => {
    const id = idOf(e);
    if (!id) return;
    if (e.target.closest('.tab-close')) closeTab(id); else { activateTab(id); focusEditor(); }
  });
  host.addEventListener('auxclick', e => { const id = idOf(e); if (id && e.button === 1) { e.preventDefault(); closeTab(id); } });
  host.addEventListener('contextmenu', e => {
    const id = idOf(e);
    if (!id) return;
    e.preventDefault();
    const t = S.tabs.find(x => x.id === id);
    showMenu([
      { label: 'Close', kb: 'Alt+W', run: () => closeTab(id) },
      { label: 'Close Others', disabled: S.tabs.length < 2, run: () => closeTabs(S.tabs.filter(x => x.id !== id)) },
      { label: 'Close All', run: () => closeTabs(S.tabs) },
      '-',
      t.path ? { label: 'Copy Path', run: () => copyText(t.path) } : null,
      t.path && vfs.isFile(t.path) ? { label: 'Reveal in Explorer', run: () => { showView('explorer'); S.selected = t.path; for (let d = P.dirname(t.path); d; d = P.dirname(d)) S.expanded.add(d); updateSide(); } } : null,
    ], { x: e.clientX, y: e.clientY });
  });
  let dragId = null;
  host.addEventListener('dragstart', e => { dragId = idOf(e); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId || ''); } catch {} });
  host.addEventListener('dragover', e => { if (!dragId) return; e.preventDefault(); host.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before')); const el = e.target.closest('.tab'); if (el) el.classList.add('drop-before'); });
  host.addEventListener('dragend', () => { dragId = null; host.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before')); });
  host.addEventListener('drop', e => {
    if (!dragId) return;
    e.preventDefault();
    const target = idOf(e), from = S.tabs.findIndex(t => t.id === dragId);
    if (from < 0) return;
    const [moved] = S.tabs.splice(from, 1);
    const to = target ? S.tabs.findIndex(t => t.id === target) : S.tabs.length;
    S.tabs.splice(to < 0 ? S.tabs.length : to, 0, moved);
    dragId = null;
    renderTabs(); persist();
  });
  host.addEventListener('wheel', e => { if (e.deltaY && !e.deltaX) host.scrollLeft += e.deltaY; }, { passive: true });
}
function renderCrumbs() {
  const host = $('#crumbs'), t = curTab();
  host.textContent = '';
  if (!t || !t.path || t.kind === 'preview') return;
  const parts = [S.name, ...t.path.split('/')];
  parts.forEach((p, i) => {
    if (i) host.append(h('span', { class: 'sep' }, '›'));
    if (i === parts.length - 1) host.append(fileIcon(p));
    host.append(h('span', null, p));
  });
}
function renderTabActions() {
  const host = $('#tab-actions'), t = curTab();
  host.textContent = '';
  if (t && t.kind === 'file') {
    const ext = P.ext(t.path);
    if (['js', 'cjs', 'mjs'].includes(ext)) host.append(iconBtn('play', 'Run File (F5)', () => runCmd('run.active')));
    if (['html', 'htm'].includes(ext)) host.append(iconBtn('preview', 'Open Preview', () => runCmd('run.preview')));
    const g = S.deco && S.deco.files.get(t.path);
    if (g && g !== 'U') host.append(iconBtn('diff', 'Open Changes', () => openDiff(t.path, S.deco.st.unstaged.some(x => x.path === t.path) ? 'working' : 'staged')));
  }
  if (t && t.kind === 'diff' && vfs.isFile(t.path)) host.append(iconBtn('file', 'Open File', () => openFile(t.path)));
  host.append(iconBtn('more', 'More Actions…', e => showMenu([
    { label: 'Close All Editors', disabled: !S.tabs.length, run: () => closeTabs(S.tabs) },
    { label: 'Close Saved Editors', disabled: !S.tabs.length, run: () => closeTabs(S.tabs.filter(x => !tabInfo(x).dirty)) },
    '-',
    { label: 'Word Wrap', kb: 'Alt+Z', checked: S.settings.wordWrap, run: () => runCmd('view.wordWrap') },
    { label: 'Minimap', checked: S.settings.minimap, run: () => runCmd('view.minimap') },
  ], e.currentTarget, { alignRight: true })));
}
function focusEditor() {
  const t = curTab();
  if (!t || !S.monacoReady) return;
  if (t.kind === 'file') editor.focus(); else if (t.kind === 'diff') diffEditor.getModifiedEditor().focus();
}
function activeCodeEditor() {
  const t = curTab();
  if (!t || !S.monacoReady) return null;
  return t.kind === 'file' ? editor : t.kind === 'diff' ? diffEditor.getModifiedEditor() : null;
}

/* ---------- diff tabs ---------- */
let diffSeq = 0;
function diffSides(t) {
  if (t.mode === 'working') {
    const live = vfs.isFile(t.path);
    return { left: git.content(git.index[t.path]), right: live ? null : '', live };
  }
  if (t.mode === 'staged') return { left: git.content(git.headTree()[t.path]), right: git.content(git.index[t.path]), live: false };
  const c = git.commits[t.commit];
  return { left: c ? git.content(git.treeOf(c.parents[0])[t.path]) : '', right: c ? git.content(c.tree[t.path]) : '', live: false };
}
function setupDiff(t) {
  const s = diffSides(t);
  clearDiff();
  const mk = (text, side) => monaco.editor.createModel(text, undefined, monaco.Uri.parse(`gitview://${side}${++diffSeq}/${t.path}`));
  const original = mk(s.left, 'a');
  const modified = s.live ? getModel(t.path).model : mk(s.right, 'b');
  diffEditor.setModel({ original, modified });
  diffEditor.updateOptions({ readOnly: !s.live });
  S.diff = { id: t.id, original, modified: s.live ? null : modified, left: s.left, right: s.right, live: s.live };
}
function clearDiff() {
  if (!S.diff) return;
  diffEditor.setModel(null);
  S.diff.original.dispose();
  if (S.diff.modified) S.diff.modified.dispose();
  S.diff = null;
}
function refreshDiff() {
  const t = curTab();
  if (!t || t.kind !== 'diff' || !S.monacoReady) return;
  const s = diffSides(t);
  if (!S.diff || S.diff.left !== s.left || S.diff.live !== s.live || S.diff.right !== s.right) setupDiff(t);
}

/* ---------- side bar shell ---------- */
const VIEWS = [
  ['explorer', 'files', 'Explorer', 'Ctrl+Shift+E'],
  ['search', 'search', 'Search', 'Ctrl+Shift+F'],
  ['scm', 'branch', 'Source Control', 'Ctrl+Shift+G'],
  ['run', 'play', 'Run', 'Ctrl+Shift+D'],
  ['diya', 'diya', 'Diya', 'Ctrl+Shift+Q'],
];
function renderActivity() {
  const host = $('#activity');
  host.textContent = '';
  const changes = S.deco ? S.deco.files.size : 0;
  for (const [id, ic, title, kb] of VIEWS) {
    const label = kb ? `${title} (${kbLabel(kb)})` : title;
    const b = h('button', { class: 'act-btn' + (S.view === id && S.sideVisible ? ' active' : ''), type: 'button', title: label, 'aria-label': title, onclick: () => { if (S.view === id && S.sideVisible) { S.sideVisible = false; layout(); } else showView(id); } }, icon(ic, 24));
    if (id === 'scm' && changes) b.append(h('span', { class: 'act-badge' }, String(changes)));
    host.append(b);
  }
  host.append(h('div', { class: 'act-spacer' }), h('button', { class: 'act-btn', type: 'button', title: 'Manage', 'aria-label': 'Manage', onclick: e => showMenu(['view.palette', '-', 'view.settings', 'view.theme', 'help.shortcuts', '-', 'workspace.reset'].map(menuItem), e.currentTarget, { above: true }) }, icon('gear', 24)));
}
function showView(id, focus) {
  S.view = id; S.sideVisible = true;
  buildSide(); layout(); renderActivity();
  if (focus !== false) {
    const f = id === 'search' ? $('#search-q') : id === 'scm' ? $('#scm-message') : id === 'explorer' ? $('#tree') : null;
    if (f) { f.focus(); if (f.select) f.select(); }
  }
}
function sideHead(title, actions) { return h('div', { class: 'side-head' }, h('span', { class: 'side-title' }, title), actions); }
function secHead(name, key, actions, count) {
  const open = !S.collapsed.has(key);
  return h('div', { class: 'sec-head', role: 'button', tabindex: '0', 'aria-expanded': String(open), onclick: () => { if (open) S.collapsed.add(key); else S.collapsed.delete(key); updateSide(); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } },
    icon(open ? 'chevD' : 'chevR', 16), h('span', { class: 'sec-name' }, name), actions && actions.length ? h('span', { class: 'sec-actions' }, actions) : null, count != null ? h('span', { class: 'count' }, String(count)) : null);
}
function buildSide() {
  const side = $('#sidebar');
  side.textContent = '';
  side.dataset.view = S.view;
  ({ explorer: buildExplorer, search: buildSearch, scm: buildScm, run: buildRun, diya: buildDiya })[S.view](side);
  updateSide();
}
function updateSide() {
  if (!S.deco) S.deco = gitDeco();
  if ($('#sidebar').dataset.view !== S.view) return;
  ({ explorer: updateExplorer, search: updateSearch, scm: updateScm, run: updateRun, diya: updateDiya })[S.view]();
}

/* ---------- explorer ---------- */
function buildExplorer(side) {
  const tree = h('div', { class: 'sec-body fill', id: 'tree', tabindex: '0', role: 'tree', 'aria-label': 'Files' });
  side.append(
    sideHead('Explorer', iconBtn('more', 'More Actions…', e => showMenu(['file.new', 'file.newFolder', '-', 'file.openFiles', 'file.openFolder', 'file.downloadZip', '-', 'workspace.reset'].map(menuItem), e.currentTarget))),
    h('div', { class: 'side-body' }, h('div', { id: 'open-editors-sec' }), h('div', { id: 'tree-head' }), tree));
  bindTree(tree);
}
function updateExplorer() {
  const oe = $('#open-editors-sec');
  oe.textContent = '';
  oe.append(secHead('Open Editors', 'openEditors', [iconBtn('collapse', 'Close All Editors', () => closeTabs(S.tabs))]));
  if (!S.collapsed.has('openEditors')) {
    for (const t of S.tabs) {
      const info = tabInfo(t);
      oe.append(h('div', { class: 'row' + (t.id === S.active ? ' sel' : ''), style: { paddingLeft: '8px' }, title: info.title, onclick: () => activateTab(t.id) },
        h('button', { class: 'icon-btn', style: { width: '20px', height: '20px' }, type: 'button', title: 'Close', onclick: e => { e.stopPropagation(); closeTab(t.id); } }, info.dirty ? h('span', { class: 'dot' }) : icon('close', 14)),
        info.icon, h('span', { class: 'label' }, info.label), t.path ? h('span', { class: 'desc' }, P.dirname(t.path)) : null));
    }
    if (!S.tabs.length) oe.append(h('div', { class: 'hint', style: { padding: '4px 24px' } }, 'No open editors'));
  }
  const th = $('#tree-head');
  th.textContent = '';
  th.append(secHead(S.name, 'tree', [
    iconBtn('newFile', 'New File…', () => newEntry('file')),
    iconBtn('newFolder', 'New Folder…', () => newEntry('folder')),
    iconBtn('refresh', 'Refresh Explorer', () => refresh()),
    iconBtn('collapse', 'Collapse Folders', () => { S.expanded.clear(); updateSide(); }),
  ]));
  renderTree();
}
function renderTree() {
  const tree = $('#tree');
  if (!tree) return;
  const hadFocus = document.activeElement === tree;
  tree.hidden = S.collapsed.has('tree');
  tree.textContent = '';
  const deco = S.deco;
  const guides = depth => Array.from({ length: depth }, (_, i) => h('span', { class: 'guide', style: { left: 11 + i * 12 + 'px' } }));
  const inputRow = (depth, kind, value, done) => {
    let finished = false;
    const input = h('input', { class: 'row-input', type: 'text', id: 'tree-input', value, spellcheck: 'false', autocomplete: 'off', 'aria-label': kind === 'folder' ? 'Folder name' : 'File name' });
    const finish = ok => { if (finished) return; finished = true; done(ok ? input.value.trim() : null); };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(!!input.value.trim()));
    input.addEventListener('click', e => e.stopPropagation());
    setTimeout(() => { input.focus(); const dot = value.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : value.length); }, 0);
    return h('div', { class: 'row', style: { paddingLeft: 4 + depth * 12 + 'px' } }, guides(depth), kind === 'folder' ? icon('chevR', 16) : [h('span', { class: 'chev' }), fileIcon(value || 'x.txt')], input);
  };
  const walk = (dir, depth) => {
    if (S.pending && S.pending.dir === dir) tree.append(inputRow(depth, S.pending.kind, '', name => commitNew(name)));
    for (const ent of vfs.list(dir)) {
      if (S.renaming === ent.path) { tree.append(inputRow(depth, ent.dir ? 'folder' : 'file', ent.name, name => commitRename(ent.path, name))); continue; }
      const st = ent.dir ? deco.dirs.get(ent.path) : deco.files.get(ent.path);
      const open = ent.dir && S.expanded.has(ent.path);
      const dirty = !ent.dir && (S.models.get(ent.path) || {}).dirty;
      tree.append(h('div', {
        class: 'row' + (S.selected === ent.path ? ' sel' : '') + (st ? ' g-' + st : '') + (!st && git.ignored(ent.path) ? ' ignored' : ''),
        role: 'treeitem', 'aria-expanded': ent.dir ? String(open) : null, draggable: 'true', title: ent.path,
        dataset: { path: ent.path, dir: ent.dir ? '1' : '' }, style: { paddingLeft: 4 + depth * 12 + 'px' },
      }, guides(depth), ent.dir ? h('span', { class: 'chev ico' }, icon(open ? 'chevD' : 'chevR', 16)) : [h('span', { class: 'chev' }), fileIcon(ent.name)],
      h('span', { class: 'label' }, ent.name),
      st ? h('span', { class: 'badge', title: { M: 'Modified', U: 'Untracked', A: 'Added', D: 'Deleted' }[st] }, ent.dir ? h('span', { class: 'dot' }) : st) : dirty ? h('span', { class: 'badge' }, h('span', { class: 'dot' })) : null));
      if (open) walk(ent.path, depth + 1);
    }
  };
  walk('', 0);
  if (!vfs.files.size && !vfs.dirs.size && !S.pending) tree.append(h('div', { class: 'hint' }, 'This workspace is empty. Create a file, or drop files here to import them.'));
  if (hadFocus) tree.focus();
}
function selectedDir() {
  const s = S.selected;
  if (!s) return '';
  return vfs.isDir(s) ? s : P.dirname(s);
}
function newEntry(kind, dir) {
  if (S.view !== 'explorer' || !S.sideVisible) showView('explorer', false);
  S.collapsed.delete('tree');
  dir = dir === undefined ? selectedDir() : dir;
  for (let d = dir; d; d = P.dirname(d)) S.expanded.add(d);
  S.pending = { kind, dir };
  updateSide();
}
function commitNew(name) {
  const p = S.pending;
  S.pending = null;
  if (!p || !name) { updateSide(); return; }
  const path = P.join(p.dir, name);
  try {
    if (!path || vfs.exists(path)) throw new Error(`A file or folder named '${name}' already exists here.`);
    if (p.kind === 'folder') { vfs.mkdir(path); S.expanded.add(path); S.selected = path; }
    else { vfs.write(path, ''); openFile(path); }
  } catch (e) { notify(e.message, 'error'); }
  updateSide();
}
function commitRename(from, name) {
  S.renaming = null;
  if (name && name !== P.basename(from)) {
    if (name.includes('/')) notify('A name cannot contain "/". Drag the item to move it to another folder.', 'error');
    else movePath(from, P.join(P.dirname(from), name));
  }
  updateSide();
}
function movePath(from, to) {
  if (from === to) return;
  const affected = S.tabs.filter(t => t.kind === 'file' && P.within(t.path, from)).map(t => {
    const m = S.models.get(t.path);
    return { old: t.path, active: t.id === S.active, value: m && m.dirty ? m.model.getValue() : null };
  });
  const wasOpen = [...S.expanded].filter(d => P.within(d, from)), wasSel = S.selected;
  try { vfs.rename(from, to); } catch (e) { notify(e.message, 'error'); return; }
  for (const d of wasOpen) { S.expanded.delete(d); S.expanded.add(to + d.slice(from.length)); }
  if (wasSel && P.within(wasSel, from)) S.selected = to + wasSel.slice(from.length);
  for (const a of affected) {
    const np = to + a.old.slice(from.length);
    openTab({ kind: 'file', path: np }, { background: !a.active });
    if (a.value != null && S.monacoReady) getModel(np).model.setValue(a.value);
  }
  refresh();
}
async function deleteEntry(path) {
  const isDir = vfs.isDir(path);
  const r = await dialog({
    title: `Are you sure you want to delete '${P.basename(path)}'${isDir ? ' and its contents' : ''}?`,
    detail: 'There is no trash here. Files that were committed can be restored from Source Control.',
    buttons: [{ label: 'Cancel', value: null }, { label: 'Delete', value: 'yes', primary: true }],
  });
  if (r !== 'yes') return;
  try { vfs.remove(path); } catch (e) { notify(e.message, 'error'); }
}
function explorerMenu(path, x, y) {
  const isDir = path != null && vfs.isDir(path), isFile = path != null && vfs.isFile(path);
  const dir = path == null ? '' : isDir ? path : P.dirname(path);
  const ext = isFile ? P.ext(path) : '';
  const g = isFile && S.deco.files.get(path);
  showMenu([
    isFile ? { label: 'Open', run: () => openFile(path) } : null,
    isFile && ['html', 'htm'].includes(ext) ? { label: 'Open Preview', run: () => openTab({ kind: 'preview', path }) } : null,
    isFile && ['js', 'cjs', 'mjs'].includes(ext) ? { label: 'Run in Terminal', run: () => runInTerminal('node ' + path) } : null,
    isFile && g && g !== 'U' ? { label: 'Open Changes', run: () => openDiff(path, S.deco.st.unstaged.some(s => s.path === path) ? 'working' : 'staged') } : null,
    isFile ? '-' : null,
    { label: 'New File…', run: () => newEntry('file', dir) },
    { label: 'New Folder…', run: () => newEntry('folder', dir) },
    isDir ? { label: 'Open in Terminal', run: () => runInTerminal('cd /' + path) } : null,
    '-',
    path != null ? { label: 'Rename…', kb: 'F2', run: () => { S.renaming = path; updateSide(); } } : null,
    path != null ? { label: 'Delete', kb: 'Delete', run: () => deleteEntry(path) } : null,
    path != null ? '-' : null,
    path != null ? { label: 'Copy Path', run: () => copyText(path) } : null,
    path == null ? menuItem('file.openFiles') : null,
  ], { x, y });
}
function bindTree(tree) {
  const rowOf = e => e.target.closest('.row[data-path]');
  tree.addEventListener('click', e => {
    const row = rowOf(e);
    if (!row) { S.selected = null; renderTree(); return; }
    const path = row.dataset.path;
    S.selected = path;
    if (row.dataset.dir) { if (S.expanded.has(path)) S.expanded.delete(path); else S.expanded.add(path); renderTree(); persist(); }
    else openFile(path, { focus: false });
  });
  tree.addEventListener('dblclick', e => { const row = rowOf(e); if (row && !row.dataset.dir) focusEditor(); });
  tree.addEventListener('contextmenu', e => {
    e.preventDefault();
    const row = rowOf(e);
    if (row) { S.selected = row.dataset.path; renderTree(); }
    explorerMenu(row ? row.dataset.path : null, e.clientX, e.clientY);
  });
  tree.addEventListener('keydown', e => {
    if (e.target !== tree) return;
    const rows = [...tree.querySelectorAll('.row[data-path]')].map(r => r.dataset.path);
    const i = rows.indexOf(S.selected), sel = S.selected;
    const move = j => { if (rows.length) { S.selected = rows[Math.max(0, Math.min(rows.length - 1, j))]; renderTree(); const el = tree.querySelector('.row.sel'); if (el) el.scrollIntoView({ block: 'nearest' }); } };
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(i < 0 ? 0 : i - 1); }
    else if (e.key === 'ArrowRight' && sel && vfs.isDir(sel)) { e.preventDefault(); if (S.expanded.has(sel)) move(i + 1); else { S.expanded.add(sel); renderTree(); } }
    else if (e.key === 'ArrowLeft' && sel) { e.preventDefault(); if (vfs.isDir(sel) && S.expanded.has(sel)) { S.expanded.delete(sel); renderTree(); } else if (P.dirname(sel)) { S.selected = P.dirname(sel); renderTree(); } }
    else if (e.key === 'Enter' && sel) { e.preventDefault(); if (vfs.isDir(sel)) { if (S.expanded.has(sel)) S.expanded.delete(sel); else S.expanded.add(sel); renderTree(); } else openFile(sel); }
    else if (e.key === 'F2' && sel) { e.preventDefault(); S.renaming = sel; updateSide(); }
    else if (e.key === 'Delete' && sel) { e.preventDefault(); deleteEntry(sel); }
  });
  let dragPath = null;
  const clearDrop = () => tree.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
  const dropDir = e => { const row = rowOf(e); if (!row) return ''; return row.dataset.dir ? row.dataset.path : P.dirname(row.dataset.path); };
  tree.addEventListener('dragstart', e => { const row = rowOf(e); dragPath = row ? row.dataset.path : null; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragPath || ''); } catch {} });
  tree.addEventListener('dragover', e => {
    e.preventDefault();
    clearDrop();
    const dir = dropDir(e);
    const row = dir ? tree.querySelector(`.row[data-path="${CSS.escape(dir)}"]`) : null;
    if (row) row.classList.add('drop');
  });
  tree.addEventListener('dragleave', e => { if (!tree.contains(e.relatedTarget)) clearDrop(); });
  tree.addEventListener('dragend', () => { dragPath = null; clearDrop(); });
  tree.addEventListener('drop', e => {
    e.preventDefault();
    clearDrop();
    const dir = dropDir(e);
    if (dragPath) {
      const from = dragPath; dragPath = null;
      if (P.dirname(from) !== dir && !P.within(dir, from)) { if (dir) S.expanded.add(dir); movePath(from, P.join(dir, P.basename(from))); }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length) importFiles(e.dataTransfer.files, dir);
  });
}
async function importFiles(fileList, dir = '') {
  let added = 0, skipped = 0;
  const jobs = [...fileList].map(async f => {
    const rel = f.webkitRelativePath || f.name;
    if (f.size > 1.5e6 || /(^|\/)(node_modules|\.git)\//.test(rel)) { skipped++; return null; }
    const text = await f.text();
    if (text.includes('\u0000')) { skipped++; return null; }
    return [P.join(dir, rel), text.replace(/\r\n/g, '\n')];
  });
  const done = (await Promise.all(jobs)).filter(Boolean);
  vfs.batch(() => { for (const [p, text] of done) { try { vfs.write(p, text); added++; } catch { skipped++; } } });
  if (dir) S.expanded.add(dir);
  notify(`Imported ${added} file${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} (binary, too large, or node_modules/.git)` : ''}.`);
  if (done.length === 1) openFile(done[0][0]);
  refresh();
}

/* ---------- source control ---------- */
function buildScm(side) {
  const ta = h('textarea', { class: 'inp', id: 'scm-message', rows: '1', spellcheck: 'false', 'aria-label': 'Commit message' });
  ta.value = S.scm.message;
  const size = () => { ta.style.height = ''; if (ta.value) ta.style.height = Math.min(160, ta.scrollHeight + 2) + 'px'; };
  ta.addEventListener('input', () => { S.scm.message = ta.value; size(); });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); gitCommit(); } });
  side.append(
    sideHead('Source Control', [
      iconBtn('check', 'Commit', () => gitCommit()),
      iconBtn('refresh', 'Refresh', () => { refresh(); }),
      iconBtn('more', 'More Actions…', e => showMenu(['git.commit', 'git.stageAll', 'git.unstageAll', 'git.discardAll', '-', 'git.branch', 'git.checkout', 'git.merge', '-', 'git.stash', 'git.stashPop', '-', 'view.output'].map(menuItem), e.currentTarget)),
    ]),
    h('div', { class: 'side-body' },
      h('div', { class: 'scm-box' }, ta, h('button', { class: 'btn block', id: 'scm-commit', type: 'button', onclick: () => gitCommit() }, icon('check', 14), 'Commit')),
      h('div', { class: 'sec-body fill', id: 'scm-lists' })));
  setTimeout(size, 0);
}
const STATUS_TITLE = { M: 'Modified', U: 'Untracked', A: 'Added', D: 'Deleted' };
function changeRow(x, staged) {
  const open = () => { if (x.status === 'U') openFile(x.path); else openDiff(x.path, staged ? 'staged' : 'working'); };
  return h('div', { class: 'row g-' + x.status, style: { paddingLeft: '24px' }, title: `${x.path} • ${STATUS_TITLE[x.status]}${staged ? ' (staged)' : ''}`, onclick: open },
    fileIcon(P.basename(x.path)), h('span', { class: 'label' }, P.basename(x.path)), h('span', { class: 'desc' }, P.dirname(x.path)),
    h('span', { class: 'row-actions' },
      vfs.isFile(x.path) ? iconBtn('file', 'Open File', () => openFile(x.path)) : null,
      staged ? null : iconBtn('discard', 'Discard Changes', () => gitDiscard(x)),
      staged ? iconBtn('minus', 'Unstage Changes', () => gitTry(`git restore --staged ${x.path}`, () => git.unstage(x.path)))
        : iconBtn('plus', 'Stage Changes', () => gitTry(`git add ${x.path}`, () => { saveFile(x.path); git.add(x.path); }))),
    h('span', { class: 'badge' }, x.status));
}
function updateScm() {
  const host = $('#scm-lists');
  if (!host) return;
  const ta = $('#scm-message');
  ta.placeholder = `Message (${kbLabel('Ctrl+Enter')} to commit)`;
  if (ta.value !== S.scm.message) { ta.value = S.scm.message; ta.style.height = ''; }
  const cb = $('#scm-commit');
  cb.lastChild.textContent = `Commit to ${git.HEAD}`;
  const { staged, unstaged } = S.deco.st;
  cb.disabled = !staged.length && !unstaged.length;
  const keep = host.scrollTop;
  host.textContent = '';
  if (staged.length) {
    host.append(secHead('Staged Changes', 'staged', [iconBtn('minus', 'Unstage All Changes', () => runCmd('git.unstageAll'))], staged.length));
    if (!S.collapsed.has('staged')) staged.forEach(x => host.append(changeRow(x, true)));
  }
  host.append(secHead('Changes', 'changes', [iconBtn('discard', 'Discard All Changes', () => runCmd('git.discardAll')), iconBtn('plus', 'Stage All Changes', () => runCmd('git.stageAll'))], unstaged.length));
  if (!S.collapsed.has('changes')) {
    unstaged.forEach(x => host.append(changeRow(x, false)));
    if (!unstaged.length && !staged.length) host.append(h('div', { class: 'hint' }, 'No changes. Edit and save a file and it shows up here.'));
  }
  // commits
  const list = git.log(undefined, true), mine = git.ancestors(git.headId());
  host.append(secHead('Commits', 'commits', [], list.length));
  if (!S.collapsed.has('commits')) {
    list.forEach((c, i) => {
      const refs = git.refsAt(c.id);
      const isOpen = S.scm.openCommit === c.id;
      host.append(h('div', {
        class: 'row commit-row' + (i === 0 ? ' first' : '') + (i === list.length - 1 ? ' last' : '') + (mine.has(c.id) ? '' : ' side') + (c.parents.length > 1 ? ' merge' : '') + (c.id === git.headId() ? ' head' : ''),
        title: `${c.message}\n\n${c.author}\n${new Date(c.time).toLocaleString()}\n${c.id}`,
        onclick: () => { S.scm.openCommit = isOpen ? null : c.id; updateScm(); },
      }, h('span', { class: 'graph' }, h('span', { class: 'node' })),
      h('div', { class: 'commit-main' },
        h('div', { class: 'subject' }, refs.map(r => h('span', { class: 'ref' + (r === git.HEAD ? ' cur' : '') }, r)), c.message.split('\n')[0]),
        h('div', { class: 'meta' }, `${git.short(c.id)} · ${c.author.split(' <')[0]} · ${timeAgo(c.time)}`))));
      if (isOpen) {
        const info = git.show(c.id);
        for (const f of info.files) {
          host.append(h('div', { class: 'row g-' + f.status, style: { paddingLeft: '40px' }, title: f.path, onclick: () => openDiff(f.path, 'commit', c.id) },
            fileIcon(P.basename(f.path)), h('span', { class: 'label' }, P.basename(f.path)), h('span', { class: 'desc' }, P.dirname(f.path)), h('span', { class: 'badge' }, f.status)));
        }
        if (!info.files.length) host.append(h('div', { class: 'hint', style: { paddingLeft: '40px' } }, 'No file changes in this commit.'));
      }
    });
    if (!list.length) host.append(h('div', { class: 'hint' }, 'No commits yet.'));
  }
  // branches
  const names = Object.keys(git.branches).sort();
  host.append(secHead('Branches', 'branches', [iconBtn('plus', 'Create Branch…', () => runCmd('git.branch'))], names.length));
  if (!S.collapsed.has('branches')) {
    for (const name of names) {
      const cur = name === git.HEAD;
      host.append(h('div', { class: 'row', style: { paddingLeft: '24px' }, title: cur ? `${name} (current branch)` : `Switch to ${name}`, onclick: () => { if (!cur) gitCheckout(name); } },
        icon(cur ? 'check' : 'branch', 14), h('span', { class: 'label', style: cur ? { fontWeight: '600' } : null }, name), h('span', { class: 'desc mono' }, git.short(git.branches[name])),
        cur ? null : h('span', { class: 'row-actions' },
          iconBtn('merge', `Merge into ${git.HEAD}`, () => gitMerge(name)),
          iconBtn('trash', 'Delete Branch', () => gitDeleteBranch(name)))));
    }
  }
  if (git.stashes.length) {
    host.append(secHead('Stashes', 'stashes', [iconBtn('discard', 'Pop Latest Stash', () => runCmd('git.stashPop'))], git.stashes.length));
    if (!S.collapsed.has('stashes')) git.stashes.forEach((s, i) => host.append(h('div', { class: 'row', style: { paddingLeft: '24px' }, title: s.message }, h('span', { class: 'desc mono' }, `stash@{${i}}`), h('span', { class: 'label' }, s.message))));
  }
  host.scrollTop = keep;
}
async function gitCommit() {
  const message = S.scm.message.trim();
  if (!message) {
    if (S.view !== 'scm' || !S.sideVisible) showView('scm');
    notify('Type a commit message first.', 'warning', 3500);
    const ta = $('#scm-message'); if (ta) ta.focus();
    return;
  }
  const dirty = dirtyPaths();
  if (dirty.length) {
    const r = await dialog({ title: `Save ${dirty.length} unsaved file${dirty.length === 1 ? '' : 's'} before committing?`, detail: dirty.join('\n'), buttons: [{ label: 'Cancel', value: null }, { label: 'Commit Without Saving', value: 'no' }, { label: 'Save All and Commit', value: 'save', primary: true }] });
    if (!r) return;
    if (r === 'save') saveAll();
  }
  const st = git.status();
  if (!st.staged.length && !st.unstaged.length) { notify('There are no changes to commit.', 'info', 3500); return; }
  const all = !st.staged.length;
  const c = gitTry(`git ${all ? 'add -A && git ' : ''}commit -m ${JSON.stringify(message)}`, () => { if (all) git.add(''); return git.commit(message); });
  if (c) { S.scm.message = ''; logOutput(`[${git.HEAD} ${git.short(c.id)}] ${message.split('\n')[0]}`); refresh(); }
}
async function gitDiscard(x) {
  const untracked = x.status === 'U';
  const r = await dialog({
    title: untracked ? `Delete the untracked file '${P.basename(x.path)}'?` : `Discard changes in '${P.basename(x.path)}'?`,
    detail: untracked ? 'The file was never committed, so it cannot be restored.' : 'The file goes back to its last staged or committed content. This cannot be undone.',
    buttons: [{ label: 'Cancel', value: null }, { label: untracked ? 'Delete File' : 'Discard Changes', value: 'yes', primary: true }],
  });
  if (r !== 'yes') return;
  const m = S.models.get(x.path);
  if (m) m.dirty = false;
  gitTry(untracked ? `git clean -f ${x.path}` : `git restore ${x.path}`, () => git.discard(x.path, { untracked: true }));
  onFsChange();
}
function gitCheckout(name) {
  if (gitTry(`git switch ${name}`, () => git.checkout(name)) != null) notify(`Switched to branch '${name}'`, 'info', 2500);
}
function gitMerge(name) {
  const r = gitTry(`git merge ${name}`, () => git.merge(name));
  if (!r) return;
  notify(r.type === 'up-to-date' ? 'Already up to date.' : r.type === 'ff' ? `Fast-forwarded ${git.HEAD} to ${name}.` : `Merged ${name} into ${git.HEAD}.`, 'info', 4000);
}
async function gitDeleteBranch(name) {
  const merged = git.isAncestor(git.branches[name], git.headId());
  const r = await dialog({
    title: `Delete branch '${name}'?`,
    detail: merged ? 'Its commits are already part of the current branch.' : `It has commits that are not merged into ${git.HEAD}. They will no longer be reachable.`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Delete Branch', value: 'yes', primary: true }],
  });
  if (r === 'yes') gitTry(`git branch -D ${name}`, () => { git.deleteBranch(name, true); });
}
async function gitCreateBranch() {
  if (!git.headId()) { notify('Make a first commit before creating branches.', 'warning'); return; }
  const name = await quickInput({ placeholder: 'Branch name', prompt: `Create a branch from ${git.HEAD} and switch to it`, validate: v => (!v ? '' : !git.validName(v) ? 'Use letters, digits, ".", "_", "-" and "/"' : git.branches[v] ? `A branch named '${v}' already exists` : '') });
  if (!name) return;
  gitTry(`git switch -c ${name}`, () => { git.createBranch(name); git.checkout(name); });
}
function gitPickBranch(title, onPick) {
  const names = Object.keys(git.branches).sort();
  quickPick({
    placeholder: title,
    provider: v => names.map(n => ({ n, m: fuzzy(v, n) })).filter(x => x.m).sort((a, b) => b.m.score - a.m.score)
      .map(x => ({ label: x.n, pos: x.m.pos, desc: (x.n === git.HEAD ? 'current · ' : '') + git.short(git.branches[x.n]) + ' ' + git.commits[git.branches[x.n]].message.split('\n')[0], name: x.n, icon: icon('branch', 14) })),
    onAccept: it => it && onPick(it.name),
  });
}

/* ---------- search ---------- */
function buildSearch(side) {
  const s = S.search;
  const q = h('input', { type: 'text', id: 'search-q', placeholder: 'Search', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search' });
  const r = h('input', { type: 'text', id: 'search-r', placeholder: 'Replace', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Replace' });
  q.value = s.q; r.value = s.replace;
  const go = debounce(() => runSearch(), 180);
  q.addEventListener('input', () => { s.q = q.value; go(); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  r.addEventListener('input', () => { s.replace = r.value; });
  const tog = (key, label, title) => { const b = h('button', { class: 'tog' + (s[key] ? ' on' : ''), type: 'button', title, 'aria-pressed': String(s[key]), onclick: () => { s[key] = !s[key]; b.classList.toggle('on', s[key]); b.setAttribute('aria-pressed', String(s[key])); runSearch(); } }, label); return b; };
  side.append(
    sideHead('Search', [iconBtn('refresh', 'Refresh', () => runSearch()), iconBtn('collapse', 'Collapse All', () => { (s.results || []).forEach(g => s.closed.add(g.path)); updateSearch(); }), iconBtn('close', 'Clear Search', () => { s.q = ''; q.value = ''; runSearch(); q.focus(); })]),
    h('div', { class: 'side-body' },
      h('div', { class: 'search-box' },
        h('div', { class: 'field' }, q, tog('cs', 'Aa', 'Match Case'), tog('word', 'ab', 'Match Whole Word'), tog('rx', '.*', 'Use Regular Expression')),
        h('div', { class: 'field' }, r, iconBtn('replaceAll', 'Replace All', () => replaceAll()))),
      h('div', { class: 'search-summary', id: 'search-summary' }),
      h('div', { class: 'sec-body fill', id: 'search-results' })));
}
function searchRegex() {
  const s = S.search;
  let src = s.rx ? s.q : Core.escRx(s.q);
  if (s.word) src = `\\b(?:${src})\\b`;
  return new RegExp(src, 'g' + (s.cs ? '' : 'i'));
}
function runSearch(quiet) {
  const s = S.search;
  s.error = ''; s.results = null;
  if (s.q) {
    let rx;
    try { rx = searchRegex(); } catch (e) { s.error = 'Invalid regular expression: ' + e.message.replace(/^Invalid regular expression: /, ''); }
    if (rx) {
      const out = [];
      let total = 0;
      for (const path of vfs.allFiles()) {
        if (git.ignored(path)) continue;
        const matches = [];
        const lines = vfs.read(path).split('\n');
        for (let i = 0; i < lines.length && total < 2000; i++) {
          const line = lines[i];
          rx.lastIndex = 0;
          let m;
          while ((m = rx.exec(line))) {
            if (!m[0]) { rx.lastIndex++; continue; }
            matches.push({ line: i + 1, col: m.index + 1, len: m[0].length, text: line });
            if (++total >= 2000) break;
          }
        }
        if (matches.length) out.push({ path, matches });
      }
      s.results = out; s.total = total;
    }
  }
  if (!quiet) s.closed.clear();
  if (S.view === 'search') updateSearch();
}
function updateSearch() {
  const s = S.search, host = $('#search-results'), sum = $('#search-summary');
  if (!host) return;
  const keep = host.scrollTop;
  host.textContent = '';
  if (s.error) { sum.textContent = s.error; sum.style.color = 'var(--err)'; return; }
  sum.style.color = '';
  if (!s.q) { sum.textContent = 'Type to search across every file in the workspace.'; return; }
  if (!s.results || !s.results.length) { sum.textContent = 'No results found.'; return; }
  sum.textContent = `${s.total}${s.total >= 2000 ? '+' : ''} result${s.total === 1 ? '' : 's'} in ${s.results.length} file${s.results.length === 1 ? '' : 's'}`;
  for (const g of s.results) {
    const open = !s.closed.has(g.path);
    host.append(h('div', { class: 'row', style: { paddingLeft: '6px' }, title: g.path, onclick: () => { if (open) s.closed.add(g.path); else s.closed.delete(g.path); updateSearch(); } },
      icon(open ? 'chevD' : 'chevR', 16), fileIcon(P.basename(g.path)), h('span', { class: 'label' }, P.basename(g.path)), h('span', { class: 'desc' }, P.dirname(g.path)), h('span', { class: 'badge' }, h('span', { class: 'count' }, String(g.matches.length)))));
    if (!open) continue;
    for (const m of g.matches) {
      const start = Math.max(0, m.col - 1 - 24), lead = m.text.slice(start, m.col - 1).replace(/^\s+/, '');
      host.append(h('div', { class: 'row match', style: { paddingLeft: '44px' }, title: `${g.path}:${m.line}`, onclick: () => openFile(g.path, { line: m.line, col: m.col, len: m.len }) },
        h('span', { class: 'label' }, (start > 0 ? '…' : '') + lead, h('mark', null, m.text.substr(m.col - 1, m.len)), m.text.slice(m.col - 1 + m.len, m.col - 1 + m.len + 120))));
    }
  }
  host.scrollTop = keep;
}
async function replaceAll() {
  const s = S.search;
  runSearch(true);
  if (!s.results || !s.results.length) { notify('Nothing to replace. Run a search with results first.', 'info', 3500); return; }
  const r = await dialog({
    title: `Replace ${s.total} occurrence${s.total === 1 ? '' : 's'} across ${s.results.length} file${s.results.length === 1 ? '' : 's'}?`,
    detail: `"${s.q}" becomes "${s.replace}". Files are saved right away; review the result in Source Control.`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Replace All', value: 'yes', primary: true }],
  });
  if (r !== 'yes') return;
  const rx = searchRegex(), rep = s.rx ? s.replace : s.replace.replace(/\$/g, '$$$$');
  saveAll();
  vfs.batch(() => { for (const g of s.results) vfs.write(g.path, vfs.read(g.path).replace(rx, rep)); });
  notify(`Replaced ${s.total} occurrence${s.total === 1 ? '' : 's'}.`, 'info', 3500);
}

/* ---------- run view ---------- */
function buildRun(side) {
  side.append(sideHead('Run', []), h('div', { class: 'side-body', id: 'run-body', style: { overflow: 'auto' } }));
}
function updateRun() {
  const host = $('#run-body');
  if (!host) return;
  host.textContent = '';
  const t = curTab(), ext = t && t.kind === 'file' ? P.ext(t.path) : '';
  const runnable = ['js', 'cjs', 'mjs'].includes(ext), page = ['html', 'htm'].includes(ext);
  host.append(h('div', { class: 'scm-box' },
    h('button', { class: 'btn block', type: 'button', disabled: !runnable && !page, onclick: () => runCmd(page ? 'run.preview' : 'run.active') }, icon(page ? 'preview' : 'play', 14), page ? `Preview ${P.basename(t.path)}` : runnable ? `Run ${P.basename(t.path)}` : 'Run Active File'),
    h('div', { class: 'hint', style: { padding: '0' } }, runnable || page ? `${kbLabel('F5')} does the same.` : 'Open a .js file to run it in the terminal, or an .html file to preview it.')));
  let scripts = null;
  try { scripts = JSON.parse(vfs.read('package.json') || 'null')?.scripts || null; } catch {}
  host.append(secHead('npm Scripts', 'scripts', [], scripts ? Object.keys(scripts).length : 0));
  if (!S.collapsed.has('scripts')) {
    if (scripts && Object.keys(scripts).length) {
      for (const [name, cmd] of Object.entries(scripts)) {
        host.append(h('div', { class: 'row', style: { paddingLeft: '24px' }, title: `npm run ${name}\n${cmd}`, onclick: () => runInTerminal(`npm run ${name}`) }, icon('play', 14), h('span', { class: 'label' }, name), h('span', { class: 'desc mono' }, cmd)));
      }
    } else host.append(h('div', { class: 'hint' }, 'Add a "scripts" section to package.json and its entries appear here.'));
  }
  const pages = vfs.allFiles().filter(p => /\.html?$/.test(p) && !git.ignored(p));
  host.append(secHead('Pages', 'pages', [], pages.length));
  if (!S.collapsed.has('pages')) for (const p of pages) host.append(h('div', { class: 'row', style: { paddingLeft: '24px' }, title: `Preview ${p}`, onclick: () => openTab({ kind: 'preview', path: p }) }, icon('preview', 14), h('span', { class: 'label' }, P.basename(p)), h('span', { class: 'desc' }, P.dirname(p))));
}

/* ---------- diya ---------- */
function buildDiya(side) {
  side.append(
    sideHead('Diya', []),
    h('div', { class: 'side-body', style: { alignItems: 'center', justifyContent: 'center', padding: '24px' } },
      icon('diya', 160),
      h('div', { class: 'hint', style: { textAlign: 'center', marginTop: '12px' } }, 'Diya')));
}
function updateDiya() {}
