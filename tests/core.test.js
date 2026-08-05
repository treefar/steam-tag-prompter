/**
 * core.js 的回歸測試。跑法：npm test（等同 node --test tests/）
 *
 * 測的是 index.html 實際跑的同一份邏輯——build-tags.js 把 core.js 內嵌進 index.html，
 * 這裡直接 require 同一個檔案。
 *
 * 隨機源可注入，所以「500 次都不出現互斥」這種性質可以穩定重跑，
 * 失敗時也能用 seed 重現。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const core = require("../core.js");
const T = require("../data/tags.json");
const IDX = core.makeIndex(T);
const { CFL, BAN, HEAVY, CLASH, ASK_PAIRS, PLAYERS_SAFE, rollTags, encodeSel, decodeSel } = core;

/** 可重現的偽隨機（mulberry32）。測試失敗時把 seed 印出來就能重跑同一組。 */
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const conflicts = (a, b) => Boolean(CFL[a] && CFL[a].has(b));
const dimsOf = names => new Set(names.map(n => IDX.byEn[n][0]));

/* ---------------- 標籤表本身 ---------------- */

test("標籤表結構完整", () => {
  assert.ok(T.length > 300, `標籤數異常：${T.length}`);
  for (const r of T) {
    assert.equal(r.length, 7, `列長度應為 7：${JSON.stringify(r)}`);
    assert.ok(Number.isInteger(r[0]) && r[0] >= 0 && r[0] <= 9, `維度超出範圍：${r[1]}`);
    assert.ok(typeof r[1] === "string" && r[1].length, `英文名缺失：${JSON.stringify(r)}`);
    assert.ok(typeof r[2] === "string" && r[2].length, `中文名缺失：${r[1]}`);
    assert.ok(Number.isInteger(r[5]) && r[5] > 0, `ID 不合法：${r[1]}`);
  }
});

test("標籤 ID 唯一（短碼正確性的前提）", () => {
  const ids = T.map(r => r[5]);
  assert.equal(new Set(ids).size, ids.length, "ID 有重複");
});

test("ID 都在短碼可編碼範圍內", () => {
  const max = Math.max(...T.map(r => r[5]));
  assert.ok(max < 36 ** (core.CODE_LEN - 1),
    `最大 ID ${max} 超出 ${core.CODE_LEN - 1} 位 base36 上限 ${36 ** (core.CODE_LEN - 1)}`);
});

test("設定表引用的標籤都存在於標籤表", () => {
  const missing = [];
  const check = (name, where) => { if (!IDX.byEn[name]) missing.push(`${where}: ${name}`); };
  CLASH.forEach((p, i) => p.forEach(n => check(n, `CLASH[${i}]`)));
  ASK_PAIRS.forEach((p, i) => p.forEach(n => check(n, `ASK_PAIRS[${i}]`)));
  PLAYERS_SAFE.forEach(n => check(n, "PLAYERS_SAFE"));
  assert.deepEqual(missing, [], `設定表引用了不存在的標籤：\n${missing.join("\n")}`);
});

/* 待抉擇配對原則上要同維度（同一個問題的兩個答案）。少數跨維度配對是刻意的設計問題，
   列在這裡當白名單——新增跨維度配對時必須一起補進來並寫清楚它問的是什麼。 */
const CROSS_DIM_OK = new Set([
  "Story Rich vs Fast-Paced",   // 敘事優先還是節奏優先：影響關卡長度與對白量的取捨
]);
test("待抉擇配對是同一維度的二選一（跨維度需列入白名單）", () => {
  const bad = ASK_PAIRS
    .filter(([a, b]) => IDX.byEn[a][0] !== IDX.byEn[b][0])
    .map(p => p.join(" vs "))
    .filter(k => !CROSS_DIM_OK.has(k));
  assert.deepEqual(bad, [],
    `跨維度配對未列入白名單（若是刻意設計，補進 CROSS_DIM_OK 並註明問的是什麼）：\n${bad.join("\n")}`);
});

test("待抉擇配對不含全模式禁抽或重工程標籤", () => {
  const bad = ASK_PAIRS.flat().filter(n => BAN.has(n) || HEAVY.has(n));
  assert.deepEqual([...new Set(bad)], [], "配對含禁抽標籤");
});

/* ---------------- 抽籤：保證可做 ---------------- */

