'use strict';
/* UI kit: DOM helper, icons, menus, quick pick, dialogs, toasts, sashes. */
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const dot3 = [5.5, 12, 18.5].map(x => `<circle cx="${x}" cy="12" r="1.1" fill="currentColor"/>`).join('');
const ICONS = {
  diya: `<defs>
    <radialGradient id="diyaGlow" cx="50%" cy="35%" r="45%">
      <stop offset="0%" stop-color="#FFD166" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#FFD166" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="diyaClay" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#E05A2B"/>
      <stop offset="100%" stop-color="#9E2A12"/>
    </linearGradient>
    <linearGradient id="diyaFlame" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFF3B0"/>
      <stop offset="55%" stop-color="#FFB703"/>
      <stop offset="100%" stop-color="#FB5607"/>
    </linearGradient>
  </defs>
  <circle cx="100" cy="70" r="55" fill="url(#diyaGlow)" stroke="none"/>
  <path d="M100 96 Q102 88 99 82" stroke="#2B2D42" stroke-width="3" stroke-linecap="round" fill="none"/>
  <path d="M100 32 C114 50, 120 66, 112 79 C108 86, 103 88, 100 88 C97 88, 92 86, 88 79 C80 66, 86 50, 100 32 Z" fill="url(#diyaFlame)" stroke="none"/>
  <path d="M100 50 C106 60, 108 70, 104 77 C102 80, 98 80, 96 77 C92 70, 94 60, 100 50 Z" fill="#FFFDF7" opacity="0.85" stroke="none"/>
  <ellipse cx="100" cy="106" rx="66" ry="12" fill="#7A1F0D" stroke="none"/>
  <ellipse cx="100" cy="107" rx="58" ry="8" fill="#F4A261" opacity="0.55" stroke="none"/>
  <path d="M34 106 C36 138, 62 156, 100 156 C138 156, 164 138, 166 106 C146 116, 54 116, 34 106 Z" fill="url(#diyaClay)" stroke="none"/>
  <path d="M44 124 Q100 134 156 124" stroke="#F6BD60" stroke-width="2.5" fill="none" stroke-dasharray="6 6" opacity="0.85"/>
  <ellipse cx="100" cy="157" rx="28" ry="5" fill="#6E1B0B" stroke="none"/>`,
  files: '<path d="M14 3H7v14h11V7z"/><path d="M14 3v4h4"/><path d="M7 7H4v14h10v-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  branch: '<circle cx="7" cy="5.5" r="2.3"/><circle cx="7" cy="18.5" r="2.3"/><circle cx="17" cy="8.5" r="2.3"/><path d="M7 7.8v8.4M17 10.8c0 4.2-10 2.2-10 5.4"/>',
  merge: '<circle cx="6.5" cy="5.5" r="2.3"/><circle cx="6.5" cy="18.5" r="2.3"/><circle cx="17.5" cy="12" r="2.3"/><path d="M6.5 7.8v8.4M6.5 8c0 4 4 4 8.7 4"/>',
  play: '<path d="M7.5 4.5v15l12-7.5z"/>',
  gear: '<circle cx="12" cy="12" r="2.8"/><circle cx="12" cy="12" r="6.6"/><path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8M5.4 5.4l1.9 1.9M16.7 16.7l1.9 1.9M5.4 18.6l1.9-1.9M16.7 7.3l1.9-1.9"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chevR: '<path d="M9.5 6.5L15 12l-5.5 5.5"/>',
  chevD: '<path d="M6.5 9.5L12 15l5.5-5.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  newFile: '<path d="M12 21H6V3h7l5 5v3"/><path d="M13 3v5h5"/><path d="M17.5 14v7M14 17.5h7"/>',
  newFolder: '<path d="M11 19H3V6h6l2 2h10v4"/><path d="M18 14v7M14.5 17.5h7"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19.5 4.5v4.2h-4.2"/>',
  collapse: '<path d="M8.5 8.5h11v11h-11z"/><path d="M5 15.5V4.5h11"/><path d="M11.5 14h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  discard: '<path d="M8.5 13.5L4 9l4.5-4.5"/><path d="M4 9h10a5.5 5.5 0 0 1 0 11h-3"/>',
  more: dot3,
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 13h9.4l.8-13M10 11v5.5M14 11v5.5"/>',
  terminal: '<path d="M3.5 5h17v14h-17z"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
  error: '<circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/>',
  warning: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17v.3"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5.5M12 7.8v.3"/>',
  bell: '<path d="M6.5 16.5v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14z"/><path d="M10.5 21h3"/>',
  sidebar: '<path d="M3.5 5h17v14h-17z"/><path d="M9 5v14"/>',
  panel: '<path d="M3.5 5h17v14h-17z"/><path d="M3.5 14h17"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  diff: '<rect x="4.5" y="2.5" width="15" height="19" rx="2"/><path d="M12 6v6M9 9h6M9 17h6"/>',
  preview: '<path d="M3.5 5h17v14h-17z"/><path d="M11 5v14"/><circle cx="15.6" cy="11.3" r="2"/><path d="M17.1 12.8l1.7 1.7"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4.5 15v4.5h15V15"/>',
  replaceAll: '<path d="M4 7h8M4 12h8M4 17h4"/><path d="M13.5 15.5l2.5 2.5 4.5-5"/>',
};
function icon(name, size = 16) {
  const s = document.createElement('span');
  s.className = 'ico ' + name;
  const viewBox = name === 'diya' ? '0 0 200 200' : '0 0 24 24';
  s.innerHTML = `<svg viewBox="${viewBox}" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return s;
}
function iconBtn(name, title, onclick, cls) {
  return h('button', { class: 'icon-btn' + (cls ? ' ' + cls : ''), type: 'button', title, 'aria-label': title, onclick: e => { e.stopPropagation(); onclick(e); } }, icon(name));
}
const LOGO = size => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><circle cx="8" cy="8.5" r="4.4" fill="var(--accent)"/><circle cx="16.4" cy="9.6" r="3.6" fill="var(--accent-strong)"/><circle cx="11.6" cy="16.6" r="3.9" fill="var(--info)" opacity=".8"/></svg>`;

const FICON = {
  js: ['JS', '#cfa82e'], mjs: ['JS', '#cfa82e'], cjs: ['JS', '#cfa82e'], jsx: ['JS', '#4fb3d9'],
  ts: ['TS', '#4f94dd'], tsx: ['TS', '#4f94dd'], json: ['{}', '#c9952a'], html: ['<>', '#e07a4f'], htm: ['<>', '#e07a4f'],
  css: ['#', '#4f9fe0'], scss: ['#', '#d46a9f'], md: ['M↓', '#6f9fd0'], py: ['PY', '#5a9fcf'], sh: ['$', '#5fb36b'],
  yml: ['Y', '#b57fc4'], yaml: ['Y', '#b57fc4'], svg: ['◇', '#d9953a'], gitignore: ['◆', '#dd6b52'], xml: ['<>', '#8aa35a'],
};
function fileIcon(name) {
  const ext = name.startsWith('.') && name.lastIndexOf('.') === 0 ? name.slice(1) : Core.P.ext(name);
  const [label, color] = FICON[ext] || ['≡', 'var(--fg-dim)'];
  return h('span', { class: 'ficon', style: { color }, 'aria-hidden': 'true' }, label);
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const kbLabel = kb => (!kb ? '' : isMac ? kb.replace('Ctrl+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥') : kb);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---- menus ---- */
let menuState = null;
function closeMenu() {
  if (!menuState) return;
  const m = menuState; menuState = null;
  m.el.remove();
  document.removeEventListener('mousedown', m.outside, true);
  document.removeEventListener('keydown', m.key, true);
  window.removeEventListener('blur', closeMenu);
  if (m.onClose) m.onClose();
}
// items: [{label, kb, run, disabled, checked} | '-']; anchor: {x, y} or element (opens below it)
function showMenu(items, anchor, opts = {}) {
  closeMenu();
  const el = h('div', { class: 'menu', role: 'menu' });
  const btns = [];
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { if (el.lastChild && el.lastChild.className !== 'menu-sep') el.append(h('div', { class: 'menu-sep' })); continue; }
    const b = h('button', { class: 'menu-item', type: 'button', role: 'menuitem', disabled: it.disabled, onclick: () => { closeMenu(); it.run && it.run(); } },
      it.checked ? h('span', { class: 'tick' }, icon('check', 14)) : null, h('span', null, it.label), it.kb ? h('span', { class: 'kb' }, kbLabel(it.kb)) : null);
    el.append(b); if (!it.disabled) btns.push(b);
  }
  if (el.lastChild && el.lastChild.className === 'menu-sep') el.lastChild.remove();
  $('#overlays').append(el);
  let x, y;
  if (anchor.nodeType) { const r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 2; } else ({ x, y } = anchor);
  const r = el.getBoundingClientRect();
  if (opts.alignRight && anchor.nodeType) x = anchor.getBoundingClientRect().right - r.width;
  if (opts.above && anchor.nodeType) y = anchor.getBoundingClientRect().top - r.height - 2;
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  let idx = -1;
  const setIdx = i => { btns.forEach(b => b.classList.remove('kbd-on')); idx = (i + btns.length) % btns.length; btns[idx].classList.add('kbd-on'); btns[idx].scrollIntoView({ block: 'nearest' }); };
  const st = {
    el, onClose: opts.onClose, owner: anchor.nodeType ? anchor : null,
    outside: e => { if (!el.contains(e.target) && !(st.owner && st.owner.contains(e.target)) && !(opts.keepOpenWithin && opts.keepOpenWithin.contains(e.target))) closeMenu(); },
    key: e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
      else if (e.key === 'ArrowDown' && btns.length) { e.preventDefault(); e.stopPropagation(); setIdx(idx + 1); }
      else if (e.key === 'ArrowUp' && btns.length) { e.preventDefault(); e.stopPropagation(); setIdx(idx < 0 ? -1 : idx - 1); }
      else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); e.stopPropagation(); btns[idx].click(); }
      else if (opts.onKey) opts.onKey(e);
    },
  };
  menuState = st;
  document.addEventListener('mousedown', st.outside, true);
  document.addEventListener('keydown', st.key, true);
  window.addEventListener('blur', closeMenu);
  return st;
}

