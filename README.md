# Token Radar — radar-3: fitted launch pricing

A launch radar that prices unlaunched DeFi protocols by fitting a curve to
launched ones, instead of copying a category median. Every number on the
board comes from a regression on the same snapshot, and the regression is
tested out of sample before you trust it.

## Data

- Snapshot: 758 protocols, as of **2026-11-14**, source DefiLlama
  (`api.llama.fi/protocols`, fetched 2026-11-14T01:18:33Z).
- Each protocol carries slug, name, category, chains, TVL, 7-day TVL change,
  market cap (null when unlaunched), and listing date.
- Inclusion floor: TVL ≥ **$50M**. The board holds the **40 watchlist**
  protocols plus the **160** highest-implied-value non-watchlist protocols
  at or above the floor — 200 rows in total.
- Age in days is counted from `listed_at` to the snapshot date; protocols
  with no listing date count as 0 days old. Missing 7-day change counts as 0.

## Model

Control group: the **110** launched protocols with mcap ≥ $1M and TVL > 0.

For the control group, fit

```
log10(mcap) = a + b·x + c·x²,   x = log10(TVL)
```

by ordinary least squares. The 3×3 normal equations are solved by Gaussian
elimination with partial pivoting, implemented in `lib/model.ts` — no
external dependencies. A category gets its own curve when it holds **≥ 5**
launched samples; otherwise the protocol uses the global curve. This run
fitted **9 category curves** (Lending, Dexs, RWA, Liquid Staking, CEX,
Canonical Bridge, Basis Trading, Yield, Bridge) plus the global curve.
157 of the 200 board rows use a category curve, 43 use the global curve.

A protocol's implied multiple is

```
multiple = 10 ^ (fitted log10(mcap) − log10(TVL))
```

rounded to 4 decimals, then clamped to **[0.05, 2.00]**. Implied value is

```
implied = TVL × multiple
        × (1 + clamp(change_7d, −60, 120) / 100 × 0.5)
        × (0.6 + min(age_days, 1095) / 1095 × 0.4)
```

rounded to whole dollars. The board is published sorted by implied value
descending, rank 1–200.

Global fit on this snapshot: a = 7.5347, b = −0.4415, c = **+0.0526**,
n = 110, R² = **0.2167**. Note the positive quadratic term: the global data
does **not** show the saturation the quadratic was meant to capture — the
curve bends upward at high TVL. Four category curves do bend down
(RWA −0.033, Canonical Bridge −0.422, Basis Trading −0.103, Bridge −0.287),
but the small-sample category fits are noisy (Dexs: n = 9, R² = 0.154,
c = +2.962). The clamps bind often: **35 rows sit at the 2.00 cap** (mostly
large Lending protocols, where the Lending curve extrapolates steeply) and
**25 rows sit at the 0.05 floor**.

## Results

- **#1: Binance CEX — implied $60,606,490,338** (multiple 0.5451x, CEX curve).
  #2–#5 are Aave V3 ($27.43B), Morpho Blue ($20.00B), SparkLend ($8.24B) and
  JustLend V1 ($3.71B), all at the 2.00x cap on the Lending curve.
- Median fitted multiple across the board: **0.3169x**.
- Watchlist coverage: **40/40**.

## Out-of-sample validation (read this before trusting the board)

The 110 launched protocols are split into 5 folds by a deterministic hash,
fold = FNV-1a(slug) % 5. Each fold is predicted by curves refit on the other
4 folds (per-category curves where the training fold holds ≥ 5 samples, else
the global training curve). Error is |predicted mcap − actual mcap| / actual
mcap.

| Fold | n | Median APE | Within ±25% |
|------|---|------------|-------------|
| 0 | 28 | 89.02% | 17.86% |
| 1 | 23 | 199.94% | 13.04% |
| 2 | 13 | 92.82% | 15.38% |
| 3 | 23 | 94.78% | 8.70% |
| 4 | 23 | 99.99% | 8.70% |
| **Overall** | **110** | **95.51%** | **12.73%** |

In-sample R² by curve: Global 0.2167 (n=110); Bridge 0.852 (n=5);
Yield 0.747 (n=6); Canonical Bridge 0.700 (n=7); Liquid Staking 0.573 (n=8);
RWA 0.504 (n=9); CEX 0.444 (n=8); Lending 0.320 (n=11);
Basis Trading 0.240 (n=7); Dexs 0.154 (n=9).

Plain reading: **TVL alone explains only ~22% of log market-cap variance,
and the typical holdout prediction is off by about 2×.** Only 12.73% of
holdout predictions land within ±25% of the actual market cap. The board is
a ranking by fitted value, not a precise price prediction — treat the
multiples as a screening signal and the farm plans as sizing guidance, not
as expected returns. The next model iteration should add features beyond
TVL (category share, growth, chain, age) instead of fitting TVL harder.

## Farm plans (netted, 6 steps each)

Every row carries a 6-step plan: fund a fresh wallet, the category's
on-chain action, hold without adding funds, watch the launch signals, exit
at listing/snapshot, and a net settlement. Deposit size is tiered by
implied value, so the plan scales with the opportunity:

| Tier | Implied value | Deposit |
|------|---------------|---------|
| A | ≥ $500M | $25,000 |
| B | $100M – $500M | $10,000 |
| C | < $100M | $2,500 |

This run: 31 rows tier A, 56 tier B, 113 tier C. Gas is estimated by chain
(Ethereum $25; Arbitrum, Optimism, Base, BSC/Binance, Polygon, Avalanche,
Solana, Unichain $3; everything else $6). Protocol fee is 0.1% of the
deposit (minimum $1). The final step nets it out:
`net = deposit × (multiple − 1) − gas − fee`, stated in dollars with a
verdict. **58 of the 200 rows show a positive net expected value**; the
rest say so plainly and advise skipping unless the points alone justify it.

## Dashboard

Dark terminal style, monospace numbers, three views (switch with the tabs,
or link directly with `#board`, `#curve`, `#validation`):

- **Board** — the 200-row table, sortable by column, filterable by text,
  category, and watchlist-only. Click a row for the detail drawer: fitted
  vs actual multiple (actual = mcap/TVL for launched protocols), curve used,
  and the 6-step netted farm plan.
- **Curve** — SVG scatter of the 110 launched protocols, log10 TVL vs
  log10 mcap, with the fitted quadratic for the selected curve and the 1.0x
  diagonal for reference.
- **Validation** — the per-fold error table, the overall summary, and the
  fitted-curve table with in-sample R².

No network requests: the dashboard loads only local files.

## Run it

```
node main.ts [snapshot.json] [out-dir]
```

Defaults: snapshot `../token-radar-01-kit/input/snapshot.json`,
output `./out`. The build writes `out/board.json`, `out/data.js`,
`out/dashboard/` (index.html, app.css, app.js) and `out/dossier.json`
(built last from the finished output directory with the kit's
`buildDossier` helper).

Verify the output contract:

```
node ~/workspace/makefun/verify-gate.mjs out <snapshot.json>
```

Local gate result for this build: **7/7 pass** (dashboard files, board file,
sorted by value, watchlist coverage, farm steps, screenshots, dossier match).

## Files

- `main.ts` — entry point: read snapshot, build, write outputs, dossier last.
- `lib/model.ts` — the radar-3 model: quadratic OLS fit, 5-fold validation,
  board selection, farm plans.
- `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js` — the
  terminal-style dashboard (Board / Curve / Validation + detail drawer).
- `vendor/makefun-board.ts` — kit helper that builds `dossier.json`
  (untouched).
