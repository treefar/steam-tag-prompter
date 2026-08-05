/**
 * core.js — 抽籤與短碼的純邏輯，零 DOM 依賴。
 *
 * 這是這些規則的唯一真實來源：
 *   - `build-tags.js` 會把本檔內容內嵌進 `index.html`（工具必須維持單檔可離線）
 *   - `tests/core.test.js` 直接 require 本檔做回歸測試
 * 因此**不要**在 index.html 裡直接改這段邏輯，改這裡再跑 `node build-tags.js`。
 *
 * 標籤列格式（與 data/tags.json 一致）：
 *   [0]維度 [1]英文名 [2]中文名 [3]旗標(h大流量 n利基 w注意 u非官方) [4]說明 [5]ID [6]是否精選
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.assign(root, api);            // 瀏覽器：掛成全域供 index.html 使用
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";

/* 版號的唯一來源。工單標頭會引用它，測試會斷言它與 package.json 一致，
   所以不會再出現「工單寫 v1.0、package.json 寫 1.1.0」這種分歧。 */
const VERSION = "v1.1.0";

const ROLES = ["core", "diff", "ask"];

/* 非遊戲軟體類與成人內容：任何抽籤模式都不抽（這是給大學生用的教學工具） */
const BAN = new Set(["Software", "Utilities", "Design & Illustration", "Animation & Modeling",
"Video Production", "Audio Production", "Photo Editing", "Game Development", "Software Training",
"Benchmark", "Hardware", "Desktop Companion", "360 Video", "Mod", "Gaming", "Education",
"Sexual Content", "Nudity", "Hentai", "Free to Play", "Early Access", "Indie", "Remake", "Sequel",
"Reboot", "Controller", "Mouse Only", "Touch-Friendly", "Voice Control",
"TrackIR", "Tutorial"]);

/* 「保證可做」與「刻意衝突」額外排除：多人基礎建設龐大、需特殊裝備、或需大型系統支撐 */
const HEAVY = new Set(["Multiplayer", "MMORPG", "MOBA", "Battle Royale",
"Massively Multiplayer", "VR", "Asymmetric VR", "Open World",
"Character Customization", "Level Editor", "Moddable"]);

/* 互斥組（非隨機模式生效）。待抉擇配對內部的互斥是刻意的，不受此限。 */
const CONFLICT = [
["2D","3D"],["2D","VR"],["2D","First-Person"],["2D","Third Person"],["2.5D","2D"],["2.5D","3D"],
["Pixel Graphics","Realistic"],
["Realistic","Cartoony"],["Realistic","Anime"],["Realistic","Cartoon"],["Realistic","Minimalist"],
["Roguelike","Roguelite"],["Traditional Roguelike","Action Roguelike"],
["Singleplayer","Multiplayer"],["Singleplayer","Massively Multiplayer"],
["Casual","Difficult"],["Casual","Souls-like"],["Family Friendly","Gore"],["Family Friendly","Violent"],
["Family Friendly","Horror"],["Family Friendly","Dark"],
["Turn-Based Combat","Fast-Paced"],["Turn-Based","Real-Time"],["Turn-Based Combat","Real Time Tactics"],
["Open World","Short"],["Linear","Nonlinear"],["Relaxing","Difficult"],["Cozy","Gore"],["Cozy","Violent"],
["First-Person","Top-Down"],["First-Person","Isometric"],["First-Person","Side Scroller"],
["First-Person","Third Person"],["Top-Down","Side Scroller"],["Isometric","Side Scroller"],
["2D Platformer","3D Platformer"],["2D Fighter","3D Fighter"],["FPS","Third-Person Shooter"],
["FPS","2D"],["FPS","Top-Down"],["FPS","Isometric"],["FPS","Side Scroller"],["FPS","Third Person"],
["First-Person","2.5D"],["Immersive Sim","2D"],["Boomer Shooter","Top-Down"]];

const CFL = {};
CONFLICT.forEach(([a, b]) => {
  (CFL[a] = CFL[a] || new Set()).add(b);
  (CFL[b] = CFL[b] || new Set()).add(a);
});

/* 補必要維度時不採用：雖歸在該維度，但無法單獨回答該維度的問題
   （例如 Split Screen 是多人呈現方式，不告訴你這遊戲是 2D 還是第一人稱） */
