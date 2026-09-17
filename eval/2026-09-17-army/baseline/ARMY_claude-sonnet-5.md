# 工單 T1 報告

**實際模型**：claude-sonnet-5（模型 ID `claude-sonnet-5`）
**結論**：PASS

## 驗收條件逐項核對

1. `taskT1/t1.js`、`taskT1/steam_tags.json`、`taskT1/results.json`、`reports/ARMY_claude-sonnet-5.md` 四檔都存在。
2. `results.json` 含 40 列；40 款全部成功抓到並解析商店頁標籤，無需 `error` 欄位（腳本本身支援該欄位，未觸發）。
3. `node t1.js --offline` 重跑後的 `summary` 與連網版逐欄位比對（`JSON.stringify` 相等）：**完全相同**。
4. 只寫了 `ARMY/taskT1/` 底下的 `t1.js`、`steam_tags.json`、`results.json`；未碰 `ARMY/baseline/`、`ARMY/control/`、`C:/projects/steam-tag-prompter`，未做任何 git 操作。連網僅打 `https://store.steampowered.com/app/<appid>/?l=english`，40 次請求間隔皆 ≥1600ms，單款最多重試 3 次（本次 40 款一次到位，未觸發重試或限流停止）。

## 彙總數字

| 指標 | 數值 |
|---|---|
| hitAt1（自己排第 1） | 0.900（36/40） |
| hitAt6（自己排前 6） | 1.000（40/40） |
| medianRank | 1 |
| medianRecorded | 6（0～6） |

**byRecorded**（依 top6 中有幾個 tagid 已記在基準索引分組）：只有 `recorded=6` 這一組有樣本，40 款全部落在這組，hitAt6=1.000；其餘 0～5 組與 null 組款數均為 0。也就是說這 40 款遊戲的「Steam 商店頁前 6 熱門標籤」全部已經被基準索引記錄齊全，沒有出現索引漏標的情況，故本次測試量不到「記得越多標籤，排名越前面」這條關係——`byRecorded` 沒有變異可比。

**bySegment**（依人氣分段）：segment 1～4 的 hitAt6 皆為 1.000（各 10/10），命中率不隨人氣分段而變化。

## selfRank > 6 或 null 的遊戲清單

無。40 款全部 selfRank ≤ 3（實際上是 1 或 2 或 3），沒有任何一款掉出前 6，也沒有任何一款抓取失敗。

## 未拿到第 1 名的 4 款（selfRank 2～3，共 4/40，對應 hitAt1=0.900 的缺口）

| 遊戲 | selfRank | selfScore | 並列的第 1 名 | top1Score |
|---|---|---|---|---|
| Hollow Knight: Silksong | 2 | 1.0000 | Hollow Knight | 1.0000 |
| 戰地風雲™ 6 | 2 | 1.0000 | 戰地風雲™ 禁區衝突 | 1.0000 |
| Resident Evil 3 Nemesis (1999) | 3 | 1.0000 | Resident Evil 4 | 1.0000 |
| The Lord of the Rings: War in the North™ Legacy Edition | 3 | 1.0000 | 龍之劍:覺醒 | 1.0000 |

## 觀察到的主要原因（3 條，均有數字佐證）

1. **不是配對失準，是分數並列後靠索引順位分勝負。** 上表 4 款的 `selfScore` 與 `top1Score` 都是 1.0000（6/6 核心標籤全中），`matchGames` 的排序規則是「分數相同時比 `coreMiss`，再比索引原始順位（`rank`，約略等於人氣）」。這 4 款都是被同系列或同類型、且在索引裡人氣序號更靠前的遊戲並列蓋過去（例如 Hollow Knight 的本體排在前傳 Silksong 前面），不是工具找不到自己，而是「自己」與另一款分數 100% 打平時規則選了對方。

2. **問題出在「6 個最熱門標籤太泛」，不是索引資料缺漏。** 這 4 款的 `recorded` 都是 6（top6 全部命中索引），也就是 `byRecorded` 唯一有樣本的那一組（40/40 款皆 recorded=6，hitAt6=1.000）。可見拿 Steam 商店頁排名最前的 6 個標籤（如 Multiplayer/FPS/Military/Action/Shooter/Singleplayer，或 Action/RPG/Hack and Slash/Action RPG/Adventure/Third Person）去配，本質上只描述了「這一整個系列／類型」，而非單款遊戲的差異化特徵，所以同系列前作或同類型作品會被配成滿分並列。

3. **命中率本身沒有問題：hitAt6 全數 100%（40/40），只有最嚴格的 hitAt1 掉了 10%（4/40）。** 若把驗收門檻放在「排進前 6」，配對與索引資料完全沒有問題；缺口只出現在「必須精確排第一」這個更嚴的指標上，而且 4 個缺口全部可以用觀察 1、2 解釋，沒有出現無法解釋的排名混亂或索引缺標籤的個案。

## 阻礙

無。40 款商店頁一次全部抓取成功，未觸發重試、未觸發限流停止；`tags.json` 對 Steam 原始標籤的覆蓋率也足以讓每款都湊出滿 6 個核心標籤，沒有需要標記為「不確定」的資料缺口。