test("保證可做模式：500 次抽籤皆符合所有規則", () => {
  for (let seed = 1; seed <= 500; seed++) {
    const r = rollTags({ T, idx: IDX, mode: "safe", n: 6, curatedOnly: true,
                         locked: [], rng: seeded(seed) });
    const ctx = `seed=${seed} → ${r.sel.map(s => s.role[0] + ":" + s.en).join(", ")}`;
    assert.equal(r.sel.length, 6, `數量不對｜${ctx}`);

    const names = r.sel.map(s => s.en);
    assert.equal(new Set(names).size, names.length, `有重複標籤｜${ctx}`);

    const asks = r.sel.filter(s => s.role === "ask").map(s => s.en);
    const others = names.filter(n => !asks.includes(n));

    // 非待抉擇的標籤之間不得互斥
    for (const a of others) for (const b of others)
      if (a !== b) assert.ok(!conflicts(a, b), `互斥並存 ${a}×${b}｜${ctx}`);
    // 待抉擇的每個選項都不能與其他標籤互斥，否則選了也沒用
    for (const a of asks) for (const b of others)
      assert.ok(!conflicts(a, b), `抉擇選項 ${a} 與 ${b} 互斥，選了也無效｜${ctx}`);

    const dims = dimsOf(names);
    for (const d of [2, 3, 8]) assert.ok(dims.has(d), `缺維度 ${d}｜${ctx}`);
    assert.ok(dims.has(0) || dims.has(1), `無類型訊號｜${ctx}`);
    assert.ok(!(dims.has(0) && dims.has(1)), `大類型與子類型並存｜${ctx}`);

    // 玩家結構必須真的表態單／多人（PvE 這類不算）
    const players = names.filter(n => IDX.byEn[n][0] === 8);
    assert.ok(players.some(n => PLAYERS_SAFE.includes(n)), `玩家結構未表態：${players}｜${ctx}`);

    // 全模式禁抽與重工程標籤都不該出現
    for (const n of names) {
      assert.ok(!BAN.has(n), `抽到禁抽標籤 ${n}｜${ctx}`);
      assert.ok(!HEAVY.has(n), `抽到重工程標籤 ${n}｜${ctx}`);
    }
  }
});

test("保證可做模式：每次都留一組待抉擇", () => {
  let withAsk = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const r = rollTags({ T, idx: IDX, mode: "safe", n: 6, curatedOnly: true,
                         locked: [], rng: seeded(seed) });
    if (r.sel.filter(s => s.role === "ask").length === 2) withAsk++;
  }
  assert.equal(withAsk, 100, `只有 ${withAsk}/100 次留了完整的待抉擇組`);
});

/* ---------------- 抽籤：刻意衝突 ---------------- */

test("刻意衝突模式：每次都抽出完整反差配對並標為差異化", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rollTags({ T, idx: IDX, mode: "clash", n: 6, curatedOnly: true,
                         locked: [], rng: seeded(seed) });
    const diffs = r.sel.filter(s => s.role === "diff").map(s => s.en);
    const ok = CLASH.some(p => p.every(n => diffs.includes(n)));
    assert.ok(ok, `seed=${seed} 沒抽出完整配對：diff=${diffs}`);
  }
});

test("刻意衝突模式：額度放不下配對時不加半組，並回報原因", () => {
  const locked = [{ en: "Horror", role: "core", lock: true },
                  { en: "Cozy", role: "core", lock: true }];
  const r = rollTags({ T, idx: IDX, mode: "clash", n: 3, curatedOnly: true,
                      locked, rng: seeded(7) });
  const diffs = r.sel.filter(s => s.role === "diff").map(s => s.en);
  const halfPair = diffs.length === 1;
  assert.ok(!halfPair, `只加了半組配對：${diffs}`);
  if (diffs.length === 0) assert.ok(r.notice, "沒加配對就該回報原因");
});

/* ---------------- 抽籤：完全隨機 ---------------- */

test("完全隨機模式：不管矛盾但仍不抽禁抽標籤、數量正確", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rollTags({ T, idx: IDX, mode: "chaos", n: 6, curatedOnly: true,
                         locked: [], rng: seeded(seed) });
    assert.equal(r.sel.length, 6, `seed=${seed} 數量不對`);
    const names = r.sel.map(s => s.en);
    assert.equal(new Set(names).size, names.length, `seed=${seed} 有重複`);
    for (const n of names) assert.ok(!BAN.has(n), `seed=${seed} 抽到禁抽標籤 ${n}`);
  }
});

