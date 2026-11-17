# Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sanglaanh123/launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sanglaanh123/launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty (token-radar-01). `main.ts` (Node 22, standard library only) reads the
sealed DefiLlama snapshot, ranks every protocol that records no token by an implied value, and writes a
static dashboard with a detail view and farm plan for each one.

The value model lives in `dashboard/model.js`, the same file the page runs:

    implied value = base(TVL, category) x momentum(7d TVL change) x launch clock(days tokenless)

The base is fitted on the snapshot's clean traded comps (tokens with a market cap, minus wrapped, staked
and bridged products). `backtest()` scores four candidate base models (flat ratio, category ratio, size
curve, size curve + category) by leave-one-out and by a walk-forward split on `listed_at`, and keeps the
one with the smallest held-out error. On this snapshot that is the size curve + category: a typical miss
of x3.4 on comps it never saw, against x4.6 for a flat ratio. Momentum and the launch clock are stated
priors on top. Each row shows the held-out range, and its farm plan sizes the smallest deposit that earns
three times its gas, or says watch. No protocol name is special-cased.

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json

Then open `out/dashboard/index.html`. State is kept in the URL hash, for example `#p=gauntlet` or
`#scope=early&trend=up`.
