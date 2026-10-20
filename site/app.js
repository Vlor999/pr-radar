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
  var meta = document.getElementById('release-meta');
  var box = document.getElementById('downloads');

  function fail() {
    meta.textContent = 'Première version en préparation.';
    box.innerHTML = '';
    var a = document.createElement('a');
    a.className = 'btn';
    a.href = 'https://github.com/' + REPO + '/releases';
    a.textContent = 'Voir les versions sur GitHub';
    box.appendChild(a);
  }

  function find(assets, re) {
    for (var i = 0; i < assets.length; i++) if (re.test(assets[i].name)) return assets[i];
  }

  function card(p) {
    var d = document.createElement('div');
    d.className = 'dl';
    var h = document.createElement('div');
    h.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[p.icon] + '</svg>';
    var t = document.createElement('strong');
    t.textContent = p.title;
    h.appendChild(document.createTextNode(' '));
    h.appendChild(t);
    var a = document.createElement('a');
    a.className = 'btn';
    a.href = p.main.browser_download_url;
    a.textContent = p.label;
    d.appendChild(h);
    d.appendChild(a);
    if (p.extra) d.appendChild(extra(p.extra, ''));
    return d;
  }

  function extra(asset, prefix) {
    var s = document.createElement('small');
    var l = document.createElement('a');
    l.href = asset.browser_download_url;
    l.textContent = prefix + asset.name;
    s.appendChild(l);
    return s;
  }

  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (rel) {
      var a = rel.assets || [];
      if (!a.length) return fail();
      var date = rel.published_at ? new Date(rel.published_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      meta.textContent = 'Version ' + (rel.tag_name || rel.name) + (date ? ' · ' + date : '');
      box.innerHTML = '';
      var all = [
        { key: 'mac-arm', icon: 'mac', title: 'macOS Apple Silicon', main: find(a, /_aarch64\.dmg$/), label: 'Télécharger .dmg' },
        { key: 'mac-x64', icon: 'mac', title: 'macOS Intel', main: find(a, /_x64\.dmg$/), label: 'Télécharger .dmg' },
        { key: 'win', icon: 'win', title: 'Windows', main: find(a, /_x64-setup\.exe$/) || find(a, /\.msi$/), label: 'Télécharger' },
        { key: 'linux', icon: 'linux', title: 'Linux', main: find(a, /\.AppImage$/), label: 'Télécharger AppImage', extra: find(a, /\.deb$/) }
      ].filter(function (p) { return p.main; });
      if (!all.length) return fail();
      var mine = all.filter(function (p) { return p.key === os; })[0];
      if (mine) {
        var top = document.createElement('div');
        top.className = 'dl-top';
        var hero = document.createElement('a');
        hero.className = 'btn primary dl-hero';
        hero.href = mine.main.browser_download_url;
        hero.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[mine.icon] + '</svg>';
        hero.appendChild(document.createTextNode(' Télécharger pour ' + mine.title));
        top.appendChild(hero);
        if (mine.extra) top.appendChild(extra(mine.extra, 'ou '));
        var other = document.createElement('p');
        other.className = 'muted dl-other';
        other.textContent = 'Autres plateformes';
        top.appendChild(other);
        box.parentNode.insertBefore(top, box);
      }
      all.forEach(function (p) { if (p !== mine) box.appendChild(card(p)); });
    })
    .catch(fail);

  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var txt = document.getElementById(b.dataset.copy).textContent;
      var done = function () { b.textContent = 'Copié'; setTimeout(function () { b.textContent = 'Copier'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done);
    });
  });
  // Hero mock timeline + vignettes: run only while visible; reduced motion keeps the static final state.
  var mock = document.getElementById('mock');
  var vigs = document.querySelectorAll('.vig');
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var typed = mock.querySelector('.typed'), key = mock.querySelector('.key'), ago = mock.querySelector('.ago');
  var cards = mock.querySelectorAll('.pc'), REPLY = 'Corrigé : 3 essais max, avec backoff.';
  var timers = [], seen = false;
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function add(c) { return function () { mock.classList.add(c); }; }
  function sel(i) {
    return function () {
      cards.forEach(function (c, n) { c.classList.toggle('sel', n === i); });
      key.classList.remove('hit'); void key.offsetWidth; key.classList.add('hit');
    };
  }
  function type(n) { return function () { typed.textContent = REPLY.slice(0, n); }; }
  function tick(s) { return function () { ago.textContent = 'mis à jour il y a ' + s + ' s'; }; }
  function stop() { timers.forEach(clearTimeout); timers = []; }
  function run() {
    stop();
    mock.className = 'mock play';
    typed.textContent = '';
    ago.textContent = 'synchronisation…';
    cards.forEach(function (c) { c.classList.remove('sel'); });
    at(150, add('s-draw')); at(500, add('s-c1')); at(800, add('s-c2')); at(1100, add('s-c3'));
    at(1400, add('s-sync')); at(1400, function () { ago.textContent = "à l'instant"; });
    for (var s = 1; s <= 9; s++) at(1400 + s * 1000, tick(s));
    at(1900, add('s-new'));
    at(2600, sel(0)); at(3100, sel(1)); at(3600, sel(2));
    at(4200, add('s-open'));
    for (var n = 1; n <= REPLY.length; n++) at(4900 + n * 50, type(n));
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
