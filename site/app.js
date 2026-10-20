(function () {
  var REPO = 'Vlor999/pr-radar';
  var ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.userAgent || '';
  var os = /mac/i.test(ua) ? 'mac-arm' : /win/i.test(ua) ? 'win' : /linux|x11|cros/i.test(ua) ? 'linux' : '';
  // Safari reports "Intel" on every Mac; a WebGL renderer naming an Intel GPU is the only cheap hint left.
  if (os === 'mac-arm') {
    try {
      var gl = document.createElement('canvas').getContext('webgl');
      var dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg && /intel/i.test(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))) os = 'mac-x64';
    } catch (e) {}
  }
  var ICON = {
    mac: '<path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.600-2.800-1.800-3.400-1.800-1.400-.1-2.800.9-3.500.9s-1.800-.8-3-.8c-1.500 0-3 .9-3.800 2.300-1.600 2.800-.4 7 1.200 9.300.8 1.100 1.700 2.400 2.900 2.300 1.200 0 1.600-.7 3-.7s1.800.7 3 .7 2-1.100 2.800-2.200c.9-1.300 1.200-2.500 1.200-2.600 0 0-2.400-.9-2.400-3.900zM14.100 5.800c.6-.8 1.100-1.900.9-3-.9 0-2.100.6-2.700 1.400-.6.700-1.100 1.800-1 2.900 1.100.1 2.200-.5 2.800-1.300z"/>',
    win: '<path d="M3 5.500 10.500 4.500v7H3zM11.500 4.400 21 3v8.500h-9.500zM3 12.500h7.500v7L3 18.500zM11.500 12.500H21V21l-9.500-1.400z"/>',
    linux: '<path d="M12 2c-2 0-3 1.800-3 4 0 1.500-.8 2.500-1.800 4C6 11.700 5 13.500 5 16c0 1.500.8 2.500 2 3l-1 2h12l-1-2c1.200-.5 2-1.500 2-3 0-2.500-1-4.300-2.200-6C15.800 8.500 15 7.500 15 6c0-2.200-1-4-3-4z"/>'
  };
  // EN strings; French stays in index.html (data-i18n / data-i18n-html / data-i18n-attr="attr:key").
  var EN = {
    skip: 'Skip to download', nav: 'Main', lang: 'Language', dl: 'Download', features: 'Features', how: 'How it works',
    tagline: 'Your open GitHub PRs, <span class="accent">as a tree.</span>',
    lead: 'Stacks, reviews, discussions and merge calendar, across all your repos. Free, open source, serverless.',
    heroMeta: 'macOS, Windows, Linux · MIT License', mockcap: 'Animated preview, sample data.',
    heroSr: 'Animated preview of the app: open PRs in the acme/web repo appear as a tree under the main branch, with one PR stacked under its parent. A card is selected with the keyboard, its review thread opens with a diff excerpt, and a reply is sent.',
    now: 'just now', pr42: 'feat(checkout): one-click payment', ready: 'Ready to merge', approved: 'Approved', blocks1: 'blocks 1 PR',
    pr45: 'feat(checkout): Apple Pay and Google Pay', 'new': 'New', by42: 'blocked by #42',
    pr38: 'fix(api): retry on payment 502s', changes: 'Changes requested', unres: '1 unresolved', stale: 'inactive for 6d',
    bob: '<b>bob</b> Cap the retries, or it loops forever.', alice: '<b>alice</b> Fixed: max 3 retries, with backoff.',
    ph: 'Your reply…', reply: 'Reply',
    auth1: 'On first launch, sign in with a code (<strong>device flow</strong>) or a <strong>personal access token</strong>.',
    flead: 'Everything waiting on you, across all your repos, in one window.',
    pr12: 'feat(cart): persistent cart', pr13: 'feat(cart): promo codes', by12: 'blocked by #12',
    cap1: '<strong>Stacks</strong>Each stacked PR sits under its parent, so you know what to merge first.<span class="sr"> Animation: the tree main, PR #12, PR #13 draws in, then the Ready to merge badge appears on PR #12.</span>',
    chloe: '<b>chloe</b> Why a one-day TTL?', alice2: '<b>alice</b> Matches session expiry', vtype: 'Matches session expiry',
    cap2: '<strong>Discussions</strong>Unresolved threads open with the code in question, and you reply without leaving the app.<span class="sr"> Animation: a diff excerpt, a question from chloe, then a reply typed and sent.</span>',
    month: 'October 2026', mo: 'M', m: 'Month', w: 'Week', d: 'Day', tu: 'T', we: 'W', th: 'T', fr: 'F', su: 'S',
    cap3: '<strong>Merge calendar</strong>Month, week or day: each repo\'s shipping pace at a glance.<span class="sr"> Animation: merged PR chips drop into the days of October.</span>',
    clock: 'Tue Oct 20 9:41 AM', t1: 'acme/web#42 approved', t1d: 'alice approved “feat(checkout): one-click payment”', tnow: 'now',
    t2: 'acme/api#17 ready to merge', t2d: 'All checks passed.',
    cap4: '<strong>Notifications</strong>An approval, a change request, a broken build: your system tells you.<span class="sr"> Animation: two system notifications slide in from the edge of the screen.</span>',
    more: 'And also', c1: 'Filters and search', c2: 'Ready-to-merge PRs', c3: 'Stale PRs', c4: 'New since last visit', c5: 'Repos by organization', c6: 'Light and dark theme',
    kbl: 'Everything works from the keyboard (Ctrl instead of ⌘ on Windows and Linux).',
    vs: 'Why not github.com/pulls?', vsd: 'GitHub\'s PR dashboard and native stacks cover the basics; PR Radar adds a multi-repo overview, outside the browser.',
    vsc: 'Comparison of github.com/pulls and PR Radar', r2: 'Stacks from every repo at a glance', r2a: 'one PR at a time',
    r3: 'Native system notifications', r3a: 'web only', r4: 'Reply to unresolved threads from the list', r4a: 'by opening each PR',
    r5: 'Merge calendar', r6: 'New since last visit',
    privacy: 'Privacy',
    pv: 'No server: the app only talks to github.com and api.github.com, from your machine. The token stays in the system keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux), and there is no telemetry.',
    pvl: 'Read the code (MIT license)',
    faq: 'Frequently asked questions',
    q1: 'What permissions does the app ask for?',
    a1: 'Two scopes: <code>repo</code> to read PRs in private repos and reply to discussions, <code>read:org</code> to list your organizations\' repos. With a personal access token (classic), check the same ones: <code>repo</code> and <code>read:org</code>.',
    q3: 'My organization uses SAML SSO',
    a3: 'With the device flow, start an SSO session on the org first, then confirm the code; if the org restricts third-party apps, an admin must approve PR Radar. With a personal access token, open it in your GitHub settings and click “Configure SSO” to authorize it for the org. Otherwise, that org\'s repos won\'t show up.',
    q4: 'Is GitHub Enterprise supported?', a4: 'Not yet: the app only talks to github.com and api.github.com.',
    q5: 'How do updates work?', a5: 'The app checks the latest GitHub release on startup, then every 6 hours. Every update is signed: the app verifies the signature before installing, then restarts.',
    q7: 'How often does the app poll GitHub?', a7: 'Every 5 minutes by default, adjustable from 1 to 30 minutes, or manual. Requests count against your usual GitHub API quota.',
    rels: 'Releases', bug: 'Report a bug', mit: 'MIT License'
  };
  var lang, FR = {};
  try { lang = localStorage.getItem('lang'); } catch (e) {}
  if (lang !== 'fr' && lang !== 'en') lang = /^fr/i.test(navigator.language || '') ? 'fr' : 'en';
  function t(fr, en) { return lang === 'en' ? en : fr; }
  // First call per key stores the French original; then pick FR or EN.
  function str(k, cur) { if (!(k in FR)) FR[k] = cur; return lang === 'en' && EN[k] != null ? EN[k] : FR[k]; }
  function translate() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = str(el.dataset.i18n, el.textContent); });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) { el.innerHTML = str(el.dataset.i18nHtml, el.innerHTML); });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var p = el.dataset.i18nAttr.split(':');
      el.setAttribute(p[0], str(p[1], el.getAttribute(p[0])));
    });
    document.querySelectorAll('.lang button').forEach(function (b) { b.setAttribute('aria-pressed', b.lang === lang); });
  }
  var meta = document.getElementById('release-meta');
  var box = document.getElementById('downloads');
  var heroDl = document.getElementById('hero-dl'), heroVer = document.getElementById('hero-ver');
  var rel; // undefined while loading, null on error; kept so a language switch re-renders without refetching

  function fail() {
    meta.textContent = t('Impossible de récupérer la dernière version.', 'Couldn\'t load the latest release.');
    box.innerHTML = '';
    var a = document.createElement('a');
    a.className = 'btn';
    a.href = 'https://github.com/' + REPO + '/releases';
    a.textContent = t('Voir les versions sur GitHub', 'See releases on GitHub');
    box.appendChild(a);
  }

  function find(assets, re) {
    for (var i = 0; i < assets.length; i++) if (re.test(assets[i].name)) return assets[i];
  }

  function svg(icon) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[icon] + '</svg>'; }

  function card(p, on) {
    var d = document.createElement('div');
    d.className = on ? 'dl on' : 'dl';
    var h = document.createElement('h3');
    h.innerHTML = svg(p.icon);
    h.appendChild(document.createTextNode(p.title));
    var a = document.createElement('a');
    a.className = on ? 'btn primary' : 'btn';
    a.href = p.main.browser_download_url;
    a.textContent = p.label;
    d.appendChild(h);
    d.appendChild(a);
    if (p.extra && p.extra.length) d.appendChild(extra(p.or, p.extra));
    if (p.note) d.appendChild(note(p.note));
    if (p.brew) d.appendChild(brew());
    return d;
  }

  function extra(or, pkgs) {
    var s = document.createElement('small');
    s.appendChild(document.createTextNode(or));
    pkgs.forEach(function (k, i) {
      if (i) s.appendChild(document.createTextNode(' · '));
      var l = document.createElement('a');
      l.href = k.asset.browser_download_url;
      l.textContent = k.label;
      s.appendChild(l);
    });
    return s;
  }

  function brew() {
    var d = document.createElement('div');
    d.className = 'code';
    var c = document.createElement('code');
    c.textContent = 'brew install --cask vlor999/tap/pr-radar';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'copy';
    b.textContent = t('Copier', 'Copy');
    b.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(c.textContent).then(function () {
        b.textContent = t('Copié', 'Copied');
        setTimeout(function () { b.textContent = t('Copier', 'Copy'); }, 1500);
      });
    });
    d.appendChild(c);
    d.appendChild(b);
    return d;
  }

  function note(txt) {
    var s = document.createElement('small');
    s.textContent = txt;
    return s;
  }

  function render() {
    // Hero button falls back to the download section until we know the release and the OS.
    heroDl.href = '#download';
    heroDl.textContent = t('Télécharger', 'Download');
    heroVer.textContent = '';
    if (rel === undefined) { meta.textContent = t('Recherche de la dernière version…', 'Looking up the latest release…'); return; }
    if (!rel) return fail();
    var a = rel.assets || [];
    if (!a.length) return fail();
    var ver = rel.tag_name || rel.name;
    var date = rel.published_at ? new Date(rel.published_at).toLocaleDateString(t('fr-FR', 'en-US'), { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    meta.textContent = 'Version ' + ver + (date ? ' · ' + date : '');
    heroVer.textContent = ver + ' · ';
    box.innerHTML = '';
    var arm = find(a, /_aarch64\.dmg$/), x64 = find(a, /_x64\.dmg$/);
    var macMain = os === 'mac-x64' ? x64 || arm : arm || x64, macAlt = macMain === arm ? x64 : arm;
    function chip(asset) { return asset === arm ? 'Apple Silicon' : 'Intel'; }
    var win = find(a, /_x64-setup\.exe$/) || find(a, /\.msi$/);
    var all = [
      { key: 'mac', icon: 'mac', title: 'macOS', main: macMain, label: macMain && t('Télécharger pour ', 'Download for ') + chip(macMain),
        or: t('ou ', 'or '), extra: macAlt ? [{ asset: macAlt, label: chip(macAlt) + ' (.dmg)' }] : [],
        note: t('✓ Signée et notarisée par Apple', '✓ Signed and notarized by Apple'), brew: true },
      { key: 'win', icon: 'win', title: 'Windows', main: win, label: win && t('Télécharger', 'Download') + (/\.msi$/.test(win.name) ? ' (.msi)' : ' (.exe)') },
      { key: 'linux', icon: 'linux', title: 'Linux', main: find(a, /\.AppImage$/), label: t('Télécharger AppImage', 'Download AppImage'), or: t('ou paquet ', 'or package '), extra: [
        { asset: find(a, /\.deb$/), label: '.deb (Debian, Ubuntu)' },
        { asset: find(a, /\.rpm$/), label: '.rpm (Fedora)' }
      ].filter(function (k) { return k.asset; }) }
    ].filter(function (p) { return p.main; });
    if (!all.length) return fail();
    var mine = os.slice(0, 3) === 'mac' ? 'mac' : os;
    all.forEach(function (p) {
      var on = p.key === mine;
      box.appendChild(card(p, on));
      if (!on) return;
      heroDl.href = p.main.browser_download_url;
      heroDl.innerHTML = svg(p.icon);
      heroDl.appendChild(document.createTextNode(t('Télécharger pour ', 'Download for ') + p.title));
    });
  }

  function setLang(l) {
    lang = l;
    translate();
    render();
  }
  setLang(lang);
  document.querySelectorAll('.lang button').forEach(function (b) {
    b.addEventListener('click', function () {
      try { localStorage.setItem('lang', b.lang); } catch (e) {}
      setLang(b.lang);
    });
  });
  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (r) { rel = r; render(); })
    .catch(function () { rel = null; render(); });

  // Hero mock timeline + vignettes: run only while visible; reduced motion keeps the static final state.
  var mock = document.getElementById('mock');
  var vigs = document.querySelectorAll('.vig');
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var typed = mock.querySelector('.typed'), key = mock.querySelector('.key'), ago = mock.querySelector('.ago');
  var cards = mock.querySelectorAll('.pc'), reply = '';
  var timers = [], seen = false;
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function add(c) { return function () { mock.classList.add(c); }; }
  function sel(i) {
    return function () {
      cards.forEach(function (c, n) { c.classList.toggle('sel', n === i); });
      key.classList.remove('hit'); void key.offsetWidth; key.classList.add('hit');
    };
  }
  function type(n) { return function () { typed.textContent = reply.slice(0, n); }; }
  function tick(s) { return function () { ago.textContent = t('mis à jour il y a ' + s + ' s', 'updated ' + s + 's ago'); }; }
  function stop() { timers.forEach(clearTimeout); timers = []; }
  function run() {
    stop();
    mock.className = 'mock play';
    typed.textContent = '';
    reply = t('Corrigé : 3 essais max, avec backoff.', 'Fixed: max 3 retries, with backoff.');
    ago.textContent = t('synchronisation…', 'syncing…');
    cards.forEach(function (c) { c.classList.remove('sel'); });
    at(150, add('s-draw')); at(500, add('s-c1')); at(800, add('s-c2')); at(1100, add('s-c3'));
    at(1400, add('s-sync')); at(1400, function () { ago.textContent = t("à l'instant", 'just now'); });
    for (var s = 1; s <= 9; s++) at(1400 + s * 1000, tick(s));
    at(1900, add('s-new'));
    at(2600, sel(0)); at(3100, sel(1)); at(3600, sel(2));
    at(4200, add('s-open'));
    for (var n = 1; n <= reply.length; n++) at(4900 + n * 50, type(n));
    at(7100, add('s-press'));
    at(7400, function () { typed.textContent = ''; mock.classList.add('s-sent'); });
    at(8200, add('s-ci'));
    at(10600, add('s-out'));
    at(11200, run);
  }
  function sync() {
    if (seen && !document.hidden) { if (!timers.length) run(); } else stop();
  }
  if (!still) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.target === mock) { seen = e.isIntersecting; sync(); }
          else e.target.classList.toggle('run', e.isIntersecting);
        });
      }, { threshold: 0.2 });
      io.observe(mock);
      vigs.forEach(function (v) { io.observe(v); });
    } else {
      seen = true; sync();
      vigs.forEach(function (v) { v.classList.add('run'); });
    }
    document.addEventListener('visibilitychange', sync);
  }
})();
