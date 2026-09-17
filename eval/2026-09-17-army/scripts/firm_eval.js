/* 試算：罕見度只看「已決定的標籤」（核心＋差異化），門檻也用同樣方式從抽籤算。
   比較現行做法與新做法在 20 題與隨機抽籤上的標記結果。不改 repo。 */
const REPO = "C:/projects/steam-tag-prompter/";
const core = require(REPO + "core.js");
const T = require(REPO + "data/tags.json");
const GI = require(REPO + "data/game-index.json");
const IDX = core.makeIndex(T);
const Q = require(__dirname + "/control/questions.json");
const seeded = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const firm = sel => sel.filter(s => s.role !== "ask");
const top = sel => { const m = core.matchGames(sel, GI, IDX, { limit: 1 }); return m.games[0] ? m.games[0].score : 0; };

/* 新門檻：抽 n=3..14 的保證可做組合，去掉待抉擇後依「已決定標籤數」分組取 P20 */
const rng = seeded(20260917);
const byK = {};
for (let n = 3; n <= 14; n++) for (let i = 0; i < 300; i++) {
  const r = core.rollTags({ T, idx: IDX, mode: "safe", n, rng, curatedOnly: true, locked: [] });
  if (!r.sel) continue;
  const f = firm(r.sel);
  if (!f.length) continue;
  (byK[f.length] = byK[f.length] || []).push(top(f));
}
const thr = {};
Object.keys(byK).forEach(k => { const v = byK[k].sort((a, b) => a - b); if (v.length >= 50) thr[k] = v[Math.floor(v.length * 0.2)]; });
console.log("新門檻（已決定標籤數→P20，樣本數）：" + Object.keys(thr).map(k => k + "→" + Math.round(thr[k] * 100) + "%(" + byK[k].length + ")").join(" "));
const thrOf = k => { const ks = Object.keys(thr).map(Number); const kk = Math.max(Math.min(...ks), Math.min(Math.max(...ks), k)); return thr[kk]; };

const judge = { C01: 1.17, C02: 1.42, C03: 1.5, C04: 1.92, C05: 2, C06: 1.92, C07: 1.83, C08: 1.92, C09: 1.42, C10: 1.33,
  C11: 1.75, C12: 1.58, C13: 2, C14: 1.58, C15: 0.58, C16: 0.42, C17: 1, C18: 0.58, C19: 1.5, C20: 1.17 };
for (const q of Q) {
  const a = core.assessCombo(q.sel, GI, IDX);
  const f = firm(q.sel), s = top(f), t = thrOf(f.length);
  console.log(q.id + " 評審" + judge[q.id].toFixed(2) + "｜現行 " + (a.low ? "標記" : "—") + " " + Math.round(a.topScore * 100) + "%/" + Math.round(a.threshold * 100)
    + "%｜新 " + (s < t ? "標記" : "—") + " 已決定" + f.length + "個 " + Math.round(s * 100) + "%/" + Math.round(t * 100) + "%");
}

/* 隨機抽籤的標記率 */
for (const mode of ["safe", "clash"]) for (const n of [4, 6, 8]) {
  const r2 = seeded((mode === "safe" ? 1000 : 2000) + n);
  let cur = 0, nw = 0, N = 300;
  for (let i = 0; i < N; i++) {
    const r = core.rollTags({ T, idx: IDX, mode, n, rng: r2, curatedOnly: true, locked: [] });
    if (core.assessCombo(r.sel, GI, IDX).low) cur++;
    const f = firm(r.sel);
    if (f.length && top(f) < thrOf(f.length)) nw++;
  }
  console.log(mode + n + "：現行標記 " + Math.round(cur / N * 100) + "%，新做法 " + Math.round(nw / N * 100) + "%");
}