/* ---------------- 抽籤：數量與鎖定 ---------------- */

test("抽籤數量夾在 3～10，非法輸入回退為 6", () => {
  const n = (v, seed) => rollTags({ T, idx: IDX, mode: "safe", n: v, curatedOnly: true,
                                    locked: [], rng: seeded(seed) }).sel.length;
  assert.equal(n(3, 1), 3);
  assert.equal(n(10, 2), 10);
  assert.equal(n(-5, 3), 3, "負數應夾到下限 3");
  assert.equal(n(999, 4), 10, "過大應夾到上限 10");
  assert.equal(n("", 5), 6, "空字串應回退 6");
  assert.equal(n("abc", 6), 6, "非數字應回退 6");
  assert.equal(n(null, 7), 6, "null 應回退 6");
});

test("鎖定的標籤在重抽後全部保留", () => {
  const locked = [{ en: "Pixel Graphics", role: "core", lock: true },
                  { en: "Singleplayer", role: "diff", lock: true }];
  for (let seed = 1; seed <= 100; seed++) {
    const r = rollTags({ T, idx: IDX, mode: "safe", n: 6, curatedOnly: true,
                         locked, rng: seeded(seed) });
    const kept = r.sel.filter(s => s.lock);
    assert.equal(kept.length, 2, `seed=${seed} 鎖定數不對`);
    assert.deepEqual(kept.map(s => s.en).sort(), ["Pixel Graphics", "Singleplayer"],
      `seed=${seed} 鎖定標籤遺失`);
    assert.equal(kept.find(s => s.en === "Singleplayer").role, "diff",
      `seed=${seed} 鎖定標籤的角色被改掉`);
    assert.equal(r.sel.length, 6, `seed=${seed} 總數不對`);
  }
});

test("鎖定數達抽籤數時不進行抽籤並回報原因", () => {
  const locked = ["Horror", "Cozy", "2D", "Singleplayer", "Anime", "Exploration"]
    .map(en => ({ en, role: "core", lock: true }));
  const r = rollTags({ T, idx: IDX, mode: "safe", n: 3, curatedOnly: true,
                      locked, rng: seeded(1) });
  assert.equal(r.sel, null, "應該不回傳結果");
  assert.match(r.notice, /鎖定/, "應回報鎖定造成的原因");
});

test("只抽精選標籤時不會抽到非精選標籤", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const r = rollTags({ T, idx: IDX, mode: "safe", n: 8, curatedOnly: true,
                         locked: [], rng: seeded(seed) });
    for (const s of r.sel)
      assert.equal(IDX.byEn[s.en][6], 1, `seed=${seed} 抽到非精選標籤 ${s.en}`);
  }
});

test("相同 seed 產生相同結果（可重現）", () => {
  const a = rollTags({ T, idx: IDX, mode: "safe", n: 6, curatedOnly: true, locked: [], rng: seeded(42) });
  const b = rollTags({ T, idx: IDX, mode: "safe", n: 6, curatedOnly: true, locked: [], rng: seeded(42) });
  assert.deepEqual(a.sel, b.sel);
});

/* ---------------- 短碼 ---------------- */

test("短碼往返：三種角色與非官方標籤都能還原", () => {
  const list = [
    { en: "Low Poly", role: "core", lock: false },      // 非官方（合成 ID）
    { en: "School", role: "diff", lock: false },         // 非官方
    { en: "Cozy", role: "ask", lock: false },            // 官方
    { en: "Singleplayer", role: "core", lock: false },
  ];
  const code = encodeSel(list, IDX);
  assert.ok(code.startsWith(core.CODE_VER), "前綴不對");
  assert.equal(code.length, core.CODE_VER.length + core.CODE_LEN * list.length, "長度不對");
  const back = decodeSel(code, IDX);
  assert.equal(back.length, list.length);
  back.forEach((b, i) => {
    assert.equal(b.en, list[i].en);
    assert.equal(b.role, list[i].role);
  });
});

test("短碼往返：全部標籤逐一驗證", () => {
  for (const r of T) {
    const one = [{ en: r[1], role: "core", lock: false }];
    const back = decodeSel(encodeSel(one, IDX), IDX);
    assert.ok(back, `${r[1]} 無法還原`);
    assert.equal(back[0].en, r[1], `${r[1]} 還原成了 ${back[0].en}`);
  }
});

