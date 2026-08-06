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
   配對本身可以互斥（2D vs 3D 就是要你選一個），故不套用互斥檢查。

   每組附取捨說明，讓工具本身就能幫使用者想清楚，不必等 AI 回答：
     q  這組在問什麼（一句問句）
     ax 選 a 的後果    bx 選 b 的後果
   寫法鐵則：講「玩法與開發成本的後果」，不是解釋詞義。看完要能做決定。 */
const ASK_PAIRS = [
{a:"Roguelike",b:"Roguelite",q:"死了要全部重來，還是能累積永久成長？",
 ax:"每局從零開始，內容量要夠大才耐玩；挫折感高，但通關的成就感也最強。",
 bx:"局外解鎖讓手殘玩家也推得動，留存曲線平緩；代價是多做一套永久成長系統與數值平衡。"},
{a:"Turn-Based Combat",b:"Real Time Tactics",q:"戰鬥要玩家慢慢想，還是即時反應？",
 ax:"回合制不吃手感與動畫品質，一人團隊做得動；但節奏慢，要靠戰術深度撐住。",
 bx:"即時戰術臨場感強，卻要處理路徑尋找、AI 反應與大量動畫，開發量是回合制的數倍。"},
{a:"Turn-Based Tactics",b:"RTS",q:"戰棋還是即時戰略？",
 ax:"格狀戰棋單位少、每步都要算，適合小團隊；玩家群偏硬核但忠誠。",
 bx:"即時戰略要同時處理數十單位的操作與 AI，是最難做的類型之一，學生專題極易爛尾。"},
{a:"Pixel Graphics",b:"Anime",q:"像素風還是動漫立繪風？",
 ax:"像素省美術工，但要做得好看需要專門功力，且動畫幀數是隱形成本。",
 bx:"動漫風受眾精準（尤其日系），可用立繪＋差分省事；畫崩的容忍度極低。"},
{a:"Stylized",b:"Realistic",q:"風格化還是寫實？",
 ax:"風格化能用低模與純色掩蓋技術限制，最適合資源有限的團隊。",
 bx:"寫實要貼圖、光照、材質全到位，任何一環不足就會被說『看起來很廉價』。"},
{a:"Hand-drawn",b:"Pixel Graphics",q:"手繪還是像素？",
 ax:"手繪辨識度高、最能做出獨特感；但每張圖都是人工，量大就崩。",
 bx:"像素可複用素材與調色盤，量產友善；風格已很擁擠，要靠題材突圍。"},
{a:"2D",b:"3D",q:"這是最先要決定的：2D 還是 3D？",
 ax:"2D 的碰撞、鏡頭、美術都單純，同樣時間能做出更完整的內容。",
 bx:"3D 一開始就要面對鏡頭、光照、模型與動畫；沒有現成資產庫的話成本是 2D 的數倍。"},
{a:"Top-Down",b:"Side Scroller",q:"俯視角還是橫向捲軸？",
 ax:"俯視角適合探索與多方向戰鬥，關卡可自由鋪；角色只需四或八向動畫。",
 bx:"橫捲的跳躍手感是賣點也是門檻，關卡設計更吃節奏，但美術面向單一比較省。"},
{a:"Isometric",b:"Top-Down",q:"等角斜視還是正俯視？",
 ax:"等角有立體感、場景較好看；但美術要重畫斜角、遮擋與深度排序都要處理。",
 bx:"正俯視最好做也最好讀，代價是畫面比較平、場景難有記憶點。"},
{a:"First-Person",b:"Third Person",q:"第一人稱還是第三人稱？",
 ax:"第一人稱不必做角色模型與動畫，沉浸感強，恐怖與探索類首選。",
 bx:"第三人稱看得到主角、好做角色魅力；但要處理鏡頭碰撞與全套移動動畫。"},
{a:"Horror",b:"Psychological Horror",q:"用嚇的，還是用不安感？",
 ax:"直接的恐怖靠音效與突發驚嚇，見效快、成本低，但玩家很快免疫。",
 bx:"心理恐怖靠敘事與氛圍鋪陳，受眾精準忠誠；寫不好就只是無聊。"},
{a:"Survival",b:"Survival Horror",q:"生存重點在資源管理，還是在恐懼？",
 ax:"純生存吃系統深度：飢餓、耐久、建造，數值平衡是主要工作量。",
 bx:"生存恐怖靠彈藥稀缺與怪物壓力製造緊張，關卡與怪物 AI 是主要工作量。"},
{a:"Cozy",b:"Difficult",q:"要讓玩家放鬆，還是被挑戰？",
 ax:"溫馨向近年成長快、社群友善；但沒有難度就必須用內容量與情感留住人。",
 bx:"高難度自帶話題與實況價值；要求手感與關卡打磨到位，做不好就是純粹的爛。"},
{a:"Relaxing",b:"Thriller",q:"整體情緒是放鬆還是緊繃？",
 ax:"放鬆向對美術與音樂要求高，玩法可以簡單，但要耐得住重複。",
 bx:"驚悚需要節奏設計與資訊控制，一旦玩家看穿套路張力就消失。"},
{a:"Story Rich",b:"Fast-Paced",q:"敘事優先還是節奏優先？",
 ax:"劇情豐富要寫大量文本與演出，是最花時間但也最容易做出記憶點的路。",
 bx:"快節奏靠手感與即時回饋，文本可以極少；但玩法核心必須本身就好玩。"},
{a:"Visual Novel",b:"Point & Click",q:"純閱讀分支，還是要有場景互動？",
 ax:"視覺小說用現成引擎最快落地，成本幾乎全在文本與立繪。",
 bx:"點擊冒險多了物品與謎題系統，互動感較強；謎題設計不當很容易卡關棄坑。"},
{a:"Farming Sim",b:"Life Sim",q:"核心循環是種田產出，還是經營人際？",
 ax:"農場的循環明確、易上手：播種到收成的正回饋自己會轉。",
 bx:"生活模擬要角色好感、事件排程與對話，內容量需求大很多。"},
{a:"Metroidvania",b:"Platformer",q:"要能力解鎖回頭探索，還是線性關卡推進？",
 ax:"銀河城地圖是互相牽連的整體，改一處會牽動全盤，設計難度最高。",
 bx:"線性平台可以一關一關做、一關一關砍，範疇最好控制，適合有時限的專題。"},
{a:"Souls-like",b:"Action RPG",q:"要正面對決的高門檻戰鬥，還是可調難度的動作 RPG？",
 ax:"魂系玩家對打擊感、判定與敵人設計期待極高，做不到位會被嚴厲比較。",
 bx:"動作 RPG 可靠等級與裝備讓玩家自行降低難度，容錯空間大得多。"},
{a:"JRPG",b:"CRPG",q:"日式回合隊伍劇情，還是歐美選擇與判定？",
 ax:"日式 RPG 路線清楚：隊伍、回合戰鬥、線性主線，內容量大但每塊都好切分。",
 bx:"歐美 RPG 要處理選擇分支與世界狀態，文本量與測試成本呈指數成長。"},
{a:"Tower Defense",b:"Auto Battler",q:"玩家佈防塔位，還是組隊後自動開打？",
 ax:"塔防的關卡與波次可以量產，數值平衡是主要挑戰。",
 bx:"自走棋重在組合深度與隨機性，單位少但每個都要能和其他單位產生化學反應。"},
{a:"Deckbuilding",b:"Card Battler",q:"牌組在遊玩中逐步構築，還是開局前就組好？",
 ax:"構築式每局都有成長感，卡牌數量可以少，靠組合爆發。",
 bx:"卡牌對戰吃卡池廣度與平衡，卡少就沒策略，卡多就做不完。"},
{a:"Singleplayer",b:"Local Co-Op",q:"單人，還是同機雙人？",
 ax:"單人是預設值，所有設計都不必考慮第二個人，學生專題強烈建議。",
 bx:"本地雙人氣氛好、展場效果佳；但鏡頭、UI、關卡都要重新為兩人設計。"},
{a:"Exploration",b:"Score Attack",q:"獎勵探索發現，還是追求高分？",
 ax:"探索要做足夠大的世界與值得找的東西，內容量是主要成本。",
 bx:"計分挑戰內容可以很小，靠重玩與排行榜延長壽命；核心手感必須極度扎實。"},
{a:"Perma Death",b:"Replay Value",q:"死亡要有真實代價，還是鼓勵一直重玩？",
 ax:"永久死亡讓每個決定都有重量，但會嚇跑休閒玩家，也放大任何不公平的設計。",
 bx:"高重玩性要靠隨機性或多路線提供變化，等於要做出比一輪遊玩更多的內容。"},
{a:"Choices Matter",b:"Multiple Endings",q:"選擇要在過程中就有影響，還是集中在結局分歧？",
 ax:"過程分歧最有感，但每個分歧都是要實作與測試的世界狀態。",
 bx:"多結局只在末端分岔，成本可控；玩家容易察覺前面的選擇其實沒差。"},
{a:"Stealth",b:"Hack and Slash",q:"避開敵人，還是正面清場？",
 ax:"潛行要做視野、聲音與察覺狀態，AI 稍有不合理玩家立刻感覺得到。",
 bx:"砍殺靠打擊感與敵人數量堆爽度，動畫與特效是主要成本。"},
{a:"Puzzle Platformer",b:"Precision Platformer",q:"考腦袋還是考手指？",
 ax:"解謎平台重在機關巧思，操作可以簡單，關卡設計是全部工作。",
 bx:"精準平台重在手感，物理參數要調到極致，一格之差就是天堂與地獄。"},
{a:"Escape Room",b:"Detective",q:"在密閉空間解機關，還是蒐證推理？",
 ax:"密室範圍小、範疇最好控制，適合短篇；重玩價值低。",
 bx:"偵探要設計證據鏈與可信的推理節奏，寫作難度高但記憶點強。"},
{a:"Short",b:"Replay Value",q:"做一個短而完整的作品，還是耐玩的作品？",
 ax:"誠實標示短篇能避免負評，也是學生專題最務實的選擇。",
 bx:"耐玩要靠隨機或多路線，同樣時間下完成度會比短篇低。"},
{a:"Crafting",b:"Resource Management",q:"重點在合成新東西，還是在分配有限資源？",
 ax:"製作系統要設計配方樹與物品欄，介面工作量常被低估。",
 bx:"資源管理可以完全用數值與 UI 呈現，美術需求低，但平衡沒調好就無聊。"},
{a:"FPS",b:"Third-Person Shooter",q:"第一人稱射擊還是越肩射擊？",
 ax:"第一人稱瞄準直觀，不必做角色動畫，是小團隊做射擊的合理起點。",
 bx:"第三人稱要處理掩體、鏡頭與全套持槍動畫，但角色能成為賣點。"}];
