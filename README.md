# YieldPilot — DeFi 智能投資 AI Agent（POC）

> 2026 生成式 AI／AI Agent 於企業實務之應用 · 模擬企業出題 **題目十四：DeFi 智能投資 AI Agent（Yield + Risk Optimization）**

**線上展示：** https://kenilikecats.github.io/yieldpilot-defi-agent/

## 功能
| 題目要求 | 實作 |
|---|---|
| 分析不同 DeFi 協議（Aave、Uniswap…） | 15 個協議、30 個收益池；8 因子風險模型（合約、收益波動、流動性、TVL 流失、無常損失、獎勵依賴、價格波動、脫鉤） |
| 預測收益（APY）與風險 | 阻尼 Holt 時序預測 + 95% 信賴區間；歷史模擬 VaR／CVaR、5 種壓力情境 |
| 自動配置資產 | 均值-變異數 + 風險懲罰最佳化（帶上限單純形投影梯度法），依保守／平衡／積極設定約束 |
| 即時調整投資組合 | 即時同步 DefiLlama 資料、觸發式再平衡、市場衝擊模擬器、自動執行模式 |
| Reinforcement Learning | 表格式 Q-Learning（12 種市場狀態 × 3 種動作），樣本外測試 |
| LLM 策略解釋 | 自然語言對話；可接 Claude API（使用者自備 key，瀏覽器直連）或規則式模板 |
| 回測 | Walk-forward（無未來函數）、交易成本，與 5 種基準比較 |

## 架構
純靜態網站（HTML/CSS/JS + Chart.js），部署在 GitHub Pages。`scripts/build_snapshot.py` 由 GitHub Actions 每日抓取 DefiLlama 資料，產生 `data/snapshot.json`；前端也可以直接即時同步。

```
js/engine.js   風險模型、預測、最佳化、VaR、回測、Q-Learning
js/app.js      介面、Agent 流程編排、LLM、監控
data/          每日資料快照
```

## 本機執行
```bash
python -m http.server 8000
```

## 致謝
- 資料：[DefiLlama](https://defillama.com/yields)
- 介面設計改編自 TemplateMo [609 Crypto Vault](https://templatemo.com/tm-609-crypto-vault)

⚠️ 教學用 POC，不連接錢包、不執行交易，不構成投資建議。
