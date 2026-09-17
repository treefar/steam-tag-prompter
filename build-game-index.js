#!/usr/bin/env node
/**
 * build-game-index.js — 產生「依標籤找遊戲」用的離線資料檔 data/game-index.json
 *
 * 用法：
 *   node build-game-index.js              # 完整跑：爬標籤 → 補明細 → 挑選 → 輸出
 *   node build-game-index.js --resume     # 中斷後續跑：沿用既有候選池，只補還沒抓的明細
 *   node build-game-index.js --select     # 不連網，只用既有快取重新挑選與輸出
 *   node build-game-index.js --limit 1500 # 改收錄款數（預設 3000）
 *   node build-game-index.js --store                # 完整跑並補商店頁完整標籤（含票數）；候選池、評論數、明細都會用快取續跑
 *   node build-game-index.js --resume --store       # 沿用既有候選池，只補缺的評論數、明細與商店頁標籤
 *   node build-game-index.js --resume --tag-totals  # 補每個標籤在 Steam 的總遊戲數，約 3 分鐘
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
const STORE = has("--store");               // 抓商店頁補完整標籤與評論數
const TAG_TOTALS = has("--tag-totals");     // 抓每個標籤的 Steam 總遊戲數
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

/* ---------- 第一階段：依標籤爬候選池 ----------
   每個標籤抓兩份清單：
   1. 相關性前 25 名（sort_by=_ASC）——偏近期熱門
   2. 全球熱銷前 300 名（filter=globaltopsellers）——救回老經典
   2026-09-17 實測只用第 1 份時，評審提名的經典有 16 款連候選池都沒進：DARK SOULS III 不在類魂相關性前 100 名，
   但在全球熱銷第 36 名；Don't Starve 在生存熱銷第 292 名。sort_by=Reviews_DESC 排的是好評率不是評論數，不能用。
   已知漏洞：熱銷依營收排，免費遊戲（Doki Doki Literature Club!）進不來；Unpacking 在溫馨熱銷前 400 名也沒有。

   搜尋列表提示框雖然有「of the N user reviews」，但那是「依瀏覽者語言篩過」的數字
   （Monster Train 顯示 331、實際所有語言 22,948），不能拿來挑選。挑選用的評論數另外從評論 API 取。 */
const RE_APPID = /data-ds-appid="(\d+)"/;
const RE_TAGIDS = /data-ds-tagids="\[([^\]]*)\]"/;
const RE_TITLE = /<span class="title">([^<]*)<\/span>/;
const BEST_PAGES = num("--best-pages", 4);   // 全球熱銷每頁 100 筆，抓幾頁（Don't Starve 在生存熱銷約第 300 名，3 頁會卡在邊緣）
const SHORTLIST = num("--shortlist", 6000);  // 依熱銷名次初篩幾款，再查真實評論數
const REVIEWS_FILE = path.join(RAW, "review-counts.json");

/** 從搜尋結果的 HTML 片段拆出每一列。回傳 { rows, raw }：raw 是原始列數。
    每頁 100 列裡常有 1 列是組合包（沒有 appid），判斷「這頁是不是最後一頁」要看 raw，不能看 rows.length。 */
function parseRows(html) {
  const rows = [];
  const chunks = String(html || "").split("search_result_row").slice(1);
  for (const chunk of chunks) {
    const id = RE_APPID.exec(chunk);
    if (!id) continue;
    const tg = RE_TAGIDS.exec(chunk);
    const ti = RE_TITLE.exec(chunk);
    rows.push({
      appid: Number(id[1]),
      tagids: tg ? tg[1].split(",").map(Number).filter(Number.isFinite) : [],
      title: ti ? ti[1].trim() : ""
    });
  }
  return { rows: rows, raw: chunks.length };
}