const REQ_SKIP = new Set(["Split Screen"]);

/* 刻意衝突模式的反差配對——市面罕見但有搞頭的組合 */
const CLASH = [
["Horror","Cozy"],["Horror","Cute"],["Survival Horror","Wholesome"],["Psychological Horror","Relaxing"],
["Farming Sim","Souls-like"],["Farming Sim","Bullet Hell"],["Farming Sim","Horror"],["Farming Sim","Deckbuilding"],
["Cooking","Post-apocalyptic"],["Cooking","Lovecraftian"],["Cooking","Souls-like"],
["Dating Sim","Survival Horror"],["Dating Sim","Tower Defense"],["Dating Sim","Automation"],
["Cozy","Perma Death"],["Wholesome","Zombies"],["Cute","Dark Fantasy"],["Cats","Post-apocalyptic"],
["Rhythm","Turn-Based Tactics"],["Rhythm","Horror"],["Rhythm","Colony Sim"],
["Visual Novel","Automation"],["Visual Novel","Tower Defense"],["Visual Novel","Roguelite"],
["Fishing","Cyberpunk"],["Fishing","Lovecraftian"],["Farming","Dark Fantasy"],
["Incremental","Psychological Horror"],["City Builder","Lovecraftian"],["City Builder","Horror"],
["Metroidvania","Cozy"],["Tower Defense","Romance"],["Typing","Souls-like"],["Mahjong","Cyberpunk"],
["Wuxia","Sci-fi"],["Samurai","Space"],["Xianxia","Cyberpunk"],["Detective","Farming Sim"],
["Escape Room","Cozy"],["Auto Battler","Story Rich"],["Boomer Shooter","Cute"],["Stealth","Cooking"]];

/* 待抉擇配對——必須是「真的要二選一」的可比較選項，不是隨機兩個同維度標籤。
   配對本身可以互斥（2D vs 3D 就是要你選一個），故不套用互斥檢查。 */
const ASK_PAIRS = [
["Roguelike","Roguelite"],["Turn-Based Combat","Real Time Tactics"],["Turn-Based Tactics","RTS"],
["Pixel Graphics","Anime"],["Stylized","Realistic"],["Hand-drawn","Pixel Graphics"],
["2D","3D"],["Top-Down","Side Scroller"],["Isometric","Top-Down"],["First-Person","Third Person"],
["Horror","Psychological Horror"],["Survival","Survival Horror"],["Cozy","Difficult"],
["Relaxing","Thriller"],["Story Rich","Fast-Paced"],["Visual Novel","Point & Click"],
["Farming Sim","Life Sim"],["Metroidvania","Platformer"],["Souls-like","Action RPG"],
["JRPG","CRPG"],["Tower Defense","Auto Battler"],["Deckbuilding","Card Battler"],
["Singleplayer","Local Co-Op"],["Exploration","Score Attack"],["Perma Death","Replay Value"],
["Choices Matter","Multiple Endings"],["Stealth","Hack and Slash"],
["Puzzle Platformer","Precision Platformer"],["Escape Room","Detective"],
["Short","Replay Value"],["Crafting","Resource Management"],["FPS","Third-Person Shooter"]];

/* 玩家結構在「保證可做」模式的加權池——學生專題以單人為主，且必須真的表態單／多人
   （PvE、PvP 這類標籤沒有回答「幾個人玩」，故不列入） */
const PLAYERS_SAFE = ["Singleplayer", "Singleplayer", "Singleplayer", "Singleplayer",
"Local Co-Op", "Co-op", "4 Player Local", "Local Multiplayer"];

/* 必要維度以子類型（1）為主而非大類型（0）——子類型才是方向的心臟，且兩者只取其一避免
   出現「Racing＋JRPG」這種不相干組合。補位池（FILL）因此不含 0 與 1。 */
const REQ = [1, 2, 3, 8], FILL = [4, 5, 7, 6];

const MODE_TXT = {
  safe: "🎯 保證可做：四個必要維度（類型／視角／風格／單多人）各補一個，自動避開互斥組與多人重工程，並刻意留一組「待抉擇」讓你自己決定。",
  chaos: "🌀 完全隨機：不管維度也不管矛盾，抽到什麼算什麼。抽出無法並存的組合是正常的，那正是發想的起點。",
  clash: "💥 刻意衝突：從反差配對表挑一組罕見組合當差異化核心，其餘照「保證可做」規則補齊。"
};

