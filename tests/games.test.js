/**
 * 參考遊戲配對（core.matchGames）的回歸測試。跑法：npm test
 *
 * 排序與權重用合成資料測，不依賴網路，也不依賴 data/game-index.json 抓完沒有——
 * 建置資料是會變的，拿它當斷言基礎的測試遲早會無故變紅。
 *
 * data/game-index.json 存在時，另外做結構檢查（欄位型別、標籤 id 是否在標籤庫內、
 * 有沒有重複 appid、簡介有沒有殘留 HTML）。不存在就跳過，不讓 CI 因為還沒抓資料而失敗。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const core = require("../core.js");
const T = require("../data/tags.json");
const IDX = core.makeIndex(T);
const { matchGames, gameUrls, GAME_W } = core;

const idOf = en => {
  const t = IDX.byEn[en];
  assert.ok(t, `測試用標籤「${en}」不在標籤庫裡，請換一個存在的標籤`);
  return t[5];
};

/* 用真實標籤名建合成索引，這樣標籤改名時測試會直接指出來 */
const A = "Roguelike", B = "Pixel Graphics", C = "Horror", D = "Singleplayer";
const idA = idOf(A), idB = idOf(B), idC = idOf(C), idD = idOf(D);

/** [appid, 名稱, 簡介, 圖片路徑, [tagid...], 年份] */
const GI = {
  games: [
    [101, "全中", "四個標籤全部命中", "101/aaa/movie_600x337.jpg", [idA, idB, idC, idD], 2020],
    [102, "只中核心", "只有核心標籤命中", "102/bbb/header.jpg", [idA, 999999], 2021],
    [103, "只中差異化", "只有差異化標籤命中", "103/ccc/header.jpg", [idB, 999999], 2022],
    [104, "完全不中", "一個標籤都沒共通", "104/ddd/header.jpg", [999999], 2023],
    [105, "中核心與待抉擇", "核心加待抉擇", "105/eee/header.jpg", [idA, idD], 2024]
  ]
};

const sel = [
  { en: A, role: "core" },
  { en: B, role: "diff" },
  { en: C, role: "diff" },
  { en: D, role: "ask" }
];

test("沒選標籤時回空結果，不硬湊", () => {
  const r = matchGames([], GI, IDX);
  assert.equal(r.games.length, 0);
  assert.equal(r.matched, 0);
});

test("索引是空的時候回空結果，不丟例外", () => {
  assert.doesNotThrow(() => matchGames(sel, { games: [] }, IDX));
  assert.doesNotThrow(() => matchGames(sel, null, IDX));
  assert.equal(matchGames(sel, null, IDX).games.length, 0);
});

test("全部命中的排第一，且標為完全吻合", () => {
  const r = matchGames(sel, GI, IDX);
  assert.equal(r.games[0].appid, 101);
  assert.equal(r.games[0].exact, true);
  assert.equal(r.games[0].score, 1);
  assert.equal(r.games[0].miss.length, 0);
});

test("一個標籤都沒共通的不列入結果（那不叫接近）", () => {
  const r = matchGames(sel, GI, IDX);
  assert.ok(!r.games.some(g => g.appid === 104));
  assert.equal(r.matched, 4);
});

test("核心標籤的權重高於差異化", () => {
  const onlyCore = matchGames(sel, GI, IDX).games.find(g => g.appid === 102);
  const onlyDiff = matchGames(sel, GI, IDX).games.find(g => g.appid === 103);
  assert.ok(onlyCore.score > onlyDiff.score,
    `只中核心應該分數較高，實際 ${onlyCore.score} vs ${onlyDiff.score}`);
  assert.equal(GAME_W.core > GAME_W.diff && GAME_W.diff > GAME_W.ask, true);
});

test("核心標籤全中會被標記，落空數也算得出來", () => {
  const r = matchGames(sel, GI, IDX);
  const g102 = r.games.find(g => g.appid === 102);
  assert.equal(g102.allCore, true);
  assert.equal(g102.coreMiss, 0);
  const g103 = r.games.find(g => g.appid === 103);
  assert.equal(g103.allCore, false);
  assert.equal(g103.coreMiss, 1);
});

