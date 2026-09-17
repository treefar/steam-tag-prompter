/* 大軍配對品質測試：建基準快照、20 組題目、盲評材料、已知答案測試名單。
   固定種子，重跑結果相同；改完資料後用同一份 questions.json 重測即可前後對比。 */
const fs = require("fs");
const path = require("path");
const REPO = "C:/projects/steam-tag-prompter/";
const ARMY = __dirname;
const mk = d => fs.mkdirSync(path.join(ARMY, d), { recursive: true });
["baseline", "control", "reports", "taskT1", "taskT2", "taskT3"].forEach(mk);

/* 1. 基準快照（凍結，大軍只讀這份） */
for (const f of ["core.js", "data/tags.json", "data/game-index.json"]) {
  fs.copyFileSync(REPO + f, path.join(ARMY, "baseline", path.basename(f)));
}
const core = require(path.join(ARMY, "baseline", "core.js"));
const T = require(path.join(ARMY, "baseline", "tags.json"));
const GI = require(path.join(ARMY, "baseline", "game-index.json"));
const IDX = core.makeIndex(T);

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* 2. 題目：14 組起手式（從 index.html 取原文）＋ 6 組抽籤 */
const html = fs.readFileSync(REPO + "index.html", "utf8");
const pm = /const PRESETS=(\[[\s\S]*?\n\]);/.exec(html);
if (!pm) { console.error("✗ 找不到 PRESETS"); process.exit(1); }
const PRESETS = Function("return " + pm[1])();
const questions = PRESETS.map(([name, p], i) => ({
  id: "C" + String(i + 1).padStart(2, "0"), source: "起手式：" + name,
  sel: [...p.c.map(en => ({ en, role: "core" })), ...p.d.map(en => ({ en, role: "diff" })), ...p.q.map(en => ({ en, role: "ask" }))]
}));
let k = questions.length;
for (const [mode, label, seed] of [["safe", "保證可做", 11], ["safe", "保證可做", 12], ["safe", "保證可做", 13],
                                   ["clash", "刻意衝突", 21], ["clash", "刻意衝突", 22], ["clash", "刻意衝突", 23]]) {
  const r = core.rollTags({ T, idx: IDX, mode, n: 6, rng: seeded(seed), curatedOnly: true, locked: [] });
  k++;
  questions.push({ id: "C" + String(k).padStart(2, "0"), source: "抽籤：" + label + "（種子 " + seed + "）",
    sel: r.sel.map(s => ({ en: s.en, role: s.role })) });
}
const missing = questions.flatMap(q => q.sel.filter(s => !IDX.byEn[s.en]).map(s => q.id + ":" + s.en));
if (missing.length) { console.error("✗ 題目有標籤不在標籤庫：" + missing.join(", ")); process.exit(1); }
fs.writeFileSync(path.join(ARMY, "control", "questions.json"), JSON.stringify(questions, null, 1));

/* 3. 盲評材料：只給組合與遊戲名稱、年份、簡介，不給分數與命中標籤，避免評審被工具的判斷帶著走 */
const ROLE = { core: "核心", diff: "差異化", ask: "待抉擇" };
const answerKey = [];
const lines = ["# 材料：20 組 Steam 標籤組合，與工具為每組找出的前 6 款遊戲", "",
  "每組列出使用者選的標籤（含角色），以及工具給的 6 款候選遊戲（依工具排序，但不附分數）。", ""];
for (const q of questions) {
  const m = core.matchGames(q.sel, GI, IDX, { limit: 6 });
  lines.push("## " + q.id);
  lines.push("標籤：" + q.sel.map(s => s.en + "（" + IDX.byEn[s.en][2] + "，" + ROLE[s.role] + "）").join("、"));
  lines.push("");
  m.games.forEach((g, i) => {
    lines.push("- R" + (i + 1) + "｜appid " + g.appid + "｜" + g.name + (g.year ? "（" + g.year + "）" : "") + "｜" + (g.desc || "（無簡介）").slice(0, 90));
    answerKey.push({ q: q.id, rank: i + 1, appid: g.appid, name: g.name, score: g.score, exact: g.exact });
  });
  lines.push("");
}
const bundle = lines.join("\n");
for (const t of ["taskT2", "taskT3"]) fs.writeFileSync(path.join(ARMY, t, "bundle.md"), bundle);
fs.writeFileSync(path.join(ARMY, "control", "baseline_results.json"), JSON.stringify(answerKey, null, 1));

/* 4. T1 已知答案測試名單：依索引排序（約略人氣）分 4 段各抽 10 款，涵蓋熱門到冷門 */
const rng = seeded(99);
const seg = Math.floor(GI.games.length / 4);
const t1 = [];
for (let s = 0; s < 4; s++) {
  const part = GI.games.slice(s * seg, (s + 1) * seg);
  const picked = new Set();
  while (picked.size < 10) picked.add(part[Math.floor(rng() * part.length)][0]);
  picked.forEach(id => { const g = GI.games.find(x => x[0] === id); t1.push({ appid: id, name: g[1], segment: s + 1 }); });
}
fs.writeFileSync(path.join(ARMY, "taskT1", "games.json"), JSON.stringify(t1, null, 1));

console.log("快照：索引 " + GI.games.length + " 款");
console.log("題目 " + questions.length + " 組：" + questions.map(q => q.id + "=" + q.sel.length + "標").join(" "));
console.log("盲評材料 " + (bundle.length / 1024).toFixed(0) + " KB，答案鍵 " + answerKey.length + " 列");
console.log("T1 名單 " + t1.length + " 款：" + t1.slice(0, 6).map(x => x.name).join("、") + "…");