const CODE_VER = "S2", CODE_LEN = 6, CODE_MAX = 40;
const RC = { core: "c", diff: "d", ask: "a" }, RD = { c: "core", d: "diff", a: "ask" };
const CODE_RE = new RegExp("^" + CODE_VER + "(?:[0-9a-zA-Z]{" + (CODE_LEN - 1) + "}[cdaCDA])+$");

/** 建立查表索引。瀏覽器與測試各建一次即可，不要每次抽籤重建。 */
function makeIndex(T) {
  const byEn = {}, byId = {};
  T.forEach(t => { byEn[t[1]] = t; byId[t[5]] = t; });
  return { byEn, byId };
}

/**
 * 抽一組標籤。純函式：不讀 DOM、不改外部狀態、隨機源可注入。
 *
 * @param {object}   o
 * @param {Array}    o.T             標籤表
 * @param {object}   o.idx           makeIndex(T) 的結果
 * @param {string}   o.mode          "safe" | "chaos" | "clash"
 * @param {number}   o.n             要抽幾個（3～10，超出會被夾住）
 * @param {boolean}  o.curatedOnly   只從精選標籤抽
 * @param {Array}    o.locked        已鎖定要保留的項目 [{en,role,lock:true}]
 * @param {function} o.rng           回傳 [0,1) 的函式，預設 Math.random
 * @returns {{sel:Array, notice:(string|null), modeText:string}}
 *          notice 是要顯示給使用者的提示（呼叫端決定怎麼呈現）；
 *          若 notice 存在且 sel 為 null，表示這次抽籤沒有進行。
 */
function rollTags(o) {
  const T = o.T, byEn = o.idx.byEn, mode = o.mode;
  const rand = o.rng || Math.random;
  const rnd = k => Math.floor(rand() * k);
  const n = Math.max(3, Math.min(10, parseInt(o.n, 10) || 6));
  const locked = (o.locked || []).filter(s => byEn[s.en]);

  if (locked.length >= n)
    return { sel: null, notice: `鎖定了 ${locked.length} 個但只抽 ${n} 個，沒有可重抽的空間`, modeText: MODE_TXT[mode] };

  let notice = null;
  const strict = mode !== "chaos";
  let pool = T.filter(t => !BAN.has(t[1]) && (!o.curatedOnly || t[6]));
  if (strict) pool = pool.filter(t => !HEAVY.has(t[1]) && t[0] !== 9);

  const out = locked.map(s => ({ en: s.en, role: s.role, lock: true }));
  const has = en => out.some(x => x.en === en);
  const clash = en => strict && out.some(x => CFL[x.en] && CFL[x.en].has(en));
  /* 配對表（CLASH／ASK_PAIRS）是用標籤名寫的，不會經過上面那個 pool 過濾，
     所以要自己套一次同樣的條件——否則勾了「只抽精選」還是會被塞進非精選標籤。 */
  const usable = en => Boolean(byEn[en]) && !BAN.has(en) && !has(en)
                       && (!o.curatedOnly || byEn[en][6]);
  const take = cands => {
    const ok = cands.filter(t => !has(t[1]) && !clash(t[1]));
    return ok.length ? ok[rnd(ok.length)] : null;
  };
  const add = (t, role) => { if (t) out.push({ en: t[1], role: role, lock: false }); return !!t; };

  // ① 刻意衝突：反差配對當差異化核心。兩者都要可用且塞得進額度，否則整組不採用
  //    （只加半組會讓 💥 模式靜默退化成普通抽籤）
  if (mode === "clash") {
    const cands = CLASH.filter(p => p.every(usable));
    if (cands.length && out.length + 2 <= n) {
      cands[rnd(cands.length)].forEach(en => out.push({ en: en, role: "diff", lock: false }));
    } else if (out.length + 2 > n) {
      notice = `抽 ${n} 個放不下反差配對，請調高數量或解鎖幾個`;
    }
  }
  // ② 留一組真的要二選一的待抉擇
  if (strict && out.length + 2 <= n) {
    const cands = ASK_PAIRS.filter(p =>
      p.every(en => usable(en) && !HEAVY.has(en)) && !p.some(en => clash(en)));
    if (cands.length) cands[rnd(cands.length)].forEach(en => out.push({ en: en, role: "ask", lock: false }));
  }
  // ③ 必要維度補齊（已被待抉擇組覆蓋的維度視為已覆蓋）。
  //    衝突模式不強制大類型——反差配對已定義類型空間，硬補會出現不相干的大類型。
  const reqDims = mode === "clash" ? [2, 3, 8] : REQ;
  if (strict) for (const d of reqDims) {
    if (out.some(x => byEn[x.en][0] === d)) continue;
    if (d === 1 && out.some(x => byEn[x.en][0] === 0)) continue;   // 已有大類型就不再補子類型
    const cands = d === 8
      ? pool.filter(t => PLAYERS_SAFE.includes(t[1]))
            .flatMap(t => Array(PLAYERS_SAFE.filter(p => p === t[1]).length).fill(t))
      : pool.filter(t => t[0] === d && !REQ_SKIP.has(t[1]));
    if (!add(take(cands), "core") && d === 1)                      // 子類型抽不到才退大類型
      add(take(pool.filter(t => t[0] === 0)), "core");
  }
  // ④ 補到目標數量
  const fillPool = strict ? pool.filter(t => FILL.includes(t[0])) : pool;
  while (out.length < n)                    // 每輪必定 push 一個或 break，不會無限迴圈
    if (!add(take(fillPool), "core")) break;
  // ⑤ 事後保證：非隨機模式一定要有類型訊號（子類型或大類型其中之一）
  if (strict && !out.some(x => byEn[x.en][0] <= 1)) {
    const t = take(pool.filter(x => x[0] === 1)) || take(pool.filter(x => x[0] === 0));
    if (t) {
      const i = out.findIndex(x => !x.lock && x.role === "core");
      if (i >= 0) out[i] = { en: t[1], role: "core", lock: false }; else add(t, "core");
    }
  }

  return {
    sel: out.slice(0, Math.max(n, out.filter(s => s.lock).length)),
    notice: notice,
    modeText: MODE_TXT[mode]
  };
}