test("落空的標籤要列得出來，使用者才知道差在哪", () => {
  const g = matchGames(sel, GI, IDX).games.find(x => x.appid === 105);
  const missed = g.miss.map(m => m.en).sort();
  assert.deepEqual(missed, [B, C].sort());
  const hits = g.hit.map(h => h.en).sort();
  assert.deepEqual(hits, [A, D].sort());
});

test("limit 生效", () => {
  assert.equal(matchGames(sel, GI, IDX, { limit: 2 }).games.length, 2);
  assert.equal(matchGames(sel, GI, IDX, { limit: 99 }).games.length, 4);
});

test("重複選同一個標籤不會灌水分數", () => {
  const dup = [{ en: A, role: "core" }, { en: A, role: "core" }];
  const r = matchGames(dup, GI, IDX);
  assert.equal(r.want.length, 1);
  assert.equal(r.games[0].score, 1);
});

test("縮圖網址＝前綴＋資料檔存的路徑，不做任何推導", () => {
  const u = gameUrls({ appid: 101, img: "101/aaa/movie_600x337.jpg" });
  assert.equal(u.store, "https://store.steampowered.com/app/101/");
  assert.equal(u.thumb, core.STEAM_ASSET + "101/aaa/movie_600x337.jpg");
});

test("img 已是完整網址時原樣使用（其他 CDN 也要能過）", () => {
  const full = "https://shared.fastly.steamstatic.com/x/y/header.jpg";
  assert.equal(gameUrls({ appid: 1, img: full }).thumb, full);
});

test("沒有圖片時回空字串，不組出一個註定 404 的網址", () => {
  assert.equal(gameUrls({ appid: 1, img: "" }).thumb, "");
  assert.equal(gameUrls({ appid: 1 }).thumb, "");
});

test("matchGames 會把圖片路徑原封帶出來", () => {
  const g = matchGames(sel, GI, IDX).games.find(x => x.appid === 101);
  assert.equal(g.img, "101/aaa/movie_600x337.jpg");
});

/* ---------- 組合罕見度 ---------- */
const { assessCombo, comboBaseline } = core;
/* 合成索引：A+B 常一起出現，C 只跟 A 出現一次，D 從不跟 B 出現 */
const GI2 = {
  _meta: {
    lowScore: { 3: 0.6, 4: 0.5, 5: 0.5, 6: 0.45, 7: 0.4, 8: 0.35, 9: 0.35, 10: 0.35, 11: 0.35, 12: 0.35 },
    tagTotals: { [idA]: 5000, [idB]: 8000, [idC]: 12000, [idD]: 90000, 1: 10, 2: 20, 3: 30, 4: 40, 5: 50 }
  },
  games: [
    [201, "AB", "", "x.jpg", [idA, idB], 2020, 100],
    [202, "AB2", "", "x.jpg", [idA, idB], 2021, 50],
    [203, "AC", "", "x.jpg", [idA, idC], 2022, 10],
    [204, "AD", "", "x.jpg", [idA, idD], 2023, 0]
  ]
};

test("罕見度：配對率低於同標籤數門檻才標記", () => {
  // 選 A、B、C（3 個）：第 1 名只中 2/3＝0.667，門檻 0.6 → 不標記
  const ok = assessCombo([{ en: A, role: "core" }, { en: B, role: "core" }, { en: C, role: "core" }], GI2, IDX);
  assert.equal(ok.n, 3);
  assert.equal(ok.threshold, 0.6);
  assert.equal(ok.low, false);
  // 選 B、C、D：每款最多中 1 個 → 0.333 < 0.6 → 標記
  const low = assessCombo([{ en: B, role: "core" }, { en: C, role: "core" }, { en: D, role: "core" }], GI2, IDX);
  assert.equal(low.low, true);
});