/* ---- fuzzy match ---- */
function fuzzy(q, text) {
  if (!q) return { score: 0, pos: [] };
  const ql = q.toLowerCase(), tl = text.toLowerCase();
  const at = tl.indexOf(ql);
  const boundary = i => i === 0 || /[\/\s._:-]/.test(text[i - 1]);
  if (at >= 0) {
    const pos = []; for (let i = 0; i < q.length; i++) pos.push(at + i);
    return { score: 1000 + (boundary(at) ? 200 : 0) - at - text.length * 0.1, pos };
  }
  let ti = 0, score = 0, last = -2;
  const pos = [];
  for (const ch of ql) {
    if (ch === ' ') continue;
    const f = tl.indexOf(ch, ti);
    if (f < 0) return null;
    score += (f === last + 1 ? 10 : 0) + (boundary(f) ? 8 : 0) - (f - ti) * 0.3;
    pos.push(f); last = f; ti = f + 1;
  }
  return { score, pos };
}
function highlight(text, pos) {
  const frag = document.createDocumentFragment();
  if (!pos || !pos.length) { frag.append(text); return frag; }
  const set = new Set(pos);
  let run = '', on = false;
  const flush = () => { if (run) frag.append(on ? h('b', null, run) : run); run = ''; };
  for (let i = 0; i < text.length; i++) { const o = set.has(i); if (o !== on) { flush(); on = o; } run += text[i]; }
  flush();
  return frag;
}

