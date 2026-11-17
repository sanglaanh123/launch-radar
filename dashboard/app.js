// Launch Radar page. It runs RadarModel.build (model.js) on the snapshot main.ts wrote to ../data.js,
// so every number on screen is computed by the same function that wrote board.json. No network.
// State lives in the URL hash (view, filters, sort, open protocol) so any view can be linked.
(function () {
  'use strict';
  var SNAP = window.SNAPSHOT, RM = window.RadarModel;
  var main = document.getElementById('main'), detail = document.getElementById('detail');
  if (!SNAP || !RM) { main.textContent = 'No snapshot: run main.ts to write data.js beside this page.'; return; }
  var R = RM.build(SNAP), money = RM.money, C = R.constants;
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
    ['mult', 'Peer x', function (r) { return r.model.multiple; }],
    ['implied', 'Implied value', function (r) { return r.implied_value_usd; }],
    ['per1k', 'Airdrop / $1k', function (r) { return r.model.per_1k; }]
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
      select('Signal', 'trend', [['any', 'Any'], ['up', 'TVL rising 7d'], ['young', 'Under 1 year old']]),
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
        h('td', { class: 'num', text: m.multiple.toFixed(2) + 'x' }),
        h('td', { class: 'num val' }, h('span', { text: money(r.implied_value_usd) }), h('i', { style: 'width:' + Math.max(1, Math.sqrt(r.implied_value_usd / max) * 100).toFixed(1) + '%' })),
        h('td', { class: 'num', text: '$' + m.per_1k.toFixed(0) }),
        h('td', null, h('span', { class: 'conf c' + m.confidence, title: 'A: 5+ peers and full data; B: 2+ peers; C: market median', text: m.confidence })));
    }));
    if (!rows.length) body = h('tbody', null, h('tr', null, h('td', { colspan: '9', class: 'empty', text: 'No protocol matches these filters.' })));
    tableWrap.innerHTML = '';
    tableWrap.appendChild(h('table', { class: 'board' }, h('thead', null, head), body));
  }

  function viewBoard() {
    var rows = filtered();
    tableWrap = h('div', { class: 'tablewrap' });
    var out = h('div', null, filterBar(''), h('div', { class: 'overview' }, scatter(rows), topList(rows), legend()), tableWrap);
    main.appendChild(out);
    drawTable();
  }

  function legend() {
    return h('div', { class: 'legend' }, h('h3', { text: 'How a row is valued' }),
      h('p', { class: 'formula', html: 'TVL × <b>peer multiple</b> × <b>momentum</b> × <b>launch clock</b>' }),
      h('ul', null,
        h('li', null, h('b', { text: 'Peer multiple: ' }), 'median market cap / TVL of the ' + R.peers._market.n + ' traded protocols in the snapshot, by category, shrunk to the market median ' + R.peers._market.median.toFixed(2) + 'x'),
        h('li', null, h('b', { text: 'Momentum: ' }), '1 + ' + C.growth_weight + ' × 7d TVL change (' + C.growth_min + '% to +' + C.growth_max + '%)'),
        h('li', null, h('b', { text: 'Launch clock: ' }), C.clock_start + ' at listing, ' + C.clock_peak + ' at ' + C.clock_peak_day + ' days tokenless, ' + C.clock_tail + ' from ' + (C.clock_tail_day / 365) + ' years'),
        h('li', null, h('b', { text: 'Airdrop / $1k: ' }), C.airdrop_share * 100 + '% of the implied value shared over the TVL, per $1,000 kept in'),
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
    main.appendChild(h('div', { class: 'panel' }, h('h2', { text: 'The model, ' + C.version }), legend(),
      h('h3', { text: 'Peer multiples learned from this snapshot' }),
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
      ['× peer multiple', m.multiple.toFixed(3) + 'x', m.peers_n + ' traded ' + (r.category || 'market') + ' peers'],
      ['× momentum', m.momentum.toFixed(3), '7d TVL ' + pct(r.change_7d)],
      ['× launch clock', m.clock.toFixed(3), age(m.age_days) + ' tokenless · ' + m.phase],
      ['= implied value', money(r.implied_value_usd), 'rank ' + r.rank + ' of ' + R.rows.length]];
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
      return h('div', { class: 'wf' + (i === factors.length - 1 ? ' total' : '') }, h('span', { text: f[0] }), h('b', { text: f[1] }), h('small', { text: f[2] }));
    })));
    if (peer.peers.length) detail.appendChild(h('p', { class: 'peers', text: 'Peers: ' + peer.peers.slice(0, 6).map(function (p) { return p.name + ' ' + p.ratio.toFixed(2) + 'x'; }).join(' · ') + (peer.peers.length > 6 ? ' …' : '') }));
    detail.appendChild(h('h3', { text: 'Farm plan · ' + steps.length + ' steps · ' + sittings + ' sittings plus the hold' }));
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