test("罕見度：配對率剛好等於門檻不標記（最低 20% 是嚴格低於）", () => {
  const exact = { _meta: Object.assign({}, GI2._meta, { lowScore: { 3: 1 / 3 } }), games: GI2.games };
  const a = assessCombo([{ en: B, role: "core" }, { en: C, role: "core" }, { en: D, role: "core" }], exact, IDX);
  assert.equal(a.topScore, 1 / 3);
  assert.equal(a.low, false, "3 個標籤中 1 個，配對率 1/3，門檻也是 1/3，不應標記");
});

test("罕見度：列出從未同時出現的核心／差異化配對，待抉擇不算", () => {
  const a = assessCombo([{ en: B, role: "core" }, { en: C, role: "diff" }, { en: D, role: "ask" }], GI2, IDX);
  assert.deepEqual(a.gaps, [[B, C]], "B 與 C 從未同時出現；D 是待抉擇，不參與");
  assert.equal(a.rarestPair, null, "有完全缺口時不另列最少配對");
});

test("罕見度：沒有完全缺口時，列出一起出現次數最少的配對", () => {
  // A、B、C 三個：B＋C 從沒一起出現 → 有缺口
  const withGap = assessCombo([{ en: A, role: "core" }, { en: B, role: "core" }, { en: C, role: "core" }], GI2, IDX);
  assert.deepEqual(withGap.gaps, [[B, C]]);
  // A、B、D：A＋B 2 款、A＋D 1 款、B＋D 0 款 → 仍有缺口；改用 A、C：只有一組且出現 1 次
  const noGap = assessCombo([{ en: A, role: "core" }, { en: C, role: "core" }], GI2, IDX);
  assert.deepEqual(noGap.gaps, []);
  assert.deepEqual(noGap.rarestPair, { pair: [A, C], count: 1 });
});

test("罕見度：標籤數超出門檻範圍時用端點；沒有門檻資料就不標記", () => {
  const two = assessCombo([{ en: B, role: "core" }, { en: C, role: "core" }], GI2, IDX);
  assert.equal(two.threshold, 0.6, "2 個標籤用 3 的門檻");
  const noMeta = assessCombo([{ en: B, role: "core" }, { en: C, role: "core" }], { games: GI2.games }, IDX);
  assert.equal(noMeta.threshold, null);
  assert.equal(noMeta.low, false);
  assert.deepEqual(noMeta.rareTags, []);
});

test("罕見度：Steam 總遊戲數落在標籤庫最低 20% 的算少見", () => {
  // 總數排序 10,20,30,40,50,5000,8000,12000,90000 → 第 20 百分位是第 1 個（索引 1）＝20
  const a = assessCombo([{ en: A, role: "core" }, { en: D, role: "core" }], GI2, IDX);
  assert.equal(a.rareCut, 20);
  assert.deepEqual(a.rareTags, [], "A 5000、D 90000 都不少見");
});

test("罕見度：空選擇或空索引不丟例外", () => {
  assert.doesNotThrow(() => assessCombo([], GI2, IDX));
  assert.equal(assessCombo([], GI2, IDX).low, false);
  assert.equal(assessCombo([{ en: A, role: "core" }], { games: [] }, IDX).low, false);
});

/* 門檻計算用真實標籤庫與合成索引，只驗形狀與可重現性，不驗數值（數值隨資料變） */
test("門檻計算：3～12 個標籤各有一個 0～1 的值，同種子結果相同", () => {
  const mkRng = () => { let a = 42; return () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; }; };
  const b1 = comboBaseline({ T: T, idx: IDX, GI: GI2, rng: mkRng(), samples: 30 });
  const b2 = comboBaseline({ T: T, idx: IDX, GI: GI2, rng: mkRng(), samples: 30 });
  assert.deepEqual(Object.keys(b1).map(Number), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  Object.values(b1).forEach(v => assert.ok(v === null || (v >= 0 && v <= 1), "門檻值超出範圍：" + v));
  assert.deepEqual(b1, b2);
});

/* ---------- 建置資料檔的結構檢查（檔案不存在就跳過） ---------- */
const GI_FILE = path.join(__dirname, "..", "data", "game-index.json");
const hasFile = fs.existsSync(GI_FILE);