/* ---- quick pick / input ---- */
let quickClose = null;
// opts: { placeholder, value, provider(value) → items[] | {items, message, bad}, onAccept(item, value) → false to stay open }
// item: { label, desc, kb, pos, icon(node) }
function quickPick(opts) {
  if (quickClose) quickClose(null);
  closeMenu();
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const input = h('input', { type: 'text', id: 'quick-input', placeholder: opts.placeholder || '', spellcheck: 'false', autocomplete: 'off', 'aria-label': opts.placeholder || 'Quick input' });
    const msg = h('div', { class: 'q-msg', hidden: true });
    const list = h('div', { class: 'quick-list', role: 'listbox' });
    const el = h('div', { class: 'quick', role: 'dialog' }, input, msg, list);
    let items = [], sel = 0, bad = false;
    const paint = () => {
      [...list.children].forEach((c, i) => c.classList.toggle('sel', i === sel));
      const cur = list.children[sel];
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    };
    const render = () => {
      let r = opts.provider ? opts.provider(input.value) : [];
      if (Array.isArray(r)) r = { items: r };
      items = (r.items || []).slice(0, 300);
      bad = !!r.bad;
      msg.hidden = !r.message; msg.textContent = r.message || ''; msg.classList.toggle('bad', bad);
      list.textContent = '';
      sel = 0;
      items.forEach((it, i) => {
        list.append(h('div', { class: 'q-item', role: 'option', onmousemove: () => { if (sel !== i) { sel = i; paint(); } }, onclick: () => accept(it) },
          it.icon || null, h('span', { class: 'label' }, highlight(it.label, it.pos)), it.desc ? h('span', { class: 'desc' }, it.desc) : null, it.kb ? h('span', { class: 'kb' }, kbLabel(it.kb)) : null));
      });
      if (!items.length && r.empty) list.append(h('div', { class: 'q-empty' }, r.empty));
      paint();
    };
    const close = result => {
      if (!quickClose) return;
      quickClose = null;
      el.remove();
      document.removeEventListener('mousedown', outside, true);
      resolve(result);
      if (result === null && prevFocus && prevFocus.isConnected) try { prevFocus.focus(); } catch {}
    };
    const accept = it => {
      if (bad) return;
      const value = input.value;
      if (opts.onAccept) {
        close({ item: it, value });
        opts.onAccept(it, value);
      } else close({ item: it, value });
    };
    const outside = e => { if (!el.contains(e.target)) close(null); };
    input.addEventListener('input', render);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { sel = (sel + 1) % items.length; paint(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { sel = (sel - 1 + items.length) % items.length; paint(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (items.length) accept(items[sel]); else if (opts.free) accept(undefined); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
    });
    quickClose = close;
    $('#overlays').append(el);
    input.value = opts.value || '';
    render();
    input.focus();
    if (opts.selectAll) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
    document.addEventListener('mousedown', outside, true);
  });
}
// Free-text prompt. validate(value) → error string or ''.
async function quickInput({ placeholder, value = '', prompt, validate }) {
  const r = await quickPick({
    placeholder, value, free: true, selectAll: true,
    provider: v => { const err = validate ? validate(v) : ''; return { items: [], message: err || prompt || 'Press Enter to confirm, Escape to cancel', bad: !!err }; },
  });
  return r ? r.value : null;
}