async function crawlTags() {
  const pool = new Map();        // appid -> { appid, tags:Set, hits, best, sales }
  const perTag = new Map();      // tagid -> [appid...]：熱銷名次在前，相關性清單補在後
  const todo = MAX_TAGS > 0 ? Array.from(TAG_IDS).slice(0, MAX_TAGS) : Array.from(TAG_IDS);
  let done = 0, failed = 0;
  // l=english：避免回應內容跟著請求標頭的語言變動，解析規則才固定（2026-09-17 踩到提示框變中文）
  const base = "https://store.steampowered.com/search/results/?query&infinite=1&json=1&l=english&tags=";
  const touch = (tagid, r) => {
    let e = pool.get(r.appid);
    if (!e) { e = { appid: r.appid, tags: new Set(), hits: 0, best: 999, sales: 99999 }; pool.set(r.appid, e); }
    if (!e.tags.has(tagid)) e.hits++;
    e.tags.add(tagid);
    r.tagids.filter(x => TAG_IDS.has(x)).forEach(x => e.tags.add(x));
    return e;
  };
  for (const tagid of todo) {
    let ok = true;
    const bestIds = [], relIds = [];
    const rel = await getJSON(base + tagid + "&start=0&count=50&sort_by=_ASC", 3);
    if (!rel || !rel.results_html) ok = false;
    else parseRows(rel.results_html).rows.slice(0, PER_TAG).forEach((r, pos) => {
      const e = touch(tagid, r);
      if (pos < e.best) e.best = pos;
      relIds.push(r.appid);
    });
    await sleep(700);
    for (let p = 0; p < BEST_PAGES; p++) {
      const j = await getJSON(base + tagid + "&start=" + (p * 100) + "&count=100&filter=globaltopsellers", 3);
      if (!j || !j.results_html) { ok = false; break; }
      const parsed = parseRows(j.results_html);
      parsed.rows.forEach((r, pos) => {
        const e = touch(tagid, r);
        const rank = p * 100 + pos;              // 在這個標籤熱銷榜的名次（0 起算）
        if (rank < e.sales) e.sales = rank;
        bestIds.push(r.appid);
      });
      await sleep(700);
      if (parsed.raw < 100) break;               // 這個標籤的熱銷榜已經到底
    }
    done++;
    if (!ok) failed++;
    const seen = new Set();
    perTag.set(tagid, bestIds.concat(relIds).filter(a => !seen.has(a) && seen.add(a)));
    process.stdout.write("\r標籤爬取 " + done + "/" + todo.length + "（候選 " + pool.size + " 款，失敗 " + failed + "）");
  }
  console.log("");
  if (failed > todo.length * 0.2) die("標籤爬取失敗率過高（" + failed + "/" + todo.length + "），不覆蓋既有資料");
  return { pool: pool, perTagTop: perTag };
}

/* ---------- 第二階段：挑出要進資料檔的名單（兩段式） ----------
   1. 初篩：先保障每個標籤熱銷前 FLOOR×2 名，再依「最佳熱銷名次」補到 SHORTLIST 款
   2. 查真實評論數（評論 API、所有語言）
   3. 決選：先保障每個標籤評論數最多的 FLOOR 款，再依評論數補滿 LIMIT 款 */
function shortlistAppids(pool, perTag) {
  const must = new Set();
  for (const list of perTag.values()) list.slice(0, FLOOR * 2).forEach(a => must.add(a));
  const rest = Array.from(pool.values())
    .filter(e => !must.has(e.appid))
    .sort((a, b) => (a.sales - b.sales) || (b.hits - a.hits) || (a.best - b.best) || (a.appid - b.appid));
  const out = Array.from(must);
  for (const e of rest) {
    if (out.length >= SHORTLIST) break;
    out.push(e.appid);
  }
  return out;
}

function pickAppids(shortlist, perTag, rev, pool) {
  const inShort = new Set(shortlist);
  const r = a => rev[a] || 0;
  const must = new Set();
  for (const list of perTag.values()) {
    list.filter(a => inShort.has(a)).sort((a, b) => r(b) - r(a)).slice(0, FLOOR).forEach(a => must.add(a));
  }
  const rest = shortlist.filter(a => !must.has(a))
    .sort((a, b) => (r(b) - r(a)) || (pool.get(b).hits - pool.get(a).hits) || (a - b));
  const picked = Array.from(must);
  for (const a of rest) {
    if (picked.length >= LIMIT) break;
    picked.push(a);
  }
  return picked;
}

