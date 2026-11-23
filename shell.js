'use strict';
/* Shell: a small command interpreter over the virtual file system and git engine. */
const Shell = (() => {
  const { P, GitError, FsError, diffLines, hunks, diffStat, splitLines } = Core;
  const sgr = n => s => `\x1b[${n}m${s}\x1b[0m`;
  const C = { red: sgr(31), green: sgr(32), yellow: sgr(33), blue: sgr('1;34'), magenta: sgr(35), cyan: sgr(36), dim: sgr(2), bold: sgr(1) };

  function tokenize(line) {
    const toks = [];
    let cur = '', has = false, i = 0, q = null;
    const push = () => { if (has) toks.push({ v: cur }); cur = ''; has = false; };
    while (i < line.length) {
      const ch = line[i];
      if (q) {
        if (ch === q) q = null;
        else if (ch === '\\' && q === '"' && '"\\'.includes(line[i + 1] || '')) cur += line[++i];
        else cur += ch;
        i++; continue;
      }
      if (ch === '"' || ch === "'") { q = ch; has = true; i++; continue; }
      if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; i++; continue; }
      if (/\s/.test(ch)) { push(); i++; continue; }
      const two = line.substr(i, 2);
      if (two === '&&' || two === '||' || two === '>>') { push(); toks.push({ op: two }); i += 2; continue; }
      if (ch === ';' || ch === '|' || ch === '>') { push(); toks.push({ op: ch }); i++; continue; }
      if (ch === '#' && !has) break;
      cur += ch; has = true; i++;
    }
    if (q) throw new Error('unterminated quote');
    push();
    return toks;
  }

  const fmtDate = t => {
    const d = new Date(t), s = d.toString().split(' ');
    const off = -d.getTimezoneOffset(), sign = off < 0 ? '-' : '+', a = Math.abs(off);
    return `${s[0]} ${s[1]} ${+s[2]} ${s[4]} ${s[3]} ${sign}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
  };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const NO_REMOTE = "fatal: this workspace has no remotes. It lives in your browser, so push, pull, fetch and clone aren't available.";
  const GIT_SUBS = ['add', 'branch', 'checkout', 'commit', 'config', 'diff', 'init', 'log', 'merge', 'reset', 'restore', 'rm', 'show', 'stash', 'status', 'switch'];

  class Shell {
    constructor(env) { this.env = env; this.cwd = ''; }
    get vfs() { return this.env.vfs; }
    get git() { return this.env.git; }
    path(p) { return P.resolve(this.cwd, p); }
    promptText() {
      const where = '~/' + this.env.name + (this.cwd ? '/' + this.cwd : '');
      const br = this.git.HEAD;
      return { text: `${C.green(where)} ${C.cyan('(' + br + ')')} $ `, len: where.length + br.length + 6 };
    }

    async run(line) {
      let toks;
      try { toks = tokenize(line); } catch (e) { this.env.write(`sh: ${e.message}\n`); return 2; }
      const cmds = [];
      let cur = { argv: [] }, wantFile = null;
      for (const t of toks) {
        if (t.op === '>' || t.op === '>>') wantFile = t.op;
        else if (t.op === '|') { this.env.write("sh: pipes aren't supported in this shell\n"); return 2; }
        else if (t.op) { cur.next = t.op; cmds.push(cur); cur = { argv: [] }; }
        else if (wantFile) { cur.redir = { op: wantFile, file: t.v }; wantFile = null; }
        else cur.argv.push(t.v);
      }
      if (wantFile) { this.env.write('sh: syntax error: expected a file name after >\n'); return 2; }
      cmds.push(cur);
      let code = 0;
      for (const c of cmds) {
        if (!c.argv.length) continue;
        code = await this.one(c);
        if (c.next === '&&' && code !== 0) break;
        if (c.next === '||' && code === 0) break;
      }
      return code;
    }

    async one(c) {
      const name = c.argv[0], buf = [];
      const io = { out: s => (c.redir ? buf.push(s) : this.env.write(s)), err: s => this.env.write(s) };
      const fn = CMDS[name];
      let code;
      if (!fn) { io.err(`sh: command not found: ${name}\n`); return 127; }
      try { code = (await fn.call(this, c.argv.slice(1), io)) || 0; }
      catch (e) {
        if (e instanceof GitError) io.err(e.message + '\n');
        else if (e instanceof FsError) io.err(`${name}: ${e.message}\n`);
        else io.err(`${name}: ${e.message}\n`);
        code = 1;
      }
      if (c.redir) {
        const p = this.path(c.redir.file), text = buf.join('');
        try { this.vfs.write(p, c.redir.op === '>>' ? (this.vfs.read(p) ?? '') + text : text); }
        catch (e) { io.err(`sh: ${e.message}\n`); code = 1; }
      }
      return code;
    }

    complete(text) {
      const word = /(\S*)$/.exec(text)[1];
      const words = text.slice(0, text.length - word.length).trim().split(/\s+/).filter(Boolean);
      let cands = [];
      if (!words.length) cands = Object.keys(CMDS).filter(c => c.startsWith(word)).sort().map(c => c + ' ');
      else if (words[0] === 'git' && words.length === 1) cands = GIT_SUBS.filter(s => s.startsWith(word)).map(s => s + ' ');
      else {
        if (words[0] === 'git' && ['checkout', 'switch', 'merge', 'branch'].includes(words[1])) cands.push(...Object.keys(this.git.branches).filter(b => b.startsWith(word)).map(b => b + ' '));
        if (words[0] === 'npm' && words[1] === 'run') cands.push(...Object.keys(this.scripts() || {}).filter(s => s.startsWith(word)).map(s => s + ' '));
        const slash = word.lastIndexOf('/'), dirPart = slash >= 0 ? word.slice(0, slash + 1) : '', base = word.slice(slash + 1);
        const dir = this.path(dirPart || '.');
        if (this.vfs.isDir(dir)) for (const e of this.vfs.list(dir)) if (e.name.startsWith(base) && (base.startsWith('.') || !e.name.startsWith('.'))) cands.push(dirPart + e.name + (e.dir ? '/' : ' '));
      }
      return { word, cands: [...new Set(cands)] };
    }

    scripts() {
      try { return JSON.parse(this.vfs.read('package.json') || '{}').scripts || {}; } catch { return null; }
    }

    /* ---- git output helpers ---- */
    decor(id) {
      const refs = this.git.refsAt(id);
      if (!refs.length) return '';
      const parts = refs.map(r => (r === this.git.HEAD ? C.cyan('HEAD -> ') + C.green(r) : C.green(r)));
      parts.sort((a, b) => b.includes('HEAD') - a.includes('HEAD'));
      return ` ${C.yellow('(')}${parts.join(C.yellow(', '))}${C.yellow(')')}`;
    }
    printCommit(io, c, oneline) {
      const subject = c.message.split('\n')[0];
      if (oneline) { io.out(`${C.yellow(this.git.short(c.id))}${this.decor(c.id)} ${subject}\n`); return; }
      io.out(`${C.yellow('commit ' + c.id)}${this.decor(c.id)}\n`);
      if (c.parents.length > 1) io.out(`Merge: ${c.parents.map(p => this.git.short(p)).join(' ')}\n`);
      io.out(`Author: ${c.author}\nDate:   ${fmtDate(c.time)}\n\n${c.message.split('\n').map(l => '    ' + l).join('\n')}\n\n`);
    }
    printDiff(io, path, a, b, aExists, bExists) {
      const ops = diffLines(a, b);
      const hs = hunks(ops);
      if (!hs.length && aExists === bExists) return;
      io.out(C.bold(`diff --git a/${path} b/${path}`) + '\n');
      if (!aExists) io.out(C.bold('new file') + '\n');
      if (!bExists) io.out(C.bold('deleted file') + '\n');
      io.out(C.bold(`--- ${aExists ? 'a/' + path : '/dev/null'}`) + '\n' + C.bold(`+++ ${bExists ? 'b/' + path : '/dev/null'}`) + '\n');
      for (const h of hs) {
        io.out(C.cyan(`@@ -${h.aStart}${h.aLen === 1 ? '' : ',' + h.aLen} +${h.bStart}${h.bLen === 1 ? '' : ',' + h.bLen} @@`) + '\n');
        for (const o of h.lines) io.out(o.t === '+' ? C.green('+' + o.s) + '\n' : o.t === '-' ? C.red('-' + o.s) + '\n' : ' ' + o.s + '\n');
      }
    }
    statSummary(files) {
      let add = 0, del = 0;
      for (const f of files) { const s = diffStat(f.a, f.b); add += s.add; del += s.del; }
      let s = ` ${plural(files.length, 'file')} changed`;
      if (add) s += `, ${plural(add, 'insertion')}(+)`;
      if (del) s += `, ${plural(del, 'deletion')}(-)`;
      return s + '\n';
    }
    treeDiffFiles(a, b, filter) {
      const g = this.git, out = [];
      for (const p of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        if (a[p] === b[p] || (filter && !filter(p))) continue;
        out.push({ path: p, a: g.content(a[p]), b: g.content(b[p]), aExists: p in a, bExists: p in b });
      }
      return out;
    }

    gitStatus(io, short) {
      const g = this.git, st = g.status();
      const tracked = st.unstaged.filter(x => x.status !== 'U'), untracked = st.unstaged.filter(x => x.status === 'U');
      if (short) {
        for (const x of st.staged) io.out(`${C.green(x.status)}  ${x.path}\n`);
        for (const x of tracked) io.out(` ${C.red(x.status)} ${x.path}\n`);
        for (const x of untracked) io.out(`${C.red('??')} ${x.path}\n`);
        return;
      }
      const label = { A: 'new file:   ', M: 'modified:   ', D: 'deleted:    ' };
      io.out(`On branch ${g.HEAD}\n`);
      if (!g.headId()) io.out('\nNo commits yet\n');
      if (st.staged.length) {
        io.out('Changes to be committed:\n  (use "git restore --staged <file>..." to unstage)\n');
        for (const x of st.staged) io.out('\t' + C.green(label[x.status] + x.path) + '\n');
        io.out('\n');
      }
      if (tracked.length) {
        io.out('Changes not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n  (use "git restore <file>..." to discard changes in working directory)\n');
        for (const x of tracked) io.out('\t' + C.red(label[x.status] + x.path) + '\n');
        io.out('\n');
      }
      if (untracked.length) {
        io.out('Untracked files:\n  (use "git add <file>..." to include in what will be committed)\n');
        for (const x of untracked) io.out('\t' + C.red(x.path) + '\n');
        io.out('\n');
      }
      if (!st.staged.length && !st.unstaged.length) io.out('nothing to commit, working tree clean\n');
      else if (!st.staged.length) io.out(tracked.length ? 'no changes added to commit (use "git add" and/or "git commit -a")\n' : 'nothing added to commit but untracked files present (use "git add" to track)\n');
    }

    async gitCmd(args, io) {
      const g = this.git, sub = args[0], rest = args.slice(1);
      const flags = rest.filter(a => a.startsWith('-')), pos = rest.filter(a => !a.startsWith('-'));
      const has = (...f) => f.some(x => flags.includes(x));
      const rel = p => (p === '.' ? this.cwd : this.path(p));
      switch (sub) {
        case undefined: case 'help': case '--help':
          io.out('usage: git <command> [<args>]\n\nAvailable here:\n   ' + GIT_SUBS.join(', ') + '\n\nThis is a built-in git that keeps its history in your browser. There are no remotes.\n');
          return 0;
        case '--version': case 'version': io.out('git version 2.x (Juniper built-in)\n'); return 0;
        case 'init': io.out(`Reinitialized existing Git repository in ~/${this.env.name}/.git/\n`); return 0;
        case 'status': this.gitStatus(io, has('-s', '--short')); return 0;
        case 'add': {
          if (has('-A', '--all')) { g.add(''); return 0; }
          if (!pos.length) { io.out('Nothing specified, nothing added.\nhint: Maybe you wanted to say \'git add .\'?\n'); return 0; }
          for (const p of pos) g.add(rel(p));
          return 0;
        }
        case 'commit': {
          let msg = null, all = false;
          for (let i = 0; i < rest.length; i++) {
            const a = rest[i];
            if (a === '-m' || a === '--message') msg = (msg ? msg + '\n\n' : '') + (rest[++i] ?? '');
            else if (a === '-am' || a === '-ma') { all = true; msg = rest[++i] ?? ''; }
            else if (a === '-a' || a === '--all') all = true;
            else if (a === '--amend') throw new GitError("error: --amend isn't supported by the built-in git");
          }
          if (msg == null) throw new GitError('error: there is no editor to write a message in. Use: git commit -m "message"');
          if (all) for (const x of g.status().unstaged) if (x.status !== 'U') g.add(x.path);
          const c = g.commit(msg);
          const info = g.show(c.id);
          io.out(`[${g.HEAD}${c.parents.length ? '' : ' (root-commit)'} ${g.short(c.id)}] ${c.message.split('\n')[0]}\n`);
          io.out(this.statSummary(info.files.map(f => ({ a: g.content(f.a), b: g.content(f.b) }))));
          return 0;
        }
        case 'log': {
          let n = Infinity;
          for (let i = 0; i < rest.length; i++) {
            if (/^-\d+$/.test(rest[i])) n = +rest[i].slice(1);
            else if (rest[i] === '-n') n = +rest[++i];
          }
          const ref = pos.find(p => g.resolve(p));
          const list = g.log(ref ? g.resolve(ref) : undefined, has('--all'));
          if (!list.length) throw new GitError(`fatal: your current branch '${g.HEAD}' does not have any commits yet`);
          for (const c of list.slice(0, n)) this.printCommit(io, c, has('--oneline'));
          return 0;
        }
        case 'show': {
          const id = g.resolve(pos[0]);
          if (!id) throw new GitError(`fatal: bad revision '${pos[0] || 'HEAD'}'`);
          const info = g.show(id);
          this.printCommit(io, info.commit, false);
          for (const f of info.files) this.printDiff(io, f.path, g.content(f.a), g.content(f.b), f.status !== 'A', f.status !== 'D');
          return 0;
        }
        case 'diff': {
          let a, b, paths = pos;
          const refs = pos.filter(p => g.resolve(p) && !this.vfs.exists(rel(p)));
          if (refs.length === 2) { a = g.treeOf(g.resolve(refs[0])); b = g.treeOf(g.resolve(refs[1])); paths = pos.filter(p => !refs.includes(p)); }
          else if (has('--staged', '--cached')) { a = g.headTree(); b = g.index; }
          else {
            a = g.index; b = {};
            const work = g.workTree();
            for (const p in a) if (p in work) b[p] = work[p];
          }
          const targets = paths.map(rel);
          const files = this.treeDiffFiles(a, b, targets.length ? p => targets.some(t => P.within(p, t)) : null)
            .map(f => (f.bExists && b !== g.index && refs.length !== 2 ? { ...f, b: this.vfs.read(f.path) } : f));
          if (has('--name-only')) { for (const f of files) io.out(f.path + '\n'); return 0; }
          if (has('--stat')) { if (files.length) io.out(this.statSummary(files)); return 0; }
          for (const f of files) this.printDiff(io, f.path, f.a, f.b, f.aExists, f.bExists);
          return 0;
        }
        case 'branch': {
          if (has('-d', '-D', '--delete')) {
            if (!pos.length) throw new GitError('fatal: branch name required');
            for (const name of pos) { const id = g.deleteBranch(name, has('-D')); io.out(`Deleted branch ${name} (was ${g.short(id)}).\n`); }
            return 0;
          }
          if (has('-m', '-M')) { if (!pos[0]) throw new GitError('fatal: branch name required'); g.renameBranch(pos[pos.length - 1]); return 0; }
          if (pos.length) { g.createBranch(pos[0], pos[1]); return 0; }
          const names = Object.keys(g.branches).sort();
          if (!names.length) return 0;
          for (const name of names) {
            const cur = name === g.HEAD, c = g.commits[g.branches[name]];
            const extra = has('-v', '-vv') ? ` ${g.short(c.id)} ${c.message.split('\n')[0]}` : '';
            io.out(cur ? `* ${C.green(name)}${extra}\n` : `  ${name}${extra}\n`);
          }
          return 0;
        }
        case 'switch': case 'checkout': {
          const create = has('-b', '-c', '-B', '-C');
          if (create) {
            if (!pos[0]) throw new GitError('fatal: branch name required');
            g.createBranch(pos[0], pos[1]);
            g.checkout(pos[0]);
            io.out(`Switched to a new branch '${pos[0]}'\n`);
            return 0;
          }
          const dashdash = rest.indexOf('--');
          if (dashdash < 0 && pos.length === 1 && g.branches[pos[0]]) {
            io.out(g.checkout(pos[0]) ? `Switched to branch '${pos[0]}'\n` : `Already on '${pos[0]}'\n`);
            return 0;
          }
          const paths = dashdash >= 0 ? rest.slice(dashdash + 1) : pos;
          if (sub === 'switch' || !paths.length) throw new GitError(paths.length ? `fatal: invalid reference: ${paths[0]}` : 'fatal: missing branch name');
          for (const p of paths) {
            const t = rel(p);
            if (!this.vfs.exists(t) && !Object.keys(g.index).some(k => P.within(k, t))) throw new GitError(`error: pathspec '${p}' did not match any file(s) known to git`);
            g.discard(t);
          }
          io.out(`Updated ${plural(paths.length, 'path')} from the index\n`);
          return 0;
        }
        case 'restore': {
          const paths = pos;
          if (!paths.length) throw new GitError('fatal: you must specify path(s) to restore');
          for (const p of paths) { if (has('--staged')) g.unstage(rel(p)); else g.discard(rel(p)); }
          return 0;
        }
        case 'reset': {
          const mode = has('--hard') ? 'hard' : has('--soft') ? 'soft' : 'mixed';
          const ref = pos[0];
          if (ref && !g.resolve(ref)) {
            for (const p of pos) g.unstage(rel(p));
          } else {
            const id = g.reset(ref, mode);
            if (mode === 'hard' && id) { io.out(`HEAD is now at ${g.short(id)} ${g.commits[id].message.split('\n')[0]}\n`); return 0; }
          }
          const un = g.status().unstaged.filter(x => x.status !== 'U');
          if (un.length && mode === 'mixed') io.out('Unstaged changes after reset:\n' + un.map(x => `${x.status}\t${x.path}\n`).join(''));
          return 0;
        }
        case 'merge': {
          if (!pos[0]) throw new GitError('fatal: specify a branch to merge');
          const before = g.headId();
          const r = g.merge(pos[0]);
          if (r.type === 'up-to-date') io.out('Already up to date.\n');
          else if (r.type === 'ff') io.out(`Updating ${g.short(before)}..${g.short(r.to)}\nFast-forward\n ${plural(r.files, 'file')} changed\n`);
          else io.out(`Merge made by the 'whole-file' strategy.\n ${plural(r.files, 'file')} changed\n`);
          return 0;
        }
        case 'stash': {
          const op = pos[0] || 'push';
          if (op === 'push' || op === 'save') { const s = g.stash(); io.out(`Saved working directory and index state ${s.message}\n`); }
          else if (op === 'pop' || op === 'apply') { g.stashPop(op === 'apply'); this.gitStatus(io); if (op === 'pop') io.out('Dropped stash@{0}\n'); }
          else if (op === 'list') g.stashes.forEach((s, i) => io.out(`stash@{${i}}: ${s.message}\n`));
          else if (op === 'drop') { if (!g.stashes.length) throw new GitError('No stash entries found.'); g.stashes.shift(); g._emit(); io.out('Dropped stash@{0}\n'); }
          else if (op === 'clear') { g.stashes = []; g._emit(); }
          else throw new GitError(`error: unknown stash subcommand: ${op}`);
          return 0;
        }
        case 'rm': {
          if (!pos.length) throw new GitError('fatal: No pathspec was given. Which files should I remove?');
          for (const p of pos) {
            const t = rel(p);
            const hit = Object.keys(g.index).filter(k => P.within(k, t));
            if (!hit.length) throw new GitError(`fatal: pathspec '${p}' did not match any files`);
            for (const k of hit) {
              if (!has('--cached') && this.vfs.isFile(k)) { this.vfs.remove(k); this.vfs.pruneEmpty(P.dirname(k)); }
              delete g.index[k];
              io.out(`rm '${k}'\n`);
            }
          }
          g._emit();
          return 0;
        }
        case 'config': {
          if (has('--list', '-l')) { io.out(`user.name=${g.user.name}\nuser.email=${g.user.email}\n`); return 0; }
          const key = pos[0], val = pos.slice(1).join(' ');
          if (key !== 'user.name' && key !== 'user.email') throw new GitError('error: only user.name and user.email can be configured here');
          const k = key.split('.')[1];
          if (val) { g.user[k] = val; g._emit(); } else io.out(g.user[k] + '\n');
          return 0;
        }
        case 'remote': return 0;
        case 'push': case 'pull': case 'fetch': case 'clone': throw new GitError(NO_REMOTE);
        default: throw new GitError(`git: '${sub}' is not a git command. See 'git help'.`);
      }
    }
  }

  const HELP = [
    ['Files', 'ls  cd  pwd  cat  head  wc  tree  mkdir  touch  rm  mv  cp  grep'],
    ['Editor', 'code <file>   open a file in the editor\npreview <file.html>   open the live preview'],
    ['Run', 'node <file.js>   run JavaScript (CommonJS) in a worker\nnpm run <script>   run a script from package.json\nnpm test, npm start'],
    ['Git', 'git status | add | commit | log | diff | show | branch | switch | checkout\ngit merge | stash | restore | reset | rm | config'],
    ['Shell', 'echo  clear  history  date  whoami  exit   cmd1 && cmd2   cmd > file   cmd >> file'],
  ];
  const UNAVAILABLE = {
    python: 'Python is not available here. JavaScript runs with: node <file.js>', python3: null, pip: null,
    npx: 'npx needs the npm registry, which this browser sandbox cannot reach.', yarn: null, pnpm: null,
    curl: 'Network access is not available in this sandbox.', wget: null, ssh: null,
    vim: 'Open files in the editor instead: code <file>', vi: null, nano: null,
    sudo: 'There is nothing to be root of here.',
  };

  const flagsOf = args => new Set(args.filter(a => /^-[A-Za-z]+$/.test(a)).flatMap(a => a.slice(1).split('')));
  const posOf = args => args.filter(a => !/^-[A-Za-z]+$/.test(a));

  const CMDS = {
    help(args, io) {
      io.out(C.bold('Juniper shell') + C.dim('  (a simulated shell over the workspace in your browser)') + '\n\n');
      for (const [title, body] of HELP) io.out(C.cyan(title) + '\n' + body.split('\n').map(l => '  ' + l).join('\n') + '\n\n');
      io.out(C.dim('Tab completes commands and paths. Up/Down walks history. Ctrl+C stops a running program.') + '\n');
    },
    pwd(args, io) { io.out(`/home/dev/${this.env.name}${this.cwd ? '/' + this.cwd : ''}\n`); },
    cd(args) {
      const t = this.path(args[0] || '~');
      if (!this.vfs.isDir(t)) throw new Error(this.vfs.isFile(t) ? `not a directory: ${args[0]}` : `no such file or directory: ${args[0]}`);
      this.cwd = t;
    },
    ls(args, io) {
      const f = flagsOf(args), targets = posOf(args);
      if (!targets.length) targets.push('.');
      let code = 0;
      targets.forEach((t, i) => {
        const p = this.path(t);
        if (this.vfs.isFile(p)) { io.out(t + '\n'); return; }
        if (!this.vfs.isDir(p)) { io.err(`ls: cannot access '${t}': No such file or directory\n`); code = 2; return; }
        if (targets.length > 1) io.out((i ? '\n' : '') + t + ':\n');
        const ents = this.vfs.list(p).filter(e => f.has('a') || !e.name.startsWith('.'));
        ents.sort((a, b) => a.name.localeCompare(b.name));
        if (f.has('l')) {
          for (const e of ents) io.out(e.dir ? `drwxr-xr-x  ${'-'.padStart(7)}  ${C.blue(e.name + '/')}\n` : `-rw-r--r--  ${String(this.vfs.read(e.path).length).padStart(7)}  ${e.name}\n`);
        } else if (ents.length) io.out(ents.map(e => (e.dir ? C.blue(e.name + '/') : e.name)).join('  ') + '\n');
      });
      return code;
    },
    cat(args, io) {
      if (!args.length) throw new Error('missing file operand');
      let code = 0;
      for (const a of args) {
        const p = this.path(a);
        if (this.vfs.isFile(p)) io.out(this.vfs.read(p));
        else { io.err(`cat: ${a}: ${this.vfs.isDir(p) ? 'Is a directory' : 'No such file or directory'}\n`); code = 1; }
      }
      return code;
    },
    head(args, io) {
      let n = 10; const files = [];
      for (let i = 0; i < args.length; i++) { if (args[i] === '-n') n = +args[++i]; else if (/^-\d+$/.test(args[i])) n = +args[i].slice(1); else files.push(args[i]); }
      for (const a of files) {
        const p = this.path(a);
        if (!this.vfs.isFile(p)) throw new Error(`cannot open '${a}'`);
        const lines = splitLines(this.vfs.read(p)).slice(0, n);
        if (lines.length) io.out(lines.join('\n') + '\n');
      }
    },
    wc(args, io) {
      const f = flagsOf(args);
      for (const a of posOf(args)) {
        const p = this.path(a);
        if (!this.vfs.isFile(p)) throw new Error(`${a}: No such file`);
        const t = this.vfs.read(p), l = (t.match(/\n/g) || []).length;
        io.out(f.has('l') ? `${l} ${a}\n` : `${String(l).padStart(5)} ${String((t.match(/\S+/g) || []).length).padStart(5)} ${String(new TextEncoder().encode(t).length).padStart(6)} ${a}\n`);
      }
    },
    echo(args, io) {
      const n = args[0] === '-n';
      io.out((n ? args.slice(1) : args).join(' ') + (n ? '' : '\n'));
    },
    mkdir(args) {
      const f = flagsOf(args), t = posOf(args);
      if (!t.length) throw new Error('missing operand');
      for (const a of t) {
        const p = this.path(a);
        if (this.vfs.exists(p)) { if (f.has('p') && this.vfs.isDir(p)) continue; throw new Error(`cannot create directory '${a}': File exists`); }
        if (!f.has('p') && !this.vfs.isDir(P.dirname(p))) throw new Error(`cannot create directory '${a}': No such file or directory`);
        this.vfs.mkdir(p);
      }
    },
    touch(args) {
      if (!args.length) throw new Error('missing file operand');
      for (const a of args) { const p = this.path(a); if (!this.vfs.exists(p)) this.vfs.write(p, ''); }
    },
    rm(args) {
      const f = flagsOf(args), t = posOf(args);
      if (!t.length) throw new Error('missing operand');
      for (const a of t) {
        const p = this.path(a);
        if (!p) throw new Error('refusing to remove the workspace root');
        if (!this.vfs.exists(p)) { if (f.has('f')) continue; throw new Error(`cannot remove '${a}': No such file or directory`); }
        if (this.vfs.isDir(p) && !f.has('r') && !f.has('R')) throw new Error(`cannot remove '${a}': Is a directory`);
        this.vfs.remove(p);
      }
    },
    mv(args) {
      const t = posOf(args);
      if (t.length < 2) throw new Error('missing destination operand');
      const dst = this.path(t[t.length - 1]);
      for (const a of t.slice(0, -1)) {
        const src = this.path(a);
        if (!this.vfs.exists(src) || !src) throw new Error(`cannot stat '${a}': No such file or directory`);
        this.vfs.rename(src, this.vfs.isDir(dst) ? P.join(dst, P.basename(src)) : dst);
      }
    },
    cp(args) {
      const f = flagsOf(args), t = posOf(args);
      if (t.length < 2) throw new Error('missing destination operand');
      const dst = this.path(t[t.length - 1]);
      this.vfs.batch(() => {
        for (const a of t.slice(0, -1)) {
          const src = this.path(a);
          const to = this.vfs.isDir(dst) ? P.join(dst, P.basename(src)) : dst;
          if (this.vfs.isFile(src)) this.vfs.write(to, this.vfs.read(src));
          else if (this.vfs.isDir(src)) {
            if (!f.has('r') && !f.has('R')) throw new Error(`-r not specified; omitting directory '${a}'`);
            this.vfs.mkdir(to);
            for (const file of this.vfs.allFiles()) if (P.within(file, src)) this.vfs.write(to + file.slice(src.length), this.vfs.read(file));
          } else throw new Error(`cannot stat '${a}': No such file or directory`);
        }
      });
    },
    tree(args, io) {
      const root = this.path(posOf(args)[0] || '.');
      if (!this.vfs.isDir(root)) throw new Error('not a directory');
      let dirs = 0, files = 0;
      io.out(C.blue(posOf(args)[0] || '.') + '\n');
      const walk = (dir, prefix) => {
        const ents = this.vfs.list(dir).filter(e => !e.name.startsWith('.'));
        ents.forEach((e, i) => {
          const last = i === ents.length - 1;
          io.out(prefix + (last ? '└── ' : '├── ') + (e.dir ? C.blue(e.name) : e.name) + '\n');
          if (e.dir) { dirs++; walk(e.path, prefix + (last ? '    ' : '│   ')); } else files++;
        });
      };
      walk(root, '');
      io.out(`\n${dirs} ${dirs === 1 ? 'directory' : 'directories'}, ${plural(files, 'file')}\n`);
    },
    grep(args, io) {
      const f = flagsOf(args), t = posOf(args);
      if (!t.length) throw new Error('usage: grep [-rni] pattern [path...]');
      let rx;
      try { rx = new RegExp(t[0], f.has('i') ? 'gi' : 'g'); } catch { rx = new RegExp(Core.escRx(t[0]), f.has('i') ? 'gi' : 'g'); }
      const targets = t.slice(1);
      if (!targets.length) { if (f.has('r')) targets.push('.'); else throw new Error('no files given (use -r to search folders)'); }
      const files = [];
      for (const a of targets) {
        const p = this.path(a);
        if (this.vfs.isFile(p)) files.push(p);
        else if (this.vfs.isDir(p)) { if (!f.has('r')) { io.err(`grep: ${a}: Is a directory\n`); continue; } files.push(...this.vfs.allFiles().filter(x => P.within(x, p))); }
        else io.err(`grep: ${a}: No such file or directory\n`);
      }
      let hits = 0;
      const showName = files.length > 1 || f.has('r');
      for (const file of files) {
        const shown = this.cwd && file.startsWith(this.cwd + '/') ? file.slice(this.cwd.length + 1) : file;
        splitLines(this.vfs.read(file)).forEach((line, i) => {
          rx.lastIndex = 0;
          if (!rx.test(line)) return;
          hits++;
          rx.lastIndex = 0;
          io.out((showName ? C.magenta(shown) + C.cyan(':') : '') + (f.has('n') ? C.green(String(i + 1)) + C.cyan(':') : '') + line.replace(rx, m => (m ? C.red(m) : m)) + '\n');
        });
      }
      return hits ? 0 : 1;
    },
    clear() { this.env.clear(); },
    history(args, io) { this.env.history().forEach((l, i) => io.out(`${String(i + 1).padStart(4)}  ${l}\n`)); },
    date(args, io) { io.out(new Date().toString() + '\n'); },
    whoami(args, io) { io.out('dev\n'); },
    exit() { this.env.exit(); },
    code(args) {
      if (!args.length) throw new Error('usage: code <file>');
      for (const a of args) {
        const p = this.path(a);
        if (this.vfs.isDir(p)) throw new Error(`${a} is a folder`);
        if (!this.vfs.isFile(p)) this.vfs.write(p, '');
        this.env.open(p);
      }
    },
    preview(args) {
      const p = this.path(args[0] || 'index.html');
      if (!this.vfs.isFile(p)) throw new Error(`${args[0] || 'index.html'}: No such file`);
      this.env.preview(p);
    },
    async node(args, io) {
      if (!args.length) { io.err('node: the interactive REPL is not available here. Run a file: node <file.js>\n'); return 1; }
      if (args[0] === '-v' || args[0] === '--version') { io.out('juniper-js (JavaScript in a browser worker, CommonJS modules)\n'); return 0; }
      if (args[0] === '-e' || args[0] === '-p') {
        const code = args[0] === '-p' ? `console.log(${args[1] || ''})` : (args[1] || '');
        return this.env.runNode({ code, cwd: this.cwd, argv: args.slice(2), out: io.out });
      }
      let p = this.path(args[0]);
      if (!this.vfs.isFile(p)) { if (this.vfs.isFile(p + '.js')) p += '.js'; else if (this.vfs.isFile(P.join(p, 'index.js'))) p = P.join(p, 'index.js'); else { io.err(`node: cannot find module '${args[0]}'\n`); return 1; } }
      return this.env.runNode({ entry: p, cwd: this.cwd, argv: args.slice(1), out: io.out });
    },
    async npm(args, io) {
      const sub = args[0];
      const scripts = this.scripts();
      const name = sub === 'run' || sub === 'run-script' ? args[1] : (sub === 'test' || sub === 't') ? 'test' : sub === 'start' ? 'start' : null;
      if (sub === 'run' && !args[1]) {
        const keys = Object.keys(scripts || {});
        io.out(keys.length ? 'Scripts available via `npm run`:\n' + keys.map(k => `  ${k}\n    ${scripts[k]}\n`).join('') : 'No scripts in package.json\n');
        return 0;
      }
      if (name) {
        if (!scripts) { io.err('npm: package.json is missing or not valid JSON\n'); return 1; }
        if (!scripts[name]) { io.err(`npm error Missing script: "${name}"\n`); return 1; }
        let pkg = {}; try { pkg = JSON.parse(this.vfs.read('package.json')); } catch {}
        io.out(`\n> ${pkg.name || this.env.name}@${pkg.version || '0.0.0'} ${name}\n> ${scripts[name]}\n\n`);
        const keep = this.cwd; this.cwd = '';
        try { return await this.run(scripts[name]); } finally { this.cwd = keep; }
      }
      if (sub === '-v' || sub === '--version') { io.out('npm scripts only (no registry access)\n'); return 0; }
      io.err('npm: the package registry cannot be reached from this browser sandbox, so installing is not available.\nScripts from package.json work: npm run <script>, npm test, npm start\n');
      return 1;
    },
    git(args, io) { return this.gitCmd(args, io); },
  };
  let lastMsg = '';
  for (const [name, msg] of Object.entries(UNAVAILABLE)) {
    if (msg) lastMsg = msg;
    const text = lastMsg;
    CMDS[name] = function (args, io) { io.err(`${name}: ${text}\n`); return 127; };
  }

  return { Shell, CMDS, C, tokenize };
})();
if (typeof module !== 'undefined') module.exports = Shell;
