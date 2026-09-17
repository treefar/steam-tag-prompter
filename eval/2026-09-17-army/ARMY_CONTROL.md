# ARMY_CONTROL：Steam 標籤定位器配對品質測試（基準輪）

## 目標
量測「選好的標籤組合，能否有效對應到最接近的遊戲」。本輪測線上現況（commit 419a404、索引 2709 款）當基準；資料補強與門檻改版後，用同一份題目重測對比。**不評判成人與否**（收錄方針：忠於 Steam）。

## 授權
2026-09-17 老師於對話親口指示「再一次請大軍去測試」，並於派工表列出後確認「照派工表：先測基準、改完重測」。

## 探測紀錄（2026-09-17 00:2x TF-GO，僅免費探測）
| 線 | 狀態 | 依據 |
|---|---|---|
| agy 1.1.27 | READY | `agy models` 列 14 個模型 |
| Claude 子代理 | READY | 主線可用 |
| Copilot | EXHAUSTED | `gh api copilot_internal/user` remaining −2／1500，10-01 重置 |
| codex 主池 | EXHAUSTED | hub.json 100%，09-19 16:14 重置 |
| codex Spark | Blocked | 09-16 探針 400：model not supported；models_cache 已無此型號 |

## 派工表
| 派工名稱 | 執行者 | 模型完整 ID | 層級 |
|---|---|---|---|
| T1 已知答案測試 | Claude 子代理 | claude-sonnet-5 | medium（子代理 5 檔第 3 檔） |
| T2 配對品質盲評 A | agy | claude-opus-4-6-thinking | Claude 系列無層級 |
| T3 配對品質盲評 B | agy | gemini-3.1-pro-high | 內含於模型 ID（high，agy 頂檔） |
| T4 總驗收 | 主控 | claude-opus-5 | — |

## 檔案責任（無 worktree：各線唯讀，只寫自己的報告資料夾）
| 線 | 可讀 | 可寫 |
|---|---|---|
| T1 | baseline/、taskT1/games.json | taskT1/ 底下新檔、reports/ARMY_claude-sonnet-5.md |
| T2 | taskT2/bundle.md | taskT2/reportT2.md |
| T3 | taskT3/bundle.md | taskT3/reportT3.md |
| 主控 | 全部 | control/、reports/ARMY_FINAL.md |
黑名單：任何線不得修改 baseline/、control/，不得碰 C:/projects/steam-tag-prompter。

## Yes／No 驗收條件
T1
1. 40 款全部有結果列，或寫明取不到的原因
2. 每款記錄：Steam 前 6 高票標籤（且存在於標籤庫）、這 6 個在基準索引中被記錄了幾個、用它們（全設核心）配對時該遊戲自己的名次、第 1 名配對率
3. 報告的彙總數字（前 1 名命中率、前 6 名命中率、名次中位數、標籤覆蓋率中位數）由主控重跑腳本後完全一致
T2／T3
4. 評分表恰好 120 列，(題號, 名次, appid) 集合與答案鍵完全相同
5. 分數只有 2／1／0
6. 每組提名 0～3 款「該出現卻沒出現」的遊戲，每款附 appid 或寫「appid 不確定」

## 測試方式
主控重跑 T1 腳本比對數字；T2／T3 以程式比對 appid 集合、計算兩評審一致度（完全一致率、加權 kappa）；提名遊戲由主控到 Steam 商店頁抓真實標籤查證。

## 停止條件
同一根因連續兩輪未解；或需要新增權限、付費、改環境、發布即停，記為 Blocked。
