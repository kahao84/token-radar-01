# Token Radar — the best token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kahao84/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kahao84/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's `token-radar-01` bounty: a program that ranks pre-token
DeFi protocols by implied value, and a dashboard a reader can use to farm them.

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot of 758
DefiLlama protocols, scores every pre-token protocol with the radar-2 model,
and writes:

- `board.json` — 200 ranked rows (the 40-protocol watchlist, plus 160 early
  pre-token protocols below the $50M floor), each with an implied value and a
  six-step farm plan.
- `data.js` + `dashboard/` — a static page (no network, no framework) with a
  sortable, filterable board, a per-protocol detail view showing the model's
  own inputs, and a live-token view set aside with market caps.
- `screenshots/` — the board, a detail view, and a filtered view.
- `dossier.json` — the summary the judge reads, built with the vendored
  `makefun-board.ts` library.

## The model (radar-2)

Implied value follows only from the snapshot's own figures. The multiple is
the market's own rate: the median market-cap-to-TVL of tokenized protocols in
the same category (global median when a category has fewer than 5 tokenized
protocols), clamped to [0.05, 2.00]. A pre-token protocol is valued at the rate
its tokenized peers already trade at.

```
multiple   = median mcap/TVL, per category (else global), clamped [0.05, 2.00]
implied    = round( tvl_usd x multiple
              x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
              x (0.6 + min(age_days, 1095) / 1095 x 0.4) )
```

Age is the time since DefiLlama first listed the protocol — how long it has
run with no token on record. No protocol name is special-cased; the same
function scores every row. The dashboard recomputes each row from the same
figures and shows the number `board.json` carries.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Then open `out/dashboard/index.html` in a browser (it reads `out/data.js`).

## Farm plans

Each row carries six steps derived from the protocol's own record (category,
chains, TVL, age): a fresh wallet, the category's action with its capital and
gas, one qualifying action a week, a hold of 30–60 days, claiming only from the
protocol's own published link, and a farm log. Costs and times are on every
step.

## Ownership

`.makefun/owner.json` holds the wallet of the make.fun account this entry
belongs to (`@zesty-beacon-46`).

## License

MIT. See `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=w794aver&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
