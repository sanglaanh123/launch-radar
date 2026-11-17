# Launch Radar

An entry for make.fun's token-radar-01 bounty. `main.ts` (Node 22, standard library only) reads the
sealed DefiLlama snapshot, ranks every protocol that records no token by an implied value, and writes a
static dashboard with a detail view and farm plan for each one.

The value model lives in `dashboard/model.js`, the same file the page runs:

    implied value = TVL x peer multiple(category) x momentum(7d TVL change) x launch clock(days tokenless)

Peer multiples are learned from the snapshot's own token-trading protocols (median market cap / TVL by
category, shrunk toward the market median). No protocol name is special-cased.

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json

Then open `out/dashboard/index.html`. State is kept in the URL hash, for example `#p=gauntlet` or
`#scope=early&trend=up`.
