/* T2／T3 盲評驗收與彙總。用法：node verify_judges.js [T2|T3|both] [--round2] */
const fs = require("fs");
const path = require("path");
const ARMY = path.join(__dirname, "..");
const ROUND2 = process.argv.includes("--round2");
const key = JSON.parse(fs.readFileSync(path.join(__dirname, ROUND2 ? "round2_results.json" : "baseline_results.json"), "utf8"));
const keySet = new Set(key.map(k => k.q + "|R" + k.rank + "|" + k.appid));
const which = process.argv.slice(2).find(a => !a.startsWith("--")) || "both";

function parse(file) {
  const txt = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const rows = [];
  for (const line of txt.split("\n")) {
    const m = /^\|\s*(C\d{2})\s*\|\s*(R\d)\s*\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (m) rows.push({ q: m[1], r: m[2], appid: Number(m[3]), score: m[4], why: m[5] });
  }
  // 接受 ## 或 ###：工單寫 ###，模型常改成 ##，內容不受影響
  const sec = name => (txt.split(new RegExp("#{2,3}\\s*" + name))[1] || "").split(/\n#{2,3}\s/)[0];
  const noms = sec("4-2").split("\n").filter(l => /^\s*`?C\d{2}：/.test(l.trim()));
  const sums = sec("4-3").split("\n").filter(l => /^\s*`?C\d{2}：/.test(l.trim()));
  return { txt, rows, noms, sums };
}

function check(tag, file) {
  const p = parse(file);
  const got = new Set(p.rows.map(r => r.q + "|" + r.r + "|" + r.appid));
  const res = {
    線: tag,
    條件1_報告存在且只寫一檔: fs.existsSync(file) && fs.readdirSync(path.dirname(file)).sort().join(",") === ["bundle.md", "prompt.txt", path.basename(file), "run.log"].sort().join(","),
    條件2_120列且集合一致: p.rows.length === 120 && got.size === 120 && [...keySet].every(k => got.has(k)),
    細節: { 列數: p.rows.length, 缺: [...keySet].filter(k => !got.has(k)).slice(0, 5), 多: [...got].filter(k => !keySet.has(k)).slice(0, 5) },
    條件3_分數只有210: p.rows.every(r => ["0", "1", "2"].includes(r.score)),
    條件4_提名20行且附appid或不確定: p.noms.length === 20 && p.noms.every(l => /：\s*無\s*`?$/.test(l.trim()) || l.split(/；/).every(x => /appid\s*\d+|appid\s*不確定/.test(x))),
    條件5_總評20行: p.sums.length === 20
  };
  return { res, p };
}

const judges = {};
for (const t of (which === "both" ? ["T2", "T3"] : [which])) {
  const f = path.join(ARMY, ROUND2 ? "round2" : "", "task" + t, "report" + t + ".md");
  if (!fs.existsSync(f)) { console.log(t + "：報告不存在"); continue; }
  const { res, p } = check(t, f);
  console.log(JSON.stringify(res, null, 1));
  judges[t] = p;
}

/* 彙總：只在格式過關時算 */
function summary(p) {
  const s = p.rows.map(r => Number(r.score));
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const by = {}; p.rows.forEach(r => { (by[r.q] = by[r.q] || []).push(Number(r.score)); });
  const perQ = Object.keys(by).sort().map(q => q + "=" + (by[q].reduce((a, b) => a + b, 0) / by[q].length).toFixed(2));
  const top1 = p.rows.filter(r => r.r === "R1").map(r => Number(r.score));
  return {
    平均分: avg.toFixed(3),
    分布: { "2": s.filter(x => x === 2).length, "1": s.filter(x => x === 1).length, "0": s.filter(x => x === 0).length },
    有參考價值比例_分數至少1: (s.filter(x => x >= 1).length / s.length * 100).toFixed(0) + "%",
    第1名平均分: (top1.reduce((a, b) => a + b, 0) / top1.length).toFixed(2),
    各題平均: perQ.join(" ")
  };
}
for (const t of Object.keys(judges)) if (judges[t].rows.length === 120) console.log(t + " 彙總：" + JSON.stringify(summary(judges[t]), null, 1));

if (judges.T2 && judges.T3 && judges.T2.rows.length === 120 && judges.T3.rows.length === 120) {
  const m2 = new Map(judges.T2.rows.map(r => [r.q + r.r, Number(r.score)]));
  const pairs = judges.T3.rows.map(r => [m2.get(r.q + r.r), Number(r.score)]);
  const exact = pairs.filter(([a, b]) => a === b).length / pairs.length;
  /* 二次加權 kappa（0～2 三級） */
  const K = 3, O = Array.from({ length: K }, () => Array(K).fill(0));
  pairs.forEach(([a, b]) => O[a][b]++);
  const N = pairs.length, ra = O.map(r => r.reduce((x, y) => x + y, 0)), cb = [0, 1, 2].map(j => O.reduce((x, r) => x + r[j], 0));
  let num = 0, den = 0;
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
    const w = ((i - j) ** 2) / ((K - 1) ** 2);
    num += w * O[i][j]; den += w * ra[i] * cb[j] / N;
  }
  const kappa = den ? 1 - num / den : 1;
  const bigGap = pairs.map((p, i) => [p, judges.T3.rows[i]]).filter(([[a, b]]) => Math.abs(a - b) === 2)
    .map(([[a, b], r]) => r.q + r.r + "(T2=" + a + ",T3=" + b + ")");
  console.log("一致度：完全一致 " + (exact * 100).toFixed(0) + "%，二次加權 kappa " + kappa.toFixed(3) + "，差 2 分的 " + bigGap.length + " 筆：" + bigGap.join(" "));
}
