/**
 * verify-games.js — 把 data/tag-notes.json 裡引用的遊戲，逐款到 Steam 查證並寫進 data/games.json。
 *
 * 用法：node verify-games.js
 *
 * 為什麼要這支腳本：
 *   代表作是對外的事實宣稱，不能憑印象寫。這裡用 Steam 商店搜尋 API 取得 appid 與**實際商店標題**，
 *   再用 appdetails 覆核。名稱對不上的一律標成 needsReview，不會靜默塞一個看起來像的進去
 *   （搜尋「Hades」第一筆會回 Hades II，這種錯誤正是要擋掉的）。
 *
 * 關於中文名：
 *   Steam 對多數西方獨立遊戲沒有官方繁中標題，`l=tchinese` 回傳的仍是英文原名。
 *   因此 steamTitle 欄位記錄的是「Steam 上實際顯示的標題」（可能是英文），
 *   台灣通稱譯名放在 data/games-tw.json，由人維護，並在畫面上明確標示為「通稱」而非官方。
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DIR = path.join(__dirname, "data");
const NOTES = JSON.parse(fs.readFileSync(path.join(DIR, "tag-notes.json"), "utf8"));
const OUT = path.join(DIR, "games.json");
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

/** 名稱正規化後比對：忽略大小寫、商標符號、標點與空白差異 */
const norm = s => String(s).toLowerCase()
  .replace(/[™®©]/g, "")
  .replace(/[:：\-–—_'’,.!?()［］\[\]]/g, " ")
  .replace(/\s+/g, " ").trim();

/** 允許 Steam 標題比我們寫的多出版本後綴（GOTY / Definitive / The Final Cut 之類） */
const EDITION = /\b(goty|game of the year|definitive|deluxe|complete|ultimate|enhanced|remastered|the final cut|royal|collection|edition)\b/g;
const core = s => norm(s).replace(EDITION, "").replace(/\s+/g, " ").trim();

function sh(cmd) { return execSync(cmd, { encoding: "utf8", maxBuffer: 1e7 }); }

function search(term) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
  try { return (JSON.parse(sh(`curl -sS --max-time 25 "${url}"`)).items) || []; }
  catch (e) { return null; }
}

function details(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`;
  try {
    const j = JSON.parse(sh(`curl -sS --max-time 25 "${url}"`));
    const x = j[appid];
    return (x && x.success && x.data) ? x.data : null;
  } catch (e) { return null; }
}

/* 蒐集所有被引用的遊戲名 */
const wanted = [...new Set(Object.entries(NOTES)
  .filter(([k]) => !k.startsWith("_"))
  .flatMap(([, v]) => v.g || []))].sort();

console.log(`tag-notes.json 引用了 ${wanted.length} 款遊戲`);

const games = {};
let hit = 0, review = 0, cached = 0;
for (const name of wanted) {
  if (prev[name] && prev[name].appid && !prev[name].needsReview) {
    games[name] = prev[name]; cached++; continue;         // 已查證過的不重查
  }
  const items = search(name);
  if (!items) { games[name] = { needsReview: "搜尋失敗" }; review++; console.log(`  ✗ ${name} 搜尋失敗`); continue; }
  const exact = items.find(i => core(i.name) === core(name));
  if (!exact) {
    games[name] = { needsReview: "無精確名稱相符", candidates: items.slice(0, 3).map(i => `${i.id} ${i.name}`) };
    review++;
    console.log(`  ✗ ${name} → 無精確相符，候選：${(items[0] || {}).name || "無"}`);
    continue;
  }
  const d = details(exact.id);
  const title = d ? d.name : exact.name;
  if (core(title) !== core(name)) {
    games[name] = { appid: exact.id, steamTitle: title, needsReview: "appdetails 標題與搜尋結果不一致" };
    review++;
    console.log(`  ⚠ ${name} → appid ${exact.id} 標題「${title}」需確認`);
    continue;
  }
  games[name] = { appid: exact.id, steamTitle: title, url: `https://store.steampowered.com/app/${exact.id}/` };
  hit++;
  console.log(`  ✓ ${name} → ${exact.id}　${title}`);
}

fs.writeFileSync(OUT, JSON.stringify(games, null, 1) + "\n");
console.log(`\n查證完成：新查 ${hit} 款、沿用 ${cached} 款、需人工確認 ${review} 款`);
if (review) { console.log("需人工確認的項目已寫入 data/games.json 的 needsReview 欄位。"); process.exitCode = 1; }
