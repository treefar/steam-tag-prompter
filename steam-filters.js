/**
 * steam-filters.js — 判斷 Steam appdetails 的一筆資料要不要收進遊戲索引。
 *
 * build-game-index.js 抓資料時用它，tests/steam-filters.test.js 也直接 require 它，
 * 所以測試測到的就是爬蟲實際跑的規則，不會各寫一套而對不上。
 *
 * 收錄方針（2026-09-17 老師定案）：工具忠於 Steam。只擋「不是遊戲」的東西
 * （DLC、軟體、沒有圖可顯示的），**不以成人與否過濾**——上課不刻意提，也不刻意迴避。
 * 2026-09-16 曾加過 18 禁過濾與成人向人工黑名單，已依此方針撤除。
 */
"use strict";

/* 軟體類的 Steam 類別 id。2026-09-16 用 25 筆人工標註樣本實測歸納，判對 24 筆
   （唯一不合的 Bongo Cat，Steam 自己就把它列為 Casual／Indie／模擬，規則跟著 Steam 走）：
     50 Accounting    51 Animation & Modeling  52 Audio Production  53 Design & Illustration
     55 Photo Editing 56 Software Training     57 Utilities         58 Video Production
     59 Web Publishing 60 Game Development
   真遊戲用的是 1 Action／2 Strategy／3 RPG／4 Casual／9 Racing／18 Sports／23 Indie／
   25 Adventure／28 Simulation／29 MMO／37 F2P／70 Early Access 這一組，兩邊不重疊。

   為什麼不看 type：VEGAS Pro、Krita、3DMark、Aseprite 的 type 全都是 "game"。
   為什麼不看標籤：標籤是玩家掛的，Tiny Glade、TOEM、Ryse 都被掛過軟體標籤。 */
const SOFT_GENRES = new Set([50, 51, 52, 53, 55, 56, 57, 58, 59, 60]);

/* 絕大多數圖片網址共用這段前綴，存檔時砍掉、前端再接回去。 */
const ASSET_PREFIX = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/";

/** 這是軟體不是遊戲嗎？（Wallpaper Engine、RPG Maker、VEGAS Pro 這類） */
function isSoftware(d) {
  return ((d && d.genres) || []).some(x => SOFT_GENRES.has(Number(x.id)));
}

/** 砍掉 ?t= 快取參數與共同前綴。認不出來的網址原樣保留，不猜。 */
function shortUrl(u) {
  const s = String(u || "").split("?")[0];
  if (!s) return "";
  return s.indexOf(ASSET_PREFIX) === 0 ? s.slice(ASSET_PREFIX.length) : s;
}

/**
 * 一筆 appdetails 結果該不該擋，擋的話回傳原因代碼；可以收就回 null。
 *   fetch    沒抓到資料（網路、下架、限流）——下次續跑要重抓
 *   type     type 不是 game（DLC、原聲帶、影片）
 *   software 發行商類別是軟體
 *   noimg    沒有任何可用圖片
 * 刻意沒有「成人」這一項，見檔頭收錄方針。
 */
function rejectReason(node) {
  if (!node || !node.success || !node.data) return "fetch";
  const d = node.data;
  if (d.type !== "game") return "type";
  if (isSoftware(d)) return "software";
  const movies = d.movies || [];
  const mv = movies.find(m => m.highlight) || movies[0];
  if (!shortUrl((mv && mv.thumbnail) || d.header_image || "")) return "noimg";
  return null;
}

/**
 * 快取裡這一筆，續跑時要不要重抓？
 * - 沒有紀錄：要抓
 * - 被擋、原因是 fetch：要重抓（一時抓不到，不該永久丟掉）
 * - 被擋、原因是 adult：要重抓（舊方針擋的，現行方針不擋）
 * - 被擋、沒有原因：2026-09-16 之前的舊快取，當時 18 禁也算在內，無法區分，要重抓一次
 * - 被擋、其他原因（type／software／noimg）：不抓，那是現行方針下仍成立的判斷
 * - 收錄了但缺 img：更舊的格式，要重抓
 */
function needsFetch(entry) {
  if (!entry) return true;
  if (entry.bad) return entry.why === undefined || entry.why === "fetch" || entry.why === "adult";
  return entry.img === undefined;
}

/* ---------- 商店頁解析（2026-09-17 實測格式） ----------
   appdetails API 不含玩家標籤，要從商店頁 HTML 取：
     InitAppTagModal( <appid>, [{"tagid":42804,"name":"Action Roguelike","count":1453,"browseable":true}, ...], ...
   通常 20 個，依票數由高到低。 */
const RE_TAG_MODAL = /InitAppTagModal\(\s*\d+\s*,\s*(\[[\s\S]*?\])\s*,/;

/**
 * 解析商店頁的玩家標籤，只留標籤庫裡有的，依票數由高到低。
 * 回傳 [[tagid, 票數], ...]；頁面裡找不到標籤段回 null（跟「有頁面但沒標籤」的空陣列分開）。
 */
function parseStoreTags(html, libraryIds) {
  const m = RE_TAG_MODAL.exec(String(html || ""));
  if (!m) return null;
  let arr;
  try { arr = JSON.parse(m[1]); } catch (e) { return null; }
  if (!Array.isArray(arr)) return null;
  return arr
    .filter(t => t && Number.isFinite(Number(t.tagid)) && (!libraryIds || libraryIds.has(Number(t.tagid))))
    .map(t => [Number(t.tagid), Number(t.count) || 0])
    .sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
}

/**
 * 評論 API（/appreviews/<appid>?json=1&language=all）回傳的所有語言總評論數。
 * 商店頁 itemprop="reviewCount" 與搜尋列表提示框都依瀏覽者語言篩過，不能用：
 * 2026-09-17 實測 Hades 商店頁 142,444、評論 API 308,520；Monster Train 搜尋提示框 331、評論 API 22,948。
 * 取不到或格式不對回 null（跟真的 0 則評論分開）。
 */
function parseAppReviews(json) {
  const q = json && json.success === 1 && json.query_summary;
  if (!q || !Number.isFinite(Number(q.total_reviews))) return null;
  return Number(q.total_reviews);
}

/**
 * 收錄中的項目，要不要去抓商店頁補完整標籤與評論數？
 * 被擋的不抓；已經有 stags（含空陣列）就不抓。
 */
function needsStore(entry) {
  return !!entry && !entry.bad && !Array.isArray(entry.stags);
}

module.exports = { SOFT_GENRES, ASSET_PREFIX, isSoftware, shortUrl, rejectReason, needsFetch,
  parseStoreTags, parseAppReviews, needsStore };