/** 所有語言的總評論數。評論 API 每款一次請求，結果存檔，下次只補缺的。
    沒查到的不能默默當 0 則（會被決選刷掉），所以：
    - 連續 20 筆失敗視為斷網或被限流，暫停 2 分鐘再接著查
    - 整輪跑完，失敗的再重查，最多 3 輪
    - 最後仍有超過 1% 查不到就中止，不拿殘缺資料決選（2026-09-17 斷線時 200 筆裡失敗 130 筆） */
async function fetchReviewCounts(appids, rev) {
  for (let round = 1; round <= 3; round++) {
    const todo = appids.filter(a => rev[a] === undefined);
    if (!todo.length) break;
    let n = 0, fail = 0, streak = 0;
    console.log("評論數第 " + round + " 輪：" + todo.length + " 款要查（約 " + Math.round(todo.length * 1.3 / 60) + " 分鐘）");
    for (const appid of todo) {
      n++;
      const j = await getJSON("https://store.steampowered.com/appreviews/" + appid
        + "?json=1&language=all&purchase_type=all&num_per_page=0&filter=all", 3);
      const total = parseAppReviews(j);
      if (total === null) { fail++; streak++; } else { rev[appid] = total; streak = 0; }
      if (n % 50 === 0) {
        fs.writeFileSync(REVIEWS_FILE, JSON.stringify(rev));
        process.stdout.write("\r評論數 " + n + "/" + todo.length + "（失敗 " + fail + "）");
      }
      if (streak >= 20) {
        fs.writeFileSync(REVIEWS_FILE, JSON.stringify(rev));
        console.log("\n連續 " + streak + " 筆失敗，暫停 2 分鐘");
        await sleep(120000);
        streak = 0;
      }
      await sleep(900);
    }
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(rev));
    console.log("\r評論數 " + n + "/" + todo.length + "（失敗 " + fail + "）          ");
  }
  const missing = appids.filter(a => rev[a] === undefined).length;
  if (missing > appids.length * 0.01) die("評論數仍有 " + missing + " 款查不到，不拿殘缺資料決選；網路穩了再用 --resume --store 續跑");
  if (missing) console.log("評論數有 " + missing + " 款查不到，以 0 則計");
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
const { ASSET_PREFIX, shortUrl, rejectReason, needsFetch, parseStoreTags, needsStore, parseAppReviews } = require("./steam-filters");
const core = require("./core.js");
const TAG_TOTALS_FILE = path.join(RAW, "tag-totals.json");

/** 抓 HTML，退避重試同 getJSON。連續失敗回 null。 */
async function getText(url, tries) {
  tries = tries || 4;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "steam-tag-prompter build script",
        // 年齡確認頁會擋住標籤段；帶上已確認的 cookie 才拿得到內容（收錄方針不以成人過濾）
        "Cookie": "birthtime=946684801; lastagecheckage=1-0-2000; wants_mature_content=1"
      } });
      if (r.status === 429 || r.status >= 500) { await sleep(20000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.text();
    } catch (e) { await sleep(3000 * (i + 1)); }
  }
  return null;
}

/**
 * 商店頁補強：appdetails 不含玩家標籤。索引原本只靠「標籤搜尋前 25 名＋搜尋結果顯示的 7 個標籤」，
 * 2026-09-17 實測每款中位數只記到 8 個（Hades 在 Steam 上 20 個、索引 8 個），配對率被系統性低估。
 * 抓不到的不寫入，下次再跑會重抓；頁面有但沒有標籤段的記空陣列並標 noModal。
 */
