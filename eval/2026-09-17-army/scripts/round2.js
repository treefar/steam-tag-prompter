/* 大軍重測輪：用同一份 questions.json，對新索引產生盲評材料與答案鍵，並離線算三項對比。
   1. 題目包：round2/taskT2、round2/taskT3（工單沿用基準輪，只改收錄款數）
   2. 提名回收：基準輪查證正確的提名遊戲，新索引收了幾款、有幾款進到該題前 6 名
   3. T1b：40 款用 Steam 第 7～12 高票標籤（標籤庫有的）全設核心去配，看自己排第幾——基準索引 vs 新索引
   4. 罕見提示：20 題在新索引上的 assessCombo 結果
   用法：node round2.js（不連網，重跑結果相同） */
const fs = require("fs");
const path = require("path");
const REPO = "C:/projects/steam-tag-prompter/";
const ARMY = __dirname;
const R2 = path.join(ARMY, "round2");
for (const d of ["snapshot", "taskT2", "taskT3"]) fs.mkdirSync(path.join(R2, d), { recursive: true });

for (const f of ["core.js", "data/tags.json", "data/game-index.json"]) {
  fs.copyFileSync(REPO + f, path.join(R2, "snapshot", path.basename(f)));
}
const core = require(path.join(R2, "snapshot", "core.js"));
const T = require(path.join(R2, "snapshot", "tags.json"));
const GI = require(path.join(R2, "snapshot", "game-index.json"));
const IDX = core.makeIndex(T);
const GI0 = require(path.join(ARMY, "baseline", "game-index.json"));
const core0 = require(path.join(ARMY, "baseline", "core.js"));
const IDX0 = core0.makeIndex(require(path.join(ARMY, "baseline", "tags.json")));
const questions = require(path.join(ARMY, "control", "questions.json"));
const base = require(path.join(ARMY, "control", "baseline_results.json"));
const out = { 索引款數: { 基準: GI0.games.length, 新: GI.games.length } };

/* 1. 題目包與答案鍵（格式與基準輪 setup.js 完全相同） */
const ROLE = { core: "核心", diff: "差異化", ask: "待抉擇" };
const key = [];
const lines = ["# 材料：20 組 Steam 標籤組合，與工具為每組找出的前 6 款遊戲", "",
  "每組列出使用者選的標籤（含角色），以及工具給的 6 款候選遊戲（依工具排序，但不附分數）。", ""];
for (const q of questions) {
  const m = core.matchGames(q.sel, GI, IDX, { limit: 6 });
  lines.push("## " + q.id);
  lines.push("標籤：" + q.sel.map(s => s.en + "（" + IDX.byEn[s.en][2] + "，" + ROLE[s.role] + "）").join("、"));
  lines.push("");
  m.games.forEach((g, i) => {
    lines.push("- R" + (i + 1) + "｜appid " + g.appid + "｜" + g.name + (g.year ? "（" + g.year + "）" : "") + "｜" + (g.desc || "（無簡介）").slice(0, 90));
    key.push({ q: q.id, rank: i + 1, appid: g.appid, name: g.name, score: g.score, exact: g.exact });
  });
  lines.push("");
}
const bundle = lines.join("\n");
for (const t of ["T2", "T3"]) {
  fs.writeFileSync(path.join(R2, "task" + t, "bundle.md"), bundle);
  const p = fs.readFileSync(path.join(ARMY, "task" + t, "prompt.txt"), "utf8");
  if (!p.includes(String(GI0.games.length))) throw new Error("工單找不到基準款數 " + GI0.games.length);
  fs.writeFileSync(path.join(R2, "task" + t, "prompt.txt"), p.split(String(GI0.games.length)).join(String(GI.games.length)));
}
fs.writeFileSync(path.join(ARMY, "control", "round2_results.json"), JSON.stringify(key, null, 1));
const same = key.filter(k => base.some(b => b.q === k.q && b.appid === k.appid)).length;
out.前6名與基準重疊 = same + "/" + key.length;