/* ---- dialog ---- */
function dialog({ title, detail, buttons }) {
  closeMenu();
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const done = v => { scrim.remove(); document.removeEventListener('keydown', key, true); resolve(v); if (prevFocus && prevFocus.isConnected) try { prevFocus.focus(); } catch {} };
    const btns = buttons.map(b => h('button', { class: 'btn' + (b.primary ? '' : ' secondary'), type: 'button', onclick: () => done(b.value) }, b.label));
    const scrim = h('div', { class: 'scrim', onmousedown: e => { if (e.target === scrim) done(null); } },
      h('div', { class: 'dialog', role: 'alertdialog', 'aria-label': title }, h('h3', null, title), detail ? h('p', null, detail) : null, h('div', { class: 'btns' }, btns)));
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', key, true);
    $('#overlays').append(scrim);
    (btns.find((b, i) => buttons[i].primary) || btns[0]).focus();
  });
}

/* ---- toasts ---- */
function notify(message, type = 'info', ms = 5000) {
  const el = h('div', { class: 'toast ' + type, role: type === 'error' ? 'alert' : 'status' }, h('div', { class: 'msg' }, message), iconBtn('close', 'Dismiss', () => el.remove()));
  $('#toasts').append(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

/* ---- sash ---- */
function makeSash(el, onMove, onEnd) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const start = { x: e.clientX, y: e.clientY };
    const move = ev => onMove(ev.clientX - start.x, ev.clientY - start.y, ev);
    const up = () => { el.classList.remove('drag'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); onEnd && onEnd(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + url));
    document.head.append(s);
  });
}
function copyText(text) {
  try { return navigator.clipboard.writeText(text).then(() => notify('Copied to clipboard', 'info', 1800), () => notify('The browser blocked clipboard access.', 'warning')); }
  catch { notify('The browser blocked clipboard access.', 'warning'); }
}
function timeAgo(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const units = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [604800, 'week'], [2592000, 'month'], [31536000, 'year']];
  let u = units[0];
  for (const x of units) if (s >= x[0]) u = x;
  const n = Math.floor(s / u[0]);
  return `${n} ${u[1]}${n === 1 ? '' : 's'} ago`;
}
