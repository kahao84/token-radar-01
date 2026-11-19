// radar-3 — fitted launch pricing model for token-radar-01.
//
// Method: for every launched protocol (mcap >= $1M) fit a quadratic curve
// log10(mcap) = a + b*x + c*x^2, x = log10(TVL), by ordinary least squares.
// Categories with >= 5 launched samples get their own curve, the rest use
// the global curve. A protocol's implied multiple is 10^(fitted log mcap -
// log TVL), rounded to 4 decimals and clamped to [0.05, 2.00]. Implied value
// then applies a 7-day momentum factor and an age factor.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chain: string;
  tvl_usd: number;
  mcap_usd: number | null;
  implied_value_usd: number;
  multiple: number;
  change_7d: number;
  age_days: number;
  rank: number;
  watchlist: boolean;
  fit_source: 'category' | 'global';
  fit_curve: string;
  farm_steps: string[];
}

export interface Fit {
  curve: string;
  a: number;
  b: number;
  c: number;
  n: number;
  r2: number;
  xMin: number;
  xMax: number;
}

export interface FoldResult {
  fold: number;
  n: number;
  medianApePct: number;
  within25Pct: number;
}

export interface Validation {
  folds: FoldResult[];
  overall: { n: number; medianApePct: number; within25Pct: number };
  method: string;
}

export interface CurvePoint {
  x: number;
  y: number;
  category: string;
  slug: string;
  name: string;
}

export interface Kpis {
  medianMultiple: number;
  oosMedianApePct: number;
  oosWithin25Pct: number;
  watchlistCovered: number;
  watchlistTotal: number;
  topName: string;
  topImpliedUsd: number;
  globalR2: number;
  controlN: number;
}

export interface BuildResult {
  rows: BoardRow[];
  validation: Validation;
  fits: Fit[];
  points: CurvePoint[];
  kpis: Kpis;
  meta: {
    model: string;
    asOf: string;
    source: string;
    floorUsd: number;
    protocols: number;
    controlN: number;
    categoriesFitted: number;
    builtAt: string;
  };
}

const MULTIPLE_MIN = 0.05;
const MULTIPLE_MAX = 2.0;
const CONTROL_MCAP_MIN = 1_000_000;
const CATEGORY_MIN_SAMPLES = 5;
const AGE_CAP_DAYS = 1095;
const WATCHLIST_SIZE = 40;
const EARLY_SIZE = 160;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(Math.round(n));
  return sign + '$' + a.toLocaleString('en-US');
}

// FNV-1a 32-bit hash — small, stable, deterministic across runs.
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function ageDays(listedAt: string | null, asOf: string): number {
  if (!listedAt) return 0;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const l = Date.parse(listedAt + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(l)) return 0;
  return Math.max(0, Math.floor((a - l) / 86400000));
}

