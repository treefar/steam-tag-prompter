/* 查證評審提名的 appid 是不是真的是那款遊戲（模型常把 appid 配錯），並分類「在不在索引」。 */
const fs = require("fs");
const path = require("path");
const noms = JSON.parse(fs.readFileSync(path.join(__dirname, "nominations.json"), "utf8"));
const GI = require(path.join(__dirname, "..", "baseline", "game-index.json"));
const inIdx = new Map(GI.games.map(g => [g[0], g]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s).toLowerCase().replace(/[™®©:;'’\-–—!.,]/g, " ").replace(/\s+/g, " ").trim();

(async () => {
  const ids = [...new Set(noms.filter(n => n.appid).map(n => n.appid))];
  const real = {};
  for (const id of ids) {
    let name = null, type = null, ok = false;
    try {
      const j = await fetch("https://store.steampowered.com/api/appdetails?appids=" + id + "&l=english").then(r => r.json());
      if (j && j[id] && j[id].success) { name = j[id].data.name; type = j[id].data.type; ok = true; }
    } catch (e) { /* 記為取不到 */ }
    real[id] = { ok, name, type };
    await sleep(1600);
  }
  const rows = noms.filter(n => n.appid).map(n => {
    const r = real[n.appid];
    const a = norm(n.name), b = norm(r.name || "");
    const match = r.ok && (a === b || b.includes(a) || a.includes(b) || a.split(" ")[0] === b.split(" ")[0]);
    return Object.assign({}, n, { steamName: r.name, type: r.type, appidOk: r.ok, nameMatch: match, inIndex: inIdx.has(n.appid) });
  });
  fs.writeFileSync(path.join(__dirname, "nominations_verified.json"), JSON.stringify(rows, null, 1));
  const bad = rows.filter(r => !r.appidOk || !r.nameMatch);
  console.log("核對 " + rows.length + " 筆（" + ids.length + " 款）：appid 與名稱相符 " + rows.filter(r => r.appidOk && r.nameMatch).length + "、不符或取不到 " + bad.length);
  bad.forEach(r => console.log("  ✗ " + r.judge + " " + r.q + "　提名「" + r.name + "」appid " + r.appid + " → Steam 上是「" + (r.steamName || "取不到") + "」"));
  const good = rows.filter(r => r.appidOk && r.nameMatch);
  const gu = [...new Map(good.map(r => [r.appid, r])).values()];
  console.log("正確提名不重複 " + gu.length + " 款：在索引 " + gu.filter(r => r.inIndex).length + "、不在索引 " + gu.filter(r => !r.inIndex).length);
  console.log("不在索引的：" + gu.filter(r => !r.inIndex).map(r => r.steamName).join("、"));
})();