test("短碼會去除重複標籤", () => {
  const one = encodeSel([{ en: "Cozy", role: "core", lock: false }], IDX);
  const dup = one + one.slice(core.CODE_VER.length) + one.slice(core.CODE_VER.length);
  assert.equal(decodeSel(dup, IDX).length, 1);
});

test("畸形與惡意短碼一律回 null，不回半組資料", () => {
  const bad = [
    "", null, undefined, "XX", "S2", "S1abcdc",           // 空、舊版前綴
    "S2zzzzzc",                                            // ID 不存在
    "S200000x",                                            // 角色字元非法
    "S200000",                                             // 長度不足
    "S2" + "00000c".repeat(41),                            // 超出數量上限
    "S2<script>alert(1)</scr" + "ipt>",                     // 注入嘗試
    "S2 00000c", "S2\n00000c",                             // 夾雜空白（去空白後仍不合法者）
    {}, [], 0, true,                                       // 非字串
  ];
  for (const b of bad)
    assert.equal(decodeSel(b, IDX), null, `應拒收：${JSON.stringify(b)}`);
});

test("短碼允許大小寫混用（使用者手抄容易變形）", () => {
  const list = [{ en: "Cozy", role: "ask", lock: false }];
  const code = encodeSel(list, IDX);
  const back = decodeSel(code.toUpperCase().replace(/^S2/i, "S2"), IDX);
  assert.ok(back, "大寫短碼應可解讀");
  assert.equal(back[0].en, "Cozy");
  assert.equal(back[0].role, "ask");
});

test("短碼可容忍前後空白與換行", () => {
  const code = encodeSel([{ en: "Horror", role: "core", lock: false }], IDX);
  assert.ok(decodeSel("  " + code + "\n", IDX), "應忽略前後空白");
});

test("抽籤結果可經短碼完整往返", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const r = rollTags({ T, idx: IDX, mode: "clash", n: 6, curatedOnly: true,
                         locked: [], rng: seeded(seed) });
    const back = decodeSel(encodeSel(r.sel, IDX), IDX);
    assert.equal(back.length, r.sel.length, `seed=${seed} 數量不符`);
    back.forEach((b, i) => {
      assert.equal(b.en, r.sel[i].en, `seed=${seed} 第 ${i} 個標籤不符`);
      assert.equal(b.role, r.sel[i].role, `seed=${seed} 第 ${i} 個角色不符`);
    });
  }
});

/* ---------------- 建置產物一致性 ---------------- */

test("index.html 內嵌的 core.js 與原始檔一致（避免手改 index.html 造成分歧）", () => {
  const fs = require("fs");
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/\r\n/g, "\n");
  const src = fs.readFileSync(path.join(root, "core.js"), "utf8")
                .replace(/\r\n/g, "\n").replace(/\s+$/, "");
  const START = "/* CORE_INJECT_START — 以下由 build-tags.js 從 core.js 注入，不要手改 */";
  const END = "/* CORE_INJECT_END */";
  const i = html.indexOf(START), j = html.indexOf(END);
  assert.ok(i >= 0 && j > i, "index.html 找不到 core.js 注入標記");
  const injected = html.slice(i + START.length, j).replace(/^\n/, "").replace(/\n$/, "");
  assert.equal(injected, src,
    "index.html 內嵌的 core.js 與原始檔不同——請執行 node build-tags.js 重新建置");
});

test("index.html 內嵌的標籤表與 data/tags.json 一致", () => {
  const fs = require("fs");
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/\r\n/g, "\n");
  const m = html.match(/const T=\[([\s\S]*?)\n\];/);
  assert.ok(m, "index.html 找不到 const T");
  const embedded = JSON.parse("[" + m[1].replace(/\\u003c/g, "<") + "\n]");
  assert.deepEqual(embedded, T, "內嵌標籤表與 data/tags.json 不同——請執行 node build-tags.js");
});

test("版號單一來源：core.js 與 package.json 一致", () => {
  const pkg = require("../package.json");
  assert.equal(core.VERSION, "v" + pkg.version,
    `core.js 是 ${core.VERSION}，package.json 是 ${pkg.version}——改版號要兩邊一起改`);
});

test("core.js 不含會截斷內嵌 script 的序列", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8");
  assert.equal(/<\/script|<!--/i.test(src), false,
    "core.js 含 </script 或 <!--，內嵌進 index.html 會截斷 script 區塊");
});
