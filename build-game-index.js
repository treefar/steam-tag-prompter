#!/usr/bin/env node
/**
 * build-game-index.js — 產生「依標籤找遊戲」用的離線資料檔 data/game-index.json
 *
 * 用法：
 *   node build-game-index.js              # 完整跑：爬標籤 → 補明細 → 挑選 → 輸出
 *   node build-game-index.js --resume     # 中斷後續跑：沿用既有候選池，只補還沒抓的明細
 *   node build-game-index.js --select     # 不連網，只用既有快取重新挑選與輸出
 *   node build-game-index.js --limit 1500 # 改收錄款數（預設 3000）
 *
 * 為什麼是離線資料檔而不是即時查：
 *   Steam 的 store API 不回 Access-Control-Allow-Origin，瀏覽器直接 fetch 一定被 CORS 擋。
 *   這個工具的定位是「單檔離線網頁」，所以資料在建置時抓好，執行期完全不連網。
 *
 * 兩個實測到的限制（2026-09-16 量測，會變，變了就改這裡）：
 *   1. appdetails 一次只吃一個 appid。傳多個回 null，filters 參數也不生效 → 只能一款一款抓。
 *   2. movies 欄位已經沒有 mp4/webm 直連，只剩 dash/hls 串流與一張 thumbnail。
 *      所以前端只用縮圖，點擊跳 Steam 商店頁。
 *
 * 圖片網址不能推導（2026-09-16 實測推翻了原本的做法）：
 *   Steam 已改用含內容雜湊的路徑，.../apps/<appid>/<40位雜湊>/header.jpg，
 *   而且檔名本身會變（燕雲十六聲是 header_alt_assets_9_tchinese.jpg）。
 *   舊式 .../apps/<appid>/header.jpg 只有 2023 年以前的舊作還通，新作一律 404。
 *   所以一定要存 API 回的實際網址；只砍掉共同前綴與 ?t= 快取參數（實測拿掉仍 200）。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "data");
const RAW = path.join(DIR, "raw");
const OUT = path.join(DIR, "game-index.json");
const CACHE = path.join(RAW, "game-details-cache.json");
const POOL_FILE = path.join(RAW, "game-pool.json");

const args = process.argv.slice(2);
const has = f => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? parseInt(args[i + 1], 10) || d : d; };

const LIMIT = num("--limit", 3000);        // 最終收錄款數
const PER_TAG = num("--per-tag", 25);      // 每個標籤取前幾名進候選池
const FLOOR = num("--floor", 5);           // 每個標籤至少保留前幾名，避免冷門標籤查無結果
const SELECT_ONLY = has("--select");        // 完全不連網，只用既有快取重算
const RESUME = has("--resume");             // 沿用既有候選池，但繼續抓還沒抓的明細
const RECHECK = has("--recheck");           // 把可能是軟體、但快取裡沒有類別資料的項目丟掉重抓
const REFRESH_GENRES = has("--refresh-genres"); // 所有收錄中但缺類別資料的項目都重抓（軟體過濾才完整覆蓋）
const MAX_TAGS = num("--tags", 0);         // 只爬前 N 個標籤，煙霧測試用；0 表示全爬
const DESC_MAX = 160;                      // 簡介截斷長度

const die = m => { console.error("✗ " + m); process.exit(1); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 標籤庫 ---------- */
if (!fs.existsSync(path.join(DIR, "tags.json"))) die("找不到 data/tags.json，請先跑 node build-tags.js");
const T = JSON.parse(fs.readFileSync(path.join(DIR, "tags.json"), "utf8"));
const TAG_IDS = new Set(T.map(t => t[5]).filter(Number.isFinite));
const TAG_NAME = new Map(T.map(t => [t[5], t[1]]));
console.log("標籤庫 " + TAG_IDS.size + " 個");

/* ---------- 連網工具 ---------- */
/** 帶退避重試的 JSON 取得。429 或 5xx 等待後重試，連續失敗回 null（絕不回半份資料）。 */
async function getJSON(url, tries) {
  tries = tries || 5;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: {
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
          "User-Agent": "steam-tag-prompter build script"
        }
      });
      if (r.status === 429 || r.status >= 500) { await sleep(20000 * (i + 1)); continue; }
      if (!r.ok) return null;
      const txt = await r.text();
      if (!txt || txt === "null") return null;
      return JSON.parse(txt);
    } catch (e) {
      await sleep(3000 * (i + 1));
    }
  }
  return null;
}

