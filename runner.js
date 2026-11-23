'use strict';
/* Runner: executes workspace JavaScript in a Web Worker with a small CommonJS runtime. */
const Runner = (() => {
  const { P } = Core;

  // Runs inside the worker. Must not reference anything outside itself.
  function prelude() {
    const post = (t, d) => self.postMessage(Object.assign({ t }, d));
    const _st = self.setTimeout.bind(self), _ct = self.clearTimeout.bind(self), _si = self.setInterval.bind(self), _ci = self.clearInterval.bind(self);
    let pending = 0, finished = false, exited = false, exitCode = 0, files = {}, cwd = '';
    const EXIT = { exit: true };
    const exit = code => { if (!exited) { exited = true; post('exit', { code: code | 0 }); } };
    const check = () => { if (finished && pending === 0) exit(exitCode); };
    const liveT = new Set(), liveI = new Set();
    self.setTimeout = (fn, ms, ...a) => {
      pending++;
      const id = _st(() => { liveT.delete(id); try { fn(...a); } finally { pending--; _st(check, 0); } }, ms);
      liveT.add(id);
      return id;
    };
    self.clearTimeout = id => { if (liveT.delete(id)) { pending--; _st(check, 0); } _ct(id); };
    self.setInterval = (fn, ms, ...a) => { pending++; const id = _si(fn, ms, ...a); liveI.add(id); return id; };
    self.clearInterval = id => { if (liveI.delete(id)) { pending--; _st(check, 0); } _ci(id); };

    const wrap = (open, parts, close) => {
      if (!parts.length) return open + close;
      const one = open + ' ' + parts.join(', ') + ' ' + close;
      if (one.length <= 76 && !one.includes('\n')) return one;
      return open + '\n' + parts.map(p => '  ' + p.replace(/\n/g, '\n  ')).join(',\n') + '\n' + close;
    };
    const fmt = (v, depth, top, seen) => {
      seen = seen || new Set();
      if (typeof v === 'string') return top ? v : "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (typeof v === 'bigint') return String(v) + 'n';
      if (typeof v === 'number' || typeof v === 'boolean') return Object.is(v, -0) ? '-0' : String(v);
      if (typeof v === 'symbol') return v.toString();
      if (typeof v === 'function') return (/^class\s/.test(Function.prototype.toString.call(v)) ? '[class ' : '[Function: ') + (v.name || '(anonymous)') + ']';
      if (v instanceof Error) return stackOf(v);
      if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
      if (v instanceof RegExp) return String(v);
      if (seen.has(v)) return '[Circular *1]';
      if (depth > 2) return Array.isArray(v) ? '[Array]' : '[Object]';
      seen.add(v);
      let out;
      if (Array.isArray(v)) out = wrap('[', v.map(x => fmt(x, depth + 1, false, seen)), ']');
      else if (v instanceof Map) out = `Map(${v.size}) ` + wrap('{', [...v].map(([k, x]) => fmt(k, depth + 1, false, seen) + ' => ' + fmt(x, depth + 1, false, seen)), '}');
      else if (v instanceof Set) out = `Set(${v.size}) ` + wrap('{', [...v].map(x => fmt(x, depth + 1, false, seen)), '}');
      else {
        const name = v.constructor && v.constructor.name && v.constructor.name !== 'Object' ? v.constructor.name + ' ' : (Object.getPrototypeOf(v) === null ? '[Object: null prototype] ' : '');
        out = name + wrap('{', Object.keys(v).map(k => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : fmt(k, 9)) + ': ' + fmt(v[k], depth + 1, false, seen)), '}');
      }
      seen.delete(v);
      return out;
    };
    const format = args => {
      if (typeof args[0] === 'string' && /%[sdifjoO%]/.test(args[0])) {
        let i = 1;
        const s = args[0].replace(/%([sdifjoO%])/g, (m, c) => {
          if (c === '%') return '%';
          if (i >= args.length) return m;
          const a = args[i++];
          return c === 's' ? String(a) : c === 'd' || c === 'i' ? String(parseInt(a, 10)) : c === 'f' ? String(parseFloat(a)) : c === 'j' ? JSON.stringify(a) : fmt(a, 0);
        });
        return [s, ...args.slice(i).map(a => fmt(a, 0, true))].join(' ');
      }
      return args.map(a => fmt(a, 0, true)).join(' ');
    };
    const stackOf = e => {
      if (!(e instanceof Error)) return fmt(e, 0, true);
      const head = `${e.name}: ${e.message}`;
      const st = String(e.stack || '');
      return st.startsWith(e.name) ? st : head + '\n' + st.split('\n').filter(Boolean).map(l => '    at ' + l.replace(/^(.*?)@/, (m, fn) => (fn ? fn + ' (' : '(')) + (l.includes('@') ? ')' : '')).join('\n');
    };
    const timers = {};
    const console = {
      log: (...a) => post('out', { text: format(a) }),
      error: (...a) => post('out', { text: format(a), err: true }),
      table: v => post('out', { text: fmt(v, 0, true) }),
      time: (l = 'default') => { timers[l] = performance.now(); },
      timeEnd: (l = 'default') => { if (l in timers) { post('out', { text: `${l}: ${(performance.now() - timers[l]).toFixed(3)}ms` }); delete timers[l]; } },
      assert: (c, ...a) => { if (!c) post('out', { text: 'Assertion failed' + (a.length ? ': ' + format(a) : ''), err: true }); },
      group() {}, groupEnd() {}, clear() {},
    };
    console.info = console.debug = console.log; console.warn = console.error; console.dir = v => console.log(v);
    self.console = console;

    const norm = p => { const o = []; for (const s of String(p).split('/')) { if (!s || s === '.') continue; if (s === '..') o.pop(); else o.push(s); } return o.join('/'); };
    const dirname = p => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
    const abs = p => (String(p).startsWith('/') ? norm(p) : norm(cwd + '/' + p));

    class AssertionError extends Error { constructor(m) { super(m); this.name = 'AssertionError'; this.code = 'ERR_ASSERTION'; } }
    const deepEq = (a, b) => {
      if (Object.is(a, b)) return true;
      if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      const ka = Object.keys(a), kb = Object.keys(b);
      return ka.length === kb.length && ka.every(k => deepEq(a[k], b[k]));
    };
    const assert = (v, m) => { if (!v) throw new AssertionError(m || 'The expression evaluated to a falsy value'); };
    Object.assign(assert, {
      ok: assert, AssertionError,
      equal: (a, b, m) => { if (a != b) throw new AssertionError(m || `${fmt(a, 0)} == ${fmt(b, 0)}`); },
      notEqual: (a, b, m) => { if (a == b) throw new AssertionError(m || `${fmt(a, 0)} != ${fmt(b, 0)}`); },
      strictEqual: (a, b, m) => { if (!Object.is(a, b)) throw new AssertionError(m || `Expected values to be strictly equal:\n\n${fmt(a, 0)} !== ${fmt(b, 0)}\n`); },
      notStrictEqual: (a, b, m) => { if (Object.is(a, b)) throw new AssertionError(m || `Expected values to differ: ${fmt(a, 0)}`); },
      deepEqual: (a, b, m) => { if (!deepEq(a, b)) throw new AssertionError(m || `Expected values to be deeply equal:\n\n${fmt(a, 0)}\n\nshould equal\n\n${fmt(b, 0)}\n`); },
      throws: (fn, exp, m) => {
        try { fn(); } catch (e) {
          if (typeof exp === 'function' && exp.prototype !== undefined && !(e instanceof exp)) throw new AssertionError(m || `Expected ${exp.name} but got ${e && e.name}`);
          if (exp instanceof RegExp && !exp.test(String(e && e.message))) throw new AssertionError(m || `Error message did not match ${exp}`);
          return;
        }
        throw new AssertionError(typeof exp === 'string' ? exp : m || 'Missing expected exception.');
      },
      fail: m => { throw new AssertionError(m || 'Failed'); },
    });
    assert.deepStrictEqual = assert.deepEqual;
    assert.strict = assert;

    const enoent = (op, p) => Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), { code: 'ENOENT' });
    const isDir = p => p === '' || Object.keys(files).some(f => f.startsWith(p + '/'));
    const fs = {
      existsSync: p => abs(p) in files || isDir(abs(p)),
      readFileSync: p => { const a = abs(p); if (!(a in files)) throw enoent('open', p); return files[a]; },
      writeFileSync: (p, d) => { const a = abs(p); files[a] = String(d); post('write', { path: a, data: files[a] }); },
      appendFileSync: (p, d) => fs.writeFileSync(p, (files[abs(p)] || '') + String(d)),
      unlinkSync: p => { const a = abs(p); if (!(a in files)) throw enoent('unlink', p); delete files[a]; post('rm', { path: a }); },
      mkdirSync: p => post('mkdir', { path: abs(p) }),
      readdirSync: p => {
        const a = abs(p), pre = a ? a + '/' : '';
        if (!isDir(a)) throw enoent('scandir', p);
        return [...new Set(Object.keys(files).filter(f => f.startsWith(pre)).map(f => f.slice(pre.length).split('/')[0]))].sort();
      },
      statSync: p => { const a = abs(p); if (!(a in files) && !isDir(a)) throw enoent('stat', p); return { isFile: () => a in files, isDirectory: () => !(a in files), size: (files[a] || '').length }; },
    };
    const path = {
      sep: '/',
      join: (...a) => norm(a.join('/')) || '.',
      resolve: (...a) => '/' + a.reduce((acc, x) => (String(x).startsWith('/') ? norm(x) : norm(acc + '/' + x)), cwd),
      dirname: p => dirname(String(p)) || '.',
      basename: (p, ext) => { const b = String(p).slice(String(p).lastIndexOf('/') + 1); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
      extname: p => { const b = path.basename(p), i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i); },
    };
    const process = {
      argv: [], env: {}, platform: 'browser', version: 'juniper-js', pid: 1,
      cwd: () => '/' + cwd,
      exit: code => { exitCode = code === undefined ? exitCode : code | 0; exit(exitCode); throw EXIT; },
      nextTick: (fn, ...a) => Promise.resolve().then(() => fn(...a)),
      stdout: { write: s => post('raw', { text: String(s) }) },
      stderr: { write: s => post('raw', { text: String(s) }) },
      hrtime: { bigint: () => BigInt(Math.round(performance.now() * 1e6)) },
      uptime: () => performance.now() / 1000,
      memoryUsage: () => ({ heapUsed: 0, rss: 0 }),
    };
    self.process = process; self.global = self;
    const builtins = { assert, fs, path, process, util: { inspect: v => fmt(v, 0), format: (...a) => format(a) }, os: { EOL: '\n', platform: () => 'browser' } };

    const mods = {}, cache = {};
    const requireFrom = from => id => {
      const name = String(id).replace(/^node:/, '');
      if (!/^\.{0,2}\//.test(name)) {
        if (name in builtins) return builtins[name];
        throw Object.assign(new Error(`Cannot find module '${id}' (npm packages are not available in this browser runtime)`), { code: 'MODULE_NOT_FOUND' });
      }
      const base = name.startsWith('/') ? norm(name) : norm(dirname(from) + '/' + name);
      const hit = [base, base + '.js', base + '.json', base + '/index.js'].find(c => c in mods);
      if (!hit) throw Object.assign(new Error(`Cannot find module '${id}'\nRequire stack:\n- ${from}`), { code: 'MODULE_NOT_FOUND' });
      return load(hit);
    };
    const load = p => {
      if (cache[p]) return cache[p].exports;
      const module = { exports: {}, id: p, filename: '/' + p };
      cache[p] = module;
      if ('json' in mods[p]) module.exports = JSON.parse(mods[p].json);
      else mods[p].fn.call(module.exports, module.exports, requireFrom(p), module, '/' + p, '/' + dirname(p));
      return module.exports;
    };
    const fail = e => { if (e === EXIT) return; post('out', { text: 'Uncaught ' + stackOf(e), err: true }); exit(1); };
    self.addEventListener('error', e => { e.preventDefault(); fail(e.error || new Error(e.message)); });
    self.addEventListener('unhandledrejection', e => { e.preventDefault(); fail(e.reason); });
    self.onmessage = e => {
      const o = e.data;
      files = o.files; cwd = o.cwd;
      process.argv = ['node', '/' + o.entry, ...o.argv];
      try { load(o.entry); } catch (err) { if (err !== EXIT) { post('out', { text: stackOf(err), err: true }); exit(1); } }
      finished = true;
      _st(check, 0);
    };
    return { mods };
  }

  const REQ = /\brequire\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  const ESM = /^\s*(import\s+[\w{*'"]|export\s+(default|const|let|var|function|class|async|\{|\*))/m;

  function collect(vfs, entry, entryCode) {
    const mods = new Map(), queue = [entry];
    while (queue.length) {
      const p = queue.shift();
      if (mods.has(p)) continue;
      const code = p === entry && entryCode != null ? entryCode : vfs.read(p);
      mods.set(p, code);
      if (p.endsWith('.json')) continue;
      for (const m of code.matchAll(REQ)) {
        if (!/^\.{0,2}\//.test(m[2])) continue;
        const base = m[2].startsWith('/') ? P.norm(m[2]) : P.join(P.dirname(p), m[2]);
        const hit = [base, base + '.js', base + '.json', base + '/index.js'].find(c => vfs.isFile(c));
        if (hit) queue.push(hit);
      }
    }
    return mods;
  }

  // opts: { vfs, entry | code, cwd, argv, out(text) } → { done: Promise<code>, kill() }
  function run(opts) {
    const { vfs, out } = opts;
    const entry = opts.entry || P.join(opts.cwd || '', '[eval]');
    const mods = collect(vfs, entry, opts.code);
    for (const [p, code] of mods) {
      if (!p.endsWith('.json') && ESM.test(code)) {
        out(`${p}\nSyntaxError: import/export syntax is not supported by the built-in runner.\nUse require() and module.exports (CommonJS) instead.\n`);
        return { done: Promise.resolve(1), kill() {} };
      }
    }
    let src = `const __rt = (${prelude.toString()})();\n`;
    const map = [];
    const lines = s => s.split('\n').length - 1;
    for (const [p, code] of mods) {
      if (p.endsWith('.json')) { src += `__rt.mods[${JSON.stringify(p)}] = { json: ${JSON.stringify(code)} };\n`; continue; }
      src += `__rt.mods[${JSON.stringify(p)}] = { fn: function (exports, require, module, __filename, __dirname) {\n`;
      const start = lines(src) + 1;
      src += code + '\n} };\n';
      map.push({ path: p, start, end: start + lines(code) });
    }
    const locate = n => { const m = map.find(x => n >= x.start && n <= x.end); return m ? { path: m.path, line: n - m.start + 1 } : null; };
    const rewrite = text => text.split('\n').map(line => {
      const m = /(?:blob:|https?:|file:)[^\s)]*?:(\d+):(\d+)/.exec(line);
      if (!m) return line;
      const loc = locate(+m[1]);
      return loc ? line.replace(m[0], `${loc.path}:${loc.line}:${m[2]}`) : null;
    }).filter(l => l !== null).join('\n');

    let worker, url, settle, ended = false;
    const done = new Promise(r => { settle = r; });
    const finish = code => { if (ended) return; ended = true; try { worker && worker.terminate(); } catch {} if (url) URL.revokeObjectURL(url); settle(code); };
    try {
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
    } catch (e) {
      out(`node: could not start a worker in this browser (${e.message})\n`);
      finish(1);
      return { done, kill() {} };
    }
    worker.onmessage = e => {
      const m = e.data;
      if (ended) return;
      if (m.t === 'out') out((m.err ? rewrite(m.text) : m.text) + '\n');
      else if (m.t === 'raw') out(m.text);
      else if (m.t === 'write') { try { vfs.write(m.path, m.data); } catch (err) { out(`fs: ${err.message}\n`); } }
      else if (m.t === 'mkdir') { try { vfs.mkdir(m.path); } catch {} }
      else if (m.t === 'rm') { try { vfs.remove(m.path); } catch {} }
      else if (m.t === 'exit') finish(m.code);
    };
    worker.onerror = e => {
      e.preventDefault();
      const loc = locate(e.lineno);
      out(`${loc ? `${loc.path}:${loc.line}` : 'node'}\n${String(e.message || 'Script error').replace(/^Uncaught /, '')}\n`);
      finish(1);
    };
    const files = {};
    for (const [p, c] of vfs.files) if (c.length < 400000) files[p] = c;
    worker.postMessage({ entry, files, cwd: opts.cwd || '', argv: opts.argv || [] });
    return { done, kill: () => { out('^C\n'); finish(130); } };
  }

  return { run };
})();
