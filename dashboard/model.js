// Launch Radar model: one file, run by main.ts (to write board.json) and by the page (to draw it).
// Same code, same snapshot, same numbers: the screenshots, the board and this source cannot disagree.
//
// implied_value_usd = tvl_usd x peerMultiple(category) x momentum(change_7d) x launchClock(age_days)
//
//   peerMultiple  the median market-cap / TVL of the snapshot's own token-trading protocols in the same
//                 category, shrunk toward the median of all of them (few peers, more shrink). Learned
//                 from this snapshot, never typed in.
//   momentum      1 + 1.25 x the seven-day TVL change, the change clamped to -40%..+60%.
//   launchClock   how long the protocol has run with no token: the premium climbs for 18 months (points
//                 seasons usually end there), then decays to 0.70 at four years (a team that has gone
//                 four years without a token is less likely to issue one). Unknown age: 1.00.
//
// No protocol name appears anywhere in this file: every row is scored by the same functions.
(function (root) {
  'use strict';

  var M = {
    version: 'radar-peer-3',
    shrink_k: 5,            // pseudo-peers pulling a category's multiple toward the market median
    multiple_min: 0.05,
    multiple_max: 2.5,
    growth_min: -40,
    growth_max: 60,
    growth_weight: 1.25,
    clock_start: 0.85,      // launch clock at day 0
    clock_peak: 1.15,       // at the peak day
    clock_peak_day: 540,    // 18 months
    clock_tail: 0.7,        // from the tail day on
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

  /** Category multiples learned from the snapshot's token-trading protocols (market cap / TVL). */
  function peerMultiples(snap) {
    var by = {}, all = [];
    snap.protocols.forEach(function (p) {
      if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0 || p.category === 'CEX') return;
      var r = p.mcap_usd / p.tvl_usd;
      all.push(r);
      (by[p.category || 'Uncategorised'] = by[p.category || 'Uncategorised'] || []).push({ slug: p.slug, name: p.name, ratio: r });
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
  function impliedValue(p, asOf, peers) {
    var peer = peers[p.category || 'Uncategorised'] || peers._market;
    var mom = momentum(p.change_7d);
    var age = ageDays(asOf, p.listed_at);
    var clock = launchClock(age);
    var implied = Math.max(1, Math.round(p.tvl_usd * peer.multiple * mom.mult * clock.mult));
    var pool = implied * M.airdrop_share;
    return {
      implied: implied,
      multiple: peer.multiple, peers_n: peer.n,
      growth_pct: mom.pct, momentum: mom.mult,
      age_days: age, clock: clock.mult, phase: clock.phase,
      pool_usd: Math.round(pool),
      per_1k: Math.round((pool / p.tvl_usd) * M.reference_usd * 100) / 100,
      confidence: peer.n >= 5 && p.change_7d !== null && age !== null ? 'A' : peer.n >= 2 ? 'B' : 'C'
    };
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
  function farmPlan(p, v) {
    var chain = p.chains[0] || 'its main chain';
    var gas = gasFor(chain), fam = familyOf(p.category);
    var hold = v.age_days === null ? 60 : v.age_days < 365 ? 90 : v.age_days < M.clock_tail_day ? 60 : 30;
    var size = p.tvl_usd < 2e7 ? 500 : M.reference_usd;
    var txs = fam === 'perps' || fam === 'dex' ? 2 : 1;
    var gasTotal = gas.usd * (4 + txs * Math.ceil(hold / 7));
    var expected = (v.per_1k * size) / M.reference_usd;
    var name = p.name;
    var action = {
      vault: ['Deposit $' + size + ' of USDC into ' + name + "'s largest stablecoin vault on " + chain + ' and keep the vault shares in the wallet', 'Re-check the vault each week and move only if its curator changes the strategy or the cap fills'],
      lending: ['Supply $' + size + ' of USDC to ' + name + ' on ' + chain + ', then borrow 20% of it in a second asset so the account shows both sides', 'Repay and re-borrow once a week, keeping the health factor above 2'],
      dex: ['Add $' + size + ' of liquidity to ' + name + "'s deepest stable or blue-chip pool on " + chain + ' with a wide range', 'Make two swaps of about $100 a week through ' + name + ' so the wallet shows trading as well as liquidity'],
      perps: ['Deposit $' + size + ' of USDC as margin on ' + name + ' and open a delta-neutral pair or a 1x hedge', 'Trade about $2,000 of notional a week at low leverage; volume, not risk, is what points programs count'],
      rwa: ['Pass ' + name + "'s onboarding and mint or buy $" + size + ' of its yield asset on ' + chain, 'Keep the asset in the wallet or its own vault; do not sell it on a secondary pool if the program counts holdings'],
      stake: ['Stake or delegate $' + size + ' worth of the supported asset through ' + name + ' on ' + chain + ' and keep the receipt token', 'Restake or compound the rewards each week if the app offers it'],
      chain: ['Bridge $' + size + ' to ' + name + ' through its official bridge page and keep a balance there', 'Use two of its native apps each week (a swap and a deposit) so the wallet shows real activity']
    }[fam];
    return [
      { step: 'Set up a fresh wallet for ' + name + ' only, open the protocol from the address in its own docs, and check the contract on ' + chain + "'s explorer before the first approval.", cost: gas.text + ' for the first approval', time: '10 minutes' },
      { step: action[0] + '.', cost: '$' + size + ' of capital plus ' + gas.text, time: '15 minutes' },
      { step: action[1] + '.', cost: money(gas.usd * txs) + ' a week in gas', time: '10 minutes a week' },
      { step: 'Hold for at least ' + hold + ' days (launch clock: ' + v.phase + ') and check the protocol\'s points or season page every two weeks.', cost: 'about ' + money(gasTotal) + ' of gas over the whole hold, capital stays in', time: hold + ' days' },
      { step: 'Judge the trade: at the model\'s ' + money(v.implied) + ' implied value and a ' + (M.airdrop_share * 100) + '% community pool, $' + size + ' kept in to the snapshot earns about ' + money(expected) + '; stop if gas or fees pass half of that.', cost: 'about ' + money(gasTotal + gas.usd * 3) + ' of gas for the whole plan against about ' + money(expected) + ' expected', time: '5 minutes' },
      { step: 'When a token or claim is announced, claim only from the link on the protocol\'s own site, then withdraw and revoke the approvals you gave.', cost: money(gas.usd * 3) + ' of gas for claim, withdraw and revoke', time: '20 minutes' }
    ];
  }

  function stepText(s) { return s.step + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; }

  /** The whole radar from a snapshot: the ranked board, the set-aside lists and the peer table. */
  function build(snap) {
    var peers = peerMultiples(snap);
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
      var v = impliedValue(p, snap.as_of, peers);
      return {
        rank: 0, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
        tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at,
        scope: watch[p.slug] ? 'watchlist' : 'early',
        token_status: 'no token recorded',
        implied_value_usd: v.implied, model: v, plan: farmPlan(p, v)
      };
    });
    rows.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || bySlug(a, b); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    trading.sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0) || b.tvl_usd - a.tvl_usd || bySlug(a, b); });
    products.sort(function (a, b) { return b.tvl_usd - a.tvl_usd || bySlug(a, b); });
    return {
      as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd, constants: M,
      watchlist_size: snap.watchlist.length, protocol_count: snap.protocols.length,
      rows: rows, peers: peers,
      trading: trading.map(function (p) {
        return { slug: p.slug, name: p.name, category: p.category, symbol: p.symbol, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: p.mcap_usd ? p.mcap_usd / p.tvl_usd : null };
      }),
      products: products
    };
  }

  root.RadarModel = { constants: M, build: build, impliedValue: impliedValue, peerMultiples: peerMultiples, momentum: momentum, launchClock: launchClock, farmPlan: farmPlan, stepText: stepText, money: money, familyOf: familyOf };
})(globalThis);
