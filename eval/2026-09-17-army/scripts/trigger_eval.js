/* 罕見提示的觸發條件評估：保證可做 vs 刻意衝突，各抽 400 組，比較三種觸發規則的命中率。
   理想：刻意衝突高、保證可做低。用法：node trigger_eval.js [索引路徑] */
const path = require("path");
const REPO = "C:/projects/steam-tag-prompter/";
const core = require(REPO + "core.js");
const T = require(REPO + "data/tags.json");
const GI = require(process.argv[2] || REPO + "data/game-index.json");
const IDX = core.makeIndex(T);
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const N = 400;
const res = {};
for (const mode of ["safe", "clash"]) {
  for (const n of [4, 6, 8]) {
    const rng = seeded(mode === "safe" ? 1000 + n : 2000 + n);
    let low = 0, gap = 0, either = 0, coreGap = 0;
    for (let i = 0; i < N; i++) {
      const r = core.rollTags({ T, idx: IDX, mode, n, rng, curatedOnly: true, locked: [] });
      const a = core.assessCombo(r.sel, GI, IDX);
      const g = a.gaps.length > 0;
      if (a.low) low++;
      if (g) gap++;
      if (a.low || g) either++;
      // 只看核心標籤之間的缺口
      const cores = r.sel.filter(s => s.role === "core").map(s => IDX.byEn[s.en][5]);
      let cg = false;
      for (let x = 0; x < cores.length && !cg; x++) for (let y = x + 1; y < cores.length && !cg; y++)
        if (!GI.games.some(gm => gm[4].includes(cores[x]) && gm[4].includes(cores[y]))) cg = true;
      if (cg) coreGap++;
    }
    const p = v => Math.round(v / N * 100) + "%";
    res[mode + n] = { 低於門檻: p(low), 有缺口: p(gap), 任一: p(either), 核心間缺口: p(coreGap) };
  }
}
console.log("索引 " + GI.games.length + " 款");
console.table(res);
