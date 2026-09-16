/**
 * steam-filters.js — 判斷 Steam appdetails 的一筆資料要不要收進遊戲索引。
 *
 * build-game-index.js 抓資料時用它，tests/steam-filters.test.js 也直接 require 它，
 * 所以測試測到的就是爬蟲實際跑的規則，不會各寫一套而對不上。
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

/**
 * 課堂用工具，濾掉 Steam 自己標成成人的：18 禁，或成人內容描述子 3／4。
 *
 * 注意這條規則擋不住「上架全年齡版、外掛 18 禁補丁」的作品：2026-09-16 實測，
 * NUKITASHI、Tentacle Locker 2 在匿名 appdetails 的年齡與描述子跟 Hades 完全相同。
 * 那些作品靠 data/game-exclude.json 的人工清單排除。
 */
function isAdult(d) {
  if (!d) return false;
  if (Number(d.required_age) >= 18) return true;
  const ids = (d.content_descriptors && d.content_descriptors.ids) || [];
  return ids.indexOf(3) >= 0 || ids.indexOf(4) >= 0;
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
 *   adult    Steam 標成成人
 *   software 發行商類別是軟體
 *   noimg    沒有任何可用圖片
 */
function rejectReason(node) {
  if (!node || !node.success || !node.data) return "fetch";
  const d = node.data;
  if (d.type !== "game") return "type";
  if (isAdult(d)) return "adult";
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
 * - 被擋、其他原因：不抓（那是判斷過的結果）
 * - 被擋、沒有原因：2026-09-16 之前的舊快取，當時沒記原因。抽 25 筆重抓 0 筆是誤丟，沿用不抓
 * - 收錄了但缺 img：更舊的格式，要重抓
 */
function needsFetch(entry) {
  if (!entry) return true;
  if (entry.bad) return entry.why === "fetch";
  return entry.img === undefined;
}

module.exports = { SOFT_GENRES, ASSET_PREFIX, isSoftware, isAdult, shortUrl, rejectReason, needsFetch };