/* ---------- 第一階段：依標籤爬候選池 ---------- */
const RE_APPID = /data-ds-appid="(\d+)"/;
const RE_TAGIDS = /data-ds-tagids="\[([^\]]*)\]"/;
const RE_TITLE = /<span class="title">([^<]*)<\/span>/;

/** 從搜尋結果的 HTML 片段拆出每一列的 appid、標籤 id 與標題。 */
function parseRows(html) {
  const out = [];
  const chunks = String(html || "").split("search_result_row").slice(1);
  for (const chunk of chunks) {
    const id = RE_APPID.exec(chunk);
    if (!id) continue;
    const tg = RE_TAGIDS.exec(chunk);
    const ti = RE_TITLE.exec(chunk);
    out.push({
      appid: Number(id[1]),
      tagids: tg ? tg[1].split(",").map(Number).filter(Number.isFinite) : [],
      title: ti ? ti[1].trim() : ""
    });
  }
  return out;
}

async function crawlTags() {
  const pool = new Map();        // appid -> { appid, tags:Set, hits, best }
  const perTagTop = new Map();   // tagid -> [appid...]
  const todo = MAX_TAGS > 0 ? Array.from(TAG_IDS).slice(0, MAX_TAGS) : Array.from(TAG_IDS);
  let done = 0, failed = 0;
  for (const tagid of todo) {
    const url = "https://store.steampowered.com/search/results/?query&start=0&count=50"
      + "&dynamic_data=&sort_by=_ASC&tags=" + tagid
      + "&snr=1_7_7_230_7&infinite=1&json=1";
    const j = await getJSON(url, 3);
    done++;
    if (!j || !j.results_html) {
      failed++;
      process.stdout.write("\r標籤爬取 " + done + "/" + todo.length + "（失敗 " + failed + "）");
      await sleep(400);
      continue;
    }
    const rows = parseRows(j.results_html).slice(0, PER_TAG);
    perTagTop.set(tagid, rows.map(r => r.appid));
    rows.forEach((r, pos) => {
      let e = pool.get(r.appid);
      if (!e) { e = { appid: r.appid, tags: new Set(), hits: 0, best: 999 }; pool.set(r.appid, e); }
      e.tags.add(tagid);
      r.tagids.filter(x => TAG_IDS.has(x)).forEach(x => e.tags.add(x));
      e.hits++;
      if (pos < e.best) e.best = pos;
    });
    process.stdout.write("\r標籤爬取 " + done + "/" + todo.length
      + "（候選 " + pool.size + " 款，失敗 " + failed + "）");
    await sleep(400);
  }
  console.log("");
  if (failed > todo.length * 0.2) die("標籤爬取失敗率過高（" + failed + "/" + todo.length + "），不覆蓋既有資料");
  return { pool: pool, perTagTop: perTagTop };
}

/* ---------- 第二階段：挑出要進資料檔的名單 ---------- */
/** 先保障每個標籤的前 FLOOR 名，再用「被多少標籤收錄」與「最佳名次」排序補滿到 LIMIT。 */
function pickAppids(pool, perTagTop) {
  const must = new Set();
  for (const list of perTagTop.values()) list.slice(0, FLOOR).forEach(a => must.add(a));
  const rest = Array.from(pool.values())
    .filter(e => !must.has(e.appid))
    .sort((a, b) => (b.hits - a.hits) || (a.best - b.best) || (a.appid - b.appid));
  const picked = Array.from(must);
  for (const e of rest) {
    if (picked.length >= LIMIT) break;
    picked.push(e.appid);
  }
  return picked;
}

/* ---------- 第三階段：逐款補明細 ---------- */
const RE_HTML_TAG = /<[^>]*>/g;
const RE_SPACES = /\s+/g;
const RE_YEAR = /\d{4}/;

