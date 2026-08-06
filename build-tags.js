/**
 * build-tags.js — 把 Steam 官方標籤（含官方繁中）併進工具的標籤庫，輸出注入 index.html。
 *
 * 用法：
 *   node build-tags.js            使用 data/raw 既有 JSON
 *   node build-tags.js --fetch    先重新抓官方清單再建置（驗證成功才覆蓋舊資料）
 *
 * 資料來源：store.steampowered.com/tagdata/populartags/{english,tchinese}
 * 說明：該端點回傳 Steam 商店標籤篩選器使用的「熱門標籤」清單。不在此清單中的標籤未必
 *      不存在，只是不在熱門清單內，故一律標記為「未在官方清單」而非「不存在」。
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const RAW = path.join(__dirname, "data", "raw");
const HTML = path.join(__dirname, "index.html");

function die(msg) { console.error("錯誤：" + msg); process.exit(1); }

/* ---- 抓取（先寫暫存檔並驗證，通過才覆蓋正式檔，避免錯誤頁把唯一資料蓋掉） ---- */
if (process.argv.includes("--fetch")) {
  fs.mkdirSync(RAW, { recursive: true });
  for (const [lang, file] of [["english", "tags_en.json"], ["tchinese", "tags_tc.json"]]) {
    const tmp = path.join(RAW, file + ".tmp");
    const url = `https://store.steampowered.com/tagdata/populartags/${lang}`;
    try {
      execSync(`curl --fail -sS --max-time 60 "${url}" -o "${tmp}"`, { stdio: "pipe" });
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch {}
      die(`抓取 ${lang} 失敗（${url}）。舊資料未被覆蓋。`);
    }
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(tmp, "utf8")); }
    catch { fs.unlinkSync(tmp); die(`${lang} 回應不是合法 JSON（可能是錯誤頁）。舊資料未被覆蓋。`); }
    if (!Array.isArray(parsed) || !parsed.length || typeof parsed[0].name !== "string") {
      fs.unlinkSync(tmp); die(`${lang} 回應格式不符預期。舊資料未被覆蓋。`);
    }
    fs.renameSync(tmp, path.join(RAW, file));
    console.log(`已更新 ${file}（${parsed.length} 筆）`);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(RAW, "SOURCE.md"),
`# Steam 標籤原始資料來源

| 項目 | 內容 |
|---|---|
| 端點 | \`https://store.steampowered.com/tagdata/populartags/{english,tchinese}\` |
| 抓取日期 | ${stamp} |
| 取得指令 | \`node build-tags.js --fetch\` |

著作權屬 Valve Corporation，本專案僅為建置需要收錄，未主張任何權利。授權範圍見專案根目錄 LICENSE。
`);
}

/* ---- 讀取資料檔 ---- */
function readJson(name, label) {
  const p = path.join(__dirname, "data", name);
  if (!fs.existsSync(p)) die(`找不到資料檔 ${p}`);
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { die(`${name} 不是合法 JSON：${e.message}`); }
}

