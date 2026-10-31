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
  // Neutral icon: OS vendor logos are trademarks we may not use.
  var ICON = '<path d="M3 4h18v12H3zM5 6v8h14V6zM1 18h22v2H1z"/>';
  // FR strings; English stays in index.html (data-i18n / data-i18n-html / data-i18n-attr="attr:key").
  var FR = {
    skip: 'Aller au téléchargement', features: 'Fonctions', dl: 'Télécharger',
    tagline: 'Vos PR GitHub ouvertes, <span class="accent">en arbre.</span>',
    lead: 'Stacks, reviews, discussions et calendrier des merges, sur tous vos repos. Gratuit, open source, sans serveur.',
    how: 'Comment ça marche', heroMeta: 'macOS, Windows, Linux · Licence MIT',
    heroSr: 'Aperçu animé de l\'app : la liste des PR ouvertes du repo acme/web s\'affiche en arbre sous la branche main, avec une PR empilée sous sa parente. Une carte est sélectionnée au clavier, sa discussion de review s\'ouvre avec un extrait de diff, et une réponse est envoyée.',
    now: 'à l\'instant', pr42: 'feat(checkout): paiement en un clic', ready: 'Prête à merger', approved: 'Approuvée',
    blocks1: 'bloque 1 PR', pr45: 'feat(checkout): moyens de paiement enregistrés', new: 'Nouveau', by42: 'bloquée par #42',
    pr38: 'fix(api): retry sur les 502 du paiement', changes: 'Changements demandés', unres: '1 non résolu',
    stale: 'inactive depuis 6 j', bob: '<b>bob</b> Il faut borner les essais, sinon boucle infinie.',
    alice: '<b>alice</b> Corrigé : 3 essais max, avec backoff.', reply: 'Répondre',
    mockcap: 'Aperçu animé, données fictives.',
    vsdate: 'Comparaison en octobre 2026, d\'après les fonctions publiques de chaque produit.',
    auth1: 'Au premier lancement, connectez-vous par code (<strong>device flow</strong>) ou avec un <strong>jeton d\'accès personnel</strong>.',
    flead: 'Tout ce qui attend une action de votre part, sur tous vos repos, dans une seule fenêtre.',
    pr12: 'feat(cart): panier persistant', pr13: 'feat(cart): codes promo', by12: 'bloquée par #12',
    cap1: '<strong>Stacks</strong>Chaque PR empilée s\'affiche sous sa parente : vous savez quoi merger en premier.<span class="sr"> Animation : l\'arbre main, PR #12, PR #13 se dessine, puis le badge Prête à merger apparaît sur la PR #12.</span>',
    chloe: '<b>chloe</b> Pourquoi un TTL d\'un jour ?', alice2: '<b>alice</b> Aligné sur la session.',
    vtype: 'Aligné sur la session.',
    cap2: '<strong>Discussions</strong>Les fils non résolus s\'ouvrent avec le code concerné, et vous répondez sans quitter l\'app.<span class="sr"> Animation : un extrait de diff, une question de chloe, puis une réponse tapée et envoyée.</span>',
    month: 'Octobre 2026', m: 'Mois', w: 'Semaine', d: 'Jour', mo: 'L', tu: 'M', we: 'M', th: 'J', fr: 'V', su: 'D',
    cap3: '<strong>Calendrier des merges</strong>Mois, semaine ou jour : le rythme de livraison de chaque repo d\'un coup d\'œil.<span class="sr"> Animation : des pastilles de PR mergées tombent dans les jours d\'octobre.</span>',
    clock: 'mar. 20 oct. 09:41', t1: 'acme/web#42 : approuvée',
    t1d: 'alice a approuvé « feat(checkout): paiement en un clic »', tnow: 'maint.', t2: 'acme/api#17 : prête à merger',
    t2d: 'Tous les checks sont passés.',
    slk: 'Postée dans #reviews',
    cap5: '<strong>Annonce Slack</strong>Voyez d\'un coup d\'œil si votre PR a déjà été postée dans un channel ou en DM.<span class="sr"> Animation : la PR #12 apparaît, puis un badge Postée dans #reviews surgit.</span>',
    cap4: '<strong>Notifications</strong>Une approbation, un changement demandé, une CI cassée : le système vous prévient.<span class="sr"> Animation : deux notifications système glissent depuis le bord de l\'écran.</span>',
    more: 'Et aussi', c1: 'Filtres et recherche', c2: 'PR prêtes à merger', c3: 'PR inactives',
    c4: 'Nouveau depuis la dernière visite', c5: 'Repos par organisation', c6: 'Thème clair et sombre',
    c7: 'Stacks natives de GitHub', c8: 'Plusieurs comptes, GitHub Enterprise Server compris',
    c9: 'Icône de barre d\'état avec le nombre de PR à traiter', c10: 'Rafraîchissement adapté à votre quota d\'API',
    c11: 'Réponse à la conversation de la PR', c12: 'Commentaires mis en forme comme sur GitHub',
    c13: 'Brouillons sans notification',
    tOpen: 'PR ouvertes', tRev: 'À reviewer · 2', pr51: 'feat(search): recherche approximative',
    pr54: 'fix(auth): rafraîchir les jetons expirés', rreq: 'Review demandée', rereq: 're-request',
    revs: 'Votre PR #12 · reviewers', pend: 'En attente',
    cap6: '<strong>À reviewer</strong>Les PR qui attendent votre review ont leur onglet et leur notification. Sur vos PR, ajoutez des reviewers depuis la carte.<span class="sr"> Animation : l\'onglet À reviewer liste deux PR de acme/api, un badge Nouveau apparaît sur la première, puis dave est ajouté comme reviewer de la PR #12, à côté de chloe qui l\'a approuvée.</span>',
    mcpq: '<b>vous</b> Lesquelles de mes PR puis-je merger ?',
    mcpa: '<b>Claude</b> acme/web#12 : approuvée, CI verte, déjà postée dans #reviews.',
    cap7: '<strong>Serveur MCP local</strong>Claude Code ou Claude Desktop lit vos PR et leurs mentions Slack directement dans l\'app, sans aucune requête de plus. Sur activation, en lecture seule.<span class="sr"> Animation : une question à Claude, la réponse get_prs de PR Radar pour acme/web#12, puis la réponse de Claude.</span>',
    webOn: 'Active · 127.0.0.1:14200', webSet: 'Réglages web',
    pr7: 'feat(sync): mode hors ligne', pr9: 'fix(sync): réessayer en cas de conflit', by7: 'bloquée par #7',
    cap8: '<strong>Dans votre navigateur</strong>Votre liste de PR et ses actions GitHub et Slack dans un onglet du navigateur, servis par l\'app sur votre machine. Fermez la fenêtre : l\'app continue dans la barre des menus ou la zone de notification, si votre système en affiche une, et envoie toujours les notifications.<span class="sr"> Animation : un clic sur le globe de l\'en-tête de PR Radar, une pastille verte et la bulle d\'état Active · 127.0.0.1:14200 apparaissent, puis un onglet du navigateur s\'ouvre sur 127.0.0.1:14200 avec l\'arbre des PR de globex/app.</span>',
    kbl: 'Tout se fait au clavier (Ctrl à la place de ⌘ sous Windows et Linux).', vs: 'Comparaison',
    vsd: 'Le tableau de bord de GitHub et les autres apps de bureau font bien leur travail. PR Radar sert à suivre les stacks de PR sur tous vos repos et à répondre aux fils de review, sur n\'importe quel OS de bureau.',
    vsc: 'Comparaison entre github.com/pulls, Gitify et PR Radar', r1: 'Plateformes', r1a: 'tout navigateur',
    r7: 'Issues, releases, discussions', r7a: 'PR uniquement', r8a: '✓ (Enterprise : jeton d\'accès)',
    r8: 'Plusieurs comptes, GitHub Enterprise Server compris', r8b: 'un à la fois (changement de compte)',
    r1b: 'macOS, Windows, Linux, et votre navigateur via l\'app',
    r11: 'Ouvrir dans un onglet du navigateur', r11a: '✓ (en local, servi par l\'app)',
    r12: 'Serveur MCP pour les agents IA', r12a: '<a href="https://github.com/github/github-mcp-server">serveur MCP de GitHub</a> à part',
    r12b: '✓ (local, lecture seule ; macOS, Linux)',
    r9: 'Demander des reviewers depuis la liste', r9a: 'sur la page de la PR', r10: 'Où chaque PR a été postée dans Slack',
    vsalt: 'Choisissez <strong><a href="https://github.com/pulls">github.com/pulls</a></strong> pour ne rien installer, <strong><a href="https://gitify.io">Gitify</a></strong> pour toute votre boîte de notifications dans la barre de menus, et <strong><a href="https://prmarmot.dev">PR Marmot</a></strong> pour une app de bureau native, avec des builds signés pour les Mac Apple silicon.', r2: 'Stacks de tous les repos d\'un coup d\'œil',
    r2a: 'une PR à la fois', r3: 'Notifications système natives', r3a: 'web uniquement',
    r4: 'Répondre aux fils de review et à la conversation de la PR depuis la liste', r4a: 'en ouvrant chaque PR', r5: 'Calendrier des merges',
    privacy: 'Confidentialité',
    pv: 'PR Radar parle uniquement à GitHub, à votre serveur GitHub Enterprise si vous en ajoutez un, et à Slack si vous le connectez. Aucun serveur : les jetons restent dans le trousseau de votre OS, les jetons Slack sont en lecture seule avec rotation automatique (ils expirent toutes les 12 h), et révocables à tout moment. Vos messages ne quittent jamais votre machine.',
    pv2: 'L\'app contacte aussi github.com pour vérifier les mises à jour (votre adresse IP et la version de l\'app) et charge les avatars depuis GitHub. Les messages Slack sont cherchés et lus sur votre machine uniquement : rien ne nous est envoyé, ni à personne d\'autre.',
    pv4: 'Le serveur MCP local est désactivé par défaut. Une fois activé, il ne répond que sur votre machine, par un socket que seul votre compte utilisateur peut ouvrir, et en lecture seule : les agents lisent ce que l\'app affiche déjà, aucun outil n\'écrit sur GitHub ni Slack, et rien ne sort de votre machine.',
    pv5: 'La version web locale est désactivée par défaut. Une fois activée, elle n\'écoute que sur 127.0.0.1, hors de portée des autres appareils de votre réseau. Le lien ouvert par l\'app porte un ticket à usage unique valable 60 secondes, échangé contre un cookie de session posé par l\'app locale, pas par ce site (HttpOnly, SameSite=Strict), et « Déconnecter les navigateurs » ferme toutes les sessions. Les autres sites web ne peuvent pas l\'appeler (contrôle des en-têtes Host et Origin, pas de CORS). Les requêtes GitHub et Slack passent par l\'app, vers les mêmes hôtes autorisés : rien ne sort de votre machine en dehors des appels habituels aux API GitHub et Slack.',
    pv3: 'Ce site est hébergé par GitHub Pages, qui enregistre l\'adresse IP des visiteurs. Votre navigateur demande la dernière version à api.github.com. Ce site ne pose aucun cookie et ne mesure pas l\'audience : seule la langue choisie est gardée dans votre navigateur (localStorage). Pendant la connexion Slack, le code à usage unique passe brièvement par une page de ce site, qui ne garde rien ; il est inutilisable sans la clé gardée dans l\'app.',
    pvl: 'Lire le code (licence MIT)', faq: 'Questions fréquentes', q1: 'Quels droits l\'app demande-t-elle ?',
    a1: 'Deux scopes : <code>repo</code> pour lire les PR des repos privés et répondre aux discussions, <code>read:org</code> pour lister les repos de vos organisations. Avec un jeton d\'accès personnel (classic), cochez les mêmes : <code>repo</code> et <code>read:org</code>.',
    q3: 'Mon organisation utilise le SSO SAML',
    a3: 'Avec le device flow, ouvrez d\'abord une session SSO sur l\'org, puis validez le code ; si l\'org restreint les apps tierces, un admin doit approuver PR Radar. Avec un jeton d\'accès personnel, ouvrez-le dans les réglages GitHub et cliquez sur « Configure SSO » pour l\'autoriser sur l\'org. Sinon, les repos de cette org n\'apparaissent pas.',
    q4: 'GitHub Enterprise est-il pris en charge ?',
    a4: 'Oui, avec un personal access token : dans les Réglages, ajoutez un compte avec l\'hôte de votre serveur. « Se connecter avec GitHub » ne marche que sur github.com.',
    q5: 'Comment se font les mises à jour ?',
    a5: 'L\'app vérifie la dernière release GitHub au démarrage puis toutes les 6 heures. Chaque mise à jour est signée : l\'app vérifie la signature avant d\'installer, puis redémarre.',
    q7: 'À quelle fréquence l\'app interroge-t-elle GitHub ?',
    a7: 'Auto par défaut : l\'intervalle s\'adapte à votre quota GitHub restant (entre 1 et 15 minutes, en gardant 20 % du quota horaire en réserve). Ou un intervalle fixe de 1 à 30 minutes, ou en manuel. Les requêtes comptent dans votre quota d\'API GitHub habituel.',
    q8: 'Mon admin Slack doit-il approuver ?',
    a8: 'Oui si votre workspace l\'exige. Cliquez sur Connecter, Slack propose de demander l\'installation.',
    q9: 'Comment brancher Claude Code ?',
    a9: 'Cliquez sur l\'icône prise à côté de l\'engrenage et activez le serveur. La section Installation donne la commande avec le vrai chemin de l\'app, par exemple <code>claude mcp add --scope user pr-radar -- \'/Applications/PR Radar.app/Contents/MacOS/pr-radar\' --mcp</code>, ou la config pour Claude Desktop, Codex, Cursor, Gemini CLI, VS Code, Windsurf ou Zed. PR Radar doit être lancé. macOS et Linux uniquement pour l\'instant.',
    q10: 'Comment ouvrir PR Radar dans mon navigateur ?',
    a10: 'Cliquez sur le globe de l\'en-tête : il démarre le serveur local si besoin et ouvre la version web dans votre navigateur, par défaut sur <code>http://127.0.0.1:14200/</code> (port modifiable dans les Réglages web). Le chevron à côté affiche l\'état et mène aux Réglages web (port, démarrage et arrêt, déconnexion des navigateurs). Quand la version web tourne, l\'icône de la barre des menus ou de la zone de notification propose aussi « Ouvrir dans le navigateur ». PR Radar doit rester lancé : fermer la fenêtre le garde dans la barre des menus ou la zone de notification, si votre système en affiche une. Un favori ne marche que tant que l\'app et le serveur web tournent : redémarrer l\'app, arrêter le serveur, changer de port ou « Déconnecter les navigateurs » ferme la session ; rouvrez alors la version web depuis le globe. La connexion des comptes, la connexion Slack, les mises à jour et la désinstallation restent dans l\'app de bureau.',
    legal: 'Mentions légales',
    lg1: '<strong>Éditeur :</strong> Vlor999, particulier, à titre non professionnel. Contact : <a href="https://github.com/Vlor999/pr-radar/issues">issues GitHub</a>.',
    lg2: '<strong>Hébergeur :</strong> GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis.',
    lg3: 'PR Radar est fourni tel quel, sans garantie (licence MIT). Non affilié à GitHub, Slack, Anthropic, Gitify ni PR Marmot.',
    lg4: 'GitHub, Slack, Anthropic, Claude, Claude Code, Claude Desktop, OpenAI, Codex, Cursor, Google, Gemini, Microsoft, VS Code, GitHub Copilot, Windsurf, Zed, Gitify, PR Marmot, Apple, Apple silicon, Mac, macOS, Intel, Windows, Linux, Debian, Ubuntu, Fedora et AppImage sont des marques ou des noms de leurs détenteurs respectifs.',
    rels: 'Versions', bug: 'Signaler un bug', mit: 'Licence MIT', nav: 'Principal', lang: 'Langue',
    ph: 'Votre réponse…'
  };
  var lang, EN = {};
  try { lang = localStorage.getItem('lang'); } catch (e) {}
  if (lang !== 'fr' && lang !== 'en') lang = /^fr/i.test(navigator.language || '') ? 'fr' : 'en';
  function t(fr, en) { return lang === 'en' ? en : fr; }
  // First call per key stores the English original; then pick EN or FR.
  function str(k, cur) { if (!(k in EN)) EN[k] = cur; return lang === 'fr' && FR[k] != null ? FR[k] : EN[k]; }
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

  function svg() { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON + '</svg>'; }

  function card(p, on) {
    var d = document.createElement('div');
    d.className = on ? 'dl on' : 'dl';
    var h = document.createElement('h3');
    h.innerHTML = svg();
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
      { key: 'mac', title: 'macOS', main: macMain, label: macMain && t('Télécharger pour ', 'Download for ') + chip(macMain),
        or: t('ou ', 'or '), extra: macAlt ? [{ asset: macAlt, label: chip(macAlt) + ' (.dmg)' }] : [],
        note: t('✓ Signée et notarisée par Apple', '✓ Signed and notarized by Apple'), brew: true },
      { key: 'win', title: 'Windows', main: win, label: win && t('Télécharger', 'Download') + (/\.msi$/.test(win.name) ? ' (.msi)' : ' (.exe)') },
      { key: 'linux', title: 'Linux', main: find(a, /\.AppImage$/), label: t('Télécharger AppImage', 'Download AppImage'), or: t('ou paquet ', 'or package '), extra: [
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
      heroDl.innerHTML = svg();
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
