/**
 * steam-filters.js 的回歸測試。跑法：npm test
 *
 * 軟體判別的樣本是 2026-09-16 實際呼叫 Steam appdetails 抄下來的 genres id，
 * 人工標註「遊戲／軟體」後用來歸納規則。這裡把它們鎖成測試：之後誰改了 SOFT_GENRES，
 * 只要讓任何一筆翻盤就會紅燈。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../steam-filters.js");

const g = ids => ({ genres: ids.map(id => ({ id: String(id) })) });   // Steam 回的 id 是字串

/* [名稱, genres id, 人工標註]。來源：2026-09-16 appdetails?l=english 實測 */
const SAMPLES = [
  ["VEGAS Pro 23", [51, 52, 55, 58], "軟體"],
  ["Krita", [23, 51, 53, 55], "軟體"],
  ["Aseprite", [51, 53, 60], "軟體"],
  ["3DMark", [57], "軟體"],
  ["Wallpaper Engine", [4, 23, 51, 53, 55, 57], "軟體"],
  ["RPG Maker MZ", [3, 53, 54, 59, 60], "軟體"],
  ["Lossless Scaling", [57], "軟體"],
  ["VTube Studio", [23, 51, 58], "軟體"],
  ["Soundpad", [52, 57], "軟體"],
  ["Tiny Glade", [4, 23, 28], "遊戲"],
  ["TOEM", [25, 4, 23], "遊戲"],
  ["Ryse: Son of Rome", [1], "遊戲"],
  ["Incredibox", [4, 23], "遊戲"],
  ["破爛藝術家", [4, 23], "遊戲"],
  ["House Flipper Remastered", [4, 23, 28], "遊戲"],
  ["PC Building Simulator", [23, 28], "遊戲"],
  ["Turing Complete", [28, 70], "遊戲"],
  ["SHINOBI 反攻的斬擊", [1], "遊戲"],
  ["SEASON", [25, 4, 23], "遊戲"],
  ["初音未來 Project DIVA", [1], "遊戲"],
  ["Crysis Warhead", [1], "遊戲"],
  ["s&box", [1, 25, 4, 23, 9, 28, 18, 2], "遊戲"],
  ["Rusty's Retirement", [4, 23, 28, 2], "遊戲"],
  ["嘟嘟鴨與摺疊世界", [25, 23], "遊戲"],
  ["Bongo Cat（Steam 自己列為 Casual／Indie／模擬）", [4, 23, 29, 28, 37], "遊戲"]
];

test("軟體判別：25 筆實測樣本全部判對", () => {
  const wrong = SAMPLES.filter(([, ids, truth]) => F.isSoftware(g(ids)) !== (truth === "軟體"));
  assert.deepEqual(wrong.map(w => w[0]), [], "判錯的樣本");
});

test("軟體判別：沒有 genres 欄位不當成軟體，也不丟例外", () => {
  assert.equal(F.isSoftware({}), false);
  assert.equal(F.isSoftware(null), false);
  assert.equal(F.isSoftware({ genres: [] }), false);
});

test("成人判別：18 禁或描述子 3／4 才擋", () => {
  assert.equal(F.isAdult({ required_age: 18 }), true);
  assert.equal(F.isAdult({ required_age: "18" }), true, "Steam 有時回字串");
  assert.equal(F.isAdult({ content_descriptors: { ids: [3] } }), true);
  assert.equal(F.isAdult({ content_descriptors: { ids: [1, 4, 5] } }), true);
  assert.equal(F.isAdult({ required_age: 12 }), false);
  assert.equal(F.isAdult({ content_descriptors: { ids: [1, 5] } }), false, "蔚藍檔案、Muse Dash 是 [1,5]，主流遊戲不該擋");
});

/* 這條是「記錄已知限制」，不是期望行為：2026-09-16 實測 NUKITASHI 在匿名 appdetails 裡
   年齡 0、沒有描述子，跟 Hades 一模一樣。自動規則擋不到，所以才需要 data/game-exclude.json。
   如果哪天這條變紅，代表 Steam 開始回傳分級了，可以考慮拿掉人工清單。 */
test("已知限制：全年齡版上架的成人向作品，自動規則擋不到", () => {
  assert.equal(F.isAdult({ required_age: 0, content_descriptors: { ids: [] } }), false);
});

test("網址縮短：砍查詢字串與共同前綴，認不出來的原樣保留", () => {
  assert.equal(F.shortUrl(F.ASSET_PREFIX + "123/abc/header.jpg?t=99"), "123/abc/header.jpg");
  assert.equal(F.shortUrl("https://shared.fastly.steamstatic.com/x/header.jpg?t=1"),
    "https://shared.fastly.steamstatic.com/x/header.jpg");
  assert.equal(F.shortUrl(""), "");
  assert.equal(F.shortUrl(null), "");
});

const ok = extra => ({ success: true, data: Object.assign({
  type: "game", required_age: 0, genres: [{ id: "1" }],
  header_image: F.ASSET_PREFIX + "1/h.jpg", movies: []
}, extra) });

test("擋下原因：每一種都分得出來", () => {
  assert.equal(F.rejectReason(null), "fetch");
  assert.equal(F.rejectReason({ success: false }), "fetch");
  assert.equal(F.rejectReason({ success: true }), "fetch");
  assert.equal(F.rejectReason(ok({ type: "dlc" })), "type");
  assert.equal(F.rejectReason(ok({ required_age: 18 })), "adult");
  assert.equal(F.rejectReason(ok({ genres: [{ id: "57" }] })), "software");
  assert.equal(F.rejectReason(ok({ header_image: "", movies: [] })), "noimg");
  assert.equal(F.rejectReason(ok({})), null);
});

test("擋下原因：成人優先於軟體（兩個都中時記成人）", () => {
  assert.equal(F.rejectReason(ok({ required_age: 18, genres: [{ id: "57" }] })), "adult");
});

test("續跑判斷：只有「一時抓不到」與「舊格式」要重抓", () => {
  assert.equal(F.needsFetch(undefined), true, "沒紀錄要抓");
  assert.equal(F.needsFetch({ bad: 1, why: "fetch" }), true, "抓不到的要重抓（A-3）");
  assert.equal(F.needsFetch({ bad: 1, why: "software" }), false);
  assert.equal(F.needsFetch({ bad: 1, why: "adult" }), false);
  assert.equal(F.needsFetch({ bad: 1 }), false, "舊快取沒記原因，抽驗 25 筆 0 筆誤丟，沿用");
  assert.equal(F.needsFetch({ name: "x" }), true, "缺 img 的更舊格式要重抓");
  assert.equal(F.needsFetch({ name: "x", img: "1/h.jpg" }), false);
});