test("data/game-index.json 結構正確", { skip: hasFile ? false : "尚未建置 game-index.json" }, () => {
  const real = JSON.parse(fs.readFileSync(GI_FILE, "utf8"));
  assert.ok(Array.isArray(real.games) && real.games.length > 0, "games 必須是非空陣列");
  /* 決選名額不該被已知擋下的項目佔掉（2026-09-17 沒排除時 3000 名額只收到 2895 款）。
     容許 1%：第 3 輪遞補後仍可能有少數新抓才發現不是遊戲的 */
  assert.ok(real.games.length >= 2970, "收錄款數 " + real.games.length + " 離 3000 太遠，檢查決選是否先排除已知收不進來的項目");
  const tagIds = new Set(T.map(t => t[5]));
  const seen = new Set();
  for (const g of real.games) {
    assert.equal(g.length, 7, `每筆應有 7 個欄位，appid ${g[0]} 有 ${g.length} 個`);
    assert.ok(Number.isInteger(g[6]) && g[6] >= 0, `appid ${g[0]} 評論數必須是非負整數：${g[6]}`);
    assert.equal(typeof g[0], "number", "appid 必須是數字");
    assert.ok(!seen.has(g[0]), `appid ${g[0]} 重複`);
    seen.add(g[0]);
    assert.ok(typeof g[1] === "string" && g[1].length > 0, `appid ${g[0]} 沒有名稱`);
    assert.equal(typeof g[2], "string", `appid ${g[0]} 簡介欄位型別錯`);
    assert.ok(!/<[a-z/]/i.test(g[2]), `appid ${g[0]} 的簡介殘留 HTML 標籤：${g[2].slice(0, 60)}`);
    assert.ok(typeof g[3] === "string" && g[3].length > 0, `appid ${g[0]} 沒有圖片路徑`);
    assert.ok(!g[3].includes("?"), `appid ${g[0]} 的圖片路徑殘留查詢字串：${g[3]}`);
    assert.ok(/\.(jpg|png|webp)$/i.test(g[3]), `appid ${g[0]} 的圖片路徑副檔名不對：${g[3]}`);
    assert.ok(Array.isArray(g[4]) && g[4].length > 0, `appid ${g[0]} 沒有任何標籤`);
    for (const t of g[4]) assert.ok(tagIds.has(t), `appid ${g[0]} 出現標籤庫沒有的 tagid ${t}`);
  }
  assert.equal(real._meta.count, real.games.length, "_meta.count 與實際筆數不符");
});

/* 覆蓋率只要求「工具會推薦的標籤」。
   禁抽清單裡的非遊戲軟體標籤（Video Production、Benchmark 之類）永遠不會被覆蓋，
   因為抓取階段就濾掉 type !== "game" 的項目——那是刻意的，不該算成失敗。
   其餘標籤若大面積沒覆蓋，代表爬取或篩選壞了，要當場擋下來。 */
test("標籤覆蓋率夠高（工具會推薦的標籤，配不到遊戲的不超過 2%）",
  { skip: hasFile ? false : "尚未建置 game-index.json" }, () => {
    const real = JSON.parse(fs.readFileSync(GI_FILE, "utf8"));
    const covered = new Set();
    real.games.forEach(g => g[4].forEach(t => covered.add(t)));
    const rollable = T.filter(t => !core.BAN.has(t[1]));
    const empty = rollable.filter(t => !covered.has(t[5])).map(t => t[1]);
    const pct = empty.length / rollable.length;
    assert.ok(pct <= 0.02,
      `${empty.length}/${rollable.length} 個可抽標籤查無任何遊戲（${(pct * 100).toFixed(1)}%），`
      + `使用者點下去會看到空白：${empty.slice(0, 20).join("、")}`);
  });

/* 這個測試只抓得到「所有標籤都是禁抽標籤」的項目，擋不住被玩家掛了一般遊戲標籤的軟體
   （Krita 就掛了 Hand-drawn）。真正的軟體判別看發行商類別，在 steam-filters.test.js 測；
   這裡名稱照實寫，不讓人誤以為軟體已經在這層被完整檢查。 */