/** 標籤組合 → 分享短碼。格式：S2 + 每標籤 6 字元（5 位 base36 的 ID ＋ 1 位角色）。
    用 5 位是因為 Steam tagid 已達 7 位十進位，4 位 base36 上限 1679616 快用完；
    一旦某個 ID 溢出成 5 位，固定框架會整串位移、把短碼靜默解成別的標籤。 */
function encodeSel(list, idx) {
  return CODE_VER + list.map(s =>
    idx.byEn[s.en][5].toString(36).padStart(CODE_LEN - 1, "0") + RC[s.role]).join("");
}

/** 分享短碼 → 標籤組合。無法解讀就回 null（絕不回半組資料）。 */
function decodeSel(code, idx) {
  const m = String(code == null ? "" : code).trim().replace(/\s+/g, "");
  if (m.length > CODE_VER.length + CODE_LEN * CODE_MAX) return null;  // 避免超長短碼建出上萬個 chip 凍結瀏覽器
  if (!CODE_RE.test(m)) return null;
  const b = m.slice(CODE_VER.length).toLowerCase(), out = [], got = new Set();
  for (let i = 0; i < b.length; i += CODE_LEN) {
    const t = idx.byId[parseInt(b.slice(i, i + CODE_LEN - 1), 36)];
    if (!t) return null;
    const r = RD[b[i + CODE_LEN - 1]];
    if (!r) return null;
    if (got.has(t[1])) continue;            // 去重：重複標籤會讓 chip 狀態與商店頁計數對不上
    got.add(t[1]);
    out.push({ en: t[1], role: r, lock: false });
  }
  return out.length ? out : null;
}

return {
  VERSION, ROLES, BAN, HEAVY, CONFLICT, CFL, REQ_SKIP, CLASH, ASK_PAIRS, PLAYERS_SAFE,
  REQ, FILL, MODE_TXT, CODE_VER, CODE_LEN, CODE_MAX,
  makeIndex, rollTags, encodeSel, decodeSel
};
});
