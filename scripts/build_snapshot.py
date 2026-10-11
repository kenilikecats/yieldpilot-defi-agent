"""Build data/snapshot.json for the DeFi Yield Agent.

Pulls the current pool list from DefiLlama Yields, keeps a curated universe of
mainstream protocols, then fetches ~1 year of daily APY/TVL history per pool
plus ETH/BTC price history (used for VaR and USD-denominated backtests).

Run: python scripts/build_snapshot.py
"""
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "snapshot.json"
HISTORY_DAYS = 365

# (project, chain, symbol, poolMeta-substring or None)
UNIVERSE = [
    ("aave-v3", "Ethereum", "USDT", None),
    ("aave-v3", "Ethereum", "USDC", None),
    ("aave-v3", "Ethereum", "WETH", None),
    ("aave-v3", "Arbitrum", "USDC", None),
    ("aave-v3", "Base", "USDC", None),
    ("compound-v3", "Ethereum", "USDC", None),
    ("compound-v3", "Ethereum", "USDT", None),
    ("compound-v3", "Ethereum", "ETH", None),
    ("lido", "Ethereum", "STETH", None),
    ("rocket-pool", "Ethereum", "RETH", None),
    ("sky-lending", "Ethereum", "SUSDS", None),
    ("ethena-usde", "Ethereum", "SUSDE", None),
    ("fluid-lending", "Ethereum", "USDC", None),
    ("fluid-lending", "Ethereum", "USDT", None),
    ("uniswap-v3", "Ethereum", "USDC-WETH", "0.05%"),
    ("uniswap-v3", "Ethereum", "WETH-USDT", "0.3%"),
    ("uniswap-v3", "Ethereum", "WBTC-WETH", "0.05%"),
    ("uniswap-v3", "Base", "WETH-USDC", "0.3%"),
    ("curve-dex", "Ethereum", "ETH-STETH", None),
    ("curve-dex", "Ethereum", "USDT-CRVUSD", None),
    ("curve-dex", "Ethereum", "DOLA-SUSDE", None),
    ("convex-finance", "Ethereum", "DOLA-SUSDE", None),
    ("convex-finance", "Ethereum", "CVXCRV", None),
    ("gmx-v2-perps", "Arbitrum", "ETH-USDC", None),
    ("gmx-v2-perps", "Arbitrum", "WBTC.B-USDC", None),
    ("yearn-finance", "Ethereum", "USDC", None),
    ("morpho-blue", "Base", "SPARKUSDC", None),
    ("morpho-blue", "Base", "GTUSDCP", None),
    ("pendle-v2", "Ethereum", None, None),
    ("sparklend", "Ethereum", None, None),
]

FIELDS = [
    "pool", "chain", "project", "symbol", "poolMeta", "tvlUsd", "apy", "apyBase",
    "apyReward", "apyMean30d", "apyPct1D", "apyPct7D", "apyPct30D", "stablecoin",
    "ilRisk", "exposure", "mu", "sigma", "predictions", "rewardTokens",
]


def get(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "defi-yield-agent/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            if i == retries - 1:
                raise
            print("retry", url, e)
            time.sleep(2 + i * 3)


def pick(pools, project, chain, symbol, meta):
    cands = [
        p for p in pools
        if p["project"] == project and p["chain"] == chain
        and (symbol is None or p["symbol"] == symbol)
        and (meta is None or meta in (p.get("poolMeta") or ""))
        and (p.get("apy") or 0) > 0.2 and (p.get("apy") or 0) < 80
        and p["tvlUsd"] > 5e6
    ]
    return max(cands, key=lambda p: p["tvlUsd"]) if cands else None


def main():
    pools = get("https://yields.llama.fi/pools")["data"]
    chosen, seen = [], set()
    for rule in UNIVERSE:
        p = pick(pools, *rule)
        if p and p["pool"] not in seen:
            seen.add(p["pool"])
            chosen.append({k: p.get(k) for k in FIELDS})
    print("selected", len(chosen), "pools")

    cutoff = time.time() - HISTORY_DAYS * 86400
    for p in chosen:
        hist = get(f"https://yields.llama.fi/chart/{p['pool']}")["data"]
        series = []
        for h in hist:
            ts = datetime.fromisoformat(h["timestamp"].replace("Z", "+00:00")).timestamp()
            if ts >= cutoff and h.get("apy") is not None:
                series.append([h["timestamp"][:10], round(h["apy"], 4), round(h.get("tvlUsd") or 0)])
        p["history"] = series
        print(f"  {p['project']:<16}{p['symbol']:<14}{len(series)} days")
        time.sleep(0.25)

    prices = {}
    for cid, key in [("coingecko:ethereum", "ETH"), ("coingecko:bitcoin", "BTC")]:
        data = get(f"https://coins.llama.fi/chart/{cid}?span={HISTORY_DAYS}&period=1d")
        prices[key] = [
            [datetime.fromtimestamp(x["timestamp"], timezone.utc).strftime("%Y-%m-%d"), round(x["price"], 2)]
            for x in data["coins"][cid]["prices"]
        ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "DefiLlama Yields API + coins API",
        "pools": chosen,
        "prices": prices,
    }, separators=(",", ":")), encoding="utf-8")
    print("wrote", OUT, OUT.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