// Solve a 3x3 linear system by Gaussian elimination with partial pivoting.
function solve3(a: number[][], b: number[]): number[] | null {
  const m = [
    [a[0][0], a[0][1], a[0][2], b[0]],
    [a[1][0], a[1][1], a[1][2], b[1]],
    [a[2][0], a[2][1], a[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    if (piv !== col) {
      const t = m[piv];
      m[piv] = m[col];
      m[col] = t;
    }
    for (let r = col + 1; r < 3; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = m[r][3];
    for (let c = r + 1; c < 3; c++) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return x;
}

interface Xy {
  x: number;
  y: number;
}

// OLS quadratic fit y = a + b*x + c*x^2. Returns null when underdetermined.
function fitQuadratic(pts: Xy[], curve: string): Fit | null {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
  let xMin = Infinity, xMax = -Infinity;
  for (const p of pts) {
    const x2 = p.x * p.x;
    sx += p.x; sx2 += x2; sx3 += x2 * p.x; sx4 += x2 * x2;
    sy += p.y; sxy += p.x * p.y; sx2y += x2 * p.y;
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
  }
  const sol = solve3(
    [[n, sx, sx2], [sx, sx2, sx3], [sx2, sx3, sx4]],
    [sy, sxy, sx2y],
  );
  if (!sol) return null;
  const [a, b, c] = sol;
  const yMean = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const p of pts) {
    const yhat = a + b * p.x + c * p.x * p.x;
    ssTot += (p.y - yMean) ** 2;
    ssRes += (p.y - yhat) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { curve, a, b, c, n, r2, xMin, xMax };
}

function predictLogMcap(fit: Fit, logTvl: number): number {
  return fit.a + fit.b * logTvl + fit.c * logTvl * logTvl;
}

// Deposit tiers by implied value, in USD.
function depositTier(impliedUsd: number): { deposit: number; tier: string } {
  if (impliedUsd >= 500_000_000) return { deposit: 25000, tier: 'A' };
  if (impliedUsd >= 100_000_000) return { deposit: 10000, tier: 'B' };
  return { deposit: 2500, tier: 'C' };
}

function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 25;
  if (['arbitrum', 'optimism', 'base', 'bsc', 'binance', 'polygon', 'avalanche', 'solana', 'unichain'].includes(c)) return 3;
  return 6;
}

// The on-chain action for each category. {DEP} is replaced with the deposit.
const CATEGORY_ACTIONS: Record<string, string> = {
  'Lending': 'Supply {DEP} of stablecoins to the lending market and borrow back 40% in the same asset to loop the position once.',
  'Uncollateralized Lending': 'Lend {DEP} to the whitelisted borrower pool and check the repayment schedule every day.',
  'Dexs': 'Provide {DEP} as two-sided liquidity in the protocol\u2019s deepest stablecoin pool and stake the LP receipt.',
  'Liquid Staking': 'Stake {DEP} of ETH for the liquid staking token and hold it; do not restake it anywhere else.',
  'Restaking': 'Restake {DEP} of liquid staking tokens into the protocol\u2019s restaking vault and hold the receipt token.',
  'Liquid Restaking': 'Deposit {DEP} of ETH into the liquid restaking vault and hold the receipt token.',
  'Yield': 'Deposit {DEP} into the highest-TVL yield vault and turn on auto-compounding.',
  'Yield Aggregator': 'Deposit {DEP} into the aggregator\u2019s top vault and let it rotate strategies automatically.',
  'CDP': 'Lock {DEP} of collateral in the CDP vault and mint stablecoins up to 40% of the collateral value.',
  'CDP Manager': 'Open a managed CDP with {DEP} of collateral and keep the collateral ratio above 200%.',
  'Derivatives': 'Post {DEP} as margin in the perpetuals market and open a small hedged position, long spot and short perp, to earn funding.',
  'Bridge': 'Bridge {DEP} across the protocol\u2019s route and provide it as bridge liquidity on the destination chain.',
  'Cross Chain Bridge': 'Bridge {DEP} across the protocol\u2019s cross-chain route and provide it as bridge liquidity on the destination chain.',
  'Canonical Bridge': 'Bridge {DEP} through the protocol\u2019s canonical bridge and hold the bridged asset on the destination chain.',
  'RWA': 'Subscribe {DEP} to the tokenized treasury or bill product and hold the receipt token until maturity.',
  'Launchpad': 'Stake {DEP} in the launchpad\u2019s allocation pool to qualify for the next token sale tier.',
  'Farm': 'Deposit {DEP} into the protocol\u2019s main farm and stake the LP tokens to earn emissions.',
  'Leveraged Farming': 'Open a 2x leveraged farm with {DEP} of collateral and keep the health factor above 1.5.',
  'Basis Trading': 'Deposit {DEP} into the basis vault that runs the spot-long and perp-short delta-neutral trade.',
  'Staking Pool': 'Stake {DEP} in the staking pool and hold the receipt token.',
  'Liquidity Manager': 'Deposit {DEP} into the concentrated-liquidity vault in the active price range.',
  'Synthetics': 'Mint {DEP} of synthetic assets against staked collateral and hold the synths.',
  'Options': 'Deposit {DEP} into the options vault that sells covered calls each week.',
  'Options Vault': 'Deposit {DEP} into the options vault that sells covered calls each week.',
  'Insurance': 'Deposit {DEP} into the cover pool as underwriting capital for the active cover policies.',
  'Prediction Market': 'Provide {DEP} as liquidity to the prediction market\u2019s largest open market.',
  'Indexes': 'Buy {DEP} of the index token that tracks the protocol\u2019s basket.',
  'Stablecoin Issuer': 'Mint {DEP} of the stablecoin against collateral and hold it in the protocol\u2019s savings module.',
  'Algo-Stables': 'Mint {DEP} of the algorithmic stablecoin and hold it in the protocol\u2019s savings module.',
  'Stablecoin Wrapper': 'Wrap {DEP} of stablecoins through the protocol and hold the wrapped receipt.',
  'Dual-Token Stablecoin': 'Mint {DEP} of the dual-token stablecoin and hold it in the protocol\u2019s savings module.',
  'Payments': 'Fund a {DEP} payment channel balance and route volume through the protocol for a week.',
  'Restaked BTC': 'Deposit {DEP} of wrapped BTC into the BTC restaking vault.',
  'Anchor BTC': 'Deposit {DEP} of wrapped BTC into the BTC staking vault.',
  'Decentralized BTC': 'Deposit {DEP} of wrapped BTC into the BTC staking vault.',
  'Risk Curators': 'Deposit {DEP} into the curated vault with the lowest historical drawdown.',
  'Onchain Capital Allocator': 'Allocate {DEP} to the allocator\u2019s top strategy vault.',
  'Interest Rate Derivatives': 'Deposit {DEP} into the rate vault and hold the fixed-rate receipt.',
  'Token Locker': 'Lock {DEP} of tokens in the locker for the longest advertised term.',
  'Governance Incentives': 'Lock {DEP} of governance tokens for voting power and vote on the next two proposals.',
  'AI Agents': 'Stake {DEP} in the agent registry to back the top-ranked agent.',
  'Decentralized AI': 'Stake {DEP} in the network\u2019s compute pool to back the top-ranked model.',
  'Privacy': 'Deposit {DEP} into the privacy pool and hold the shielded balance.',
  'CeDeFi': 'Deposit {DEP} into the CeDeFi vault that runs centralized-exchange basis strategies.',
  'CEX': 'Hold {DEP} in the exchange\u2019s earn product for the 30-day flexible term.',
  'Chain': 'Stake {DEP} with a validator on the chain and hold the staking receipt.',
  'Collateral Markets': 'Deposit {DEP} of collateral into the protocol\u2019s collateral market.',
  'Collateral Management': 'Deposit {DEP} of collateral into the protocol\u2019s collateral vault.',
  'OTC Marketplace': 'Place a {DEP} OTC order through the protocol\u2019s desk and settle on-chain.',
  'Crypto Card Issuer': 'Load {DEP} onto the protocol\u2019s card and spend through it to reach the cashback tier.',
  'NFT Marketplace': 'Provide {DEP} as liquidity to the marketplace\u2019s collection offers.',
  'Reserve Currency': 'Bond {DEP} into the reserve treasury for the discounted bond rate.',
  'DOR': 'Deposit {DEP} into the protocol\u2019s DOR vault and hold the receipt token.',
};

function categoryAction(category: string, deposit: number): string {
  const template = CATEGORY_ACTIONS[category]
    ?? 'Deposit {DEP} into the protocol\u2019s core position and hold the receipt token.';
  return template.replaceAll('{DEP}', fmtUsd(deposit));
}

interface FarmPlanInput {
  name: string;
  category: string;
  chain: string;
  multiple: number;
  impliedUsd: number;
}

function farmSteps(input: FarmPlanInput): string[] {
  const { deposit, tier } = depositTier(input.impliedUsd);
  const gas = gasUsd(input.chain);
  const fee = Math.max(1, Math.round(deposit * 0.001));
  const gross = Math.round(deposit * (input.multiple - 1));
  const net = gross - gas - fee;
  const dep = fmtUsd(deposit);
  const action = categoryAction(input.category, deposit);
  let verdict: string;
  if (net > 0) verdict = 'Positive expectancy — worth farming at this size.';
  else if (input.multiple >= 1) verdict = 'Thin margin — only proceed if you already use this protocol.';
  else verdict = 'Negative expectancy at this multiple — skip unless the points alone justify it.';
  return [
    `Fund a fresh wallet with ${dep} plus ${fmtUsd(gas + fee)} for gas and fees on ${input.chain}. Use a new address that has never interacted with ${input.name}, and keep the seed phrase offline.`,
    `${action} Do it in one transaction and keep the receipt or position token in the same fresh wallet.`,
    `Hold the position without adding funds, so the cost basis stays exactly ${dep} (tier ${tier}). Check the position once a day and record the TVL and any points balance in a simple log.`,
    `Watch the launch signals: the token contract announcement, the points snapshot date, and the protocol's TVL trend. If 7-day TVL falls more than 30% from entry, cut the position in half.`,
    `Exit when the token lists or the points program snapshots: withdraw the full ${dep} position in one transaction and claim any points or token allocation in the same session.`,
    `Net settlement: at the fitted ${input.multiple.toFixed(4)}x multiple the ${dep} deposit implies a gross change of ${fmtUsd(gross)}; after ${fmtUsd(gas)} gas and ${fmtUsd(fee)} fees the net expected value is ${fmtUsd(net)}. ${verdict}`,
  ];
}

interface Proto {
  slug: string;
  name: string;
  category: string;
  chain: string;
  tvl: number;
  change7d: number;
  mcap: number | null;
  ageDays: number;
}

export function buildBoard(snapshot: Snapshot): BuildResult {
  const asOf = snapshot.as_of;
  const floorUsd = snapshot.floor_usd ?? 50_000_000;

  const protos: Proto[] = snapshot.protocols.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chain: (p.chains && p.chains[0]) || 'Unknown',
    tvl: p.tvl_usd,
    change7d: p.change_7d ?? 0,
    mcap: p.mcap_usd,
    ageDays: ageDays(p.listed_at, asOf),
  }));

  // Launched control group: mcap >= $1M and a positive TVL.
  const control = protos.filter((p) => p.mcap != null && p.mcap >= CONTROL_MCAP_MIN && p.tvl > 0);
  const controlXy: Xy[] = control.map((p) => ({ x: Math.log10(p.tvl), y: Math.log10(p.mcap as number) }));

  const globalFit = fitQuadratic(controlXy, 'Global');
  if (!globalFit) throw new Error('global curve fit failed: control group too small');

  // Per-category fits where the category has >= 5 launched samples.
  const byCategory = new Map<string, Xy[]>();
  for (const p of control) {
    const arr = byCategory.get(p.category) ?? [];
    arr.push({ x: Math.log10(p.tvl), y: Math.log10(p.mcap as number) });
    byCategory.set(p.category, arr);
  }
  const categoryFits = new Map<string, Fit>();
  for (const [cat, pts] of byCategory) {
    if (pts.length >= CATEGORY_MIN_SAMPLES) {
      const f = fitQuadratic(pts, cat);
      if (f) categoryFits.set(cat, f);
    }
  }

  // Price every protocol.
  interface Priced extends Proto {
    multiple: number;
    implied: number;
    fitSource: 'category' | 'global';
    fitCurve: string;
  }
  const priced: Priced[] = protos.map((p) => {
    const fit = categoryFits.get(p.category) ?? globalFit;
    const x = Math.log10(p.tvl);
    const yhat = predictLogMcap(fit, x);
    const raw = 10 ** (yhat - x);
    const multiple = clamp(round4(raw), MULTIPLE_MIN, MULTIPLE_MAX);
    const momentum = 1 + (clamp(p.change7d, -60, 120) / 100) * 0.5;
    const ageFactor = 0.6 + (Math.min(p.ageDays, AGE_CAP_DAYS) / AGE_CAP_DAYS) * 0.4;
    const implied = Math.round(p.tvl * multiple * momentum * ageFactor);
    return {
      ...p,
      multiple,
      implied,
      fitSource: categoryFits.has(p.category) ? 'category' : 'global',
      fitCurve: categoryFits.has(p.category) ? p.category : 'Global',
    };
  });

  // 5-fold out-of-sample validation, folds by FNV-1a(slug) % 5.
  const foldApes: number[][] = [[], [], [], [], []];
  for (let fold = 0; fold < 5; fold++) {
    const train = control.filter((p) => fnv1a(p.slug) % 5 !== fold);
    const valid = control.filter((p) => fnv1a(p.slug) % 5 === fold);
    const trainXy: Xy[] = train.map((p) => ({ x: Math.log10(p.tvl), y: Math.log10(p.mcap as number) }));
    const gFit = fitQuadratic(trainXy, 'Global');
    if (!gFit) continue;
    const trainByCat = new Map<string, Xy[]>();
    for (const p of train) {
      const arr = trainByCat.get(p.category) ?? [];
      arr.push({ x: Math.log10(p.tvl), y: Math.log10(p.mcap as number) });
      trainByCat.set(p.category, arr);
    }
    const trainCatFits = new Map<string, Fit>();
    for (const [cat, pts] of trainByCat) {
      if (pts.length >= CATEGORY_MIN_SAMPLES) {
        const f = fitQuadratic(pts, cat);
        if (f) trainCatFits.set(cat, f);
      }
    }
    for (const p of valid) {
      const fit = trainCatFits.get(p.category) ?? gFit;
      const pred = 10 ** predictLogMcap(fit, Math.log10(p.tvl));
      const actual = p.mcap as number;
      foldApes[fold].push(Math.abs(pred - actual) / actual);
    }
  }
  const folds: FoldResult[] = foldApes.map((apes, fold) => {
    const within = apes.filter((a) => a <= 0.25).length;
    return {
      fold,
      n: apes.length,
      medianApePct: apes.length ? median(apes) * 100 : 0,
      within25Pct: apes.length ? (within / apes.length) * 100 : 0,
    };
  });
  const allApes = foldApes.flat();
  const overallWithin = allApes.filter((a) => a <= 0.25).length;
  const validation: Validation = {
    folds,
    overall: {
      n: allApes.length,
      medianApePct: allApes.length ? median(allApes) * 100 : 0,
      within25Pct: allApes.length ? (overallWithin / allApes.length) * 100 : 0,
    },
    method: '5-fold out-of-sample: fold = FNV-1a(slug) % 5. Each fold is predicted by curves refit on the other 4 folds (per-category curves where the train fold holds >= 5 samples, else the global train curve). Error is |predicted mcap - actual mcap| / actual mcap.',
  };

  // Board: the 40 watchlist protocols, then the top 160 non-watchlist
  // protocols with TVL >= floor by implied value. The published board is
  // sorted by implied value descending (gate requirement), rank 1..200.
  const watchSet = new Set(snapshot.watchlist);
  const watchRows = priced.filter((p) => watchSet.has(p.slug));
  const earlyPool = priced
    .filter((p) => !watchSet.has(p.slug) && p.tvl >= floorUsd)
    .sort((a, b) => b.implied - a.implied || b.tvl - a.tvl || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_SIZE);
  const selected = [...watchRows, ...earlyPool].sort(
    (a, b) => b.implied - a.implied || b.tvl - a.tvl || (a.slug < b.slug ? -1 : 1),
  );
  const rows: BoardRow[] = selected.map((p, i) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chain: p.chain,
    tvl_usd: p.tvl,
    mcap_usd: p.mcap,
    implied_value_usd: p.implied,
    multiple: p.multiple,
    change_7d: p.change7d,
    age_days: p.ageDays,
    rank: i + 1,
    watchlist: watchSet.has(p.slug),
    fit_source: p.fitSource,
    fit_curve: p.fitCurve,
    farm_steps: farmSteps({
      name: p.name,
      category: p.category,
      chain: p.chain,
      multiple: p.multiple,
      impliedUsd: p.implied,
    }),
  }));

  // Curve-view data: the launched control group as scatter points.
  const points: CurvePoint[] = control.map((p) => ({
    x: round4(Math.log10(p.tvl)),
    y: round4(Math.log10(p.mcap as number)),
    category: p.category,
    slug: p.slug,
    name: p.name,
  }));

  // Fit table: global first, then categories by sample size.
  const fits: Fit[] = [
    globalFit,
    ...[...categoryFits.values()].sort((a, b) => b.n - a.n),
  ];

  const multiples = rows.map((r) => r.multiple);
  const kpis: Kpis = {
    medianMultiple: median(multiples),
    oosMedianApePct: validation.overall.medianApePct,
    oosWithin25Pct: validation.overall.within25Pct,
    watchlistCovered: watchRows.length,
    watchlistTotal: snapshot.watchlist.length,
    topName: rows[0]?.name ?? '',
    topImpliedUsd: rows[0]?.implied_value_usd ?? 0,
    globalR2: globalFit.r2,
    controlN: control.length,
  };

  return {
    rows,
    validation,
    fits,
    points,
    kpis,
    meta: {
      model: 'radar-3',
      asOf,
      source: snapshot.source,
      floorUsd,
      protocols: protos.length,
      controlN: control.length,
      categoriesFitted: categoryFits.size,
      builtAt: asOf, // fixed to the snapshot date: wall-clock time would make two runs differ
    },
  };
}
