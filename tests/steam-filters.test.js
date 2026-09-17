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

/* 收錄方針（2026-09-17 老師定案）：工具忠於 Steam，不以成人與否過濾。
   這條測試把方針鎖住——誰想加回成人過濾，得先改這裡並說明理由。 */
test("收錄方針：18 禁與成人描述子都不是擋下的理由", () => {
  assert.equal(F.isAdult, undefined, "不應再匯出成人判別函式");
  assert.equal(F.rejectReason(ok({ required_age: 18 })), null);
  assert.equal(F.rejectReason(ok({ required_age: "18", content_descriptors: { ids: [1, 3, 4, 5] } })), null);
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
  assert.equal(F.rejectReason(ok({ genres: [{ id: "57" }] })), "software");
  assert.equal(F.rejectReason(ok({ header_image: "", movies: [] })), "noimg");
  assert.equal(F.rejectReason(ok({})), null);
});

test("擋下原因：成人的軟體照樣以軟體擋", () => {
  assert.equal(F.rejectReason(ok({ required_age: 18, genres: [{ id: "57" }] })), "software");
});

/* 商店頁片段取自 2026-09-17 實抓的 Hades（appid 1145360）頁面，只留標籤段。
   頁面上的 reviewCount meta 按語言篩過、不採用，片段裡保留它是為了確認解析不會誤取 */
const STORE_SNIPPET = `<script>InitAppTagModal( 1145360, [{"tagid":42804,"name":"Action Roguelike","count":1453,"browseable":true},{"tagid":3959,"name":"Roguelite","count":1059,"browseable":true},{"tagid":1646,"name":"Hack and Slash","count":1036,"browseable":true},{"tagid":99999999,"name":"Not In Library","count":2000,"browseable":true}], [], "#app_tagging_modal", true );</script>
<meta itemprop="reviewCount" content="142444">`;

test("商店頁標籤：只留標籤庫有的，依票數排序", () => {
  const lib = new Set([42804, 3959, 1646]);
  assert.deepEqual(F.parseStoreTags(STORE_SNIPPET, lib), [[42804, 1453], [3959, 1059], [1646, 1036]]);
  assert.equal(F.parseStoreTags(STORE_SNIPPET, lib).some(t => t[0] === 99999999), false, "標籤庫沒有的要濾掉");
});

test("商店頁標籤：找不到標籤段回 null，不回空陣列冒充", () => {
  assert.equal(F.parseStoreTags("<html>年齡驗證頁</html>", new Set([1])), null);
  assert.equal(F.parseStoreTags("InitAppTagModal( 1, [壞掉的 JSON], [] )", new Set([1])), null);
  assert.deepEqual(F.parseStoreTags('InitAppTagModal( 1, [], [], "x" )', new Set([1])), []);
});

/* 評論 API 回應格式取自 2026-09-17 實測（Hades，language=all） */
test("評論數：取評論 API 的所有語言總數", () => {
  assert.equal(F.parseAppReviews({ success: 1, query_summary: { num_reviews: 0, review_score_desc: "Overwhelmingly Positive", total_reviews: 308520 } }), 308520);
  assert.equal(F.parseAppReviews({ success: 1, query_summary: { total_reviews: 0 } }), 0, "真的 0 則要回 0");
});

test("評論數：取不到或格式不對回 null，不跟 0 則混在一起", () => {
  assert.equal(F.parseAppReviews(null), null);
  assert.equal(F.parseAppReviews({ success: 2 }), null);
  assert.equal(F.parseAppReviews({ success: 1 }), null);
  assert.equal(F.parseAppReviews({ success: 1, query_summary: { total_reviews: "abc" } }), null);
});

test("評論數：不再從商店頁 HTML 取（那個數字按語言篩過）", () => {
  assert.equal(F.parseReviewCount, undefined);
});

test("要不要抓商店頁：只抓收錄中、還沒有完整標籤的", () => {
  assert.equal(F.needsStore({ name: "x", img: "a.jpg" }), true);
  assert.equal(F.needsStore({ name: "x", img: "a.jpg", stags: [] }), false, "空陣列代表抓過了");
  assert.equal(F.needsStore({ bad: 1, why: "software" }), false);
  assert.equal(F.needsStore(undefined), false);
});

test("續跑判斷：抓不到、舊方針擋的、沒記原因的要重抓", () => {
  assert.equal(F.needsFetch(undefined), true, "沒紀錄要抓");
  assert.equal(F.needsFetch({ bad: 1, why: "fetch" }), true, "抓不到的要重抓（A-3）");
  assert.equal(F.needsFetch({ bad: 1, why: "adult" }), true, "舊方針以成人擋的，現行方針要收回");
  assert.equal(F.needsFetch({ bad: 1 }), true, "舊快取沒記原因，當時 18 禁也算在內，要重判一次");
  assert.equal(F.needsFetch({ bad: 1, why: "software" }), false);
  assert.equal(F.needsFetch({ bad: 1, why: "type" }), false);
  assert.equal(F.needsFetch({ bad: 1, why: "noimg" }), false);
  assert.equal(F.needsFetch({ name: "x" }), true, "缺 img 的更舊格式要重抓");
  assert.equal(F.needsFetch({ name: "x", img: "1/h.jpg" }), false);
});