async function fetchStore(appids, cache) {
  const todo = appids.filter(a => needsStore(cache[a]));
  let n = 0, got = 0, noModal = 0, fail = 0;
  console.log("商店頁補強：" + todo.length + " 款（約 " + Math.round(todo.length * 1.6 / 60) + " 分鐘）");
  for (const appid of todo) {
    n++;
    const html = await getText("https://store.steampowered.com/app/" + appid + "/?l=english");
    if (html == null) fail++;
    else {
      const stags = parseStoreTags(html, TAG_IDS);
      cache[appid].stags = stags || [];
      if (!stags) { cache[appid].noModal = 1; noModal++; } else got++;
    }
    if (n % 25 === 0) {
      fs.writeFileSync(CACHE, JSON.stringify(cache));
      process.stdout.write("\r商店頁 " + n + "/" + todo.length + "（取得 " + got + "、無標籤段 " + noModal + "、失敗 " + fail + "）");
    }
    await sleep(1600);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log("\r商店頁 " + n + "/" + todo.length + "（取得 " + got + "、無標籤段 " + noModal + "、失敗 " + fail + "）          ");
}

/** 每個標籤在 Steam 的總遊戲數，用來判斷標籤本身冷不冷門。成功率低於八成不覆蓋舊檔。 */
async function fetchTagTotals() {
  const out = {};
  let fail = 0, n = 0;
  for (const tagid of TAG_IDS) {
    n++;
    const j = await getJSON("https://store.steampowered.com/search/results/?query&start=0&count=1&tags=" + tagid + "&infinite=1&json=1", 3);
    if (j && Number.isFinite(Number(j.total_count))) out[tagid] = Number(j.total_count); else fail++;
    if (n % 20 === 0) process.stdout.write("\r標籤總數 " + n + "/" + TAG_IDS.size + "（失敗 " + fail + "）");
    await sleep(500);
  }
  console.log("\r標籤總數 " + n + "/" + TAG_IDS.size + "（失敗 " + fail + "）          ");
  if (fail > TAG_IDS.size * 0.2) { console.log("  失敗過多，不覆蓋 " + TAG_TOTALS_FILE); return; }
  fs.writeFileSync(TAG_TOTALS_FILE, JSON.stringify(out));
}

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
    pool = new Map(saved.pool.map(e => [e.appid, { appid: e.appid, tags: new Set(e.tags), hits: e.hits, best: e.best, sales: e.sales === undefined ? 99999 : e.sales }]));
    perTagTop = new Map(saved.perTagTop.map(p => [Number(p[0]), p[1]]));
    console.log("沿用候選池 " + pool.size + " 款（未連網）");
  } else {
    const r = await crawlTags();
    pool = r.pool;
    perTagTop = r.perTagTop;
    fs.writeFileSync(POOL_FILE, JSON.stringify({
      pool: Array.from(pool.values()).map(e => ({ appid: e.appid, tags: Array.from(e.tags), hits: e.hits, best: e.best, sales: e.sales })),
      perTagTop: Array.from(perTagTop.entries())
    }));
  }

  const shortlist = shortlistAppids(pool, perTagTop);
  const rev = fs.existsSync(REVIEWS_FILE) ? JSON.parse(fs.readFileSync(REVIEWS_FILE, "utf8")) : {};
  console.log("初篩 " + shortlist.length + " 款（依熱銷名次）");
  if (!SELECT_ONLY) await fetchReviewCounts(shortlist, rev);
  let picked = pickAppids(shortlist, perTagTop, rev, pool);
  console.log("決選 " + picked.length + " 款（依所有語言總評論數）進入明細階段");

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

  /* 人工排除清單：自動規則擋不到的（瞄準訓練工具、跑分、VR 影片）。
     --select 不連網就能套用新清單。 */
  const EXCLUDE_FILE = path.join(DIR, "game-exclude.json");
  const excluded = new Set();
  if (fs.existsSync(EXCLUDE_FILE)) {
    const ex = JSON.parse(fs.readFileSync(EXCLUDE_FILE, "utf8"));
    Object.keys(ex).filter(k => !k.startsWith("_")).forEach(k =>
      (ex[k] || []).forEach(item => excluded.add(Number(item.appid))));
  }
  let excludedHit = shortlist.filter(a => excluded.has(a)).length;

  /* 決選名額不能被「已知收不進來」的佔掉：明細判定不是遊戲（DLC、軟體、沒圖）或在人工排除清單的，
     先從初篩名單拿掉再決選，新遞補的抓完明細再檢查一次，最多 3 輪。
     2026-09-17 沒做這步時，3000 個名額有 105 個是舊快取早就知道要擋的，最後只收 2895 款。 */
  const knownOut = a => excluded.has(a) || (cache[a] && cache[a].bad && !needsFetch(cache[a]));
  for (let pass = 1; pass <= 3; pass++) {
    if (!SELECT_ONLY) await fetchDetails(picked, cache);
    const out = picked.filter(knownOut).length;
    if (!out) break;
    picked = pickAppids(shortlist.filter(a => !knownOut(a)), perTagTop, rev, pool);
    console.log("決選第 " + (pass + 1) + " 輪：拿掉 " + out + " 款已知收不進來的，遞補後 " + picked.length + " 款");
    if (SELECT_ONLY) break;
  }
  if (!SELECT_ONLY) await fetchDetails(picked, cache);   // 第 3 輪遞補的也要有明細；已抓過的會直接略過
  if (!SELECT_ONLY && STORE) await fetchStore(picked, cache);
  if (!SELECT_ONLY && TAG_TOTALS) await fetchTagTotals();

  /* 組裝輸出：[appid, 名稱, 簡介, 圖片路徑, [tagid...], 年份, 總評論數]
     標籤順序：有商店頁資料時依玩家票數由高到低，再補上搜尋階段拿到、商店頁前 20 名沒列到的 */
  const games = [];
  for (const appid of picked) {
    const c = cache[appid];
    if (!c || c.bad || !c.img) continue;
    if (excluded.has(appid)) { excludedHit++; continue; }
    const e = pool.get(appid);
    const fromStore = Array.isArray(c.stags) ? c.stags.map(t => t[0]).filter(x => TAG_IDS.has(x)) : [];
    const seen = new Set(fromStore);
    const fromPool = Array.from(e.tags).filter(x => TAG_IDS.has(x) && !seen.has(x)).sort((a, b) => a - b);
    const tags = fromStore.concat(fromPool);
    if (!tags.length) continue;
    // 評論數用評論 API 的所有語言總數；商店頁與搜尋列表的數字都按語言篩過，不可靠（2026-09-17 實測）
    games.push([appid, c.name, c.desc, c.img, tags, c.year || 0, rev[appid] || 0]);
  }
  // 同分時前端依索引順序決勝，所以索引依評論數排：評論多的遊戲當參考比較有代表性
  games.sort((a, b) => ((b[6] || 0) - (a[6] || 0)) || (pool.get(b[0]).hits - pool.get(a[0]).hits));

  if (games.length < 200) die("只組出 " + games.length + " 款，明顯不足，不覆蓋既有資料");
  if (excluded.size) console.log("人工排除清單 " + excluded.size + " 筆，實際擋下 " + excludedHit + " 筆");

  /* 覆蓋率檢查：每個標籤至少要有一款遊戲配得到，否則前端會出現查無結果 */
  const covered = new Set();
  games.forEach(g => g[4].forEach(t => covered.add(t)));
  const empty = Array.from(TAG_IDS).filter(t => !covered.has(t));

  /* 罕見度門檻：用同一份索引，對每種標籤數抽 300 組保證可做組合，記第 1 名配對率的第 20 百分位。
     固定種子，同一份資料重建結果相同。 */
  const tagTotals = fs.existsSync(TAG_TOTALS_FILE) ? JSON.parse(fs.readFileSync(TAG_TOTALS_FILE, "utf8")) : null;
  let seed = 20260917;
  const rng = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lowScore = core.comboBaseline({ T: T, idx: core.makeIndex(T), GI: { games: games }, rng: rng, samples: 300 });
  const withStore = games.filter(g => Array.isArray((cache[g[0]] || {}).stags) && cache[g[0]].stags.length).length;
  console.log("罕見度門檻（標籤數→第 20 百分位配對率）：" + JSON.stringify(lowScore));
  console.log("有商店頁完整標籤 " + withStore + "/" + games.length + "；標籤總遊戲數 " + (tagTotals ? Object.keys(tagTotals).length + " 個" : "無"));

  const out = {
    _meta: {
      built: new Date().toISOString().slice(0, 10),
      count: games.length,
      fields: "[appid, name, desc, img, tagIds(依票數), year, reviews]",
      lowScore: lowScore,
      tagTotals: tagTotals,

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