/* ---- 讀取官方資料 ---- */
function readRaw(file, label) {
  const p = path.join(RAW, file);
  if (!fs.existsSync(p)) die(`找不到 ${p}。請先執行：node build-tags.js --fetch`);
  let j;
  try { j = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { die(`${file} 不是合法 JSON。請重新執行：node build-tags.js --fetch`); }
  if (!Array.isArray(j) || !j.length) die(`${file} 內容不是非空陣列。`);
  const bad = j.find(t => !t || typeof t.name !== "string" || !Number.isInteger(t.tagid));
  if (bad) die(`${file} 有欄位缺失的項目：${JSON.stringify(bad)}`);
  console.log(`讀入 ${label} ${j.length} 筆`);
  return j;
}
const en = readRaw("tags_en.json", "英文標籤");
const tc = readRaw("tags_tc.json", "繁中標籤");
const tcById = Object.fromEntries(tc.map(t => [t.tagid, t.name.trim()]));
const official = en.map(t => ({ id: t.tagid, en: t.name.trim(), tc: (tcById[t.tagid] || "").trim() }));
const offByEn = Object.fromEntries(official.map(o => [o.en.toLowerCase(), o]));

/* ---- 別名：我的慣用寫法 → 官方正式名稱 ----
   只收「同一概念、只是名字不同」的情況。目的是不要讓同義詞各自佔一個入口，
   造成使用者以為官方沒有這個標籤。對應關係逐筆對過官方清單，不憑印象。 */
const ALIAS = {
  "Vampire": "Vampires",                    // 官方用複數
  "1980's": "1980s",                        // 官方 80 年代不帶撇號（90 年代帶撇號，故不列）
  "Clicker": "Incremental",
  "Racing Sim": "Automobile Sim",
  "Monster Tamer": "Creature Collector",    // 同為寶可夢系
  "Photorealistic": "Realistic",            // 官方無「擬真寫實」層級，統一掛 Realistic
  "MMO": "Massively Multiplayer",
  "Kart Racing": "Racing",
  "Arcade Racing": "Racing",
  "Branching Narrative": "Nonlinear",
  "Occult": "Supernatural",
  "Dreamlike": "Surreal",
  "Speedrun": "Time Attack",
  "Gardening": "Farming",
  "Full Controller Support": "Controller",  // 官方標籤名為 Controller
};

/* ---- 社群詞彙 → 掛在官方標籤的說明上 ----
   本工具刻意完全對應 Steam 官方清單，不收官方沒有的標籤。但社群慣用詞（Low Poly、
   校園、技能樹…）仍是使用者會想到的說法，所以把它們寫進最接近的官方標籤說明裡：
   搜尋會掃說明欄，因此搜「低多邊形」或「Low Poly」還是會找到官方的 Stylized。
   官方沒有的美術或機制細節，請寫在工具的「一句話構想」欄或工單的提示詞段落。 */
const VOCAB = {
  "Stylized": ["Low Poly 低多邊形", "Cel-Shaded 卡通渲染"],
  "Survival": ["Survival Craft 生存製作（與 Crafting 併掛）"],
  "Anime": ["日系校園（官方無 School 標籤，用 Anime＋Story Rich 表達）"],
  "Atmospheric": ["Creepy 毛骨悚然"],
  "Thriller": ["Tense 緊張"],
  "Story Rich": ["Dramatic 戲劇性", "Drama 劇情片式", "Multiple Protagonists 多主角",
                 "Character Development 角色成長敘事"],
  "Dynamic Narration": ["Narration 旁白"],
  "Character Customization": ["Skill Tree 技能樹"],
  "PvP": ["Asymmetric 非對稱對抗（官方僅有 Asymmetric VR）"],
  "Abstract": ["Artistic 藝術遊戲"],
};

/* 資料檔是純 JSON 而非可執行 JS：公開 repo 若收 PR，「改一個標籤」不該等於「執行任意程式碼」 */
const CURATED = readJson("curated-tags.json", "精選標籤庫");
const CLASSIFY = readJson("official-dims.json", "官方標籤維度歸類");
/* 每個標籤的重點與代表作。代表作由 verify-games.js 逐款到 Steam 查證過，
   games.json 記錄的是 Steam 上的實際商店標題與 appid；台灣通稱譯名另放
   games-tw.json，由人維護，畫面上會標示為「通稱」而非官方譯名。 */
const NOTES = fs.existsSync(path.join(__dirname, "data", "tag-notes.json"))
  ? readJson("tag-notes.json", "標籤重點") : {};
const GAMES = fs.existsSync(path.join(__dirname, "data", "games.json"))
  ? readJson("games.json", "遊戲查證表") : {};
const GAMES_TW = fs.existsSync(path.join(__dirname, "data", "games-tw.json"))
  ? readJson("games-tw.json", "遊戲台灣通稱") : {};

const rows = [];
const seen = new Set();
function push(dim, enName, zh, flags, note, id, curated) {
  const k = enName.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  rows.push([dim, enName, zh, flags, note || "", id || 0, curated ? 1 : 0, []]);
  return true;
}

/* 1) 精選標籤：對齊官方名稱與官方繁中 */
let aliased = 0, unofficial = 0, merged = 0;
for (const [dim, name, zh, flags, note] of CURATED) {
  const target = ALIAS[name] || name;
  const o = offByEn[target.toLowerCase()];
  if (o) {
    const extra = target !== name ? `社群常寫作「${name}」，官方標籤是 ${o.en}。` : "";
    if (target !== name) aliased++;
    const zhShow = o.tc || zh;
    /* tag-notes.json 的重點是寫得更完整的版本，有就取代原本的簡短說明，
       不要兩段串在一起變成重複的話 */
    const body = ((NOTES[o.en] || {}).k ? NOTES[o.en].k + "。" : (note || ""));
    const noteFull = (o.tc && o.tc !== zh ? `亦稱「${zh}」。` : "") + body + extra;
    if (!push(dim, o.en, zhShow, flags.replace("u", ""), noteFull, o.id, true)) merged++;
  } else {
    /* 走到這裡代表 curated 有一個官方清單裡沒有的標籤。本工具刻意完全對應官方清單，
       所以這是需要處理的狀況：要嘛加進 ALIAS 指向官方名，要嘛從 curated 移除、
       把它的說法寫進 VOCAB。仍會標記 u 並保留，讓測試能抓到而不是靜默消失。 */
    unofficial++;
    push(dim, name, zh, flags.includes("u") ? flags : flags + "u", note, 0, true);
  }
}

/* 2) 官方獨有標籤 */
const unclassified = [];
for (const o of official) {
  if (seen.has(o.en.toLowerCase())) continue;
  const dim = CLASSIFY[o.en];
  if (dim === undefined) { unclassified.push(o.en); continue; }
  push(dim, o.en, o.tc, "", "", o.id, false);
}
for (const name of unclassified) {
  const o = offByEn[name.toLowerCase()];
  push(9, o.en, o.tc, "", "未分類官方標籤", o.id, false);
}

/* 2.5) 把社群詞彙掛到對應官方標籤的說明上，讓搜尋找得到 */
let vocabApplied = 0;
const vocabMissing = [];
for (const [target, words] of Object.entries(VOCAB)) {
  const row = rows.find(r => r[1] === target);
  if (!row) { vocabMissing.push(target); continue; }
  row[4] = [row[4], "社群也說：" + words.join("、") + "。"].filter(Boolean).join("");
  vocabApplied += words.length;
}
if (vocabMissing.length) die(`VOCAB 指向不存在的標籤：${vocabMissing.join(", ")}`);

/* 2.6) 併入每個標籤的重點與代表作。
        重點接在說明後面；代表作另存第 8 欄，讓 UI 與指南可以分開排版。 */
const noteMissing = [], gameMissing = [];
let noted = 0;
for (const [tag, n] of Object.entries(NOTES)) {
  if (tag.startsWith("_")) continue;
  const row = rows.find(r => r[1] === tag);
  if (!row) { noteMissing.push(tag); continue; }
  /* 重點已在步驟 1 併入（官方獨有標籤在步驟 2 沒有說明，這裡補上） */
  if (n.k && !row[4].includes(n.k)) row[4] = [row[4], n.k + "。"].filter(Boolean).join("");
  const gs = (n.g || []).map(name => {
    const info = GAMES[name];
    if (!info || !info.appid) { gameMissing.push(`${tag}: ${name}`); return null; }
    return { en: info.steamTitle || name, tw: GAMES_TW[name] || "", id: info.appid };
  }).filter(Boolean);
  row[7] = gs;                       // 第 8 欄：代表作
  noted++;
}
rows.forEach(r => { if (r.length < 8) r[7] = []; });
if (noteMissing.length) die(`tag-notes.json 指向不存在的標籤：${noteMissing.join(", ")}`);
/* games-tw.json 只能列 games.json 查證過的遊戲——多餘的條目代表打錯字或誤植標籤名，
   留著不會壞掉但永遠不會生效，屬於同一類的死引用 */
const twStray = Object.keys(GAMES_TW).filter(k => !k.startsWith("_") && !GAMES[k]);
if (twStray.length) die(`games-tw.json 有 games.json 裡沒有的條目：${twStray.join(", ")}`);
if (gameMissing.length) die(`代表作未通過查證（請先跑 node verify-games.js）：\n  ${gameMissing.join("\n  ")}`);

/* 3) 未在官方清單的標籤配發合成 ID，讓分享短碼有穩定編碼。
      起點取官方最大 ID 之後，確保不與官方 tagid 撞號。 */
const SYNTH_BASE = Math.max(...official.map(o => o.id)) + 1000;
rows.filter(r => !r[5]).sort((a, b) => a[1].localeCompare(b[1]))
    .forEach((r, i) => { r[5] = SYNTH_BASE + i; });

/* ID 唯一性是短碼正確性的前提，違反就中止而不是靜默產出壞資料 */
const ids = rows.map(r => r[5]);
if (new Set(ids).size !== ids.length) {
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  die(`標籤 ID 重複：${[...new Set(dup)].join(", ")}`);
}
const ID_MAX = 36 ** 5;   // 短碼用 5 位 base36
if (Math.max(...ids) >= ID_MAX) die(`ID ${Math.max(...ids)} 超出短碼可編碼上限 ${ID_MAX}`);

rows.sort((a, b) => a[0] - b[0] || b[6] - a[6]);

/* ---- 注入 index.html ----
   `<` 轉成 <：JSON.stringify 不會轉義它，而產物直接寫進 inline <script>，
   標籤名或說明一旦含 </script> 就會截斷 script 區塊。
   replace 用函式回傳值：字串形式的第二參數會把 $& $1 $` 當特殊語法。 */
/* 測試與其他工具讀這份；index.html 讀的是下面注入的 const T（兩者同一來源） */
fs.writeFileSync(path.join(__dirname, "data", "tags.json"),
  "[\n" + rows.map(r => JSON.stringify(r)).join(",\n") + "\n]\n");

const js = ("const T=[\n" + rows.map(r => JSON.stringify(r)).join(",\n") + "\n];")
             .replace(/</g, "\\u003c");

/* core.js 是抽籤與短碼規則的唯一真實來源，內嵌進來讓 index.html 維持單檔可離線。
   同一份檔案也被 tests/core.test.js 直接 require，所以測到的就是工具實際跑的邏輯。 */
const CORE_START = "/* CORE_INJECT_START — 以下由 build-tags.js 從 core.js 注入，不要手改 */";
const CORE_END = "/* CORE_INJECT_END */";
const corePath = path.join(__dirname, "core.js");
if (!fs.existsSync(corePath)) die(`找不到 ${corePath}`);
const coreSrc = fs.readFileSync(corePath, "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, "");
/* 這裡不能像 const T 那樣把 `<` 全轉成 <——core.js 的 `<` 多半是比較運算子，
   轉了就壞掉。內嵌 script 真正的危險只有 `</script` 與 `<!--` 這兩個序列，
   core.js 不該出現它們；出現就中止並要求改寫，不要靜默產出壞檔。 */
const danger = coreSrc.match(/<\/script|<!--/i);
if (danger) die(`core.js 含內嵌 script 不安全的序列「${danger[0]}」，請改寫（例如拆成 "<"+"/script"）`);

let html = fs.readFileSync(HTML, "utf8");
const INJECT = /const T=\[[\s\S]*?\n\];/;
if (!INJECT.test(html)) die(`在 ${HTML} 找不到注入點 const T=[...]；index.html 未更新`);
const before = html;
html = html.replace(INJECT, () => js);

const ci = html.indexOf(CORE_START), cj = html.indexOf(CORE_END);
if (ci < 0 || cj < 0 || cj < ci) die(`在 ${HTML} 找不到 core.js 注入標記；index.html 未更新`);
html = html.slice(0, ci + CORE_START.length) + "\n" + coreSrc + "\n" + html.slice(cj);

const out = html;
fs.writeFileSync(HTML, out);

console.log(`\n官方清單 ${official.length} 筆｜精選 ${CURATED.length} 筆`
  + `（別名對齊 ${aliased}、併入既有項 ${merged}、未在官方清單 ${unofficial}）`);
console.log(`社群詞彙掛上官方標籤 ${vocabApplied} 條｜標籤重點 ${noted} 個、代表作 ${rows.reduce((n,r)=>n+(r[7]||[]).length,0)} 筆`);
if (unofficial) console.warn(`⚠️ 有 ${unofficial} 個標籤不在官方清單中，違反「完全對應 Steam」原則`);
console.log(`合併後總計 ${rows.length} 筆，未分類 ${unclassified.length} 筆：${unclassified.join(", ") || "無"}`);
console.log(`合成 ID 起點 ${SYNTH_BASE}，最大 ID ${Math.max(...ids)}（上限 ${ID_MAX}）`);
console.log(out === before ? "index.html 內容未變（標籤與 core.js 皆無變動）" : "index.html 已更新");