/* 內部多處只需要標籤名，用這個取出來，不要各自寫 [p.a,p.b] */
const pairTags = p => [p.a, p.b];

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

/** 從一組已選的待抉擇標籤中，找出它們屬於哪一組配對（找不到回 null）。
    UI 用它顯示取捨說明，不必等 AI 回答。 */
function findAskPair(names) {
  const set = new Set(names);
  return ASK_PAIRS.find(p => set.has(p.a) && set.has(p.b)) || null;
}

/* 十個維度的名稱與定位重要度。
   必要（must）：缺了就無法定位——類型、視角、美術風格、玩家結構。
   其中大類型（0）與子類型（1）是同一個問題的兩種答法，兩者有其一就算數。
   選配（opt）：加分項，缺了不影響定位成立。 */
const DIM_NAMES = ["大類型","子類型","視角","美術風格","題材","情緒","敘事","機制","玩家結構","範疇"];
const DIM_NEED = ["type","type","must","must","opt","opt","opt","opt","must","opt"];

/**
 * 算出每個維度被涵蓋的狀況，供 UI 顯示概覽列。純函式。
 * @returns {{dims:Array, missing:Array<string>}}
 *   dims    每個維度一筆 {dim,label,need,filled:[{en,role}]}
 *   missing 還缺的必要項名稱（大類型與子類型都空才算缺「類型」）
 */
