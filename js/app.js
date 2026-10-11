/* =========================================================================
   YieldPilot UI — pages, charts, agent orchestration, live sync, monitor.
   ========================================================================= */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (x, d = 0) => (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const usdShort = x => x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(1) + 'K' : '$' + x.toFixed(0);
  const pct = (x, d = 2) => (x * 100).toFixed(d) + '%';
  const apyF = (x, d = 2) => (+x).toFixed(d) + '%';
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const PALETTE = ['#c9845a', '#7fa37f', '#6f8fb8', '#b98bb0', '#d4b06a', '#5fa6a0', '#c97b7b', '#8f8a6a', '#9a7fc4', '#a3a3a3'];
  const PROTO_COLOR = { 'aave-v3': '#8a6bbd', 'compound-v3': '#3e9b7a', 'lido': '#5d8fd6', 'rocket-pool': '#d9773b', 'sky-lending': '#3fa58a', 'sparklend': '#d98e3b', 'uniswap-v3': '#d4508a', 'curve-dex': '#7a7ac9', 'convex-finance': '#5a6fb8', 'morpho-blue': '#4b6fd1', 'fluid-lending': '#3b8fd9', 'ethena-usde': '#6b6b6b', 'yearn-finance': '#3b6fd9', 'pendle-v2': '#3bb1a5', 'gmx-v2-perps': '#3b5fd9' };
  const pIcon = p => `<div class="p-icon" style="background:${PROTO_COLOR[p.project] || '#888'}">${esc(p.proto.name.slice(0, 2).toUpperCase())}</div>`;
  const poolCell = p => `<div class="pool-cell">${pIcon(p)}<div><div class="p-name">${esc(p.proto.name)} · ${esc(p.symbol)}</div><div class="p-sub">${esc(p.chain)} · ${esc(p.proto.cat)}${p.poolMeta ? ' · ' + esc(p.poolMeta.slice(0, 26)) : ''}</div></div></div>`;
  const gradeTag = r => `<span class="grade ${r.grade}">${r.grade}</span>`;
  const ICON = {
    vault: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2.5 0 00-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.9 2.5 2-1.1 2-2.5 2a2.5 2.5 0 01-2.5-1.5M12 6v1.5M12 16.5V18"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  };
  const statCard = (icon, label, value, change = '', cls = '', primary = false) =>
    `<div class="stat-card${primary ? ' primary' : ''}"><div class="stat-icon">${ICON[icon]}</div><div class="stat-content"><div class="stat-label">${label}</div><div class="stat-value num">${value}</div><div class="stat-change ${cls}">${change}</div></div></div>`;

  let BASE = null;        // pristine snapshot (possibly live-updated)
  let MARKET = null;      // snapshot currently fed to the engine (may contain shocks)
  let S = null;
  let shocked = false;
  const charts = {};
  const state = { page: 'overview', agent: null, bt: null, rl: null, monitor: null, live: false };

  // ---------------- Toast ----------------
  let toastT;
  function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

  // ---------------- Charts ----------------
  function chart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const ctx = document.getElementById(id);
    if (!ctx || !window.Chart) return null;
    const grid = css('--grid'), txt = css('--text-secondary');
    Chart.defaults.font.family = "'Instrument Sans','Noto Sans TC',sans-serif";
    Chart.defaults.color = txt;
    cfg.options = cfg.options || {};
    cfg.options.responsive = true; cfg.options.maintainAspectRatio = false;
    cfg.options.animation = { duration: 500 };
    const sc = cfg.options.scales || {};
    for (const k of Object.keys(sc)) { sc[k].grid = { color: grid, ...(sc[k].grid || {}) }; sc[k].border = { display: false }; sc[k].ticks = { color: txt, ...(sc[k].ticks || {}) }; }
    cfg.options.plugins = cfg.options.plugins || {};
    cfg.options.plugins.legend = { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: txt }, ...(cfg.options.plugins.legend || {}) };
    cfg.options.plugins.tooltip = { backgroundColor: css('--bg-secondary'), titleColor: css('--text-primary'), bodyColor: txt, borderColor: css('--border'), borderWidth: 1, padding: 10, ...(cfg.options.plugins.tooltip || {}) };
    charts[id] = new Chart(ctx, cfg);
    return charts[id];
  }
  const shortDate = d => d.slice(5).replace('-', '/');

  // ---------------- Data ----------------
  async function loadSnapshot() {
    const r = await fetch('data/snapshot.json', { cache: 'no-cache' });
    BASE = await r.json();
    setMarket(structuredClone(BASE));
  }
  function setMarket(snap) {
    MARKET = snap; S = Engine.prepare(snap);
    const d = new Date(snap.generatedAt);
    $('#dataStamp').innerHTML = `${shocked ? '<span class="warn">⚠ 模擬衝擊情境中</span><br>' : ''}資料時間：${d.toLocaleString('zh-TW', { hour12: false })}<br>${state.live ? '來源：DefiLlama 即時同步' : '來源：DefiLlama 每日快照'}`;
  }

  async function liveSync() {
    const btns = $$('[data-sync]');
    $$('[data-live]').forEach(x => { x.className = 'live-dot busy'; });
    $$('[data-sync-label]').forEach(x => { x.textContent = '同步中…'; });
    btns.forEach(b => (b.disabled = true));
    try {
      const [pr, pools] = await Promise.all([
        fetch('https://coins.llama.fi/prices/current/coingecko:ethereum,coingecko:bitcoin').then(r => r.json()),
        fetch('https://yields.llama.fi/pools').then(r => r.json()),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const upd = (arr, row) => { if (arr.length && arr[arr.length - 1][0] === today) arr[arr.length - 1] = row; else if (!arr.length || arr[arr.length - 1][0] < today) arr.push(row); };
      upd(BASE.prices.ETH, [today, pr.coins['coingecko:ethereum'].price]);
      upd(BASE.prices.BTC, [today, pr.coins['coingecko:bitcoin'].price]);
      const byId = new Map(pools.data.map(p => [p.pool, p]));
      let n = 0;
      for (const p of BASE.pools) {
        const l = byId.get(p.pool); if (!l) continue;
        Object.assign(p, { apy: l.apy, apyBase: l.apyBase, apyReward: l.apyReward, tvlUsd: l.tvlUsd, predictions: l.predictions, sigma: l.sigma, apyPct1D: l.apyPct1D, apyPct7D: l.apyPct7D, apyPct30D: l.apyPct30D });
        upd(p.history, [today, +(+l.apy).toFixed(4), Math.round(l.tvlUsd)]);
        n++;
      }
      BASE.generatedAt = new Date().toISOString();
      state.live = true; shocked = false;
      setMarket(structuredClone(BASE));
      state.bt = null; state.rl = null;
      renderPage(state.page);
      if (state.monitor) monitorCheck('即時資料同步完成');
      toast(`✓ 已同步 ${n} 個池子的即時 APY／TVL 與 ETH、BTC 價格`);
      $$('[data-live]').forEach(x => { x.className = 'live-dot on'; });
      $$('[data-sync-label]').forEach(x => { x.textContent = '即時資料 ✓'; });
    } catch (e) {
      console.error(e);
      toast('即時同步失敗，繼續使用每日快照資料');
      $$('[data-live]').forEach(x => { x.className = 'live-dot'; });
      $$('[data-sync-label]').forEach(x => { x.textContent = '同步即時資料'; });
    } finally { btns.forEach(b => (b.disabled = false)); }
  }

  // ---------------- Navigation ----------------
  function go(page) {
    state.page = page;
    $$('.nav-item[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === page));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
    $('#sidebar').classList.remove('active'); $('#overlay').classList.remove('active');
    if (location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
    window.scrollTo({ top: 0 });
    renderPage(page);
  }
  function renderPage(p) {
    ({ overview: renderOverview, agent: renderAgentPage, protocols: renderProtocols, backtest: renderBacktest, rl: renderRL, monitor: renderMonitor, about: () => {} }[p] || (() => {}))();
  }

  // ---------------- Overview ----------------
  let ovRange = 365;
  function renderOverview() {
    const T = S.T;
    const rows = S.pools.map(p => ({ p, r: Engine.riskScore(p), f: Engine.forecast(p) }));
    const tvl = S.pools.reduce((s, p) => s + (p.tvlS[T] || 0), 0);
    const st = S.pools.filter(p => p.isStable).map(p => p.apyS[T]).sort((a, b) => a - b);
    const med = st[Math.floor(st.length / 2)];
    const eth = S.px.ETH[T], eth30 = S.px.ETH[T - 30];
    const best = rows.filter(x => x.r.score < 40).sort((a, b) => b.f.mean / (1 + b.r.score / 30) - a.f.mean / (1 + a.r.score / 30))[0];
    const ms = Engine.marketState(T);
    $('#ovStats').innerHTML =
      statCard('vault', '追蹤池子 TVL 總額', usdShort(tvl), `${S.pools.length} 個收益池 · ${new Set(S.pools.map(p => p.project)).size} 個協議`, '', true) +
      statCard('coin', '穩定幣 APY 中位數', apyF(med), `比美國公債約 4% ${med > 4 ? '高' : '低'} ${Math.abs(med - 4).toFixed(2)}%`) +
      statCard('trend', 'ETH 價格', usd(eth), `30 日 ${eth / eth30 - 1 >= 0 ? '+' : ''}${pct(eth / eth30 - 1, 1)}`, eth >= eth30 ? 'pos' : 'neg') +
      statCard('brain', '市場狀態（RL 特徵）', ms.label.split('·')[0], ms.label, '');
    // APY trend chart
    const pick = [
      S.pools.find(p => p.project === 'aave-v3' && p.symbol === 'USDT'),
      S.pools.find(p => p.project === 'sky-lending'),
      S.pools.find(p => p.project === 'lido'),
      S.pools.find(p => p.project === 'ethena-usde'),
      S.pools.find(p => p.project === 'fluid-lending'),
      S.pools.find(p => p.project === 'compound-v3' && p.symbol === 'USDC'),
    ].filter(Boolean);
    const from = Math.max(0, T - ovRange + 1);
    const ma = (a, i, n = 7) => { const w = a.slice(Math.max(0, i - n + 1), i + 1).filter(x => x !== null); return w.length ? w.reduce((s, x) => s + x, 0) / w.length : null; };
    const series = pick.map(p => S.dates.slice(from).map((_, k) => ma(p.apyS, from + k)));
    const allV = series.flat().filter(v => v !== null).sort((a, b) => a - b);
    const yMax = Math.ceil(allV[Math.floor(allV.length * 0.98)] * 1.15);
    chart('ovApyChart', {
      type: 'line',
      data: { labels: S.dates.slice(from).map(shortDate), datasets: pick.map((p, i) => ({ label: `${p.proto.name} ${p.symbol}`, data: series[i], borderColor: PALETTE[i], backgroundColor: PALETTE[i], borderWidth: 2, pointRadius: 0, tension: .3 })) },
      options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } }, y: { min: 0, max: yMax, ticks: { callback: v => v + '%' } } }, plugins: { tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y?.toFixed(2)}%` } } } },
    });
    chart('ovScatter', {
      type: 'scatter',
      data: { datasets: [
        { label: '穩定幣', data: rows.filter(x => x.p.isStable).map(x => ({ x: x.r.score, y: x.f.mean, p: x.p })), backgroundColor: PALETTE[1], pointRadius: 6, pointHoverRadius: 8 },
        { label: '波動資產', data: rows.filter(x => !x.p.isStable).map(x => ({ x: x.r.score, y: x.f.mean, p: x.p })), backgroundColor: PALETTE[0], pointRadius: 6, pointHoverRadius: 8 },
      ] },
      options: { onClick: (e, els) => { if (els[0]) openPool(charts.ovScatter.data.datasets[els[0].datasetIndex].data[els[0].index].p); },
        scales: { x: { title: { display: true, text: '風險分數 →', color: css('--text-muted') }, min: 0 }, y: { title: { display: true, text: '預測 APY %', color: css('--text-muted') }, ticks: { callback: v => v + '%' } } },
        plugins: { tooltip: { callbacks: { label: c => ` ${c.raw.p.proto.name} ${c.raw.p.symbol}：風險 ${c.raw.x.toFixed(0)}、APY ${c.raw.y.toFixed(2)}%` } } } },
    });
    const radar = rows.map(x => ({ ...x, adj: x.f.mean / (1 + x.r.score / 30) })).sort((a, b) => b.adj - a.adj).slice(0, 8);
    $('#ovRadar').innerHTML = `<thead><tr><th>#</th><th>收益池</th><th class="r">TVL</th><th class="r">目前 APY</th><th class="r">30 日預測</th><th>風險</th><th class="r">風險調整分</th></tr></thead><tbody>` +
      radar.map((x, i) => `<tr class="click" data-pool="${x.p.id}"><td class="num">${i + 1}</td><td>${poolCell(x.p)}</td><td class="r num">${usdShort(x.p.tvlS[T] || 0)}</td><td class="r num">${apyF(x.p.apyS[T])}</td><td class="r num">${apyF(x.f.mean)}</td><td>${gradeTag(x.r)} <span class="note">${x.r.score.toFixed(0)}</span></td><td class="r num"><b>${x.adj.toFixed(2)}</b></td></tr>`).join('') + '</tbody>';
    void best;
  }

  // ---------------- Protocols ----------------
  let protoSort = { k: 'risk', dir: 1 }, protoFilter = 'all';
  function renderProtocols() {
    const T = S.T, q = ($('#protoSearch').value || '').toLowerCase();
    let rows = S.pools.map(p => {
      const r = Engine.riskScore(p), f = Engine.forecast(p);
      const a7 = p.apyS[Math.max(p.first, T - 7)] || 0;
      return { p, r, f, tvl: p.tvlS[T] || 0, apy: p.apyS[T] || 0, d7: (p.apyS[T] || 0) - a7 };
    }).filter(x => (protoFilter === 'all' || (protoFilter === 'stable') === x.p.isStable)
      && (!q || `${x.p.proto.name} ${x.p.symbol} ${x.p.chain} ${x.p.proto.cat}`.toLowerCase().includes(q)));
    const key = { risk: x => x.r.score, tvl: x => x.tvl, apy: x => x.apy, fc: x => x.f.mean, d7: x => x.d7, vol: x => x.r.annVol }[protoSort.k];
    rows.sort((a, b) => (key(a) - key(b)) * protoSort.dir);
    const th = (k, label) => `<th class="sortable r" data-sort="${k}">${label}${protoSort.k === k ? (protoSort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
    const ml = p => { const c = p.predictions?.predictedClass; if (!c) return '<span class="pill mut">—</span>'; return `<span class="pill ${c === 'Down' ? 'neg' : 'pos'}">${c === 'Down' ? '↓ 下降' : '→ 穩定/上升'} ${p.predictions.predictedProbability ? Math.round(p.predictions.predictedProbability) + '%' : ''}</span>`; };
    $('#protoTable').innerHTML = `<thead><tr><th>收益池</th>${th('tvl', 'TVL')}${th('apy', '目前 APY')}${th('fc', '30 日預測')}${th('d7', '7 日變化')}${th('vol', '價格波動')}${th('risk', '風險分數')}<th>ML 趨勢</th></tr></thead><tbody>` +
      rows.map(x => `<tr class="click" data-pool="${x.p.id}"><td>${poolCell(x.p)}</td><td class="r num">${usdShort(x.tvl)}</td><td class="r num">${apyF(x.apy)}</td><td class="r num">${apyF(x.f.mean)}</td><td class="r num ${x.d7 >= 0 ? 'pos' : 'neg'}">${x.d7 >= 0 ? '+' : ''}${x.d7.toFixed(2)}</td><td class="r num">${x.r.annVol < 0.01 ? '—' : pct(x.r.annVol, 0)}</td><td class="r"><span class="bar"><i style="width:${Math.min(100, x.r.score)}%"></i></span><span class="num">${x.r.score.toFixed(0)}</span> ${gradeTag(x.r)}</td><td>${ml(x.p)}</td></tr>`).join('') + '</tbody>';
  }

  function openPool(p) {
    const T = S.T, r = Engine.riskScore(p), f = Engine.forecast(p);
    $('#pmHead').innerHTML = poolCell(p);
    const dtm = Engine.daysToMaturity(p, T);
    $('#pmStats').innerHTML =
      statCard('coin', '目前 APY', apyF(p.apyS[T]), p.apyBase != null ? `基礎 ${apyF(p.apyBase || 0)} + 獎勵 ${apyF(p.apyReward || 0)}` : '') +
      statCard('trend', '30 日預測', apyF(f.mean), `區間 ${apyF(f.lo.at(-1) || 0, 1)} – ${apyF(f.hi.at(-1) || 0, 1)}`) +
      statCard('vault', 'TVL', usdShort(p.tvlS[T] || 0), p.chain) +
      statCard('shield', '風險評級', `${r.grade} · ${r.score.toFixed(0)}`, r.grade <= 'B' ? '低風險' : r.grade === 'C' ? '中等風險' : '高風險', '', true);
    const from = Math.max(p.first, T - 150);
    const hist = S.dates.slice(from, T + 1);
    const fut = f.path.map((_, i) => { const d = new Date(S.dates[T] + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i + 1); return d.toISOString().slice(0, 10); });
    const labels = [...hist, ...fut].map(shortDate);
    const pad = n => new Array(n).fill(null);
    chart('pmChart', {
      type: 'line',
      data: { labels, datasets: [
        { label: '歷史 APY', data: [...p.apyS.slice(from, T + 1), ...pad(fut.length)], borderColor: PALETTE[2], borderWidth: 1.8, pointRadius: 0, tension: .2 },
        { label: '預測', data: [...pad(hist.length - 1), p.apyS[T], ...f.path], borderColor: PALETTE[0], borderDash: [5, 4], borderWidth: 2, pointRadius: 0 },
        { label: '95% 上界', data: [...pad(hist.length), ...f.hi], borderColor: 'transparent', backgroundColor: 'rgba(201,132,90,.15)', pointRadius: 0, fill: '+1' },
        { label: '95% 下界', data: [...pad(hist.length), ...f.lo], borderColor: 'transparent', pointRadius: 0 },
      ] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { filter: i => i.datasetIndex < 2 } } }, scales: { x: { ticks: { maxTicksLimit: 7 }, grid: { display: false } }, y: { ticks: { callback: v => v + '%' } } } },
    });
    const parts = Object.entries(r.parts);
    chart('pmRisk', {
      type: 'bar',
      data: { labels: parts.map(x => x[0]), datasets: [{ data: parts.map(x => x[1]), backgroundColor: parts.map(x => x[1] > 60 ? css('--loss') : x[1] > 30 ? css('--warn') : css('--gain')), borderRadius: 4 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100 }, y: { grid: { display: false } } } },
    });
    const flags = [];
    if (p.expo.lpCP) flags.push('集中流動性 LP：價格偏離時無常損失會被放大（模型以 2.5 倍計）');
    if (p.expo.synthetic) flags.push('含合成／演算法穩定幣，有脫鉤風險');
    if ((p.apyReward || 0) > 0) flags.push(`收益有 ${pct((p.apyReward || 0) / (p.apy || 1), 0)} 來自獎勵代幣，可能隨代幣價格下跌而縮水`);
    if (isFinite(dtm)) flags.push(`到期日 ${p.maturity.toISOString().slice(0, 10)}（剩 ${Math.round(dtm)} 天），剩不到 45 天時 Agent 會自動排除`);
    if (r.annVol > 0.01) flags.push(`年化價格波動約 ${pct(r.annVol, 0)}`);
    $('#pmNote').innerHTML = `<h3 style="margin-top:0">${esc(p.proto.name)}</h3><p>${esc(p.proto.note)}（${p.proto.since} 年上線）</p><h3>Agent 觀察</h3><ul>${flags.map(f => `<li>${esc(f)}</li>`).join('') || '<li>無特別風險旗標</li>'}</ul>`;
    $('#poolModal').classList.add('show');
  }

  // ---------------- Agent ----------------
  const params = () => ({
    capital: Math.max(100, +$('#pCapital').value || 10000),
    horizonDays: Math.max(7, +$('#pHorizon').value || 180),
    profile: $('#pProfile .active').dataset.v,
    stableOnly: $('#pStable').checked,
    chains: $$('.pChain').filter(c => c.checked).map(c => c.value),
  });
  function setParams(o) {
    $('#pCapital').value = Math.round(o.capital); $('#pHorizon').value = o.horizonDays;
    $$('#pProfile button').forEach(b => b.classList.toggle('active', b.dataset.v === o.profile));
    $('#pStable').checked = !!o.stableOnly;
    $$('.pChain').forEach(c => { c.checked = o.chains.includes(c.value); });
  }

  function addMsg(role, html, src) {
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    d.innerHTML = html + (src ? `<span class="src">${src}</span>` : '');
    $('#chatLog').appendChild(d);
    $('#chatLog').scrollTop = 1e9;
    return d;
  }

  const STEPS = [
    ['解析投資需求', 'parse_intent'], ['讀取市場資料', 'fetch_market_data'], ['協議風險評分', 'score_risk'],
    ['收益時序預測', 'forecast_apy'], ['投資組合最佳化', 'optimize_portfolio'], ['VaR 與壓力測試', 'stress_test'],
    ['歷史回測驗證', 'backtest'], ['生成策略說明', 'explain_strategy'],
  ];
  function traceInit() {
    $('#trace').innerHTML = STEPS.map(([t, tool], i) => `<li id="tr${i}"><div class="dot">${i + 1}</div><div class="t-title">${t}<span class="t-tool">${tool}()</span></div><div class="t-out"></div></li>`).join('');
  }
  async function traceStep(i, fn) {
    const li = $('#tr' + i); li.className = 'run';
    await sleep(260);
    const out = await fn();
    li.className = 'done'; li.querySelector('.dot').textContent = '✓';
    li.querySelector('.t-out').innerHTML = out;
  }

  let agentBusy = false;
  async function runAgent(fromChat) {
    if (agentBusy) return; agentBusy = true;
    $('#runAgent').disabled = true;
    const t0 = performance.now();
    const P = params();
    traceInit();
    const prof = Engine.PROFILES[P.profile];
    let res, vr, stress, bt, explain, excluded = [];
    try {
      await traceStep(0, () => `${usd(P.capital)} · ${prof.name} · ${P.horizonDays} 天${P.stableOnly ? ' · 僅穩定幣' : ''} · ${P.chains.join('/') || '全部鏈'}`);
      await traceStep(1, () => `${S.pools.length} 個池子 · ${new Set(S.pools.map(p => p.project)).size} 個協議 · ${state.live ? '即時資料' : '快照'} ${S.dates[S.T]}`);
      await traceStep(2, () => {
        const scored = S.pools.map(p => ({ p, r: Engine.riskScore(p) }));
        const pass = Engine.candidates(S.T, P);
        excluded = scored.filter(x => !pass.includes(x.p)).map(x => ({ ...x, why: whyExcluded(x, P) }));
        const top = excluded.filter(x => x.why.startsWith('風險')).sort((a, b) => b.p.apyS[S.T] - a.p.apyS[S.T]).slice(0, 2);
        return `${pass.length} 個通過門檻（≤${prof.maxScore}），排除 ${excluded.length} 個${top.length ? '，例如 ' + top.map(x => `${x.p.proto.name} ${x.p.symbol}（${x.r.score.toFixed(0)}）`).join('、') : ''}`;
      });
      await traceStep(3, () => {
        const c = Engine.candidates(S.T, P).map(p => Engine.forecast(p).mean);
        return c.length ? `候選池 30 日預測 APY 介於 ${apyF(Math.min(...c))} – ${apyF(Math.max(...c))}（已做不確定性折減）` : '無候選池';
      });
      await traceStep(4, () => {
        res = Engine.optimize(S.T, P);
        if (!res.weights.length) return '<span class="neg">沒有符合條件的池子，請放寬限制</span>';
        return `選出 ${res.weights.length} 個部位 · 預期 APY <b>${apyF(res.expApy)}</b> · 波動 ${pct(res.vol, 1)} · 加權風險 ${res.riskScore.toFixed(0)}`;
      });
      if (!res.weights.length) throw new Error('empty');
      await traceStep(5, () => {
        vr = Engine.valueAtRisk(res.weights, P.capital);
        stress = Engine.stressTests(res.weights, P.capital);
        const worst = [...stress].sort((a, b) => a.loss - b.loss)[0];
        return `30 日 VaR95 = ${usd(vr.var30Usd)}（${pct(vr.var30)}）· 最差情境：${worst.name.split('（')[0]} ${usd(worst.usd)}`;
      });
      await traceStep(6, async () => {
        await sleep(30);
        bt = Engine.backtest({ ...P, strategy: 'agent' });
        return `過去 ${bt.curve.length - 1} 天 walk-forward：報酬 ${pct(bt.total, 1)} · 年化 ${pct(bt.ann, 1)} · 最大回撤 ${pct(bt.maxDD, 1)}`;
      });
      const ctx = { P, prof, res, vr, stress, bt, excluded };
      await traceStep(7, async () => {
        explain = await explainStrategy(ctx);
        return explain.src;
      });
      state.agent = { ...ctx, explain, at: new Date() };
      $('#traceTime').textContent = `耗時 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`;
      renderAgentResult();
      addMsg('bot', summaryText(state.agent), explain.src);
      if (fromChat) $('#agentResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      if (e.message !== 'empty') console.error(e);
      addMsg('bot', '找不到符合所有條件的收益池。試著放寬限制，例如允許更多鏈，或改成平衡型。');
    } finally { agentBusy = false; $('#runAgent').disabled = false; }
  }

  function whyExcluded(x, P) {
    const prof = Engine.PROFILES[P.profile];
    if (P.stableOnly && !x.p.isStable) return '非穩定幣';
    if (P.chains.length && !P.chains.includes(x.p.chain)) return `不在指定鏈（${x.p.chain}）`;
    if (Engine.daysToMaturity(x.p, S.T) <= 45) return '即將到期';
    if (S.T - x.p.first < 60) return '歷史資料不足 60 天';
    if (x.r.score > prof.maxScore) return `風險分數 ${x.r.score.toFixed(0)} 超過${prof.name}門檻 ${prof.maxScore}`;
    return '收益過低';
  }

  function positionReason(x) {
    const p = x.pool, r = Engine.riskScore(p);
    const top = Object.entries(r.parts).sort((a, b) => b[1] - a[1])[0][0];
    if (p.expo.lpCP) return `手續費收益高，但承擔 ETH 價格與無常損失，主要風險是「${top}」`;
    if (p.expo.synthetic) return `合成美元收益較高，但有脫鉤風險，所以限制權重`;
    if (p.isStable && p.proto.sc <= 15) return `藍籌協議的穩定幣收益，合約風險低，作為組合的壓艙石`;
    if (p.isStable) return `收益比藍籌協議高，協議較新，風險評級 ${r.grade}`;
    if (p.expo.ETH >= 0.99) return `ETH 原生收益，主要曝險於 ETH 價格`;
    return `分散收益來源，風險評級 ${r.grade}`;
  }

  function templateExplain({ P, prof, res, vr, stress, bt, excluded }) {
    const inc = P.capital * res.expApy / 100 * P.horizonDays / 365;
    const worst = [...stress].sort((a, b) => a.loss - b.loss)[0];
    const hiEx = excluded.filter(x => x.why.startsWith('風險')).sort((a, b) => b.p.apyS[S.T] - a.p.apyS[S.T])[0];
    let s = `根據你的需求（${usd(P.capital)}、${prof.name}、${P.horizonDays} 天${P.stableOnly ? '、僅穩定幣' : ''}），我從 ${S.pools.length} 個收益池中篩選，最後配置 ${res.weights.length} 個部位：\n\n`;
    s += res.weights.map(x => `• ${x.pool.proto.name} ${x.pool.symbol}（${x.pool.chain}）${pct(x.w, 0)}：預測 APY ${apyF(x.mu * 100)}，${positionReason(x)}。`).join('\n');
    s += `\n\n整體預期年化 ${apyF(res.expApy)}，${P.horizonDays} 天預估收益約 ${usd(inc)}。穩定幣占 ${pct(res.stableShare, 0)}，加權風險分數 ${res.riskScore.toFixed(0)}。`;
    s += `\n\n風險面：30 日 95% VaR 為 ${usd(vr.var30Usd)}，也就是有 5% 的機率在 30 天內虧損超過這個金額。壓力測試中最嚴重的情境是「${worst.name}」，估計損失 ${usd(worst.usd)}。`;
    if (hiEx) s += `\n\n為什麼沒選 ${hiEx.p.proto.name} ${hiEx.p.symbol}（APY ${apyF(hiEx.p.apyS[S.T])}）？因為${hiEx.why}，對${prof.name}來說，多出來的收益不足以補償風險。`;
    s += `\n\n回測參考：同一套規則過去 ${bt.curve.length - 1} 天的報酬是 ${pct(bt.total, 1)}，最大回撤 ${pct(bt.maxDD, 1)}。建議把這個組合加入「即時監控」，觸發條件出現時 Agent 會提出再平衡建議。`;
    return s;
  }

  // ----- LLM (optional, user-supplied Anthropic key, called directly from the browser) -----
  const llm = { key: () => store.get('yp_key'), model: () => store.get('yp_model') || 'claude-opus-5-5' };
  async function callClaude(system, user, maxTokens = 1200) {
    const model = llm.model();
    const body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }], output_config: { effort: 'low' } };
    const headers = { 'content-type': 'application/json', 'x-api-key': llm.key(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    if (model !== 'claude-haiku-5-5') { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || r.status);
    if (j.stop_reason === 'refusal') throw new Error('模型拒絕回應');
    return j.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  }
  const SYS = '你是 YieldPilot 的 DeFi 投資策略分析師，向一般投資人解釋 AI Agent 的量化結果。請使用繁體中文、白話且精確的語氣，不要使用 Markdown 標題或表格，可以用「•」列點。只能根據提供的數據回答，不可捏造數字，也不可保證收益。務必提到主要風險。這是教學用 POC，結尾用一句話提醒「非投資建議」。';
  function ctxJson({ P, prof, res, vr, stress, bt, excluded }) {
    return JSON.stringify({
      需求: { 金額USD: P.capital, 風險偏好: prof.name, 期間天數: P.horizonDays, 僅穩定幣: P.stableOnly, 鏈: P.chains },
      配置: res.weights.map(x => ({ 池: `${x.pool.proto.name} ${x.pool.symbol}`, 鏈: x.pool.chain, 權重: +(x.w * 100).toFixed(1), 預測APY: +(x.mu * 100).toFixed(2), 風險分數: +x.risk.toFixed(0), 協議說明: x.pool.proto.note })),
      組合: { 預期APY: +res.expApy.toFixed(2), 年化波動: +(res.vol * 100).toFixed(1), 加權風險: +res.riskScore.toFixed(0), 穩定幣占比: +(res.stableShare * 100).toFixed(0) },
      VaR: { 一日VaR95: +(vr.var1 * 100).toFixed(2), 三十日VaR95: +(vr.var30 * 100).toFixed(2), 三十日CVaR: +(vr.cvar30 * 100).toFixed(2), 三十日VaR金額: Math.round(vr.var30Usd) },
      壓力測試: stress.map(s => ({ 情境: s.name, 損失百分比: +(s.loss * 100).toFixed(1) })),
      回測: { 天數: bt.curve.length - 1, 總報酬: +(bt.total * 100).toFixed(1), 最大回撤: +(bt.maxDD * 100).toFixed(1), Sharpe: +bt.sharpe.toFixed(2) },
      被排除的高收益池: excluded.sort((a, b) => b.p.apyS[S.T] - a.p.apyS[S.T]).slice(0, 5).map(x => ({ 池: `${x.p.proto.name} ${x.p.symbol}`, APY: +x.p.apyS[S.T].toFixed(2), 原因: x.why })),
    });
  }
  async function explainStrategy(ctx) {
    if (llm.key()) {
      try {
        const text = await callClaude(SYS, `以下是 Agent 的量化分析結果（JSON）。請用 250–350 字解釋：為什麼這樣配置、預期收益、主要風險，以及為什麼排除某些高收益池。\n\n${ctxJson(ctx)}`);
        return { text, src: `由 ${llm.model()} 生成` };
      } catch (e) {
        toast('LLM 呼叫失敗，改用規則引擎：' + e.message, 4000);
      }
    }
    return { text: templateExplain(ctx), src: '由規則式模板引擎生成（可在 LLM 設定中接入 Claude）' };
  }

  function summaryText(a) {
    return `完成 ✓ 建議配置 ${a.res.weights.length} 個部位，預期年化 <b>${apyF(a.res.expApy)}</b>，30 日 VaR95 為 <b>${usd(a.vr.var30Usd)}</b>。\n${a.res.weights.map(x => `• ${esc(x.pool.proto.name)} ${esc(x.pool.symbol)}　${pct(x.w, 0)}`).join('\n')}\n\n完整的說明、壓力測試與預測圖在下方。也可以繼續問我，例如「為什麼不放 Uniswap？」`;
  }

  async function onChat(text) {
    text = text.trim(); if (!text) return;
    addMsg('user', esc(text));
    $('#chatText').value = '';
    const isQuestion = /為什麼|為何|什麼是|解釋|是什麼|怎麼|風險.*嗎|\?|？/.test(text) && !/\d{3,}|萬/.test(text);
    if (isQuestion && state.agent) return answerQuestion(text);
    if (isQuestion && !state.agent) {
      const ans = ruleAnswer(text);
      if (ans) { addMsg('bot', ans); return; }
    }
    const o = Engine.parseIntent(text, params());
    setParams(o);
    addMsg('bot', `收到，我理解你的需求是：<b>${usd(o.capital)}</b>、<b>${Engine.PROFILES[o.profile].name}</b>、${o.horizonDays} 天${o.stableOnly ? '、<b>僅穩定幣</b>' : ''}、鏈：${o.chains.join(' / ')}。開始分析…`);
    runAgent(true);
  }

  function findPoolsInText(text) {
    const t = text.toLowerCase();
    const alias = { 'aave': 'aave-v3', 'compound': 'compound-v3', 'lido': 'lido', 'rocket': 'rocket-pool', 'sky': 'sky-lending', 'maker': 'sky-lending', 'spark': 'sparklend', 'uniswap': 'uniswap-v3', 'curve': 'curve-dex', 'convex': 'convex-finance', 'morpho': 'morpho-blue', 'fluid': 'fluid-lending', 'ethena': 'ethena-usde', 'usde': 'ethena-usde', 'yearn': 'yearn-finance', 'pendle': 'pendle-v2', 'gmx': 'gmx-v2-perps' };
    const projects = new Set(Object.entries(alias).filter(([k]) => t.includes(k)).map(([, v]) => v));
    return S.pools.filter(p => projects.has(p.project));
  }
  function ruleAnswer(text) {
    const pools = findPoolsInText(text);
    if (pools.length) {
      const P = params(); const a = state.agent;
      return pools.slice(0, 3).map(p => {
        const r = Engine.riskScore(p), f = Engine.forecast(p);
        const inP = a?.res.weights.find(x => x.pool.id === p.id);
        const ex = a?.excluded.find(x => x.p.id === p.id);
        const top = Object.entries(r.parts).sort((x, y) => y[1] - x[1]).slice(0, 2).map(x => `${x[0]} ${x[1].toFixed(0)}`).join('、');
        let s = `<b>${esc(p.proto.name)} ${esc(p.symbol)}（${p.chain}）</b>：目前 APY ${apyF(p.apyS[S.T])}，預測 ${apyF(f.mean)}，風險 ${r.grade}（${r.score.toFixed(0)} 分），最高的風險因子是 ${top}。${esc(p.proto.note)}。`;
        if (inP) s += `\n→ 已配置 ${pct(inP.w, 0)}。`;
        else if (ex) s += `\n→ 沒有配置，原因：${ex.why}。`;
        else if (a) s += `\n→ 有通過門檻，但最佳化後它的風險調整收益不如其他候選池（邊際貢獻低於 3% 權重門檻）。`;
        else s += `\n→ 對${Engine.PROFILES[P.profile].name}的風險門檻是 ${Engine.PROFILES[P.profile].maxScore}。`;
        return s;
      }).join('\n\n');
    }
    if (/var|風險值/i.test(text)) return 'VaR（Value at Risk）是指在 95% 信心水準下，一段期間內最大可能虧損。例如 30 日 VaR95 = $500，意思是有 5% 的機率在 30 天內虧損超過 $500。我們用過去一年的每日報酬，以歷史模擬法計算。';
    if (/無常損失|impermanent|IL/i.test(text)) return '無常損失（Impermanent Loss）：在 AMM 提供流動性時，若兩種代幣的價格比改變，LP 部位的價值會低於單純持有。Uniswap V3 是集中流動性，損失會被放大，因此模型以 2.5 倍計算。';
    return null;
  }
  async function answerQuestion(text) {
    if (llm.key()) {
      const pending = addMsg('bot', '<span class="spinner"></span> 思考中…');
      try {
        const pools = findPoolsInText(text).map(p => { const r = Engine.riskScore(p); return { 池: `${p.proto.name} ${p.symbol} (${p.chain})`, APY: p.apyS[S.T], 預測: +Engine.forecast(p).mean.toFixed(2), 風險分數: +r.score.toFixed(0), 風險因子: Object.fromEntries(Object.entries(r.parts).map(([k, v]) => [k, +v.toFixed(0)])), 說明: p.proto.note }; });
        const ans = await callClaude(SYS, `目前的投資組合分析：${ctxJson(state.agent)}\n\n問題中提到的池子資料：${JSON.stringify(pools)}\n\n使用者問題：${text}\n\n請在 200 字內回答。`, 800);
        pending.innerHTML = esc(ans) + `<span class="src">由 ${llm.model()} 生成</span>`;
        return;
      } catch (e) { pending.remove(); toast('LLM 呼叫失敗：' + e.message, 4000); }
    }
    addMsg('bot', ruleAnswer(text) || '這個問題我需要接上 LLM 才能自由回答（左下「LLM 設定」）。目前可以問我某個協議為什麼有／沒有被配置，或是 VaR、無常損失等名詞解釋。', '規則引擎');
  }

  function renderAgentPage() {
    $('#agentMode').textContent = llm.key() ? `LLM：${llm.model()}` : '規則引擎';
    if (!$('#chatLog').children.length) {
      addMsg('bot', `嗨，我是 <b>YieldPilot</b> DeFi 投資 Agent 👋\n告訴我你的投資金額、風險偏好和期間，我會分析 ${S.pools.length} 個收益池，給你有根據的配置建議，並說明風險。\n\n也可以直接調整右邊的參數，再按「執行 Agent」。`);
      traceInit();
    }
    if (state.agent) renderAgentResult();
  }

  function renderAgentResult() {
    const a = state.agent; if (!a) return;
    const { P, res, vr, stress, explain } = a;
    const inc = P.capital * res.expApy / 100 * P.horizonDays / 365;
    $('#agentResult').innerHTML = `
      <div class="grid g4">
        ${statCard('trend', '預期年化收益', apyF(res.expApy), `${P.horizonDays} 天約 ${usd(inc)}`, '', true)}
        ${statCard('alert', '30 日 VaR (95%)', usd(vr.var30Usd), `CVaR ${usd(vr.cvar30Usd)} · ${pct(vr.var30)}`, vr.var30 > 0.05 ? 'neg' : '')}
        ${statCard('shield', '加權風險分數', res.riskScore.toFixed(0) + ' / 100', `穩定幣占 ${pct(res.stableShare, 0)} · 波動 ${pct(res.vol, 1)}`)}
        ${statCard('vault', '回測報酬', pct(a.bt.total, 1), `最大回撤 ${pct(a.bt.maxDD, 1)} · Sharpe ${a.bt.sharpe.toFixed(2)}`, a.bt.total >= 0 ? 'pos' : 'neg')}
      </div>
      <div class="grid g-1-2">
        <div class="card"><div class="card-header"><div class="card-title">資產配置</div></div>
          <div class="donut-wrap"><div class="chart-box sm" style="height:190px"><canvas id="agDonut"></canvas></div>
          <div class="legend">${res.weights.map((x, i) => `<div><i style="background:${PALETTE[i]}"></i>${esc(x.pool.proto.name)} ${esc(x.pool.symbol)}<span class="n num">${pct(x.w, 0)}</span></div>`).join('')}</div></div>
        </div>
        <div class="card"><div class="card-header"><div class="card-title">配置明細</div><button class="btn primary sm" id="toMonitor">加入即時監控 →</button></div>
          <div class="table-wrap"><table><thead><tr><th>收益池</th><th class="r">權重</th><th class="r">金額</th><th class="r">預測 APY</th><th class="r">預估收益</th><th>風險</th></tr></thead><tbody>
          ${res.weights.map(x => { const r = Engine.riskScore(x.pool); return `<tr class="click" data-pool="${x.pool.id}"><td>${poolCell(x.pool)}</td><td class="r num">${pct(x.w, 1)}</td><td class="r num">${usd(P.capital * x.w)}</td><td class="r num">${apyF(x.mu * 100)}</td><td class="r num pos">+${usd(P.capital * x.w * x.mu * P.horizonDays / 365)}</td><td>${gradeTag(r)}</td></tr>`; }).join('')}
          </tbody></table></div>
        </div>
      </div>
      <div class="grid g-2-1">
        <div class="card"><div class="card-header"><div class="card-title">AI 策略說明</div><span class="pill acc">${llm.key() && !explain.src.includes('模板') ? 'LLM' : '模板'}</span></div>
          <div class="explain">${esc(explain.text)}</div><div class="explain-src">${esc(explain.src)}</div>
          <div class="disclaimer">本結果由演算法根據公開歷史資料產生，僅供課程 POC 展示，不構成投資建議。</div>
        </div>
        <div class="card"><div class="card-header"><div class="card-title">壓力測試</div></div>
          <div class="table-wrap"><table><tbody>${stress.map(s => `<tr><td style="white-space:normal">${esc(s.name)}</td><td class="r num ${s.loss < 0 ? 'neg' : 'pos'}">${pct(s.loss, 1)}<br><span class="note">${usd(s.usd)}</span></td></tr>`).join('')}</tbody></table></div>
        </div>
      </div>
      <div class="grid g2">
        <div class="card"><div class="card-header"><div><div class="card-title">30 日報酬分布（歷史模擬）</div><div class="card-desc">紅線 = VaR95</div></div></div><div class="chart-box"><canvas id="agHist"></canvas></div></div>
        <div class="card"><div class="card-header"><div><div class="card-title">組合淨值回測 vs 基準</div><div class="card-desc">同一套 Agent 規則，walk-forward</div></div></div><div class="chart-box"><canvas id="agBt"></canvas></div></div>
      </div>`;
    chart('agDonut', { type: 'doughnut', data: { labels: res.weights.map(x => `${x.pool.proto.name} ${x.pool.symbol}`), datasets: [{ data: res.weights.map(x => +(x.w * 100).toFixed(1)), backgroundColor: PALETTE, borderColor: css('--bg-card'), borderWidth: 3 }] }, options: { cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed}%` } } } } });
    // histogram
    const d = vr.dist, lo = Math.min(...d), hi = Math.max(...d), nb = 30, w = (hi - lo) / nb || 1e-4;
    const bins = new Array(nb).fill(0); d.forEach(x => bins[Math.min(nb - 1, Math.floor((x - lo) / w))]++);
    const varIdx = Math.floor((-vr.var30 - lo) / w);
    chart('agHist', { type: 'bar', data: { labels: bins.map((_, i) => pct(lo + (i + .5) * w, 1)), datasets: [{ data: bins, backgroundColor: bins.map((_, i) => i <= varIdx ? css('--loss') : PALETTE[0]), borderRadius: 2, barPercentage: 1, categoryPercentage: .95 }] }, options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { ticks: { precision: 0 } } } } });
    const base = Engine.backtest({ ...P, strategy: 'aaveUsdc' }), eth = Engine.backtest({ ...P, strategy: 'hodlEth' });
    const lbl = a.bt.curve.map(c => shortDate(S.dates[c.t]));
    chart('agBt', { type: 'line', data: { labels: lbl, datasets: [
      { label: 'Agent 組合', data: a.bt.curve.map(c => c.v), borderColor: PALETTE[0], borderWidth: 2.4, pointRadius: 0 },
      { label: 'Aave USDC 持有', data: base.curve.map(c => c.v), borderColor: PALETTE[1], borderWidth: 1.6, pointRadius: 0 },
      { label: 'stETH 持有', data: eth.curve.map(c => c.v), borderColor: PALETTE[2], borderWidth: 1.6, pointRadius: 0 },
    ] }, options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } }, y: { ticks: { callback: v => v.toFixed(2) } } } } });
    $('#toMonitor').onclick = () => { initMonitor(a); go('monitor'); };
  }

  // ---------------- Backtest ----------------
  function renderBacktest() {
    if (!state.bt) runBacktest(); else drawBacktest();
  }
  function runBacktest() {
    const prof = $('#btProfile .active').dataset.v;
    const o = { profile: prof, every: +$('#btEvery').value, costRate: (+$('#btCost').value || 0) / 1e4, stableOnly: $('#btStable').checked, chains: [] };
    const strategies = [
      ['agent', `AI Agent（${Engine.PROFILES[prof].name}）`], ['equal', '等權重分散'], ['chase', '追逐最高 APY'], ['aaveUsdc', 'Aave USDC 持有'], ['hodlEth', 'Lido stETH 持有'],
    ];
    state.bt = { o, list: strategies.map(([k, name]) => ({ k, name, r: Engine.backtest({ ...o, strategy: k, every: ['aaveUsdc', 'hodlEth'].includes(k) ? 9999 : (k === 'equal' ? 30 : o.every) }) })) };
    drawBacktest();
  }
  function drawBacktest() {
    const { list } = state.bt;
    const ag = list[0].r;
    const bestOther = list.slice(1).filter(x => x.k !== 'chase').sort((a, b) => b.r.sharpe - a.r.sharpe)[0];
    $('#btStats').innerHTML =
      statCard('trend', 'Agent 總報酬', pct(ag.total, 1), `年化 ${pct(ag.ann, 1)}`, ag.total >= 0 ? 'pos' : 'neg', true) +
      statCard('alert', '最大回撤', pct(ag.maxDD, 1), `stETH 持有 ${pct(list[4].r.maxDD, 1)}`) +
      statCard('shield', 'Sharpe（rf=4%）', ag.sharpe.toFixed(2), `${bestOther.name} ${bestOther.r.sharpe.toFixed(2)}`) +
      statCard('vault', '再平衡次數', ag.rebalances, `平均單次換手 ${pct(ag.turnover / Math.max(1, ag.rebalances), 1)}`);
    const lbl = ag.curve.map(c => shortDate(S.dates[c.t]));
    chart('btChart', { type: 'line', data: { labels: lbl, datasets: list.map((x, i) => ({ label: x.name, data: x.r.curve.map(c => c.v), borderColor: PALETTE[i], borderWidth: i === 0 ? 2.8 : 1.5, pointRadius: 0, borderDash: x.k === 'chase' ? [4, 3] : [] })) },
      options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 9 }, grid: { display: false } }, y: { ticks: { callback: v => v.toFixed(2) } } }, plugins: { tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toFixed(4)}` } } } } });
    $('#btTable').innerHTML = `<thead><tr><th>策略</th><th class="r">總報酬</th><th class="r">波動</th><th class="r">回撤</th><th class="r">Sharpe</th></tr></thead><tbody>` +
      list.map((x, i) => `<tr><td><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${PALETTE[i]};margin-right:8px"></span>${esc(x.name)}</td><td class="r num ${x.r.total >= 0 ? 'pos' : 'neg'}">${pct(x.r.total, 1)}</td><td class="r num">${pct(x.r.vol, 1)}</td><td class="r num">${pct(x.r.maxDD, 1)}</td><td class="r num">${x.r.sharpe.toFixed(2)}</td></tr>`).join('') +
      `</tbody>`;
    $('#btTable').insertAdjacentHTML('afterend', '');
    // allocation stacked bars
    const ids = new Map();
    ag.alloc.forEach(a => a.w.forEach((w, id) => ids.set(id, (ids.get(id) || 0) + w)));
    const top = [...ids.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(x => x[0]);
    const ds = top.map((id, i) => ({ label: `${S.pools[id].proto.name} ${S.pools[id].symbol}`, data: ag.alloc.map(a => +((a.w.get(id) || 0) * 100).toFixed(1)), backgroundColor: PALETTE[i] }));
    ds.push({ label: '其他', data: ag.alloc.map(a => +(100 * [...a.w.entries()].filter(([id]) => !top.includes(id)).reduce((s, [, w]) => s + w, 0)).toFixed(1)), backgroundColor: PALETTE[9] });
    chart('btAlloc', { type: 'bar', data: { labels: ag.alloc.map(a => shortDate(S.dates[a.t])), datasets: ds }, options: { scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { stacked: true, max: 100, ticks: { callback: v => v + '%' } } }, plugins: { legend: { position: 'bottom' } } } });
  }

  // ---------------- RL ----------------
  function renderRL() { if (!state.rl) runRL(); else drawRL(); }
  function runRL() {
    const btn = $('#runRl'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 訓練中…';
    setTimeout(() => {
      state.rl = Engine.trainRL({ episodes: +$('#rlEp').value, riskAversion: +$('#rlRisk').value, seed: +$('#rlSeed').value || 42 });
      btn.disabled = false; btn.textContent = '訓練 Agent';
      drawRL();
    }, 30);
  }
  function drawRL() {
    const rl = state.rl, A = Engine.ACTIONS, N = Engine.ACTION_NAMES;
    const statics = A.map(a => ({ a, ...rl.results[a] })).sort((x, y) => y.total - x.total);
    const ms = Engine.marketState(S.T);
    $('#rlStats').innerHTML =
      statCard('brain', 'RL 樣本外報酬', pct(rl.results.rl.total, 2), `${rl.test.length} 週 · 回撤 ${pct(rl.results.rl.maxDD, 1)}`, rl.results.rl.total >= 0 ? 'pos' : 'neg', true) +
      statCard('trend', '最佳靜態策略', pct(statics[0].total, 2), `${N[statics[0].a]} · 回撤 ${pct(statics[0].maxDD, 1)}`) +
      statCard('shield', '最差靜態策略', pct(statics.at(-1).total, 2), N[statics.at(-1).a]) +
      statCard('alert', '當前市場 → RL 建議', N[A[rl.policy[ms.id]]], ms.label);
    chart('rlCurve', { type: 'line', data: { labels: rl.curve.map((_, i) => i + 1), datasets: [
      { label: '回合獎勵', data: rl.curve, borderColor: 'rgba(201,132,90,.35)', borderWidth: 1, pointRadius: 0 },
      { label: '移動平均 (20)', data: rl.curve.map((_, i) => Engine.mean(rl.curve.slice(Math.max(0, i - 19), i + 1))), borderColor: PALETTE[0], borderWidth: 2.4, pointRadius: 0 },
    ] }, options: { scales: { x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } } } } });
    const lbl = ['起點', ...rl.test.map(w => shortDate(S.dates[w.t + 7] || S.dates[S.T]))];
    chart('rlTest', { type: 'line', data: { labels: lbl, datasets: [
      { label: 'RL Agent', data: rl.results.rl.path, borderColor: PALETTE[0], borderWidth: 2.8, pointRadius: 0 },
      ...A.map((a, i) => ({ label: '固定：' + N[a], data: rl.results[a].path, borderColor: PALETTE[i + 1], borderWidth: 1.4, pointRadius: 0, borderDash: [4, 3] })),
    ] }, options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 7 }, grid: { display: false } }, y: { ticks: { callback: v => v.toFixed(3) } } } } });
    const labels = Array.from({ length: 12 }, (_, s) => { const m = Math.floor(s / 4), v = Math.floor(s / 2) % 2, sp = s % 2; return `${['下跌', '盤整', '上漲'][m]} · ${v ? '高波動' : '低波動'} · ${sp ? '利差大' : '利差小'}`; });
    const all = rl.Q.flat(), mx = Math.max(...all.map(Math.abs)) || 1;
    $('#qTable').innerHTML = `<thead><tr><th style="text-align:left">市場狀態</th>${A.map(a => `<th>${N[a]}</th>`).join('')}<th>造訪次數</th><th>策略</th></tr></thead><tbody>` +
      rl.Q.map((q, s) => { const n = rl.N[s].reduce((x, y) => x + y, 0); return `<tr${s === ms.id ? ' style="background:var(--accent-soft)"' : ''}><td style="text-align:left">${labels[s]}${s === ms.id ? ' <span class="pill acc">目前</span>' : ''}</td>${q.map((v, a) => `<td><span class="qcell${n && rl.policy[s] === a ? ' qbest' : ''}" style="background:${v >= 0 ? `rgba(127,163,127,${Math.abs(v) / mx * .5})` : `rgba(201,123,123,${Math.abs(v) / mx * .5})`}">${v.toFixed(2)}</span></td>`).join('')}<td class="num">${n}</td><td>${n ? `<b>${N[A[rl.policy[s]]]}</b>` : '<span class="note">未見過 → 平衡</span>'}</td></tr>`; }).join('') + '</tbody>';
  }

  // ---------------- Monitor ----------------
  const SHOCKS = [
    { k: 'ethcrash', t: 'ETH 閃崩 −25%', d: 'BTC −18%，LP 承受無常損失' },
    { k: 'depeg', t: 'USDe 脫鉤 −6%', d: 'Ethena 資金費率轉負，TVL −45%' },
    { k: 'hack', t: '協議遭駭（最大部位）', d: '部位 −15%，TVL −60%，列入黑名單' },
    { k: 'apydrop', t: '收益率崩跌', d: '最高收益部位 APY 跌到 1/5' },
    { k: 'opportunity', t: '新收益機會', d: '藍籌穩定幣池 APY 升到 11%' },
    { k: 'ethpump', t: 'ETH 強勁反彈 +18%', d: '波動資產權重偏離目標' },
  ];
  function initMonitor(a) {
    const src = a || (() => { const P = { capital: 10000, horizonDays: 180, profile: 'balanced', stableOnly: false, chains: [] }; const res = Engine.optimize(S.T, P); return { P, res }; })();
    state.monitor = {
      P: src.P, blacklist: new Set(), proposal: null, log: [],
      positions: src.res.weights.map(x => ({ id: x.pool.id, usd: src.P.capital * x.w, target: x.w, entryFc: x.mu * 100, entryTvl: S.pools[x.pool.id].tvlS[S.T], entryRisk: x.risk })),
      source: a ? 'AI Agent 建立的組合' : '示範組合（平衡型 · $10,000）',
    };
    logEvt('info', `開始監控：${state.monitor.source}，共 ${state.monitor.positions.length} 個部位`);
    monitorCheck();
  }
  function logEvt(kind, text) {
    const m = state.monitor; if (!m) return;
    m.log.unshift({ kind, text, at: new Date() });
    m.log = m.log.slice(0, 60);
  }
  function healthOf(pos) {
    const p = S.pools[pos.id], T = S.T, r = Engine.riskScore(p);
    const issues = [];
    const tot = state.monitor.positions.reduce((s, x) => s + x.usd, 0);
    const w = pos.usd / tot;
    if (state.monitor.blacklist.has(p.project)) issues.push('協議列入黑名單');
    if ((p.apyS[T] || 0) < pos.entryFc * 0.5) issues.push(`APY 降到 ${apyF(p.apyS[T])}（建倉時預期 ${apyF(pos.entryFc)}）`);
    if ((p.tvlS[T] || 0) < pos.entryTvl * 0.75) issues.push(`TVL 下滑 ${pct(1 - p.tvlS[T] / pos.entryTvl, 0)}`);
    if (r.score > pos.entryRisk + 8 || r.score > Engine.PROFILES[state.monitor.P.profile].maxScore + 5) issues.push(`風險分數升到 ${r.score.toFixed(0)}`);
    if (Math.abs(w - pos.target) > 0.05) issues.push(`權重偏離 ${w > pos.target ? '+' : ''}${pct(w - pos.target, 1)}`);
    return { p, r, w, issues };
  }
  function monitorCheck(reason) {
    const m = state.monitor; if (!m) return;
    const H = m.positions.map(healthOf);
    const alerts = H.filter(h => h.issues.length);
    const tot = m.positions.reduce((s, x) => s + x.usd, 0);
    const exclude = S.pools.filter(p => m.blacklist.has(p.project)).map(p => p.id);
    const apyOverride = {};
    alerts.forEach(h => { apyOverride[h.p.id] = h.p.apyS[S.T]; });
    const target = Engine.optimize(S.T, { ...m.P, exclude, apyOverride });
    const curW = m.positions.map(x => ({ pool: S.pools[x.id], w: x.usd / tot, mu: (apyOverride[x.id] ?? Engine.forecast(S.pools[x.id]).mean) / 100, risk: Engine.riskScore(S.pools[x.id]).score }));
    const cur = Engine.portfolioStats(curW);
    const gain = target.expApy - cur.expApy;
    if (reason) logEvt('info', reason);
    if (alerts.length || gain > 0.75) {
      const trades = new Map();
      m.positions.forEach(x => trades.set(x.id, -x.usd));
      target.weights.forEach(x => trades.set(x.pool.id, (trades.get(x.pool.id) || 0) + x.w * tot));
      const list = [...trades.entries()].filter(([, v]) => Math.abs(v) > tot * 0.005).sort((a, b) => a[1] - b[1]);
      m.proposal = { target, tot, list, alerts, gain, before: cur };
      logEvt('alert', `觸發 ${alerts.length} 項警示${gain > 0.75 ? `；最佳化後預期 APY 可提升 ${gain.toFixed(2)}%` : ''}：${alerts.map(h => `${h.p.proto.name} ${h.p.symbol}：${h.issues[0]}`).join('；') || '出現更好的收益機會'}`);
      if ($('#autoRebal').classList.contains('on')) applyProposal(true);
    } else {
      m.proposal = null;
      logEvt('ok', `巡檢完成：${m.positions.length} 個部位健康，組合價值 ${usd(tot)}`);
    }
    if (state.page === 'monitor') drawMonitor();
  }
  function applyProposal(auto) {
    const m = state.monitor, pr = m?.proposal; if (!pr) return;
    m.positions = pr.target.weights.map(x => ({ id: x.pool.id, usd: pr.tot * x.w, target: x.w, entryFc: x.mu * 100, entryTvl: x.pool.tvlS[S.T], entryRisk: x.risk }));
    const cost = pr.list.reduce((s, [, v]) => s + Math.abs(v), 0) / 2 * 0.001;
    m.positions.forEach(x => { x.usd -= cost * x.target; });
    logEvt('ok', `${auto ? '🤖 自動' : '✋ 手動'}執行再平衡：${pr.list.length} 筆交易，換手 ${usd(pr.list.reduce((s, [, v]) => s + Math.abs(v), 0) / 2)}，成本約 ${usd(cost, 2)}；新組合預期 APY ${apyF(pr.target.expApy)}`);
    m.proposal = null;
    if (state.page === 'monitor') drawMonitor();
  }
  function applyShock(k) {
    if (!state.monitor) initMonitor(state.agent);
    const m = state.monitor;
    const snap = structuredClone(MARKET);
    const last = snap.prices.ETH.at(-1)[0];
    const d = new Date(last + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
    const nd = d.toISOString().slice(0, 10);
    let eth = 1, btc = 1; const extraLoss = {};
    const poolMod = {};
    const held = m.positions.map(x => S.pools[x.id]);
    const largest = [...m.positions].sort((a, b) => b.usd - a.usd)[0];
    let desc = '';
    if (k === 'ethcrash') { eth = 0.75; btc = 0.82; desc = 'ETH 單日下跌 25%'; }
    if (k === 'ethpump') { eth = 1.18; btc = 1.08; desc = 'ETH 單日上漲 18%'; }
    if (k === 'depeg') {
      snap.pools.forEach((p, i) => { if (/USDE/.test(p.symbol)) { poolMod[i] = { apy: 0.5, tvl: 0.55 }; extraLoss[i] = -0.06; } });
      desc = 'USDe 脫鉤 6%，相關池 TVL 流出 45%';
    }
    if (k === 'hack' && largest) {
      const proj = S.pools[largest.id].project;
      snap.pools.forEach((p, i) => { if (p.project === proj) { poolMod[i] = { apy: 1, tvl: 0.4 }; extraLoss[i] = -0.15; } });
      m.blacklist.add(proj);
      desc = `${S.pools[largest.id].proto.name} 遭駭：部位損失 15%，TVL 流出 60%，Agent 已將其列入黑名單`;
    }
    if (k === 'apydrop') {
      const top = [...held].sort((a, b) => (b.apyS[S.T] || 0) - (a.apyS[S.T] || 0))[0];
      if (top) { poolMod[top.id] = { apy: 0.2, tvl: 0.9 }; desc = `${top.proto.name} ${top.symbol} 的 APY 從 ${apyF(top.apyS[S.T])} 跌到 ${apyF(top.apyS[S.T] * 0.2)}`; }
    }
    if (k === 'opportunity') {
      const cand = S.pools.filter(p => p.isStable && Engine.riskScore(p).score < 25 && !m.positions.some(x => x.id === p.id)).sort((a, b) => b.tvlS[S.T] - a.tvlS[S.T])[0] || S.pools.find(p => p.isStable);
      poolMod[cand.id] = { apyAbs: 11, tvl: 1.3 };
      desc = `${cand.proto.name} ${cand.symbol}（${cand.chain}）APY 升到 11%，TVL +30%`;
    }
    snap.prices.ETH.push([nd, snap.prices.ETH.at(-1)[1] * eth]);
    snap.prices.BTC.push([nd, snap.prices.BTC.at(-1)[1] * btc]);
    snap.pools.forEach((p, i) => {
      const h = p.history.at(-1); if (!h) return;
      const md = poolMod[i] || {};
      const apy = md.apyAbs ?? h[1] * (md.apy ?? 1) * (1 + (Math.random() - 0.5) * 0.04);
      p.history.push([nd, +apy.toFixed(4), Math.round(h[2] * (md.tvl ?? 1))]);
      p.apy = apy; p.tvlUsd = h[2] * (md.tvl ?? 1);
    });
    snap.generatedAt = nd + 'T12:00:00Z';
    shocked = true;
    setMarket(snap);
    // mark-to-market the positions with the new day's returns
    const before = m.positions.reduce((s, x) => s + x.usd, 0);
    m.positions.forEach(x => { x.usd *= 1 + (S.pools[x.id].ret[S.T] ?? 0) + (extraLoss[x.id] || 0); });
    const after = m.positions.reduce((s, x) => s + x.usd, 0);
    state.bt = null; state.rl = null;
    logEvt('alert', `⚡ 市場事件（${nd}）：${desc}。組合價值 ${usd(before)} → ${usd(after)}（${pct(after / before - 1, 2)}）`);
    monitorCheck();
  }

  function renderMonitor() {
    if (!state.monitor) initMonitor(state.agent);
    drawMonitor();
  }
  function drawMonitor() {
    const m = state.monitor; if (!m) return;
    const tot = m.positions.reduce((s, x) => s + x.usd, 0);
    const H = m.positions.map(healthOf);
    const curW = H.map(h => ({ pool: h.p, w: h.w, mu: Engine.forecast(h.p).mean / 100, risk: h.r.score }));
    const st = Engine.portfolioStats(curW);
    const vr = Engine.valueAtRisk(curW, tot);
    $('#monSrc').textContent = m.source + (m.blacklist.size ? ` · 黑名單：${[...m.blacklist].map(p => Engine.PROTOCOLS[p]?.name || p).join('、')}` : '');
    $('#monStats').innerHTML =
      statCard('vault', '組合價值', usd(tot), `本金 ${usd(m.P.capital)}（${pct(tot / m.P.capital - 1, 2)}）`, tot >= m.P.capital ? 'pos' : 'neg', true) +
      statCard('trend', '目前預期 APY', apyF(st.expApy), `加權風險 ${st.riskScore.toFixed(0)}`) +
      statCard('alert', '30 日 VaR (95%)', usd(vr.var30Usd), pct(vr.var30)) +
      statCard('shield', '健康部位', `${H.filter(h => !h.issues.length).length} / ${H.length}`, H.some(h => h.issues.length) ? '有部位需要注意' : '全部正常', H.some(h => h.issues.length) ? 'neg' : 'pos');
    $('#monTable').innerHTML = `<thead><tr><th>部位</th><th class="r">價值</th><th class="r">權重 / 目標</th><th class="r">APY</th><th class="r">TVL</th><th>風險</th><th>狀態</th></tr></thead><tbody>` +
      H.map((h, i) => `<tr class="click" data-pool="${h.p.id}"><td>${poolCell(h.p)}</td><td class="r num">${usd(m.positions[i].usd)}</td><td class="r num">${pct(h.w, 1)} / ${pct(m.positions[i].target, 0)}</td><td class="r num">${apyF(h.p.apyS[S.T])}</td><td class="r num">${usdShort(h.p.tvlS[S.T] || 0)}</td><td>${gradeTag(h.r)}</td><td style="white-space:normal;min-width:150px">${h.issues.length ? `<span class="pill neg">⚠ ${esc(h.issues[0])}</span>` : '<span class="pill pos">● 健康</span>'}</td></tr>`).join('') + '</tbody>';
    $('#shocks').innerHTML = SHOCKS.map(s => `<button class="shock" data-shock="${s.k}"><b>${s.t}</b><span>${s.d}</span></button>`).join('');
    const pr = m.proposal;
    $('#applyRebal').disabled = !pr;
    $('#rebalBox').innerHTML = pr ? `
      <p class="card-desc" style="margin-bottom:10px">預期 APY ${apyF(pr.before.expApy)} → <b class="pos">${apyF(pr.target.expApy)}</b> · 風險 ${pr.before.riskScore.toFixed(0)} → ${pr.target.riskScore.toFixed(0)}</p>
      <div class="table-wrap"><table><thead><tr><th>動作</th><th>收益池</th><th class="r">金額</th></tr></thead><tbody>
      ${pr.list.map(([id, v]) => `<tr><td><span class="pill ${v < 0 ? 'neg' : 'pos'}">${v < 0 ? '賣出' : '買入'}</span></td><td>${poolCell(S.pools[id])}</td><td class="r num">${usd(Math.abs(v))}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">目前沒有觸發條件 ✓<br><span class="note">試試右上方的市場衝擊模擬器</span></div>';
    $('#monLog').innerHTML = m.log.map(l => `<div class="log-item ${l.kind}"><time>${l.at.toLocaleTimeString('zh-TW', { hour12: false })}</time>${esc(l.text)}</div>`).join('');
  }

  // ---------------- Wiring ----------------
  function bind() {
    document.addEventListener('click', e => {
      const nav = e.target.closest('[data-page]'); if (nav) { e.preventDefault(); go(nav.dataset.page); return; }
      const g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go); return; }
      const row = e.target.closest('[data-pool]'); if (row) { openPool(S.pools[+row.dataset.pool]); return; }
      if (e.target.closest('[data-close]') || e.target.classList.contains('modal-bg')) { $$('.modal-bg').forEach(m => m.classList.remove('show')); return; }
      const sort = e.target.closest('[data-sort]'); if (sort) { const k = sort.dataset.sort; protoSort = { k, dir: protoSort.k === k ? -protoSort.dir : (k === 'risk' ? 1 : -1) }; renderProtocols(); return; }
      const sh = e.target.closest('[data-shock]'); if (sh) { applyShock(sh.dataset.shock); return; }
      if (e.target.closest('[data-sync]')) { liveSync(); return; }
      const chip = e.target.closest('.chip'); if (chip) { onChat(chip.textContent); return; }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal-bg').forEach(m => m.classList.remove('show')); });
    const segs = (sel, cb) => $(sel).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$(sel + ' button').forEach(x => x.classList.toggle('active', x === b)); cb && cb(b); });
    segs('#pProfile'); segs('#btProfile'); segs('#ovRange', b => { ovRange = +b.dataset.r; renderOverview(); });
    segs('#protoFilter', b => { protoFilter = b.dataset.f; renderProtocols(); });
    $('#protoSearch').addEventListener('input', renderProtocols);
    $('#runAgent').onclick = () => runAgent(false);
    $('#chatSend').onclick = () => onChat($('#chatText').value);
    $('#chatText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onChat(e.target.value); } });
    $('#runBt').onclick = runBacktest;
    $('#runRl').onclick = runRL;
    $('#rlEp').oninput = e => { $('#rlEpV').textContent = e.target.value; };
    $('#rlRisk').oninput = e => { $('#rlRiskV').textContent = e.target.value; };
    $('#applyRebal').onclick = () => applyProposal(false);
    $('#autoRebal').onclick = e => { e.currentTarget.classList.toggle('on'); toast(e.currentTarget.classList.contains('on') ? '已開啟自動再平衡：觸發條件時 Agent 會直接執行' : '已關閉自動再平衡'); if (e.currentTarget.classList.contains('on') && state.monitor?.proposal) applyProposal(true); };
    $('#resetShock').onclick = () => { shocked = false; setMarket(structuredClone(BASE)); state.bt = null; state.rl = null; initMonitor(state.agent); drawMonitor(); toast('市場已重設為最新資料'); };
    $('#menuToggle').onclick = () => { $('#sidebar').classList.toggle('active'); $('#overlay').classList.toggle('active'); };
    $('#overlay').onclick = () => { $('#sidebar').classList.remove('active'); $('#overlay').classList.remove('active'); };
    // theme
    const applyTheme = t => { document.documentElement.dataset.theme = t; $('#themeSwitch').classList.toggle('on', t === 'light'); };
    applyTheme(store.get('yp_theme') || 'dark');
    $('#themeSwitch').onclick = () => { const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; applyTheme(t); store.set('yp_theme', t); renderPage(state.page); };
    // settings
    const badge = () => { $('#llmBadge').textContent = llm.key() ? '已連線' : '離線'; $('#agentMode').textContent = llm.key() ? `LLM：${llm.model()}` : '規則引擎'; };
    $('#openSettings').onclick = () => { $('#apiKey').value = llm.key() || ''; $('#apiModel').value = llm.model(); $('#settingsModal').classList.add('show'); };
    $('#saveKey').onclick = () => { const k = $('#apiKey').value.trim(); store.set('yp_key', k || null); store.set('yp_model', $('#apiModel').value); badge(); $('#settingsModal').classList.remove('show'); toast(k ? '✓ 已儲存，Agent 會使用 Claude 生成策略說明' : '已清除 Key'); };
    $('#clearKey').onclick = () => { store.set('yp_key', null); $('#apiKey').value = ''; badge(); toast('已清除 API Key'); };
    badge();
  }

  async function init() {
    bind();
    try { await loadSnapshot(); }
    catch (e) { $('#dataStamp').textContent = '資料載入失敗'; console.error(e); return; }
    const h = location.hash.slice(1);
    go(['overview', 'agent', 'protocols', 'backtest', 'rl', 'monitor', 'about'].includes(h) ? h : 'overview');
    setInterval(() => { if (state.monitor && state.page === 'monitor' && !document.hidden) monitorCheck(); }, 45000);
  }
  init();
})();
