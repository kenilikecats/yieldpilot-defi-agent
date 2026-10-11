/* =========================================================================
   YieldPilot Engine — risk modeling, forecasting, optimization, VaR,
   walk-forward backtesting and a tabular Q-learning meta-policy.
   Pure functions over the snapshot; no DOM access here.
   ========================================================================= */
const Engine = (() => {
  // ---------- Protocol knowledge base (smart-contract / governance risk) ----------
  const PROTOCOLS = {
    'aave-v3':        { name: 'Aave V3',        cat: '借貸',       since: 2020, sc: 10, note: '最大借貸協議，多次審計、Safety Module 保障' },
    'compound-v3':    { name: 'Compound V3',    cat: '借貸',       since: 2018, sc: 12, note: '老牌借貸協議，Comet 單一資產市場設計' },
    'lido':           { name: 'Lido',           cat: '流動性質押', since: 2020, sc: 12, note: 'ETH 質押龍頭，節點營運商集中度風險' },
    'rocket-pool':    { name: 'Rocket Pool',    cat: '流動性質押', since: 2021, sc: 15, note: '去中心化節點營運，rETH 流動性略低' },
    'sky-lending':    { name: 'Sky (Maker)',    cat: 'CDP/儲蓄',   since: 2017, sc: 15, note: '原 MakerDAO，sUSDS 儲蓄利率由治理決定' },
    'sparklend':      { name: 'SparkLend',      cat: '借貸',       since: 2023, sc: 18, note: 'Aave V3 分叉，Sky 生態' },
    'uniswap-v3':     { name: 'Uniswap V3',     cat: 'DEX / LP',   since: 2021, sc: 15, note: '集中流動性 LP，主要風險為無常損失' },
    'curve-dex':      { name: 'Curve',          cat: 'DEX / LP',   since: 2020, sc: 18, note: '穩定幣兌換池，曾發生 Vyper 編譯器漏洞事件' },
    'convex-finance': { name: 'Convex',         cat: '收益聚合',   since: 2021, sc: 28, note: '堆疊在 Curve 之上，多層合約風險與獎勵代幣依賴' },
    'morpho-blue':    { name: 'Morpho',         cat: '借貸金庫',   since: 2024, sc: 22, note: '隔離市場 + Curator 金庫，風險取決於策展人' },
    'fluid-lending':  { name: 'Fluid',          cat: '借貸',       since: 2024, sc: 25, note: 'Instadapp 團隊，較新的流動性層設計' },
    'ethena-usde':    { name: 'Ethena',         cat: '合成美元',   since: 2024, sc: 35, note: 'Delta-neutral 合成美元，資金費率轉負與交易所對手風險' },
    'yearn-finance':  { name: 'Yearn',          cat: '收益聚合',   since: 2020, sc: 25, note: '自動化策略金庫，策略層合約風險' },
    'pendle-v2':      { name: 'Pendle',         cat: '收益代幣化', since: 2021, sc: 30, note: 'PT/YT 收益拆分，到期與流動性風險' },
    'gmx-v2-perps':   { name: 'GMX V2',         cat: '永續 LP',    since: 2023, sc: 30, note: 'GM 池為交易者對手方，承擔交易者盈虧' },
  };
  const proto = (p) => PROTOCOLS[p.project] || { name: p.project, cat: '其他', since: 2024, sc: 35, note: '未收錄協議，採保守預設' };

  const STABLE = new Set(['USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','DOLA','CRVUSD','FRAX','GHO','SGHO','USD₮0','PYUSD','RLUSD','APYUSD','USDG','SPARKUSDC','GTUSDCP']);
  const SYNTHETIC = new Set(['USDE','SUSDE','DOLA','CRVUSD','FRAX','APYUSD']);
  const ETHS = new Set(['ETH','WETH','STETH','WSTETH','RETH','WEETH','OETH','FRXETH']);
  const IL_K = 2.5; // concentrated-liquidity IL amplification vs full-range
  const BTCS = new Set(['WBTC','CBBTC','WBTC.B','BTC','TBTC']);

  // ---------- Snapshot preparation ----------
  let S = null; // prepared state

  function prepare(snapshot) {
    const dates = snapshot.prices.ETH.map(d => d[0]);
    const idx = new Map(dates.map((d, i) => [d, i]));
    const px = {};
    for (const k of ['ETH', 'BTC']) {
      const m = new Map(snapshot.prices[k]);
      let last = null;
      px[k] = dates.map(d => (m.has(d) ? (last = m.get(d)) : last));
    }
    const pools = snapshot.pools.map((p, i) => {
      const apy = new Array(dates.length).fill(null), tvl = new Array(dates.length).fill(null);
      for (const [d, a, t] of p.history) if (idx.has(d)) { apy[idx.get(d)] = a; tvl[idx.get(d)] = t; }
      let la = null, lt = null, first = -1;
      for (let t = 0; t < dates.length; t++) {
        if (apy[t] !== null) { la = apy[t]; lt = tvl[t]; if (first < 0) first = t; }
        else if (la !== null) { apy[t] = la; tvl[t] = lt; }
      }
      const q = { ...p, id: i, apyS: apy, tvlS: tvl, first, proto: proto(p) };
      q.expo = exposure(q);
      q.label = `${q.proto.name} · ${q.symbol}${q.poolMeta ? ' ' + q.poolMeta : ''}`;
      q.isStable = q.expo.stable === 1;
      const mm = (q.poolMeta || '').match(/(\d{2})([A-Z]{3})(\d{4})/);
      if (mm) q.maturity = new Date(`${mm[1]} ${mm[2]} ${mm[3]} UTC`);
      return q;
    });
    S = { dates, px, pools, generatedAt: snapshot.generatedAt, T: dates.length - 1 };
    for (const p of pools) p.ret = dailyReturns(p);
    return S;
  }

  function exposure(p) {
    const parts = p.symbol.toUpperCase().split('-');
    const e = { ETH: 0, BTC: 0, ALT: 0, stable: 0, lpCP: false, synthetic: false };
    const classes = new Set();
    for (const t of parts) {
      const w = 1 / parts.length;
      if (STABLE.has(t) || (p.stablecoin && !ETHS.has(t) && !BTCS.has(t))) { e.stable += w; classes.add('S'); if (SYNTHETIC.has(t)) e.synthetic = true; }
      else if (ETHS.has(t)) { e.ETH += w; classes.add('E'); }
      else if (BTCS.has(t)) { e.BTC += w; classes.add('B'); }
      else { e.ALT += w; classes.add('A'); }
    }
    // constant-product impermanent loss only for AMM LPs pairing two different asset classes
    e.lpCP = p.project.startsWith('uniswap') && classes.size > 1;
    return e;
  }

  function assetRet(k, t) {
    if (t <= 0) return 0;
    if (k === 'ALT') return 1.5 * (S.px.ETH[t] / S.px.ETH[t - 1] - 1);
    return S.px[k][t] / S.px[k][t - 1] - 1;
  }

  // daily total return (yield + price + IL approximation) for a pool
  function dailyReturns(p) {
    const r = new Array(S.dates.length).fill(null);
    for (let t = Math.max(1, p.first + 1); t < S.dates.length; t++) {
      const y = (p.apyS[t - 1] || 0) / 100 / 365;
      const e = p.expo;
      let pr;
      const lin = e.ETH * assetRet('ETH', t) + e.BTC * assetRet('BTC', t) + e.ALT * assetRet('ALT', t);
      if (e.lpCP) { // 50/50 constant-product value ∝ Π P_i^{w_i}; V3 concentration amplifies IL (×IL_K)
        const cp = Math.pow(1 + assetRet('ETH', t), e.ETH) * Math.pow(1 + assetRet('BTC', t), e.BTC) * Math.pow(1 + assetRet('ALT', t), e.ALT) - 1;
        pr = lin + IL_K * (cp - lin);
      } else pr = lin;
      r[t] = y + pr;
    }
    return r;
  }

  // ---------- Statistics helpers ----------
  const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
  const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
  const window = (arr, t, n) => arr.slice(Math.max(0, t - n + 1), t + 1).filter(x => x !== null && x !== undefined);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const available = (p, t, minDays = 60) => p.first >= 0 && t - p.first >= minDays;
  const daysToMaturity = (p, t) => p.maturity ? (p.maturity - new Date(S.dates[t] + 'T00:00:00Z')) / 864e5 : Infinity;

  // ---------- Risk model ----------
  function riskScore(p, t = S.T) {
    const a90 = window(p.apyS, t, 90);
    const cv = a90.length > 5 ? std(a90) / Math.max(0.5, mean(a90)) : 1;
    const tvl = p.tvlS[t] || p.tvlUsd || 1e6;
    const tvl30 = p.tvlS[Math.max(p.first, t - 30)] || tvl;
    const r90 = window(p.ret, t, 90);
    const annVol = r90.length > 10 ? std(r90) * Math.sqrt(365) : 0.5;
    const rewardShare = p.apy ? clamp((p.apyReward || 0) / p.apy, 0, 1) : 0;
    const parts = {
      合約風險: p.proto.sc / 40 * 100,
      收益波動: clamp(cv * 100, 0, 100),
      流動性: clamp((10 - Math.log10(tvl)) * 25, 0, 100),
      TVL流失: clamp(Math.max(0, -(tvl / tvl30 - 1)) * 250, 0, 100),
      無常損失: p.expo.lpCP ? 70 : 0,
      獎勵依賴: rewardShare * 100,
      價格波動: clamp(annVol / 0.8 * 100, 0, 100),
      脫鉤風險: p.expo.synthetic ? 60 : 0,
    };
    const W = { 合約風險: .30, 收益波動: .14, 流動性: .12, TVL流失: .05, 無常損失: .10, 獎勵依賴: .06, 價格波動: .16, 脫鉤風險: .07 };
    const score = Object.keys(W).reduce((s, k) => s + W[k] * parts[k], 0);
    return { score, parts, annVol, grade: score < 18 ? 'A' : score < 28 ? 'B' : score < 40 ? 'C' : score < 55 ? 'D' : 'E' };
  }

  // ---------- Time-series forecast: damped Holt linear trend ----------
  function forecast(p, t = S.T, h = 30) {
    const y = window(p.apyS, t, 120);
    if (y.length < 10) return { mean: p.apyS[t] || 0, path: [], lo: [], hi: [], resid: 0 };
    const alpha = 0.25, beta = 0.05, phi = 0.9;
    let L = y[0], B = 0; const res = [];
    for (let i = 1; i < y.length; i++) {
      const f = L + phi * B; res.push(y[i] - f);
      const Ln = alpha * y[i] + (1 - alpha) * (L + phi * B);
      B = beta * (Ln - L) + (1 - beta) * phi * B; L = Ln;
    }
    const sd = std(res.slice(-60));
    const path = [], lo = [], hi = [];
    let damp = 0;
    for (let k = 1; k <= h; k++) {
      damp += Math.pow(phi, k);
      const v = Math.max(0, L + damp * B);
      path.push(v); lo.push(Math.max(0, v - 1.96 * sd * Math.sqrt(k))); hi.push(v + 1.96 * sd * Math.sqrt(k));
    }
    // shrink toward 90d mean to stabilise noisy reward-driven APYs
    const w30 = window(p.apyS, t, 30).sort((a, b) => a - b);
    const med30 = w30[Math.floor(w30.length / 2)];
    const raw = 0.6 * mean(path) + 0.4 * med30;
    // uncertainty haircut: noisy (fee/reward-driven) yields are discounted by half a residual s.d.
    const fm = Math.max(0, Math.min(raw - 0.5 * sd, raw));
    return { mean: fm, raw, path, lo, hi, resid: sd, trend: B };
  }

  // ---------- Portfolio optimizer: projected gradient on a capped simplex ----------
  const PROFILES = {
    conservative: { key: 'conservative', name: '保守型', lambda: 12, gamma: 0.06, cap: 0.30, maxScore: 36, minStable: 0.65 },
    balanced:     { key: 'balanced',     name: '平衡型', lambda: 6,  gamma: 0.03, cap: 0.35, maxScore: 50, minStable: 0.40 },
    aggressive:   { key: 'aggressive',   name: '積極型', lambda: 1.5, gamma: 0.012, cap: 0.45, maxScore: 70, minStable: 0.0 },
  };

  function projectCapped(v, cap) {
    let lo = Math.min(...v) - cap, hi = Math.max(...v);
    for (let it = 0; it < 60; it++) {
      const tau = (lo + hi) / 2;
      const s = v.reduce((acc, x) => acc + clamp(x - tau, 0, cap), 0);
      if (s > 1) lo = tau; else hi = tau;
    }
    const tau = (lo + hi) / 2;
    return v.map(x => clamp(x - tau, 0, cap));
  }

  function covariance(cands, t, n = 120) {
    const from = Math.max(1, t - n + 1);
    const R = cands.map(p => { const out = []; for (let k = from; k <= t; k++) out.push(p.ret[k] ?? 0); return out; });
    const m = R.map(mean);
    const C = cands.map(() => new Array(cands.length).fill(0));
    for (let i = 0; i < cands.length; i++) for (let j = i; j < cands.length; j++) {
      let s = 0; for (let k = 0; k < R[i].length; k++) s += (R[i][k] - m[i]) * (R[j][k] - m[j]);
      C[i][j] = C[j][i] = s / Math.max(1, R[i].length - 1) * 365;
    }
    return C;
  }

  function candidates(t, opt = {}) {
    const prof = PROFILES[opt.profile || 'balanced'];
    return S.pools.filter(p => available(p, t) && (p.apyS[t] || 0) > 0.1
      && daysToMaturity(p, t) > 45
      && (!opt.stableOnly || p.isStable)
      && (!opt.chains || opt.chains.length === 0 || opt.chains.includes(p.chain))
      && (!opt.exclude || !opt.exclude.includes(p.id))
      && riskScore(p, t).score <= (opt.maxScore ?? prof.maxScore));
  }

  function optimize(t = S.T, opt = {}) {
    const prof = { ...PROFILES[opt.profile || 'balanced'], ...(opt.override || {}) };
    let cands = candidates(t, opt);
    if (cands.length === 0) return { weights: [], cands: [] };
    const fc = cands.map(p => (opt.apyOverride && opt.apyOverride[p.id] !== undefined) ? opt.apyOverride[p.id] : forecast(p, t).mean);
    const mu = fc.map(x => clamp(x / 100, 0, 0.5));
    const risk = cands.map(p => riskScore(p, t).score / 100);
    const C = covariance(cands, t);
    const stable = cands.map(p => p.isStable ? 1 : 0);
    const minStable = opt.stableOnly ? 0 : (stable.some(Boolean) ? prof.minStable : 0);
    const cap = Math.max(prof.cap, 1 / cands.length + 1e-6);
    const n = cands.length;
    let w = projectCapped(new Array(n).fill(1 / n), cap);
    const lr = 0.04, rho = 4;
    for (let it = 0; it < 1200; it++) {
      const g = new Array(n);
      const sw = w.reduce((s, x, i) => s + x * stable[i], 0);
      const short = Math.max(0, minStable - sw);
      for (let i = 0; i < n; i++) {
        let cw = 0; for (let j = 0; j < n; j++) cw += C[i][j] * w[j];
        g[i] = mu[i] - prof.lambda * cw - prof.gamma * risk[i] + 2 * rho * short * stable[i];
      }
      w = projectCapped(w.map((x, i) => x + lr * g[i]), cap);
    }
    // prune dust & keep at most 7 positions
    let pairs = w.map((x, i) => [x, i]).filter(([x]) => x >= 0.03).sort((a, b) => b[0] - a[0]).slice(0, 7);
    const tot = pairs.reduce((s, [x]) => s + x, 0) || 1;
    const weights = pairs.map(([x, i]) => ({ pool: cands[i], w: x / tot, mu: mu[i], risk: risk[i] * 100 }));
    return { weights, cands, profile: prof, ...portfolioStats(weights, t) };
  }

  function portfolioStats(weights, t = S.T) {
    if (!weights.length) return { expApy: 0, vol: 0, riskScore: 0, stableShare: 0 };
    const cands = weights.map(x => x.pool);
    const C = covariance(cands, t);
    let v = 0;
    for (let i = 0; i < weights.length; i++) for (let j = 0; j < weights.length; j++) v += weights[i].w * weights[j].w * C[i][j];
    return {
      expApy: weights.reduce((s, x) => s + x.w * x.mu, 0) * 100,
      vol: Math.sqrt(Math.max(0, v)),
      riskScore: weights.reduce((s, x) => s + x.w * x.risk, 0),
      stableShare: weights.reduce((s, x) => s + (x.pool.isStable ? x.w : 0), 0),
    };
  }

  // ---------- Value-at-Risk & stress tests ----------
  function portfolioReturnSeries(weights, t = S.T, n = 365) {
    const out = [];
    for (let k = Math.max(1, t - n + 1); k <= t; k++) {
      let r = 0, ws = 0;
      for (const x of weights) if (x.pool.ret[k] !== null) { r += x.w * x.pool.ret[k]; ws += x.w; }
      out.push(ws > 0 ? r / ws : 0);
    }
    return out;
  }

  function valueAtRisk(weights, capital, t = S.T) {
    const r = portfolioReturnSeries(weights, t);
    const r30 = [];
    for (let i = 0; i + 30 <= r.length; i++) r30.push(r.slice(i, i + 30).reduce((p, x) => p * (1 + x), 1) - 1);
    const v1 = Math.max(0, -quantile(r, 0.05)), v30 = Math.max(0, -quantile(r30, 0.05));
    const tail = r30.filter(x => x <= -v30);
    const cvar30 = Math.max(0, tail.length ? -mean(tail) : v30);
    const sig = std(r), mu = mean(r);
    return {
      var1: v1, var30: v30, cvar30, paramVar30: 1.645 * sig * Math.sqrt(30) - mu * 30,
      var1Usd: v1 * capital, var30Usd: v30 * capital, cvar30Usd: cvar30 * capital,
      worstDay: Math.min(...r), dist: r30,
    };
  }

  function stressTests(weights, capital) {
    const shock = (x, s) => {
      const e = x.pool.expo;
      const m = { ETH: 1 + s.ETH, BTC: 1 + s.BTC, ALT: 1 + s.ALT };
      let pr = e.lpCP ? Math.pow(m.ETH, e.ETH) * Math.pow(m.BTC, e.BTC) * Math.pow(m.ALT, e.ALT) - 1
        : e.ETH * s.ETH + e.BTC * s.BTC + e.ALT * s.ALT;
      if (e.synthetic) pr += e.stable * s.depeg;
      return pr;
    };
    const largest = [...weights].sort((a, b) => b.w - a.w)[0];
    const sc = [
      { name: 'ETH 暴跌 30%（BTC −25%）', s: { ETH: -0.30, BTC: -0.25, ALT: -0.45, depeg: 0 } },
      { name: '加密寒冬：ETH −55%、BTC −45%', s: { ETH: -0.55, BTC: -0.45, ALT: -0.75, depeg: -0.03 } },
      { name: '合成穩定幣脫鉤 −10%（USDe/DOLA 類）', s: { ETH: -0.05, BTC: -0.04, ALT: -0.1, depeg: -0.10 } },
    ].map(c => ({ name: c.name, loss: weights.reduce((s, x) => s + x.w * shock(x, c.s), 0) }));
    if (largest) sc.push({ name: `最大部位遭駭（${largest.pool.proto.name}，損失 50%）`, loss: -0.5 * largest.w });
    sc.push({ name: '全部收益率腰斬（持有 1 年的收入損失）', loss: -weights.reduce((s, x) => s + x.w * x.mu, 0) / 2 });
    return sc.map(x => ({ ...x, usd: x.loss * capital }));
  }

  // ---------- Walk-forward backtest (no look-ahead) ----------
  function backtest(opt = {}) {
    const start = opt.start ?? 120, end = opt.end ?? S.T, every = opt.every ?? 7;
    const costRate = opt.costRate ?? 0.001; // 0.1% of turnover (slippage + gas)
    const strategy = opt.strategy || 'agent';
    let w = new Map(), equity = 1, peak = 1, maxDD = 0, turnoverTot = 0, rebalances = 0;
    const curve = [{ t: start, v: 1 }], daily = [], alloc = [];
    for (let t = start; t < end; t++) {
      if ((t - start) % every === 0) {
        const target = targetWeights(strategy, t, opt);
        let turn = 0;
        const keys = new Set([...w.keys(), ...target.keys()]);
        for (const k of keys) turn += Math.abs((target.get(k) || 0) - (w.get(k) || 0));
        if (turn > 1e-6) { equity *= (1 - costRate * turn / 2); turnoverTot += turn / 2; rebalances++; }
        w = target; alloc.push({ t, w: new Map(target) });
      }
      // next-day return
      let r = 0;
      const nw = new Map();
      for (const [id, x] of w) { const ri = S.pools[id].ret[t + 1] ?? 0; r += x * ri; nw.set(id, x * (1 + ri)); }
      const tot = [...nw.values()].reduce((s, x) => s + x, 0) || 1;
      for (const [k, v] of nw) nw.set(k, v / tot);
      w = nw; equity *= 1 + r; daily.push(r);
      peak = Math.max(peak, equity); maxDD = Math.max(maxDD, 1 - equity / peak);
      curve.push({ t: t + 1, v: equity });
    }
    const days = end - start;
    const ann = Math.pow(equity, 365 / days) - 1;
    const vol = std(daily) * Math.sqrt(365);
    return { strategy, curve, daily, alloc, total: equity - 1, ann, vol, sharpe: vol > 0 ? (ann - 0.04) / vol : 0, maxDD, rebalances, turnover: turnoverTot };
  }

  function targetWeights(strategy, t, opt) {
    const m = new Map();
    if (strategy === 'agent' || PROFILES[strategy]) {
      const res = optimize(t, { ...opt, profile: PROFILES[strategy] ? strategy : opt.profile });
      for (const x of res.weights) m.set(x.pool.id, x.w);
    } else if (strategy === 'stableAgent') {
      const res = optimize(t, { ...opt, profile: 'conservative', stableOnly: true });
      for (const x of res.weights) m.set(x.pool.id, x.w);
    } else if (strategy === 'equal') {
      const c = candidates(t, { ...opt, maxScore: 100 });
      c.forEach(p => m.set(p.id, 1 / c.length));
    } else if (strategy === 'chase') {
      const c = candidates(t, { ...opt, maxScore: 100 });
      const best = c.sort((a, b) => mean(window(b.apyS, t, 7)) - mean(window(a.apyS, t, 7)))[0];
      if (best) m.set(best.id, 1);
    } else if (strategy === 'aaveUsdc') {
      const p = S.pools.find(p => p.project === 'aave-v3' && p.isStable && available(p, t, 0)) || S.pools.find(p => p.isStable);
      m.set(p.id, 1);
    } else if (strategy === 'hodlEth') {
      const p = S.pools.find(p => p.project === 'lido');
      if (p) m.set(p.id, 1);
    }
    return m;
  }

  // ---------- Reinforcement learning: tabular Q-learning meta-policy ----------
  const ACTIONS = ['stableAgent', 'balanced', 'aggressive'];
  const ACTION_NAMES = { stableAgent: '全穩定幣', conservative: '保守', balanced: '平衡', aggressive: '積極' };

  function marketState(t) {
    const e = S.px.ETH;
    const mom = e[t] / e[Math.max(0, t - 30)] - 1;
    const rv = std(window(S.pools.find(p => p.project === 'lido').ret, t, 30)) * Math.sqrt(365);
    const st = S.pools.filter(p => p.isStable && available(p, t, 10)).map(p => p.apyS[t]);
    const rk = S.pools.filter(p => !p.isStable && available(p, t, 10)).map(p => p.apyS[t]);
    const spread = mean(rk) - mean(st);
    const m = mom < -0.08 ? 0 : mom > 0.08 ? 2 : 1;
    const v = rv > 0.6 ? 1 : 0;
    const s = spread > 1.5 ? 1 : 0;
    return { id: m * 4 + v * 2 + s, mom, rv, spread, label: `${['下跌', '盤整', '上漲'][m]}·${v ? '高波動' : '低波動'}·${s ? '利差大' : '利差小'}` };
  }

  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function trainRL(opt = {}, onProgress) {
    const start = 120, every = 7, end = S.T;
    // weekly returns of each action (each a walk-forward strategy)
    const series = {};
    for (const a of ACTIONS) series[a] = backtest({ ...opt, strategy: a, start, end, every });
    const weeks = [];
    for (let t = start, i = 0; t + every <= end; t += every, i++) {
      const wr = {};
      for (const a of ACTIONS) wr[a] = series[a].daily.slice(i * every, i * every + every).reduce((p, x) => p * (1 + x), 1) - 1;
      weeks.push({ t, state: marketState(t), r: wr });
    }
    const split = Math.floor(weeks.length * 0.65);
    const train = weeks.slice(0, split), test = weeks.slice(split);
    const nS = 12, nA = ACTIONS.length;
    const Q = Array.from({ length: nS }, () => new Array(nA).fill(0));
    const N = Array.from({ length: nS }, () => new Array(nA).fill(0));
    const rand = mulberry32(opt.seed ?? 42);
    const episodes = opt.episodes ?? 300, gamma = 0.3, ddPenalty = opt.riskAversion ?? 3;
    const curve = [];
    const reward = (r, prev, a) => r * 100 - ddPenalty * Math.max(0, -r * 100) ** 2 / 5 - (prev !== null && prev !== a ? 0.05 : 0);
    for (let ep = 0; ep < episodes; ep++) {
      const eps = Math.max(0.05, 1 - ep / (episodes * 0.7));
      let prev = null, tot = 0;
      for (let i = 0; i < train.length; i++) {
        const s = train[i].state.id;
        const a = rand() < eps ? Math.floor(rand() * nA) : Q[s].indexOf(Math.max(...Q[s]));
        const rw = reward(train[i].r[ACTIONS[a]], prev, a);
        const s2 = i + 1 < train.length ? train[i + 1].state.id : s;
        N[s][a]++;
        const alpha = Math.max(0.05, 1 / Math.sqrt(N[s][a]));
        Q[s][a] += alpha * (rw + gamma * Math.max(...Q[s2]) - Q[s][a]);
        tot += rw; prev = a;
      }
      curve.push(tot);
    }
    const policy = Q.map(q => (q.every(x => x === 0) ? 1 : q.indexOf(Math.max(...q))));
    const evalSet = (set, chooser) => {
      let v = 1, peak = 1, dd = 0; const path = [1]; const acts = [];
      for (const w of set) { const a = chooser(w); acts.push(a); v *= 1 + w.r[ACTIONS[a]]; peak = Math.max(peak, v); dd = Math.max(dd, 1 - v / peak); path.push(v); }
      return { total: v - 1, maxDD: dd, path, acts };
    };
    const results = { rl: evalSet(test, w => policy[w.state.id]) };
    ACTIONS.forEach((a, i) => { results[a] = evalSet(test, () => i); });
    return { Q, N, policy, curve, weeks, train, test, results, split };
  }

  // ---------- Natural-language intent parsing (fallback when no LLM key) ----------
  function parseIntent(text, defaults) {
    const o = { ...defaults };
    const s = text.replace(/,/g, '');
    const m = s.match(/(\d+(?:\.\d+)?)\s*(萬|万|k|K|千|m|M|百萬|億)?\s*(美元|美金|USD|USDT|USDC|U|塊|元)?/);
    if (m && (m[2] || m[3] || +m[1] >= 100)) {
      const mult = { 萬: 1e4, 万: 1e4, k: 1e3, K: 1e3, 千: 1e3, m: 1e6, M: 1e6, 百萬: 1e6, 億: 1e8 }[m[2]] || 1;
      o.capital = +m[1] * mult;
    }
    if (/保守|穩健|低風險|安全|不想虧|退休/.test(s)) o.profile = 'conservative';
    else if (/積極|激進|高風險|高報酬|衝|梭哈|aggressive/i.test(s)) o.profile = 'aggressive';
    else if (/平衡|中等|適中|balanced/i.test(s)) o.profile = 'balanced';
    if (/只.*穩定幣|穩定幣.*就好|stable ?only|不要.*(ETH|波動|幣價)/i.test(s)) o.stableOnly = true;
    const chains = ['Ethereum', 'Arbitrum', 'Base'].filter(c => new RegExp(c, 'i').test(s) || (c === 'Ethereum' && /以太坊|主網/.test(s)));
    if (chains.length) o.chains = chains;
    const h = s.match(/(\d+)\s*(個月|月|年|天|週|周)/);
    if (h) o.horizonDays = +h[1] * ({ 個月: 30, 月: 30, 年: 365, 天: 1, 週: 7, 周: 7 }[h[2]]);
    return o;
  }

  return {
    prepare, get S() { return S; }, PROTOCOLS, PROFILES, ACTIONS, ACTION_NAMES,
    riskScore, forecast, optimize, portfolioStats, valueAtRisk, stressTests, backtest, trainRL,
    marketState, parseIntent, candidates, daysToMaturity, mean, std, window,
  };
})();
