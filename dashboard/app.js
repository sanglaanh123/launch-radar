// Launch Radar page. It runs RadarModel.build (model.js) on the snapshot main.ts wrote to ../data.js,
// so every number on screen is computed by the same function that wrote board.json. No network.
// State lives in the URL hash (view, filters, sort, open protocol) so any view can be linked.
(function () {
  'use strict';
  var SNAP = window.SNAPSHOT, RM = window.RadarModel;
  var main = document.getElementById('main'), detail = document.getElementById('detail');
  if (!SNAP || !RM) { main.textContent = 'No snapshot: run main.ts to write data.js beside this page.'; return; }
  var R = RM.build(SNAP), money = RM.money, C = R.constants, BT = R.backtest, BEST = BT.best;
  var BY = {};
  R.rows.forEach(function (r) { BY[r.slug] = r; });

  var DEFAULT = { view: 'board', scope: 'all', cat: '', chain: '', min: '0', trend: 'any', q: '', sort: 'rank', dir: '1', p: '' };
  var S = readHash();

  function readHash() {
    var s = Object.assign({}, DEFAULT);
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0 && kv.slice(0, i) in s) s[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    return s;
  }
  function writeHash() {
    var parts = Object.keys(S).filter(function (k) { return S[k] !== DEFAULT[k]; }).map(function (k) { return k + '=' + encodeURIComponent(S[k]); });
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname);
  }
  function set(patch) { Object.assign(S, patch); writeHash(); render(); }

  // ---- tiny DOM helpers ----
  function h(tag, attrs) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(n, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(n, x); });
    else n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function pct(x) { return x === null ? 'n/a' : (x > 0 ? '+' : '') + x.toFixed(1) + '%'; }
  function age(d) { return d === null ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- filters ----
  var CATS = uniq(R.rows.map(function (r) { return r.category || 'Uncategorised'; }));
  var CHAINS = uniq(R.rows.map(function (r) { return r.chains[0] || 'n/a'; }));
  function uniq(xs) { return xs.filter(function (x, i) { return xs.indexOf(x) === i; }).sort(); }

  function filtered() {
    var q = S.q.trim().toLowerCase(), min = Number(S.min);
    return R.rows.filter(function (r) {
      if (S.scope !== 'all' && r.scope !== S.scope) return false;
      if (S.cat && (r.category || 'Uncategorised') !== S.cat) return false;
      if (S.chain && r.chains.indexOf(S.chain) < 0) return false;
      if (r.tvl_usd < min) return false;
      if (S.trend === 'up' && !(r.change_7d > 0)) return false;
      if (S.trend === 'young' && !(r.model.age_days !== null && r.model.age_days < 365)) return false;
      if (S.trend === 'farm' && r.sizing.verdict === 'watch') return false;
      if (S.trend === 'watch' && r.sizing.verdict !== 'watch') return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.category).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  var COLS = [
    ['rank', '#', function (r) { return r.rank; }],
    ['name', 'Protocol', function (r) { return r.name.toLowerCase(); }],
    ['tvl', 'TVL', function (r) { return r.tvl_usd; }],
    ['growth', '7d', function (r) { return r.change_7d === null ? -1e9 : r.change_7d; }],
    ['age', 'Tokenless for', function (r) { return r.model.age_days === null ? -1 : r.model.age_days; }],
    ['implied', 'Implied value', function (r) { return r.implied_value_usd; }],
    ['range', 'Held-out range', function (r) { return r.model.high; }],
    ['per1k', 'Drop / $1k', function (r) { return r.model.per_1k; }],
    ['play', 'Play', function (r) { return r.sizing.verdict === 'watch' ? 1e9 : r.sizing.size; }]
  ];
  function sortRows(rows) {
    var col = COLS.filter(function (c) { return c[0] === S.sort; })[0] || COLS[0], dir = Number(S.dir) || 1;
    return rows.slice().sort(function (a, b) {
      var x = col[2](a), y = col[2](b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || a.rank - b.rank;
    });
  }

  // ---- views ----
  function renderKpis() {
    var k = document.getElementById('kpis'), covered = R.rows.filter(function (r) { return r.scope === 'watchlist'; }).length;
    var total = R.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    k.innerHTML = '';
    [['Ranked, no token recorded', R.rows.length, 'every row scored by impliedValue()'],
      ['Watchlist covered', covered + ' / ' + R.watchlist_size, 'the floor: TVL at or above ' + money(R.floor_usd)],
      ['Early finds below the floor', R.rows.length - covered, 'pre-token, TVL ' + money(5e6) + ' to ' + money(R.floor_usd)],
      ['Typical miss on unseen comps', '×' + BEST.miss.toFixed(1), BEST.label + ', picked by leave-one-out on ' + BEST.n + ' traded comps'],
      ['Total implied value', money(total), 'if every record stayed as it is'],
      ['Tokens already trading', R.trading.length, 'kept apart, priced by the market']
    ].forEach(function (x) { k.appendChild(h('div', { class: 'kpi' }, h('b', { text: x[1] }), h('span', { text: x[0] }), h('small', { text: x[2] }))); });
    document.getElementById('sub').textContent = 'Snapshot ' + R.as_of + ' · ' + R.protocol_count + ' protocols from DefiLlama · model ' + C.version;
  }

  function select(label, key, opts) {
    return h('label', { class: 'f' }, h('span', { text: label }),
      h('select', { onchange: function (e) { var p = {}; p[key] = e.target.value; set(p); } },
        opts.map(function (o) { return h('option', { value: o[0], selected: S[key] === o[0] }, o[1]); })));
  }

  function filterBar(count) {
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Scope' },
      [['all', 'All'], ['watchlist', 'Watchlist'], ['early', 'Early finds']].map(function (o) {
        return h('button', { class: S.scope === o[0] ? 'on' : null, 'aria-pressed': String(S.scope === o[0]), onclick: function () { set({ scope: o[0] }); } }, o[1]);
      }));
    var search = h('input', { type: 'search', placeholder: 'Search protocol or category', value: S.q, 'aria-label': 'Search',
      oninput: function (e) { S.q = e.target.value; writeHash(); drawTable(); } });
    var active = ['cat', 'chain', 'min', 'trend', 'q', 'scope'].some(function (k) { return S[k] !== DEFAULT[k]; });
    return h('div', { class: 'filters' }, seg, search,
      select('Category', 'cat', [['', 'All categories']].concat(CATS.map(function (c) { return [c, c]; }))),
      select('Main chain', 'chain', [['', 'All chains']].concat(CHAINS.map(function (c) { return [c, c]; }))),
      select('TVL at least', 'min', [['0', 'Any'], ['20000000', '$20M'], ['50000000', '$50M'], ['100000000', '$100M'], ['500000000', '$500M']]),
      select('Signal', 'trend', [['any', 'Any'], ['up', 'TVL rising 7d'], ['young', 'Under 1 year old'], ['farm', 'Worth farming'], ['watch', 'Watch only']]),
      h('span', { class: 'count', id: 'count', text: count }),
      active ? h('button', { class: 'ghost', onclick: function () { set({ scope: 'all', cat: '', chain: '', min: '0', trend: 'any', q: '' }); } }, 'Clear filters') : null);
  }

  function scatter(rows) {
    // TVL (log) across, seven-day change up; dot area follows implied value. Drawn as inline SVG text.
    var W = 360, H = 190, P = 26, lo = Math.log10(5e6), hi = Math.log10(3e9), max = R.rows[0].implied_value_usd;
    var x = function (v) { return P + (Math.log10(Math.max(v, 5e6)) - lo) / (hi - lo) * (W - P - 8); };
    var y0 = H * 0.6, y = function (g) { var c = Math.max(-40, Math.min(60, g || 0)); return c >= 0 ? y0 - c / 60 * (y0 - 12) : y0 + -c / 40 * (H - 22 - y0); };
    var dots = rows.slice().reverse().map(function (r) {
      var rad = 2.5 + Math.sqrt(r.implied_value_usd / max) * 13;
      return '<circle class="' + r.scope + (S.p === r.slug ? ' sel' : '') + '" cx="' + x(r.tvl_usd).toFixed(1) + '" cy="' + y(r.change_7d).toFixed(1) + '" r="' + rad.toFixed(1) + '"><title>' + esc(r.name) + ' · ' + money(r.implied_value_usd) + '</title></circle>';
    }).join('');
    var ticks = [1e7, 1e8, 1e9].map(function (t) { return '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="8" y2="' + (H - 16) + '"/><text x="' + x(t) + '" y="' + (H - 3) + '">' + money(t) + '</text>'; }).join('');
    return h('figure', { class: 'scatter' },
      h('div', { html: '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="TVL against seven-day change"><g class="grid">' + ticks + '<line x1="' + P + '" x2="' + W + '" y1="' + y0 + '" y2="' + y0 + '"/><text x="2" y="16">+60%</text><text x="2" y="' + (H - 20) + '">-40%</text></g>' + dots + '</svg>' }),
      h('figcaption', null, h('i', { class: 'k watchlist' }), 'watchlist ', h('i', { class: 'k early' }), 'early find · TVL across, 7d change up, size = implied value'));
  }

  function topList(rows) {
    var max = rows.length ? rows[0].implied_value_usd : 1;
    var top = rows.slice().sort(function (a, b) { return a.rank - b.rank; }).slice(0, 6);
    return h('div', { class: 'toplist' }, h('h3', { text: 'Top of this view' }), top.map(function (r) {
      return h('button', { class: 'bar', onclick: function () { set({ p: r.slug }); } },
        h('span', { class: 'n', text: r.rank + '. ' + r.name }), h('span', { class: 'v', text: money(r.implied_value_usd) }),
        h('i', { style: 'width:' + Math.max(2, r.implied_value_usd / max * 100).toFixed(1) + '%' }));
    }));
  }

  var tableWrap;
  function drawTable() {
    var rows = sortRows(filtered()), max = R.rows[0].implied_value_usd;
    document.getElementById('count').textContent = rows.length + ' of ' + R.rows.length + ' rows';
    var head = h('tr', null, COLS.map(function (c) {
      var on = S.sort === c[0];
      return h('th', { class: 'c-' + c[0], 'aria-sort': on ? (S.dir === '1' ? 'ascending' : 'descending') : null },
        h('button', { onclick: function () { set({ sort: c[0], dir: on ? String(-Number(S.dir)) : c[0] === 'rank' || c[0] === 'name' ? '1' : '-1' }); } }, c[1], on ? (S.dir === '1' ? ' ▲' : ' ▼') : ''));
    }), h('th', { text: 'Conf.' }));
    var body = h('tbody', null, rows.map(function (r) {
      var m = r.model;
      return h('tr', { class: S.p === r.slug ? 'sel' : null, tabindex: '0', onclick: function () { set({ p: r.slug }); }, onkeydown: function (e) { if (e.key === 'Enter') set({ p: r.slug }); } },
        h('td', { class: 'c-rank', text: r.rank }),
        h('td', { class: 'c-name' }, h('b', { text: r.name }), h('span', { class: 'tag ' + r.scope, text: r.scope === 'watchlist' ? 'watchlist' : 'early' }), h('small', { text: (r.category || 'Uncategorised') + ' · ' + (r.chains[0] || 'n/a') + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') })),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : ''), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: age(m.age_days) }),
        h('td', { class: 'num val' }, h('span', { text: money(r.implied_value_usd) }), h('i', { style: 'width:' + Math.max(1, Math.sqrt(r.implied_value_usd / max) * 100).toFixed(1) + '%' })),
        h('td', { class: 'num dim', text: money(m.low) + ' – ' + money(m.high) }),
        h('td', { class: 'num', text: '$' + m.per_1k.toFixed(2) }),
        h('td', null, play(r.sizing)),
        h('td', null, h('span', { class: 'conf c' + m.confidence, title: 'A: 5+ peers and full data; B: 2+ peers; C: market median', text: m.confidence })));
    }));
    if (!rows.length) body = h('tbody', null, h('tr', null, h('td', { colspan: '10', class: 'empty', text: 'No protocol matches these filters.' })));
    tableWrap.innerHTML = '';
    tableWrap.appendChild(h('table', { class: 'board' }, h('thead', null, head), body));
  }

  function play(z) {
    return h('span', { class: 'play ' + z.verdict.replace(' ', '-'), title: 'Gas ' + money(z.gas_all) + ' · expected ' + money(z.expected) + ' · break-even ' + money(z.breakeven || 0),
      text: z.verdict === 'watch' ? 'watch' : 'farm $' + (z.size >= 1000 ? z.size / 1000 + 'k' : z.size) });
  }

  function calibration(w, hgt) {
    // Each traded comp: what the chosen base predicted with that comp held out (across) against its real
    // market cap (up), both log. The diagonal is a perfect call; the band is within 3x.
    var lo = 5, hi = 11, P = 22, sx = function (v) { return P + (Math.log10(v) - lo) / (hi - lo) * (w - P - 6); };
    var sy = function (v) { return hgt - 16 - (Math.log10(v) - lo) / (hi - lo) * (hgt - 24); }, k = Math.log10(3);
    var band = '<path class="band" d="M' + sx(1e5) + ',' + sy(Math.pow(10, lo + k)) + ' L' + sx(Math.pow(10, hi - k)) + ',' + sy(1e11) + ' L' + sx(1e11) + ',' + sy(1e11) + ' L' + sx(1e11) + ',' + sy(Math.pow(10, hi - k)) + ' L' + sx(Math.pow(10, lo + k)) + ',' + sy(1e5) + ' L' + sx(1e5) + ',' + sy(1e5) + 'Z"/>';
    var dots = BEST.loo.map(function (x) {
      var cl = Math.max(1e5, Math.min(1e11, x.predicted)), ca = Math.max(1e5, Math.min(1e11, x.actual));
      return '<circle cx="' + sx(cl).toFixed(1) + '" cy="' + sy(ca).toFixed(1) + '" r="2.6"><title>' + esc(x.slug) + ': predicted ' + money(x.predicted) + ', trades at ' + money(x.actual) + '</title></circle>';
    }).join('');
    var tag = function (t) { return money(t).replace(/\.0+([MB])/, '$1'); };
    var ticks = [1e6, 1e8, 1e10].map(function (t) { return '<text x="' + sx(t) + '" y="' + (hgt - 3) + '" text-anchor="middle">' + tag(t) + '</text><text x="0" y="' + (sy(t) + 3) + '">' + tag(t) + '</text>'; }).join('') +
      '<text x="' + (w - 4) + '" y="' + (hgt - 22) + '" text-anchor="end">predicted →</text><text x="' + (P + 2) + '" y="8">actual ↑</text>';
    return '<svg class="calib" width="' + w * 1.25 + '" height="' + hgt * 1.25 + '" viewBox="0 0 ' + w + ' ' + hgt + '" role="img" aria-label="Held-out prediction against real market cap">' + band +
      '<line x1="' + sx(1e5) + '" y1="' + sy(1e5) + '" x2="' + sx(1e11) + '" y2="' + sy(1e11) + '"/>' + ticks + dots + '</svg>';
  }

  function backtestTable() {
    return h('table', { class: 'bt' }, h('thead', null, h('tr', null, ['Base model', 'LOO miss', 'In 3×', 'Walk-fwd'].map(function (t) { return h('th', { text: t }); }))),
      h('tbody', null, BT.candidates.map(function (c) {
        return h('tr', { class: c.key === BEST.key ? 'win' : null }, h('td', { text: (c.key === BEST.key ? '✓ ' : '') + c.label }),
          h('td', { class: 'num', text: '×' + c.miss.toFixed(2) }), h('td', { class: 'num', text: Math.round(c.within3 * 100) + '%' }), h('td', { class: 'num', text: '×' + c.wf_miss.toFixed(2) }));
      })));
  }

  function backtestCard() {
    return h('div', { class: 'legend' }, h('h3', { text: 'Tested on comps it never saw' }),
      h('div', { class: 'btwrap' }, h('div', { html: calibration(170, 150) }), backtestTable()),
      h('p', { class: 'fine', text: BEST.n + ' clean traded comps, each predicted with itself held out; walk-forward fits the ' + (BEST.n - BEST.wf_n) + ' listed before ' + BEST.wf_from + ' and predicts the ' + BEST.wf_n + ' after. ' + BEST.label + ' wins and prices every row; momentum and launch clock are stated priors on top.' }));
  }

  function viewBoard() {
    var rows = filtered();
    tableWrap = h('div', { class: 'tablewrap' });
    var out = h('div', null, filterBar(''), h('div', { class: 'overview' }, scatter(rows), topList(rows), backtestCard()), tableWrap);
    main.appendChild(out);
    drawTable();
  }

  function legend() {
    return h('div', { class: 'legend' }, h('h3', { text: 'How a row is valued' }),
      h('p', { class: 'formula', html: '<b>base</b>(TVL, category) × <b>momentum</b> × <b>launch clock</b>' }),
      h('ul', null,
        h('li', null, h('b', { text: 'Base (fitted, tested): ' }), BEST.label + ', market cap ≈ ' + Math.exp(BT.curve.a).toFixed(1) + ' × TVL^' + BT.curve.b.toFixed(3) + (BEST.key === 'curve_cat' ? ' plus a shrunk category term' : '') + ', fitted on ' + BEST.n + ' clean comps and chosen over ' + (BT.candidates.length - 1) + ' rivals by held-out error'),
        h('li', null, h('b', { text: 'Momentum (prior): ' }), '1 + ' + C.growth_weight + ' × 7d TVL change (' + C.growth_min + '% to +' + C.growth_max + '%)'),
        h('li', null, h('b', { text: 'Launch clock (prior): ' }), C.clock_start + ' at listing, ' + C.clock_peak + ' at ' + C.clock_peak_day + ' days tokenless, ' + C.clock_tail + ' from ' + (C.clock_tail_day / 365) + ' years'),
        h('li', null, h('b', { text: 'Range: ' }), 'the base\'s held-out residual quartiles, ×' + BEST.band[0].toFixed(2) + ' to ×' + BEST.band[1].toFixed(2)),
        h('li', null, h('b', { text: 'Drop / $1k: ' }), C.airdrop_share * 100 + '% of the implied value shared over the TVL; Play sizes the smallest deposit that earns 3× its gas'),
        h('li', null, h('b', { text: 'Confidence: ' }), h('span', { class: 'conf cA', text: 'A' }), ' 5+ peers and full data ', h('span', { class: 'conf cB', text: 'B' }), ' 2+ peers ', h('span', { class: 'conf cC', text: 'C' }), ' market median')),
      h('p', { class: 'fine', text: 'Tokens that already trade (' + R.trading.length + ') are never ranked here: they sit in Already trading at their market value.' }));
  }

  function viewTrading() {
    main.appendChild(h('div', { class: 'panel' }, h('h2', { text: 'Already trading: ' + R.trading.length + ' protocols' }),
      h('p', { class: 'lede', text: 'These record a token (a CoinGecko id, a symbol or a market cap), so the market prices them and the radar does not. Those with a market cap teach the model its peer multiples.' }),
      h('table', { class: 'board compact' }, h('thead', null, h('tr', null, ['Protocol', 'Symbol', 'Category', 'TVL', 'Market cap', 'Mcap / TVL'].map(function (t) { return h('th', { text: t }); }))),
        h('tbody', null, R.trading.slice(0, 60).map(function (t) {
          return h('tr', null, h('td', { text: t.name }), h('td', { text: t.symbol || 'n/a' }), h('td', { text: t.category || 'n/a' }), h('td', { class: 'num', text: money(t.tvl_usd) }),
            h('td', { class: 'num', text: t.mcap_usd ? money(t.mcap_usd) : 'not recorded' }), h('td', { class: 'num', text: t.ratio ? t.ratio.toFixed(2) + 'x' : 'n/a' }));
        })))));
  }

  function viewAside() {
    main.appendChild(h('div', { class: 'panel' }, h('h2', { text: 'Set aside: ' + R.products.length + ' tokenless records that are not launches' }),
      h('p', { class: 'lede', text: 'Wrapped, staked and bridged products, exchanges, versioned deployments, and protocols above the floor that the watchlist leaves out (DefiLlama records a parent with a token). The radar applies the watchlist\'s own rule to the rows below the floor.' }),
      h('table', { class: 'board compact' }, h('thead', null, h('tr', null, ['Protocol', 'Category', 'TVL', 'Why it is not ranked'].map(function (t) { return h('th', { text: t }); }))),
        h('tbody', null, R.products.slice(0, 80).map(function (p) {
          return h('tr', null, h('td', { text: p.name }), h('td', { text: p.category || 'n/a' }), h('td', { class: 'num', text: money(p.tvl_usd) }), h('td', { text: p.reason }));
        })))));
  }

  function viewModel() {
    var cats = Object.keys(R.peers).filter(function (k) { return k !== '_market'; }).sort(function (a, b) { return R.peers[b].n - R.peers[a].n || (a < b ? -1 : 1); });
    main.appendChild(h('div', { class: 'panel' }, h('h2', { text: 'The model, ' + C.version }),
      h('div', { class: 'overview two' }, legend(), h('div', { class: 'legend' }, h('h3', { text: 'Backtest: held-out prediction against real market cap' }),
        h('div', { class: 'btwrap' }, h('div', { html: calibration(300, 230) }), backtestTable()),
        h('p', { class: 'fine', text: Math.round(BEST.within3 * 100) + '% of unseen comps land within 3× of the call (the band). The curve\'s slope of ' + BT.curve.b.toFixed(2) + ' says a book twice as big trades at about ' + Math.pow(2, BT.curve.b).toFixed(2) + '× the market cap, not 2×: a flat ratio overprices the largest vaults.' }))),
      h('h3', { text: 'Category multiples of the clean comps' }),
      h('table', { class: 'board compact' }, h('thead', null, h('tr', null, ['Category', 'Traded peers', 'Raw median', 'Shrunk multiple', 'Ranked rows'].map(function (t) { return h('th', { text: t }); }))),
        h('tbody', null, cats.map(function (c) {
          var p = R.peers[c], n = R.rows.filter(function (r) { return r.category === c; }).length;
          return h('tr', null, h('td', { text: c }), h('td', { class: 'num', text: p.n }), h('td', { class: 'num', text: p.median.toFixed(3) + 'x' }), h('td', { class: 'num', text: p.multiple.toFixed(3) + 'x' }), h('td', { class: 'num', text: n }));
        })))));
  }

  // ---- detail drawer ----
  function renderDetail() {
    var r = BY[S.p];
    detail.hidden = !r;
    document.body.classList.toggle('drawer', !!r);
    if (!r) return;
    var m = r.model, peer = R.peers[r.category] || R.peers._market, steps = r.plan;
    detail.innerHTML = '';
    var factors = [['TVL', money(r.tvl_usd), 'DefiLlama, ' + R.as_of],
      ['→ base', money(m.base), BEST.label.toLowerCase() + ', ' + m.multiple.toFixed(3) + '× TVL'],
      ['× momentum', m.momentum.toFixed(3), 'prior · 7d TVL ' + pct(r.change_7d)],
      ['× launch clock', m.clock.toFixed(3), 'prior · ' + age(m.age_days) + ' tokenless, ' + m.phase],
      ['= implied value', money(r.implied_value_usd), 'rank ' + r.rank + ' of ' + R.rows.length],
      ['held-out range', money(m.low) + ' – ' + money(m.high), 'half of unseen comps land here']];
    var near = RM.nearestComps(r, R.comps), z = r.sizing;
    var sittings = steps.reduce(function (s, x) { return s + (x.time.indexOf('days') > 0 ? 0 : 1); }, 0);
    detail.appendChild(h('div', { class: 'dhead' },
      h('div', null, h('span', { class: 'tag ' + r.scope, text: r.scope === 'watchlist' ? 'watchlist' : 'early find' }), h('h2', { text: r.name }),
        h('p', { text: (r.category || 'Uncategorised') + ' · ' + r.chains.slice(0, 4).join(', ') + (r.chains.length > 4 ? ' +' + (r.chains.length - 4) : '') + ' · ' + r.token_status })),
      h('button', { class: 'close', 'aria-label': 'Close detail', onclick: function () { set({ p: '' }); } }, '×')));
    detail.appendChild(h('div', { class: 'hero' },
      h('div', null, h('span', { text: 'Implied value' }), h('b', { text: money(r.implied_value_usd) })),
      h('div', null, h('span', { text: 'Airdrop pool at ' + C.airdrop_share * 100 + '%' }), h('b', { text: money(m.pool_usd) })),
      h('div', null, h('span', { text: 'Per $1,000 farmed' }), h('b', { text: '$' + m.per_1k.toFixed(2) }))));
    detail.appendChild(h('h3', { text: 'Why this value' }));
    detail.appendChild(h('div', { class: 'waterfall' }, factors.map(function (f, i) {
      return h('div', { class: 'wf' + (f[0].charAt(0) === '=' ? ' total' : i === factors.length - 1 ? ' range' : '') }, h('span', { text: f[0] }), h('b', { text: f[1] }), h('small', { text: f[2] }));
    })));
    detail.appendChild(h('p', { class: 'peers', text: 'Nearest traded comps: ' + near.map(function (q) { return q.name + ' ' + money(q.tvl_usd) + ' TVL → ' + money(q.mcap_usd); }).join(' · ') }));
    detail.appendChild(h('h3', null, 'Farm plan · ' + steps.length + ' steps · ' + sittings + ' sittings plus the hold ', play(z)));
    detail.appendChild(h('div', { class: 'econ' }, [['Deposit', '$' + z.size.toLocaleString('en-US')], ['Gas, whole plan', money(z.gas_all)], ['Expected drop', money(z.expected)], ['Break-even', money(z.breakeven || 0)]].map(function (x) {
      return h('div', null, h('span', { text: x[0] }), h('b', { text: x[1] }));
    })));
    detail.appendChild(h('ol', { class: 'plan' }, steps.map(function (s) {
      return h('li', null, h('p', { text: s.step }), h('div', { class: 'meta' }, h('span', { class: 'cost', text: s.cost }), h('span', { class: 'time', text: s.time })));
    })));
    detail.appendChild(h('p', { class: 'fine', text: 'DefiLlama records no token for ' + r.name + '; that is not proof it has none. The implied value is this radar\'s claim if the record stayed as it is, not a forecast of a launch.' }));
  }

  function render() {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.view === S.view)); });
    main.innerHTML = '';
    ({ board: viewBoard, trading: viewTrading, aside: viewAside, model: viewModel }[S.view] || viewBoard)();
    renderDetail();
  }

  document.querySelectorAll('.tabs button').forEach(function (b) { b.addEventListener('click', function () { set({ view: b.dataset.view }); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.p) set({ p: '' }); });
  window.addEventListener('hashchange', function () { S = readHash(); render(); });
  renderKpis();
  render();
})();
