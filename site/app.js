(function () {
  var REPO = 'Vlor999/pr-radar';
  var ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.userAgent || '';
  var os = /mac/i.test(ua) ? 'mac' : /win/i.test(ua) ? 'win' : /linux|x11|cros/i.test(ua) ? 'linux' : '';
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

  function card(osKey, title, main, label, extra) {
    if (!main) return;
    var d = document.createElement('div');
    d.className = 'dl' + (osKey === os ? ' match' : '');
    var h = document.createElement('div');
    h.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[osKey] + '</svg>';
    var t = document.createElement('strong');
    t.textContent = title;
    h.appendChild(document.createTextNode(' '));
    h.appendChild(t);
    var a = document.createElement('a');
    a.className = 'btn' + (osKey === os ? ' primary' : '');
    a.href = main.browser_download_url;
    a.textContent = label;
    d.appendChild(h);
    d.appendChild(a);
    if (extra) {
      var s = document.createElement('small');
      var l = document.createElement('a');
      l.href = extra.browser_download_url;
      l.textContent = extra.name;
      s.appendChild(l);
      d.appendChild(s);
    }
    box.appendChild(d);
    return d;
  }

  fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (rel) {
      var a = rel.assets || [];
      if (!a.length) return fail();
      var date = rel.published_at ? new Date(rel.published_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      meta.textContent = 'Version ' + (rel.tag_name || rel.name) + (date ? ' · ' + date : '');
      box.innerHTML = '';
      card('mac', 'macOS Apple Silicon', find(a, /_aarch64\.dmg$/), 'Télécharger .dmg');
      card('mac', 'macOS Intel', find(a, /_x64\.dmg$/), 'Télécharger .dmg');
      card('win', 'Windows', find(a, /_x64-setup\.exe$/) || find(a, /\.msi$/), 'Télécharger');
      card('linux', 'Linux', find(a, /\.AppImage$/), 'Télécharger AppImage', find(a, /\.deb$/));
      if (!box.children.length) fail();
    })
    .catch(fail);

  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var txt = document.getElementById(b.dataset.copy).textContent;
      var done = function () { b.textContent = 'Copié'; setTimeout(function () { b.textContent = 'Copier'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done);
    });
  });
})();