function coverage(sel, idx) {
  const dims = DIM_NAMES.map((label, d) => ({
    dim: d, label: label, need: DIM_NEED[d],
    filled: sel.filter(s => idx.byEn[s.en] && idx.byEn[s.en][0] === d)
               .map(s => ({ en: s.en, role: s.role }))
  }));
  const missing = [];
  if (!dims[0].filled.length && !dims[1].filled.length) missing.push("類型");
  dims.forEach(x => { if (x.need === "must" && !x.filled.length) missing.push(x.label); });
  return { dims: dims, missing: missing };
}

/**
 * 這個標籤是否因為與已選標籤互斥而不該再選。回傳擋住它的標籤名，沒有就回 null。
 * 已經選中的標籤永遠不擋（否則使用者無法取消它）。
 */
function blockedBy(en, sel) {
  if (sel.some(s => s.en === en)) return null;
  const c = CFL[en];
  if (!c) return null;
  const hit = sel.find(s => c.has(s.en));
  return hit ? hit.en : null;
}

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
    const cands = ASK_PAIRS.filter(p => pairTags(p).every(en => usable(en) && !HEAVY.has(en))
                                        && !pairTags(p).some(en => clash(en)));
    if (cands.length) pairTags(cands[rnd(cands.length)])
      .forEach(en => out.push({ en: en, role: "ask", lock: false }));
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
  DIM_NAMES, DIM_NEED, coverage, blockedBy,
  pairTags, findAskPair, makeIndex, rollTags, encodeSel, decodeSel
};
});
