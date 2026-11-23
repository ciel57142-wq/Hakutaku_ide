'use strict';
/* Core: paths, hashing, line diff, in-memory file system, git engine. No DOM. */
const Core = (() => {
  const P = {
    norm(p) {
      const out = [];
      for (const seg of String(p).split('/')) {
        if (!seg || seg === '.') continue;
        if (seg === '..') out.pop(); else out.push(seg);
      }
      return out.join('/');
    },
    join(...a) { return P.norm(a.filter(x => x != null && x !== '').join('/')); },
    dirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); },
    basename(p) { return p.slice(p.lastIndexOf('/') + 1); },
    ext(p) { const b = P.basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i + 1).toLowerCase(); },
    resolve(cwd, p) {
      if (p === '~' || p.startsWith('~/') || p.startsWith('/')) return P.norm(p.replace(/^~/, ''));
      return P.join(cwd, p);
    },
    within(p, dir) { return dir === '' || p === dir || p.startsWith(dir + '/'); },
  };

  function cyrb53(str, seed) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  const hash = (str, n = 2) => { let o = ''; for (let i = 0; i < n; i++) o += cyrb53(str, i * 7919 + 1); return o; };

  /* ---------- line diff ---------- */
  function splitLines(t) {
    if (t == null || t === '') return [];
    const l = String(t).split('\n');
    if (l[l.length - 1] === '') l.pop();
    return l;
  }

  // Returns ops: [{t:' '|'-'|'+', s, a, b}] with 1-based line numbers (a: old, b: new).
  function diffLines(aText, bText) {
    const a = Array.isArray(aText) ? aText : splitLines(aText);
    const b = Array.isArray(bText) ? bText : splitLines(bText);
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const n = a.length - pre - suf, m = b.length - pre - suf;
    const raw = [];
    for (let i = 0; i < pre; i++) raw.push(' ', a[i]);
    if (n * m > 4e6 || n === 0 || m === 0) {
      for (let i = 0; i < n; i++) raw.push('-', a[pre + i]);
      for (let j = 0; j < m; j++) raw.push('+', b[pre + j]);
    } else {
      const ids = new Map();
      const idOf = s => { let v = ids.get(s); if (v === undefined) { v = ids.size; ids.set(s, v); } return v; };
      const A = new Int32Array(n), B = new Int32Array(m);
      for (let i = 0; i < n; i++) A[i] = idOf(a[pre + i]);
      for (let j = 0; j < m; j++) B[j] = idOf(b[pre + j]);
      const W = m + 1, L = new Uint32Array((n + 1) * W);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          L[i * W + j] = A[i] === B[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (A[i] === B[j]) { raw.push(' ', a[pre + i]); i++; j++; }
        else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { raw.push('-', a[pre + i]); i++; }
        else { raw.push('+', b[pre + j]); j++; }
      }
      while (i < n) { raw.push('-', a[pre + i]); i++; }
      while (j < m) { raw.push('+', b[pre + j]); j++; }
    }
    for (let i = a.length - suf; i < a.length; i++) raw.push(' ', a[i]);
    const ops = [];
    let la = 0, lb = 0;
    for (let k = 0; k < raw.length; k += 2) {
      const t = raw[k];
      if (t !== '+') la++;
      if (t !== '-') lb++;
      ops.push({ t, s: raw[k + 1], a: t === '+' ? 0 : la, b: t === '-' ? 0 : lb });
    }
    return ops;
  }

  function hunks(ops, ctx = 3) {
    const out = [];
    let i = 0;
    while (i < ops.length) {
      while (i < ops.length && ops[i].t === ' ') i++;
      if (i >= ops.length) break;
      const start = Math.max(0, i - ctx);
      let end = i, last = i;
      while (end < ops.length) {
        if (ops[end].t !== ' ') last = end;
        else if (end - last > ctx * 2) break;
        end++;
      }
      end = Math.min(ops.length, last + ctx + 1);
      const lines = ops.slice(start, end);
      let aStart = 0, bStart = 0, aLen = 0, bLen = 0;
      // line numbers before the hunk
      let pa = 0, pb = 0;
      for (let k = 0; k < start; k++) { if (ops[k].t !== '+') pa++; if (ops[k].t !== '-') pb++; }
      for (const o of lines) { if (o.t !== '+') aLen++; if (o.t !== '-') bLen++; }
      aStart = aLen ? pa + 1 : pa; bStart = bLen ? pb + 1 : pb;
      out.push({ aStart, aLen, bStart, bLen, lines });
      i = end;
    }
    return out;
  }

  // Changes expressed on new-file lines, for editor gutter marks.
  function lineChanges(ops) {
    const out = [];
    let b = 0, i = 0;
    while (i < ops.length) {
      if (ops[i].t === ' ') { b++; i++; continue; }
      let minus = 0, plus = 0;
      const first = b + 1;
      while (i < ops.length && ops[i].t !== ' ') { if (ops[i].t === '-') minus++; else { plus++; b++; } i++; }
      if (plus && minus) out.push({ type: 'mod', start: first, end: first + plus - 1 });
      else if (plus) out.push({ type: 'add', start: first, end: first + plus - 1 });
      else out.push({ type: 'del', start: Math.max(1, first - 1), end: Math.max(1, first - 1), atTop: first === 1 });
    }
    return out;
  }

  function diffStat(aText, bText) {
    let add = 0, del = 0;
    for (const o of diffLines(aText, bText)) { if (o.t === '+') add++; else if (o.t === '-') del++; }
    return { add, del };
  }

  /* ---------- virtual file system ---------- */
  class FsError extends Error {}

  class VFS {
    constructor() { this.files = new Map(); this.dirs = new Set(); this._subs = []; this._batch = 0; this._dirty = false; }
    on(fn) { this._subs.push(fn); }
    _emit() {
      if (this._batch) { this._dirty = true; return; }
      for (const fn of this._subs) fn();
    }
    batch(fn) {
      this._batch++;
      try { return fn(); }
      finally { if (--this._batch === 0 && this._dirty) { this._dirty = false; this._emit(); } }
    }
    isFile(p) { return this.files.has(p); }
    isDir(p) { return p === '' || this.dirs.has(p); }
    exists(p) { return this.isFile(p) || this.isDir(p); }
    read(p) { return this.files.get(p); }
    _mkdir(p) {
      let cur = '';
      for (const seg of p.split('/')) {
        if (!seg) continue;
        cur = cur ? cur + '/' + seg : seg;
        if (this.files.has(cur)) throw new FsError(`'${cur}' is a file`);
        this.dirs.add(cur);
      }
    }
    mkdir(p) { p = P.norm(p); if (!p) return; this._mkdir(p); this._emit(); }
    write(p, content) {
      p = P.norm(p);
      if (!p) throw new FsError('A file needs a name');
      if (this.isDir(p)) throw new FsError(`'${p}' is a folder`);
      this._mkdir(P.dirname(p));
      this.files.set(p, String(content));
      this._emit();
    }
    remove(p) {
      p = P.norm(p);
      if (this.files.has(p)) this.files.delete(p);
      else if (this.dirs.has(p)) {
        for (const f of [...this.files.keys()]) if (P.within(f, p)) this.files.delete(f);
        for (const d of [...this.dirs]) if (P.within(d, p)) this.dirs.delete(d);
      } else throw new FsError(`'${p}' does not exist`);
      this._emit();
    }
    rename(from, to) {
      from = P.norm(from); to = P.norm(to);
      if (from === to) return;
      if (!to) throw new FsError('A name is required');
      if (this.exists(to)) throw new FsError(`'${to}' already exists`);
      if (this.files.has(from)) {
        this._mkdir(P.dirname(to));
        this.files.set(to, this.files.get(from));
        this.files.delete(from);
      } else if (this.dirs.has(from)) {
        if (P.within(to, from)) throw new FsError('Cannot move a folder into itself');
        this._mkdir(to);
        for (const d of [...this.dirs]) if (P.within(d, from) && d !== from) { this.dirs.delete(d); this._mkdir(to + d.slice(from.length)); }
        this.dirs.delete(from);
        for (const [f, c] of [...this.files]) if (P.within(f, from)) { this.files.delete(f); this.files.set(to + f.slice(from.length), c); }
      } else throw new FsError(`'${from}' does not exist`);
      this._emit();
    }
    list(dir) {
      dir = P.norm(dir);
      const out = [], pre = dir ? dir + '/' : '';
      for (const d of this.dirs) if (d.startsWith(pre) && d.length > pre.length && d.indexOf('/', pre.length) < 0) out.push({ name: d.slice(pre.length), path: d, dir: true });
      for (const f of this.files.keys()) if (f.startsWith(pre) && f.indexOf('/', pre.length) < 0) out.push({ name: f.slice(pre.length), path: f, dir: false });
      out.sort((x, y) => (y.dir - x.dir) || x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
      return out;
    }
    allFiles() { return [...this.files.keys()].sort(); }
    pruneEmpty(dir) {
      while (dir && this.dirs.has(dir) && this.list(dir).length === 0) { this.dirs.delete(dir); dir = P.dirname(dir); }
    }
    toJSON() { return { files: Object.fromEntries(this.files), dirs: [...this.dirs] }; }
    load(j) {
      this.files = new Map(Object.entries(j.files || {}));
      this.dirs = new Set(j.dirs || []);
      for (const f of this.files.keys()) this._mkdir(P.dirname(f));
    }
  }

  /* ---------- git ---------- */
  class GitError extends Error {}
  const union = (...objs) => { const s = new Set(); for (const o of objs) for (const k in o) s.add(k); return [...s].sort(); };
  const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  class Git {
    constructor(vfs) {
      this.vfs = vfs;
      this.blobs = {}; this.commits = {}; this.branches = {}; this.HEAD = 'main';
      this.index = {}; this.stashes = [];
      this.user = { name: 'Dev', email: 'dev@juniper.local' };
      this._subs = []; this._hc = new Map();
    }
    on(fn) { this._subs.push(fn); }
    _emit() { for (const fn of this._subs) fn(); }

    _h(path, content) {
      const c = this._hc.get(path);
      if (c && c.content === content) return c.h;
      const hh = hash(content, 2);
      this._hc.set(path, { content, h: hh });
      return hh;
    }
    _blob(content) { const hh = hash(content, 2); if (!(hh in this.blobs)) this.blobs[hh] = content; return hh; }
    content(h) { return h ? (this.blobs[h] ?? '') : ''; }
    headId() { return this.branches[this.HEAD] || null; }
    treeOf(id) { return id && this.commits[id] ? this.commits[id].tree : {}; }
    headTree() { return this.treeOf(this.headId()); }
    workTree() { const t = {}; for (const [p, c] of this.vfs.files) t[p] = this._h(p, c); return t; }
    short(id) { return id ? id.slice(0, 7) : ''; }

    ignored(path) {
      const txt = this.vfs.read('.gitignore');
      if (!txt) return false;
      if (this._ignSrc !== txt) {
        this._ignSrc = txt;
        this._ign = txt.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(pat => {
          const anchored = pat.startsWith('/');
          pat = pat.replace(/^\//, '').replace(/\/$/, '');
          const rx = pat.split('*').map(escRx).join('[^/]*');
          return new RegExp(anchored || pat.includes('/') ? `^${rx}(/|$)` : `(^|/)${rx}(/|$)`);
        });
      }
      return this._ign.some(r => r.test(path));
    }

    status() {
      const head = this.headTree(), idx = this.index, work = this.workTree();
      const staged = [], unstaged = [];
      for (const p of union(head, idx)) {
        if (!(p in head)) staged.push({ path: p, status: 'A' });
        else if (!(p in idx)) staged.push({ path: p, status: 'D' });
        else if (head[p] !== idx[p]) staged.push({ path: p, status: 'M' });
      }
      for (const p of union(idx, work)) {
        if (!(p in idx)) { if (!this.ignored(p)) unstaged.push({ path: p, status: 'U' }); }
        else if (!(p in work)) unstaged.push({ path: p, status: 'D' });
        else if (idx[p] !== work[p]) unstaged.push({ path: p, status: 'M' });
      }
      return { staged, unstaged };
    }

    add(target = '') {
      target = P.norm(target);
      let n = 0;
      for (const [p, c] of this.vfs.files) {
        if (!P.within(p, target)) continue;
        if (!(p in this.index) && this.ignored(p) && p !== target) continue;
        const hh = this._blob(c);
        if (this.index[p] !== hh) { this.index[p] = hh; n++; }
      }
      for (const p of Object.keys(this.index)) if (P.within(p, target) && !this.vfs.isFile(p)) { delete this.index[p]; n++; }
      if (target && !this.vfs.exists(target) && !n && !(target in this.headTree())) throw new GitError(`fatal: pathspec '${target}' did not match any files`);
      this._emit();
      return n;
    }
    unstage(target = '') {
      target = P.norm(target);
      const head = this.headTree();
      for (const p of union(head, this.index)) {
        if (!P.within(p, target)) continue;
        if (p in head) this.index[p] = head[p]; else delete this.index[p];
      }
      this._emit();
    }
    // Restore working files from the index. Untracked files are removed only when asked.
    discard(target = '', opts = {}) {
      target = P.norm(target);
      this.vfs.batch(() => {
        for (const p of union(this.index, Object.fromEntries(this.vfs.files))) {
          if (!P.within(p, target)) continue;
          if (p in this.index) {
            const want = this.content(this.index[p]);
            if (this.vfs.read(p) !== want) this.vfs.write(p, want);
          } else if (opts.untracked && !this.ignored(p)) {
            this.vfs.remove(p); this.vfs.pruneEmpty(P.dirname(p));
          }
        }
      });
      this._emit();
    }

    commit(message, opts = {}) {
      message = String(message || '').trim();
      if (!message) throw new GitError('Aborting commit due to empty commit message.');
      const head = this.headTree();
      const same = union(head, this.index).every(p => head[p] === this.index[p]);
      if (same && !opts.parents) {
        const st = this.status();
        throw new GitError(st.unstaged.length ? 'no changes added to commit (use "git add" and/or "git commit -a")' : 'nothing to commit, working tree clean');
      }
      const parents = opts.parents || (this.headId() ? [this.headId()] : []);
      const time = opts.time || Date.now();
      const author = `${this.user.name} <${this.user.email}>`;
      const tree = { ...this.index };
      const id = hash(JSON.stringify([tree, parents, message, time, author]), 3).slice(0, 40);
      const c = { id, parents, message, author, time, tree };
      this.commits[id] = c;
      this.branches[this.HEAD] = id;
      this._emit();
      return c;
    }

    resolve(ref) {
      if (!ref || ref === 'HEAD' || ref === '@') return this.headId();
      const m = /^(.*?)(?:~(\d*)|\^)$/.exec(ref);
      if (m) {
        let id = this.resolve(m[1] || 'HEAD');
        const n = ref.endsWith('^') ? 1 : (m[2] === '' ? 1 : +m[2]);
        for (let i = 0; i < n && id; i++) id = this.commits[id].parents[0] || null;
        return id;
      }
      if (this.branches[ref]) return this.branches[ref];
      if (/^[0-9a-f]{4,40}$/.test(ref)) {
        const hits = Object.keys(this.commits).filter(id => id.startsWith(ref));
        if (hits.length === 1) return hits[0];
      }
      return null;
    }
    ancestors(id) {
      const seen = new Set(), stack = id ? [id] : [];
      while (stack.length) {
        const x = stack.pop();
        if (seen.has(x) || !this.commits[x]) continue;
        seen.add(x);
        stack.push(...this.commits[x].parents);
      }
      return seen;
    }
    log(from, all) {
      const seen = new Set();
      const roots = all ? Object.values(this.branches) : [from === undefined ? this.headId() : from];
      for (const r of roots) for (const x of this.ancestors(r)) seen.add(x);
      const list = [...seen].map(id => this.commits[id]);
      // newest first, parents always after children
      list.sort((x, y) => y.time - x.time);
      return list;
    }
    isAncestor(a, b) { return !!a && this.ancestors(b).has(a); }
    mergeBase(a, b) {
      const anc = this.ancestors(a);
      return this.log(b).find(c => anc.has(c.id))?.id || null;
    }
    refsAt(id) { return Object.keys(this.branches).filter(b => this.branches[b] === id).sort(); }

    _moveTo(target) {
      const head = this.headTree();
      const st = this.status();
      const dirty = new Set([...st.staged, ...st.unstaged].map(x => x.path));
      const paths = union(head, target).filter(p => head[p] !== target[p]);
      const clash = paths.filter(p => dirty.has(p));
      if (clash.length) {
        throw new GitError('error: Your local changes to the following files would be overwritten:\n' + clash.map(p => '\t' + p).join('\n') + '\nPlease commit your changes or stash them first.\nAborting');
      }
      this.vfs.batch(() => {
        for (const p of paths) {
          if (p in target) { this.vfs.write(p, this.content(target[p])); this.index[p] = target[p]; }
          else { if (this.vfs.isFile(p)) { this.vfs.remove(p); this.vfs.pruneEmpty(P.dirname(p)); } delete this.index[p]; }
        }
      });
      return paths.length;
    }

    validName(name) { return /^[A-Za-z0-9][\w./-]*$/.test(name) && !name.endsWith('/') && !name.includes('..'); }
    createBranch(name, from) {
      if (!this.validName(name)) throw new GitError(`fatal: '${name}' is not a valid branch name`);
      if (this.branches[name]) throw new GitError(`fatal: a branch named '${name}' already exists`);
      const id = from === undefined ? this.headId() : this.resolve(from);
      if (!id) throw new GitError(`fatal: not a valid object name: '${from || this.HEAD}'`);
      this.branches[name] = id;
      this._emit();
    }
    deleteBranch(name, force) {
      if (!this.branches[name]) throw new GitError(`error: branch '${name}' not found`);
      if (name === this.HEAD) throw new GitError(`error: cannot delete branch '${name}' used by the working tree`);
      if (!force && !this.isAncestor(this.branches[name], this.headId())) throw new GitError(`error: the branch '${name}' is not fully merged\nhint: If you are sure you want to delete it, run 'git branch -D ${name}'`);
      const id = this.branches[name];
      delete this.branches[name];
      this._emit();
      return id;
    }
    renameBranch(to) {
      if (!this.validName(to)) throw new GitError(`fatal: '${to}' is not a valid branch name`);
      if (this.branches[to]) throw new GitError(`fatal: a branch named '${to}' already exists`);
      if (this.headId()) { this.branches[to] = this.headId(); delete this.branches[this.HEAD]; }
      this.HEAD = to;
      this._emit();
    }
    checkout(name) {
      if (!this.branches[name]) throw new GitError(`error: pathspec '${name}' did not match any file(s) known to git`);
      if (name === this.HEAD) return false;
      this._moveTo(this.treeOf(this.branches[name]));
      this.HEAD = name;
      this._emit();
      return true;
    }
    merge(name) {
      const theirs = this.resolve(name), ours = this.headId();
      if (!theirs) throw new GitError(`merge: ${name} - not something we can merge`);
      if (this.isAncestor(theirs, ours)) return { type: 'up-to-date' };
      if (!ours || this.isAncestor(ours, theirs)) {
        const files = this._moveTo(this.treeOf(theirs));
        this.branches[this.HEAD] = theirs;
        this._emit();
        return { type: 'ff', from: ours, to: theirs, files };
      }
      const st = this.status();
      if (st.staged.length || st.unstaged.some(x => x.status !== 'U')) throw new GitError('error: Your local changes would be overwritten by merge.\nPlease commit your changes or stash them before you merge.\nAborting');
      const b = this.treeOf(this.mergeBase(ours, theirs)), o = this.treeOf(ours), t = this.treeOf(theirs);
      const result = {}, conflicts = [];
      for (const p of union(b, o, t)) {
        const B = b[p], O = o[p], T = t[p];
        let r;
        if (O === T) r = O; else if (O === B) r = T; else if (T === B) r = O; else { conflicts.push(p); continue; }
        if (r) result[p] = r;
      }
      if (conflicts.length) {
        throw new GitError(conflicts.map(p => `CONFLICT (content): Merge conflict in ${p}`).join('\n') + '\nAutomatic merge failed. This built-in git merges whole files, so both branches changing the same file cannot be combined. Nothing was changed.');
      }
      const files = this._moveTo(result);
      const c = this.commit(`Merge branch '${name}' into ${this.HEAD}`, { parents: [ours, theirs] });
      return { type: 'merge', commit: c, files };
    }
    // mode: 'soft' | 'mixed' | 'hard'
    reset(ref, mode = 'mixed') {
      const id = this.resolve(ref);
      if (ref && !id) throw new GitError(`fatal: ambiguous argument '${ref}': unknown revision`);
      const target = this.treeOf(id);
      if (mode === 'hard') {
        this.vfs.batch(() => {
          for (const p of union(this.index, target, this.headTree())) {
            if (p in target) { if (this.vfs.read(p) !== this.content(target[p])) this.vfs.write(p, this.content(target[p])); }
            else if (this.vfs.isFile(p)) { this.vfs.remove(p); this.vfs.pruneEmpty(P.dirname(p)); }
          }
        });
      }
      if (mode !== 'soft') this.index = { ...target };
      if (id) this.branches[this.HEAD] = id;
      this._emit();
      return id;
    }
    stash() {
      const st = this.status();
      const tracked = st.unstaged.filter(x => x.status !== 'U');
      if (!st.staged.length && !tracked.length) throw new GitError('No local changes to save');
      const work = {};
      for (const p of Object.keys(this.index)) if (this.vfs.isFile(p)) work[p] = this._blob(this.vfs.read(p));
      const head = this.headId();
      const subject = head ? this.commits[head].message.split('\n')[0] : '';
      const entry = { message: `WIP on ${this.HEAD}: ${this.short(head)} ${subject}`, base: { ...this.headTree() }, work, time: Date.now() };
      this.stashes.unshift(entry);
      this.reset(null, 'hard');
      return entry;
    }
    stashPop(keep) {
      const s = this.stashes[0];
      if (!s) throw new GitError('No stash entries found.');
      const cur = this.workTree();
      const paths = union(s.base, s.work).filter(p => s.base[p] !== s.work[p]);
      const clash = paths.filter(p => cur[p] !== s.base[p] && cur[p] !== s.work[p]);
      if (clash.length) throw new GitError('error: Your local changes to the following files would be overwritten:\n' + clash.map(p => '\t' + p).join('\n') + '\nThe stash entry is kept.');
      this.vfs.batch(() => {
        for (const p of paths) {
          if (p in s.work) this.vfs.write(p, this.content(s.work[p]));
          else if (this.vfs.isFile(p)) this.vfs.remove(p);
        }
      });
      if (!keep) this.stashes.shift();
      this._emit();
      return s;
    }
    show(id) {
      const c = this.commits[id];
      if (!c) return null;
      const a = this.treeOf(c.parents[0]), b = c.tree;
      const files = [];
      for (const p of union(a, b)) {
        if (a[p] === b[p]) continue;
        files.push({ path: p, status: !(p in a) ? 'A' : !(p in b) ? 'D' : 'M', a: a[p], b: b[p] });
      }
      return { commit: c, files };
    }
    toJSON() {
      return { blobs: this.blobs, commits: this.commits, branches: this.branches, HEAD: this.HEAD, index: this.index, stashes: this.stashes, user: this.user };
    }
    load(j) {
      Object.assign(this, { blobs: j.blobs || {}, commits: j.commits || {}, branches: j.branches || {}, HEAD: j.HEAD || 'main', index: j.index || {}, stashes: j.stashes || [], user: j.user || this.user });
    }
  }

  /* ---------- store-only zip ---------- */
  let crcTable;
  function crc32(buf) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function makeZip(entries) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const e of entries) {
      const name = enc.encode(e.name), data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
      const crc = crc32(data);
      const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      const local = new Uint8Array([0x50, 0x4b, 3, 4, ...common]);
      parts.push(local, name, data);
      central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += local.length + name.length + data.length;
    }
    const cSize = central.reduce((n, p) => n + p.length, 0);
    const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cSize), ...u32(offset), ...u16(0)]);
    const all = [...parts, ...central, end];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of all) { out.set(p, at); at += p.length; }
    return out;
  }

  return { P, hash, splitLines, diffLines, hunks, lineChanges, diffStat, VFS, FsError, Git, GitError, makeZip, escRx };
})();
if (typeof module !== 'undefined') module.exports = Core;
