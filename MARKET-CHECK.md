# 市場查證：有人做過「Steam 標籤 → 遊戲雛型」嗎

查證日期：2026-08-05｜方法：DuckDuckGo 搜尋結果清單 ＋ 逐站直接抓取頁面 ＋ GitHub API 搜尋
限制：WebSearch／WebFetch 工具當時故障，改用 curl；DuckDuckGo 在第二輪查詢開始跳 CAPTCHA，未繞過，故搜尋樣本以第一輪 10 筆結果為主，非窮盡。

## 結論

**沒有人做出完整的這條鏈**：全量官方標籤附說明 → 多選並標記角色 → 產出可執行的雛型工單。
市面上的工具分成三群，各自只做其中一段，且**主流方向與本專案相反**（他們是「已有遊戲 → 推薦標籤做行銷」，本專案是「先選標籤 → 生出遊戲」）。

## 最接近的既有工具

| 工具 | 做什麼 | 與本專案的差距 |
|---|---|---|
| **Perchance — Game Idea Generator Ultra**<br>`perchance.org/game-idea-ultra` | 用 3 個隨機或使用者選定的 Steam 標籤，生成遊戲點子敘述＋概念圖 | **唯一同方向者**。但上限 3 個標籤、無角色標記、無待抉擇機制、產出是點子敘述不是工單，也無繁中。頁面為 JS 載入，功能描述取自搜尋摘要，未能逐項實測 |
| **artbohr/game-idea-generator**（GitHub ★11） | 隨機混合 2 個熱門類型＋1 個 Steam 標籤產生點子 | 純隨機，使用者不能選；無說明、無產出 |

## 反方向工具（遊戲 → 標籤，行銷用）

這群最多人做，但解決的是「已經有遊戲，該掛什麼標籤」：

- **Game Marketing Intel — Steam Tag Analyzer & Builder**：貼 3 個競品 Steam 網址，比對出理想標籤清單
- **More Wishlists — Steam Tag Generator**：描述遊戲 → AI 推薦標籤（同站另有隨機 Game Idea Generator，與標籤無關）
- **StudioSprite — Steam Tag Analyzer**：貼遊戲描述 → 依相關度與流量排序標籤
- **IMPRESS — Steam Tag Analysis & Optimisation Tool**：標籤分析與最佳化
- **j-ac/Machine_Learning_Steam_Tag_Generator**（GitHub）：機器學習從商店頁描述預測標籤

## 有雛型生成、但沒有標籤入口

- **Seele AI — Game Prototype Generator**：概念 → 可測試的玩法循環與場景，無 Steam 標籤選擇器
- **Ludo.ai**：2026-08 實際查看，首頁已轉為 AI **素材**生成（sprite、2D、3D、音樂、影片），不再主打遊戲點子與市場數據。先前憑記憶的印象已過時，此處以實際頁面為準

## 本專案仍然值得做的理由

1. 全量 430 官方標籤附**繁中官方譯名＋白話說明**，中文圈沒有對應工具
2. **角色標記（核心／差異化／待抉擇）** 是既有工具都沒有的機制——把標籤抉擇當成設計決策，而不只是行銷欄位
3. 產出是帶**範圍鎖、yes/no 驗收條件、失敗路徑**的工單，不是一段點子文字
4. 進階管線模式可接創作者自有的 Unity 資產庫索引，讓產出的套件建議限定在實際持有的範圍內
5. 教學用途：可直接當遊戲企劃課的作業工具