function clean(s) {
  return String(s == null ? "" : s)
    .replace(RE_HTML_TAG, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(RE_SPACES, " ")
    .trim();
}

/* 判別規則（軟體、圖片網址、續跑要不要重抓）放在 steam-filters.js；收錄方針忠於 Steam，不以成人過濾。
   tests/steam-filters.test.js 直接 require 同一份，測到的就是這裡實際跑的規則。 */
const { ASSET_PREFIX, shortUrl, rejectReason, needsFetch } = require("./steam-filters");

async function fetchDetails(appids, cache) {
  let n = 0, got = 0, skip = 0, fail = 0;
  const why = {};
  for (const appid of appids) {
    n++;
    if (!needsFetch(cache[appid])) { skip++; continue; }
    const url = "https://store.steampowered.com/api/appdetails?appids=" + appid + "&l=tchinese&cc=tw";
    const j = await getJSON(url);
    const node = j && j[appid];
    const reason = rejectReason(node);
    if (reason) {
      // 記下原因：fetch 失敗的下次 --resume 會重抓，其他原因不再浪費請求
      cache[appid] = { bad: 1, why: reason };
      why[reason] = (why[reason] || 0) + 1;
      fail++;
    } else {
      const d = node.data;
      const movies = d.movies || [];
      const mv = movies.find(m => m.highlight) || movies[0];
      const dateStr = String((d.release_date || {}).date || "");
      const ym = RE_YEAR.exec(dateStr);
      cache[appid] = {
        name: clean(d.name),
        desc: clean(d.short_description).slice(0, DESC_MAX),
        // 優先用預告片封面幀（16:9，卡片好看），沒有預告片才退回商店頁封面圖
        img: shortUrl((mv && mv.thumbnail) || d.header_image || ""),
        year: ym ? Number(ym[0]) : 0,
        // 存起來，日後改判別規則時不必再抓一次三千筆
        gen: (d.genres || []).map(x => Number(x.id)).filter(Number.isFinite)
      };
      got++;
    }
    if (n % 25 === 0) {
      fs.writeFileSync(CACHE, JSON.stringify(cache));
      process.stdout.write("\r明細抓取 " + n + "/" + appids.length
        + "（新增 " + got + "、沿用 " + skip + "、略過 " + fail + "）");
    }
    await sleep(1600);   // 實測安全速率，約每 5 分鐘 180 次
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log("\r明細抓取 " + n + "/" + appids.length
    + "（新增 " + got + "、沿用 " + skip + "、略過 " + fail + "）          ");
  if (fail) console.log("  略過原因：" + JSON.stringify(why)
    + (why.fetch ? "（fetch 的 " + why.fetch + " 筆下次 --resume 會重抓）" : ""));
}

/* ---------- 主流程 ---------- */
(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};

  let pool, perTagTop;
  if (SELECT_ONLY || RESUME) {
    if (!fs.existsSync(POOL_FILE)) die("--select／--resume 需要既有的 data/raw/game-pool.json");
    const saved = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
    pool = new Map(saved.pool.map(e => [e.appid, { appid: e.appid, tags: new Set(e.tags), hits: e.hits, best: e.best }]));
    perTagTop = new Map(saved.perTagTop.map(p => [Number(p[0]), p[1]]));
    console.log("沿用候選池 " + pool.size + " 款（未連網）");
  } else {
    const r = await crawlTags();
    pool = r.pool;
    perTagTop = r.perTagTop;
    fs.writeFileSync(POOL_FILE, JSON.stringify({
      pool: Array.from(pool.values()).map(e => ({ appid: e.appid, tags: Array.from(e.tags), hits: e.hits, best: e.best })),
      perTagTop: Array.from(perTagTop.entries())
    }));
  }

  const picked = pickAppids(pool, perTagTop);
  console.log("挑出 " + picked.length + " 款進入明細階段");

  /* --recheck：2026-09-16 加入軟體判別（看 genres）之前抓的快取沒有 gen 欄位，
     其中混了 VEGAS Pro、Krita、3DMark 這類軟體。這裡把「帶軟體標籤且缺 gen」的項目
     丟掉讓它重抓，不必整份三千筆重來。標籤只是用來縮小重抓範圍，判別仍以 genres 為準。 */
  if (RECHECK) {
    const SOFT_TAG_NAMES = ["Software", "Utilities", "Design & Illustration", "Animation & Modeling",
      "Video Production", "Audio Production", "Photo Editing", "Game Development",
      "Software Training", "Benchmark", "Hardware", "Desktop Companion", "360 Video", "Web Publishing"];
    const softTagIds = new Set(T.filter(t => SOFT_TAG_NAMES.indexOf(t[1]) >= 0).map(t => t[5]));
    let n = 0;
    for (const appid of picked) {
      const c = cache[appid];
      if (!c || c.bad || c.gen !== undefined) continue;
      const e = pool.get(appid);
      if (!e) continue;
      if (Array.from(e.tags).some(t => softTagIds.has(t))) { delete cache[appid]; n++; }
    }
    console.log("--recheck：" + n + " 筆可疑項目已標記重抓（軟體標籤 " + softTagIds.size + " 種）");
  }

  /* --refresh-genres：2026-09-16 前抓的快取沒有 gen（發行商類別），軟體判別對它們沒生效。
     --recheck 只重抓帶軟體標籤的；這個旗標把所有「收錄中且缺 gen」的都重抓，約一小時。
     被擋的舊項目不動（抽驗 25 筆 0 筆誤丟）。 */
  if (REFRESH_GENRES) {
    let n = 0;
    for (const appid of picked) {
      const c = cache[appid];
      if (c && !c.bad && c.gen === undefined) { delete cache[appid]; n++; }
    }
    console.log("--refresh-genres：" + n + " 筆缺類別資料的項目已標記重抓（約 " + Math.round(n * 1.6 / 60) + " 分鐘）");
  }

  if (!SELECT_ONLY) await fetchDetails(picked, cache);

  /* 人工排除清單：自動規則擋不到的（全年齡版上架的成人向、瞄準訓練工具、跑分、VR 影片）。
     放在組裝階段，--select 不連網就能套用新清單。 */
  const EXCLUDE_FILE = path.join(DIR, "game-exclude.json");
  const excluded = new Set();
  if (fs.existsSync(EXCLUDE_FILE)) {
    const ex = JSON.parse(fs.readFileSync(EXCLUDE_FILE, "utf8"));
    Object.keys(ex).filter(k => !k.startsWith("_")).forEach(k =>
      (ex[k] || []).forEach(item => excluded.add(Number(item.appid))));
  }
  let excludedHit = 0;

  /* 組裝輸出：[appid, 名稱, 簡介, 圖片路徑, [tagid...], 年份] */
  const games = [];
  for (const appid of picked) {
    const c = cache[appid];
    if (!c || c.bad || !c.img) continue;
    if (excluded.has(appid)) { excludedHit++; continue; }
    const e = pool.get(appid);
    const tags = Array.from(e.tags).filter(x => TAG_IDS.has(x)).sort((a, b) => a - b);
    if (!tags.length) continue;
    games.push([appid, c.name, c.desc, c.img, tags, c.year || 0]);
  }
  games.sort((a, b) =>
    (pool.get(b[0]).hits - pool.get(a[0]).hits) || (pool.get(a[0]).best - pool.get(b[0]).best));

  if (games.length < 200) die("只組出 " + games.length + " 款，明顯不足，不覆蓋既有資料");
  if (excluded.size) console.log("人工排除清單 " + excluded.size + " 筆，實際擋下 " + excludedHit + " 筆");

  /* 覆蓋率檢查：每個標籤至少要有一款遊戲配得到，否則前端會出現查無結果 */
  const covered = new Set();
  games.forEach(g => g[4].forEach(t => covered.add(t)));
  const empty = Array.from(TAG_IDS).filter(t => !covered.has(t));

  const out = {
    _meta: {
      built: new Date().toISOString().slice(0, 10),
      count: games.length,
      fields: "[appid, name, desc, img, tagIds, year]",
      imgPrefix: ASSET_PREFIX,
      note: "img 若不以 http 開頭，前面要接上 imgPrefix。圖片優先用預告片封面幀，沒有預告片才用商店頁封面圖。"
        + "簡介以 l=tchinese 取得；Steam 沒提供繁中的款別會是英文原文。已濾除非遊戲項目（DLC、軟體、影片）；收錄忠於 Steam，不以成人與否過濾。",
      emptyTags: empty.map(t => TAG_NAME.get(t) || t)
    },
    games: games
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const size = fs.statSync(OUT).size;
  console.log("\n✓ 已寫出 " + OUT);
  console.log("  " + games.length + " 款、" + (size / 1024).toFixed(0) + " KB、平均每款 "
    + (size / games.length).toFixed(0) + " 位元組");
  console.log("  配不到任何遊戲的標籤：" + empty.length + " 個" + (empty.length ? "（見 _meta.emptyTags）" : ""));
})();
