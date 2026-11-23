'use strict';
/* Seed: builds the sample workspace and its git history. SAMPLE is injected at build time. */
const Seed = {
  name: 'brew-timer',
  apply(vfs, git) {
    const F = SAMPLE, H = 3600e3, now = Date.now();
    const put = (...paths) => paths.forEach(p => vfs.write(p, F[p]));
    const commit = (msg, hoursAgo) => { git.add(''); git.commit(msg, { time: now - hoursAgo * H }); };
    const presets = [
      'const PRESETS = {',
      '  v60: { ratio: 16, pours: 3 },',
      '  chemex: { ratio: 15, pours: 2 },',
      '  aeropress: { ratio: 13, pours: 1 },',
      '};',
      '',
      '',
    ].join('\n');
    vfs.batch(() => {
      vfs.write('README.md', F['README.md'].split('\n## Scripts')[0]);
      vfs.write('package.json', F['package.json'].replace('"0.3.0"', '"0.1.0"'));
      put('.gitignore');
      commit('Initial commit', 122);
      put('src/ratio.js', 'scripts/report.js', 'tests/ratio.test.js');
      commit('Add ratio module, report script and tests', 97);
      put('index.html', 'styles/main.css', 'src/main.js', 'src/types.ts', 'package.json');
      commit('Add brew calculator page', 50);
      git.createBranch('feature/presets');
      git.checkout('feature/presets');
      vfs.write('src/ratio.js', F['src/ratio.js'].replace('const api = { DEFAULT_RATIO,', presets + 'const api = { DEFAULT_RATIO, PRESETS,'));
      commit('Add preset recipes for V60, Chemex and AeroPress', 26);
      git.checkout('main');
      put('README.md');
      commit('Document npm scripts in README', 5);
      // Uncommitted work, so Source Control has something to show.
      vfs.write('styles/main.css', F['styles/main.css'].replace('--accent: #8a5a2b;', '--accent: #a4532a;') + '\nli + li {\n  margin-top: 0.25rem;\n}\n');
      put('docs/notes.md');
    });
  },
};
if (typeof module !== 'undefined') module.exports = Seed;