/* 2. 提名回收 */
const noms = require(path.join(ARMY, "control", "nominations_verified.json")).filter(n => n.appidOk && n.nameMatch);
const qById = Object.fromEntries(questions.map(q => [q.id, q]));
const inNew = new Set(GI.games.map(g => g[0]));
const uniq = new Map();
noms.forEach(n => { const k = n.q + "|" + n.appid; if (!uniq.has(k)) uniq.set(k, n); });
const rows = [...uniq.values()].map(n => {
  const inTop = (gi, c, idx) => c.matchGames(qById[n.q].sel, gi, idx, { limit: 6 }).games.some(g => g.appid === n.appid);
  return { q: n.q, name: n.name, appid: n.appid, 基準收錄: n.inIndex, 新收錄: inNew.has(n.appid),
    基準前6: inTop(GI0, core0, IDX0), 新前6: inTop(GI, core, IDX) };
});
const games = new Set(rows.map(r => r.appid));
out.提名回收 = {
  題目與遊戲組合: rows.length, 不重複遊戲: games.size,
  基準收錄: [...games].filter(a => rows.find(r => r.appid === a).基準收錄).length,
  新收錄: [...games].filter(a => inNew.has(a)).length,
  基準進前6: rows.filter(r => r.基準前6).length, 新進前6: rows.filter(r => r.新前6).length,
  仍未收錄: [...games].filter(a => !inNew.has(a)).map(a => rows.find(r => r.appid === a).name)
};

/* 3. T1b：第 7～12 高票標籤 */
const steam = require(path.join(ARMY, "taskT1", "steam_tags.json"));
const t1games = require(path.join(ARMY, "taskT1", "games.json"));
const lib = new Map(T.map(r => [r[5], r[1]]));   // tagid -> 英文名
const rankOf = (sel, gi, c, idx, appid) => {
  const m = c.matchGames(sel, gi, idx, { limit: 100000 }).games;
  const i = m.findIndex(g => g.appid === appid);
  return i < 0 ? null : i + 1;
};
const t1b = t1games.map(g => {
  const st = (steam[g.appid] || []).filter(t => lib.has(Number(t.tagid))).sort((a, b) => b.count - a.count);
  const sel = st.slice(6, 12).map(t => ({ en: lib.get(Number(t.tagid)), role: "core" }));
  return { appid: g.appid, name: g.name, 標籤數: sel.length,
    基準名次: sel.length ? rankOf(sel, GI0, core0, IDX0, g.appid) : null,
    新名次: sel.length ? rankOf(sel, GI, core, IDX, g.appid) : null,
    新前6標籤名次: rankOf(st.slice(0, 6).map(t => ({ en: lib.get(Number(t.tagid)), role: "core" })), GI, core, IDX, g.appid) };
});
const stat = k => {
  const v = t1b.filter(r => r.標籤數 >= 3).map(r => r[k]);
  const ok = v.filter(x => x !== null).sort((a, b) => a - b);
  return { 可測: v.length, 不在索引: v.length - ok.length, 第1名: v.filter(x => x === 1).length, 前6名: v.filter(x => x !== null && x <= 6).length,
    名次中位數: ok.length ? ok[Math.floor((ok.length - 1) / 2)] : null };
};
out.T1b第7到12名標籤 = { 基準: stat("基準名次"), 新: stat("新名次") };
out.T1前6名標籤_新索引 = stat("新前6標籤名次");
fs.writeFileSync(path.join(ARMY, "control", "round2_t1b.json"), JSON.stringify(t1b, null, 1));

/* 4. 罕見提示 */
out.罕見提示 = questions.map(q => {
  const a = core.assessCombo(q.sel, GI, IDX);
  return q.id + (a.low ? " 標記" : " —") + " 吻合" + (a.topScore * 100).toFixed(0) + "%／門檻" + (a.threshold === null ? "無" : (a.threshold * 100).toFixed(0) + "%")
    + (a.gaps.length ? " 缺口:" + a.gaps.map(p => p.join("+")).join("、") : "")
    + (a.rareTags.length ? " 冷門:" + a.rareTags.map(t => t.en + "(" + t.total + ")").join("、") : "");
});
fs.writeFileSync(path.join(ARMY, "control", "round2_offline.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
