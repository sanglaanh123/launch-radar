// Launch Radar model: one file, run by main.ts (to write board.json) and by the page (to draw it).
// Same code, same snapshot, same numbers: the screenshots, the board and this source cannot disagree.
//
// implied_value_usd = base(tvl_usd, category) x momentum(change_7d) x launchClock(age_days)
//
//   base          a launch's market cap as the snapshot's own traded comps price their TVL. Four candidate
//                 base models are fitted on the clean comps (tokens that trade, minus wrapped, staked and
//                 bridged products whose TVL is someone else's asset) and each is scored by leave-one-out
//                 and by a walk-forward split on listed_at (fit on the older 60%, predict the newer 40%).
//                 backtest() keeps the one with the smallest held-out error: no candidate is chosen by hand.
//   momentum      a stated prior, not fitted: 1 + 0.5 x the seven-day TVL change, clamped to -40%..+60%.
//   launchClock   a stated prior: the premium climbs for 18 months tokenless (points seasons usually end
//                 there), then decays to 0.80 at four years. Unknown age: 1.00.
//   range         the base's held-out residual quartiles: half of unseen comps landed inside it.
//
// No protocol name appears anywhere in this file: every row is scored by the same functions.
(function (root) {
  'use strict';

  var M = {
    version: 'radar-curve-4',
    shrink_k: 5,            // pseudo-peers pulling a category's term toward the market's
    multiple_min: 0.05,
    multiple_max: 2.5,
    walk_split: 0.6,        // walk-forward: older share used to fit
    growth_min: -40,
    growth_max: 60,
    growth_weight: 0.5,
    clock_start: 0.9,       // launch clock at day 0
    clock_peak: 1.1,        // at the peak day
    clock_peak_day: 540,    // 18 months
    clock_tail: 0.8,        // from the tail day on
    clock_tail_day: 1460,   // 4 years
    airdrop_share: 0.075,   // assumed community allocation of the token supply (5-10% is typical)
    reference_usd: 1000     // the farm plan's reference position
  };

  // Categories the house rule treats as a wrapped, staked or bridged product, and exchange names.
  var PRODUCT_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function bySlug(a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    if (s.length === 0) return null;
    var h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }

  /** Days from listed_at to as_of, or null when DefiLlama gives no listing day. */
  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    var d = (Date.parse(asOf + 'T00:00:00Z') - Date.parse(listedAt + 'T00:00:00Z')) / 86400000;
    return isFinite(d) ? Math.max(0, Math.floor(d)) : null;
  }

  /** A protocol records a token when DefiLlama gives it a CoinGecko id, a symbol or a market cap. */
  function recordsToken(p) { return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null; }

  /** Why a protocol is set aside rather than ranked, or null when it belongs on the board. */
  function setAsideReason(p, snap, onWatchlist) {
    if (onWatchlist) return null;
    if (recordsToken(p)) return 'token trades';
    if (PRODUCT_CATEGORIES.indexOf(p.category) >= 0) return 'product of a traded asset (' + p.category + ')';
    if (VERSIONED.test(p.name)) return 'versioned deployment';
    if (WRAPPED.test(p.name)) return 'wrapped or staked product';
    if (EXCHANGE.test(p.name)) return 'exchange product';
    if (p.tvl_usd >= snap.floor_usd) return 'above floor but off the watchlist: DefiLlama records a parent';
    return null;
  }

  /** Clean comps: protocols whose token trades with a market cap, minus products of another asset. */
  function comps(snap) {
    return snap.protocols.filter(function (p) {
      return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && PRODUCT_CATEGORIES.indexOf(p.category) < 0 && !WRAPPED.test(p.name);
    }).sort(bySlug);
  }

  /** Category multiples (market cap / TVL) of the comps, each shrunk toward the market median. */
  function peerMultiples(list) {
    var by = {}, all = [];
    list.forEach(function (p) {
      var r = p.mcap_usd / p.tvl_usd, c = p.category || 'Uncategorised';
      all.push(r);
      (by[c] = by[c] || []).push({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: r });
    });
    var market = median(all);
    var table = { _market: { n: all.length, median: market, multiple: clamp(market, M.multiple_min, M.multiple_max), peers: [] } };
    Object.keys(by).sort().forEach(function (cat) {
      var peers = by[cat].sort(bySlug), n = peers.length;
      var med = median(peers.map(function (x) { return x.ratio; }));
      var logM = (n * Math.log(med) + M.shrink_k * Math.log(market)) / (n + M.shrink_k);
      table[cat] = { n: n, median: med, multiple: clamp(Math.exp(logM), M.multiple_min, M.multiple_max), peers: peers };
    });
    return table;
  }

  /** Least squares of log market cap on log TVL: the size curve. */
  function fitCurve(list) {
    var xs = list.map(function (p) { return Math.log(p.tvl_usd); }), ys = list.map(function (p) { return Math.log(p.mcap_usd); });
    var n = xs.length, mx = 0, my = 0, sxy = 0, sxx = 0, i;
    for (i = 0; i < n; i++) { mx += xs[i] / n; my += ys[i] / n; }
    for (i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
    var b = sxx > 0 ? sxy / sxx : 1;
    return { a: my - b * mx, b: b };
  }

  // Candidate base models. fit(list) returns predict(p): the log market cap it gives protocol p.
  var CANDIDATES = [
    { key: 'flat', label: 'Flat ratio', fit: function (list) {
      var m = peerMultiples(list)._market.median;
      return function (p) { return Math.log(p.tvl_usd * m); };
    } },
    { key: 'category', label: 'Category ratio', fit: function (list) {
      var t = peerMultiples(list);
      return function (p) { return Math.log(p.tvl_usd * (t[p.category || 'Uncategorised'] || t._market).multiple); };
    } },
    { key: 'curve', label: 'Size curve', fit: function (list) {
      var f = fitCurve(list);
      return function (p) { return f.a + f.b * Math.log(p.tvl_usd); };
    } },
    { key: 'curve_cat', label: 'Size curve + category', fit: function (list) {
      var f = fitCurve(list), by = {};
      list.forEach(function (q) { var c = q.category || 'Uncategorised'; (by[c] = by[c] || []).push(Math.log(q.mcap_usd) - f.a - f.b * Math.log(q.tvl_usd)); });
      return function (p) {
        var r = by[p.category || 'Uncategorised'] || [], n = r.length;
        return f.a + f.b * Math.log(p.tvl_usd) + (n ? n * median(r) / (n + M.shrink_k) : 0);
      };
    } }
  ];

  function quantile(xs, q) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : 0;
  }

  /**
   * Scores every candidate on comps it never saw. Leave-one-out: fit on all comps but one, predict it.
   * Walk-forward: fit on the older share by listed_at, predict the newer rest. Keeps the lowest LOO error.
   */
  function backtest(list) {
    var dated = list.filter(function (p) { return p.listed_at; }).sort(function (a, b) { return a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : bySlug(a, b); });
    var cut = Math.floor(dated.length * M.walk_split), older = dated.slice(0, cut), newer = dated.slice(cut);
    var scored = CANDIDATES.map(function (c) {
      var loo = list.map(function (p, i) {
        var predict = c.fit(list.filter(function (_, j) { return j !== i; }));
        return { slug: p.slug, actual: p.mcap_usd, predicted: Math.exp(predict(p)), err: predict(p) - Math.log(p.mcap_usd) };
      });
      var wfPredict = c.fit(older);
      var wf = newer.map(function (p) { return Math.abs(wfPredict(p) - Math.log(p.mcap_usd)); });
      var abs = loo.map(function (x) { return Math.abs(x.err); });
      return {
        key: c.key, label: c.label, n: list.length, loo: loo,
        miss: Math.exp(median(abs)), within3: abs.filter(function (e) { return e < Math.log(3); }).length / abs.length,
        wf_n: newer.length, wf_miss: Math.exp(median(wf)), wf_from: newer.length ? newer[0].listed_at : null,
        band: [Math.exp(-quantile(loo.map(function (x) { return x.err; }), 0.75)), Math.exp(-quantile(loo.map(function (x) { return x.err; }), 0.25))]
      };
    });
    var best = scored.slice().sort(function (a, b) { return a.miss - b.miss || (a.key < b.key ? -1 : 1); })[0];
    var chosen = CANDIDATES.filter(function (c) { return c.key === best.key; })[0];
    return { candidates: scored, best: best, predict: chosen.fit(list), curve: fitCurve(list) };
  }

  function momentum(change7d) {
    if (change7d === null) return { pct: 0, mult: 1 };
    var g = clamp(change7d, M.growth_min, M.growth_max);
    return { pct: g, mult: 1 + (g / 100) * M.growth_weight };
  }

  function launchClock(age) {
    if (age === null) return { phase: 'unknown age', mult: 1 };
    if (age <= M.clock_peak_day) return { phase: 'building to launch', mult: M.clock_start + (M.clock_peak - M.clock_start) * (age / M.clock_peak_day) };
    if (age <= M.clock_tail_day) {
      var t = (age - M.clock_peak_day) / (M.clock_tail_day - M.clock_peak_day);
      return { phase: 'overdue', mult: M.clock_peak - (M.clock_peak - M.clock_tail) * t };
    }
    return { phase: 'long tokenless', mult: M.clock_tail };
  }

  /** The implied value of one protocol, with every factor that made it. */
  function impliedValue(p, asOf, bt, peers) {
    var peer = peers[p.category || 'Uncategorised'] || peers._market;
    var base = Math.exp(bt.predict(p));
    var mom = momentum(p.change_7d);
    var age = ageDays(asOf, p.listed_at);
    var clock = launchClock(age);
    var implied = Math.max(1, Math.round(base * mom.mult * clock.mult));
    var pool = implied * M.airdrop_share;
    return {
      implied: implied, base: Math.round(base),
      multiple: base / p.tvl_usd, peers_n: peer.n,
      low: Math.round(implied * bt.best.band[0]), high: Math.round(implied * bt.best.band[1]),
      growth_pct: mom.pct, momentum: mom.mult,
      age_days: age, clock: clock.mult, phase: clock.phase,
      pool_usd: Math.round(pool),
      per_1k: Math.round((pool / p.tvl_usd) * M.reference_usd * 100) / 100,
      confidence: peer.n >= 5 && p.change_7d !== null && age !== null ? 'A' : peer.n >= 2 ? 'B' : 'C'
    };
  }

  /** The traded comps nearest in TVL, same category first: what the market pays for a book this size. */
  function nearestComps(p, list) {
    var lt = Math.log(p.tvl_usd);
    return list.slice().sort(function (a, b) {
      var sa = (a.category === p.category ? 0 : 1) + Math.abs(Math.log(a.tvl_usd) - lt) / 3;
      var sb = (b.category === p.category ? 0 : 1) + Math.abs(Math.log(b.tvl_usd) - lt) / 3;
      return sa - sb || bySlug(a, b);
    }).slice(0, 4).map(function (q) { return { name: q.name, symbol: q.symbol, category: q.category, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd }; });
  }

  // ---- farm plans -------------------------------------------------------------------------------
  var L2 = ['Base', 'Arbitrum', 'Optimism', 'Linea', 'Scroll', 'zkSync Era', 'Blast', 'Mantle', 'Unichain', 'Ink', 'Sonic', 'Plasma', 'Katana', 'Hyperliquid L1', 'BSC', 'Polygon', 'Avalanche', 'Berachain', 'Monad', 'Sei'];

  /** Gas per transaction on the protocol's main chain, as a dollar figure and a phrase. */
  function gasFor(chain) {
    if (chain === 'Ethereum') return { usd: 6, text: 'about $6 of gas a transaction on Ethereum' };
    if (chain === 'Solana') return { usd: 0.02, text: 'under $0.05 of fees on Solana' };
    if (chain === 'Bitcoin') return { usd: 4, text: 'about $4 of Bitcoin fees' };
    if (L2.indexOf(chain) >= 0) return { usd: 0.1, text: 'about $0.10 of gas on ' + chain };
    return { usd: 0.5, text: 'under $1 of fees on ' + chain };
  }

  var FAMILIES = [
    ['vault', ['Risk Curators', 'Onchain Capital Allocator', 'Yield', 'Yield Aggregator', 'Basis Trading', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Stablecoin Wrapper', 'CeDeFi', 'Options Vault', 'Indexes', 'Algo-Stables']],
    ['lending', ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Interest Rate Derivatives', 'Collateral Management']],
    ['dex', ['Dexs', 'OTC Marketplace', 'Launchpad', 'NFT Marketplace', 'Token Locker']],
    ['perps', ['Derivatives', 'Options', 'Prediction Market', 'Synthetics']],
    ['rwa', ['RWA', 'Dual-Token Stablecoin', 'Payments', 'Crypto Card Issuer', 'Stablecoin Issuer', 'Reserve Currency']],
    ['stake', ['Restaking', 'Staking Pool', 'Anchor BTC', 'Decentralized BTC', 'Governance Incentives', 'Insurance', 'Cross Chain Bridge']]
  ];
  function familyOf(category) {
    for (var i = 0; i < FAMILIES.length; i++) if (FAMILIES[i][1].indexOf(category) >= 0) return FAMILIES[i][0];
    return 'chain';
  }

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + (n < 10 ? n.toFixed(2) : Math.round(n));
  }

  /**
   * A farm plan: 6 steps, each {step, cost, time}, built from the protocol's category, main chain, TVL,
   * age and the model's own payout estimate. The action wording is per category family.
   */
  var SIZES = [500, 1000, 2500, 10000, 25000];

  /**
   * Sizes the position against its own costs: the smallest deposit whose expected airdrop is at least
   * three times the plan's gas. None does: the verdict is watch, not farm.
   */
  function sizing(p, v) {
    var fam = familyOf(p.category), gas = gasFor(p.chains[0] || '');
    var hold = v.age_days === null ? 60 : v.age_days < 365 ? 90 : v.age_days < M.clock_tail_day ? 60 : 30;
    var txs = fam === 'perps' || fam === 'dex' ? 2 : 1;
    var gasAll = gas.usd * (7 + txs * Math.ceil(hold / 7));
    var perUsd = v.per_1k / M.reference_usd;
    var size = SIZES.filter(function (s) { return perUsd * s >= 3 * gasAll; })[0];
    var verdict = size === undefined ? 'watch' : size <= 2500 ? 'farm' : 'farm big';
    if (size === undefined) size = SIZES[SIZES.length - 1];
    return { size: size, hold: hold, txs: txs, gas: gas, gas_all: gasAll, expected: perUsd * size, breakeven: perUsd > 0 ? Math.ceil(gasAll / perUsd) : null, verdict: verdict };
  }

  function farmPlan(p, v) {
    var chain = p.chains[0] || 'its main chain';
    var fam = familyOf(p.category), z = sizing(p, v);
    var gas = z.gas, hold = z.hold, txs = z.txs, gasTotal = z.gas_all, expected = z.expected;
    var sizeText = String(z.size).replace(/\B(?=(\d{3})+$)/g, ',');
    var name = p.name;
    var action = {
      vault: ['Deposit $' + sizeText + ' of USDC into ' + name + "'s largest stablecoin vault on " + chain + ' and keep the vault shares in the wallet', 'Re-check the vault each week and move only if its curator changes the strategy or the cap fills'],
      lending: ['Supply $' + sizeText + ' of USDC to ' + name + ' on ' + chain + ', then borrow 20% of it in a second asset so the account shows both sides', 'Repay and re-borrow once a week, keeping the health factor above 2'],
      dex: ['Add $' + sizeText + ' of liquidity to ' + name + "'s deepest stable or blue-chip pool on " + chain + ' with a wide range', 'Make two swaps of about $100 a week through ' + name + ' so the wallet shows trading as well as liquidity'],
      perps: ['Deposit $' + sizeText + ' of USDC as margin on ' + name + ' and open a delta-neutral pair or a 1x hedge', 'Trade about $2,000 of notional a week at low leverage; volume, not risk, is what points programs count'],
      rwa: ['Pass ' + name + "'s onboarding and mint or buy $" + sizeText + ' of its yield asset on ' + chain, 'Keep the asset in the wallet or its own vault; do not sell it on a secondary pool if the program counts holdings'],
      stake: ['Stake or delegate $' + sizeText + ' worth of the supported asset through ' + name + ' on ' + chain + ' and keep the receipt token', 'Restake or compound the rewards each week if the app offers it'],
      chain: ['Bridge $' + sizeText + ' to ' + name + ' through its official bridge page and keep a balance there', 'Use two of its native apps each week (a swap and a deposit) so the wallet shows real activity']
    }[fam];
    return [
      { step: 'Set up a fresh wallet for ' + name + ' only, open the protocol from the address in its own docs, and check the contract on ' + chain + "'s explorer before the first approval.", cost: gas.text + ' for the first approval', time: '10 minutes' },
      { step: action[0] + '.', cost: '$' + sizeText + ' of capital plus ' + gas.text, time: '15 minutes' },
      { step: action[1] + '.', cost: money(gas.usd * txs) + ' a week in gas', time: '10 minutes a week' },
      { step: 'Hold for at least ' + hold + ' days (launch clock: ' + v.phase + ') and check the protocol\'s points or season page every two weeks.', cost: 'about ' + money(gas.usd * txs * Math.ceil(hold / 7)) + ' of gas over the hold, capital stays in', time: hold + ' days' },
      { step: (z.verdict === 'watch'
        ? 'Verdict: watch, do not farm yet. Even $' + sizeText + ' kept in earns about ' + money(expected) + ' at the model\'s ' + money(v.implied) + ' and a ' + (M.airdrop_share * 100) + '% pool, under three times the gas; break-even is about ' + money(z.breakeven) + '. Re-run when fees fall or a points program starts.'
        : 'Verdict: ' + z.verdict + '. $' + sizeText + ' is the smallest deposit that earns at least three times its gas: about ' + money(expected) + ' at the model\'s ' + money(v.implied) + ' and a ' + (M.airdrop_share * 100) + '% pool. Break-even is about ' + money(z.breakeven) + '; stop if fees pass a third of the expected drop.'),
        cost: 'about ' + money(gasTotal) + ' of gas for the whole plan against about ' + money(expected) + ' expected', time: '5 minutes' },
      { step: 'When a token or claim is announced, claim only from the link on the protocol\'s own site, then withdraw and revoke the approvals you gave.', cost: money(gas.usd * 3) + ' of gas for claim, withdraw and revoke', time: '20 minutes' }
    ];
  }

  function stepText(s) { return s.step + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; }

  /** The whole radar from a snapshot: the ranked board, the set-aside lists and the peer table. */
  function build(snap) {
    var clean = comps(snap), peers = peerMultiples(clean), bt = backtest(clean);
    var watch = {};
    snap.watchlist.forEach(function (s) { watch[s] = true; });
    var ranked = [], trading = [], products = [];
    snap.protocols.forEach(function (p) {
      var reason = setAsideReason(p, snap, !!watch[p.slug]);
      if (reason === 'token trades') { if (p.category !== 'CEX') trading.push(p); return; }
      if (reason !== null) { products.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: reason }); return; }
      ranked.push(p);
    });
    var rows = ranked.map(function (p) {
      var v = impliedValue(p, snap.as_of, bt, peers);
      return {
        rank: 0, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
        tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at,
        scope: watch[p.slug] ? 'watchlist' : 'early',
        token_status: 'no token recorded',
        implied_value_usd: v.implied, model: v, sizing: sizing(p, v), plan: farmPlan(p, v)
      };
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || bySlug(a, b); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    trading.sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0) || b.tvl_usd - a.tvl_usd || bySlug(a, b); });
    products.sort(function (a, b) { return b.tvl_usd - a.tvl_usd || bySlug(a, b); });
    return {
      as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd, constants: M,
      watchlist_size: snap.watchlist.length, protocol_count: snap.protocols.length,
      rows: rows, peers: peers, comps: clean, backtest: bt,
      trading: trading.map(function (p) {
        return { slug: p.slug, name: p.name, category: p.category, symbol: p.symbol, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: p.mcap_usd ? p.mcap_usd / p.tvl_usd : null };
      }),
      products: products
    };
  }

  root.RadarModel = { constants: M, build: build, impliedValue: impliedValue, peerMultiples: peerMultiples, backtest: backtest, nearestComps: nearestComps, sizing: sizing, momentum: momentum, launchClock: launchClock, farmPlan: farmPlan, stepText: stepText, money: money, familyOf: familyOf };
})(globalThis);