test("索引不含只掛禁抽標籤的項目", { skip: hasFile ? false : "尚未建置 game-index.json" }, () => {
  const real = JSON.parse(fs.readFileSync(GI_FILE, "utf8"));
  const banIds = new Set(T.filter(t => core.BAN.has(t[1])).map(t => t[5]));
  const banOnly = real.games.filter(g => g[4].every(t => banIds.has(t)));
  assert.equal(banOnly.length, 0,
    `有 ${banOnly.length} 筆只掛禁抽標籤：` + banOnly.slice(0, 5).map(g => g[1]).join("、"));
});

/* 快取裡有發行商類別的項目，用跟爬蟲同一條規則（steam-filters.isSoftware）再驗一次，
   確認沒有軟體類別漏進索引。沒有類別資料的舊快取項目無法在這裡驗，另計數量供參考。 */
const CACHE_FILE = path.join(__dirname, "..", "data", "raw", "game-details-cache.json");
test("快取有類別資料的項目，沒有軟體類別進到索引", { skip: hasFile && fs.existsSync(CACHE_FILE) ? false : "缺索引或快取" }, () => {
  const { isSoftware } = require("../steam-filters.js");
  const real = JSON.parse(fs.readFileSync(GI_FILE, "utf8"));
  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  const withGen = real.games.filter(g => cache[g[0]] && Array.isArray(cache[g[0]].gen));
  const leaked = withGen.filter(g => isSoftware({ genres: cache[g[0]].gen.map(id => ({ id })) }));
  assert.ok(withGen.length > 0, "索引裡沒有任何一筆有類別資料，這個測試形同虛設");
  assert.equal(leaked.length, 0, "軟體類別漏進索引：" + leaked.slice(0, 5).map(g => g[1]).join("、"));
});

/* 人工排除清單：格式要對、每筆都要有理由、而且真的被排除了 */
const EXCLUDE_FILE = path.join(__dirname, "..", "data", "game-exclude.json");
test("人工排除清單格式正確，且清單內項目都不在索引裡", { skip: hasFile && fs.existsSync(EXCLUDE_FILE) ? false : "缺索引或排除清單" }, () => {
  const ex = JSON.parse(fs.readFileSync(EXCLUDE_FILE, "utf8"));
  const real = JSON.parse(fs.readFileSync(GI_FILE, "utf8"));
  const inIndex = new Set(real.games.map(g => g[0]));
  const seen = new Set();
  for (const k of Object.keys(ex).filter(k => !k.startsWith("_"))) {
    assert.ok(Array.isArray(ex[k]), `排除清單的「${k}」必須是陣列`);
    for (const item of ex[k]) {
      assert.equal(typeof item.appid, "number", `「${k}」有一筆 appid 不是數字：${JSON.stringify(item)}`);
      assert.ok(item.name && item.reason, `「${k}」的 appid ${item.appid} 缺名稱或理由`);
      assert.ok(!seen.has(item.appid), `appid ${item.appid} 在排除清單重複出現`);
      seen.add(item.appid);
      assert.ok(!inIndex.has(item.appid), `appid ${item.appid}（${item.name}）在排除清單上卻仍在索引裡，請跑 node build-game-index.js --select`);
    }
  }
});

/* 整份比對，不是只比首末筆：中間某筆在注入時被截斷或改壞，首末筆與筆數照樣對得上 */
test("index.html 內嵌的遊戲索引與 data/game-index.json 完全一致", { skip: hasFile ? false : "尚未建置 game-index.json" }, () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = /const GI=(\{.*?\});\n/s.exec(html);
  assert.ok(m, "index.html 找不到內嵌的 const GI=…，請跑 npm run build");
  const inHtml = JSON.parse(m[1]);
  const onDisk = JSON.parse(fs.readFileSync(GI_FILE, "utf8"));
  assert.equal(inHtml.games.length, onDisk.games.length, "內嵌筆數與資料檔不一致，請重跑 npm run build");
  assert.deepEqual(inHtml, onDisk, "內嵌索引與資料檔內容不一致，請重跑 npm run build");
});
