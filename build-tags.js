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

/* ---- 未在官方清單、但概念上有用的標籤：註明商店頁該改掛什麼 ----
   這些是官方真的沒有的缺口（非同義詞），保留供對齊方向用，但工單與 UI 會註記不可上架。 */
const SUBSTITUTE = {
  "Low Poly": "Stylized 或 Voxel",
  "Cel-Shaded": "Stylized 或 Cartoony",
  "School": "Anime＋Story Rich 的組合",
  "Survival Craft": "Survival＋Crafting 兩個一起掛",
  "Creepy": "Horror 或 Atmospheric",
  "Tense": "Thriller 或 Atmospheric",
  "Dramatic": "Narrative 或 Story Rich",
  "Drama": "Narrative 或 Story Rich",
  "Multiple Protagonists": "Story Rich（官方無此標籤）",
  "Character Development": "Lore-Rich 或 Story Rich",
  "Skill Tree": "Character Customization 或 Class-Based",
  "Asymmetric": "PvP（官方僅有 Asymmetric VR）",
  "Artistic": "Abstract 或 Beautiful",
  "Narration": "Dynamic Narration",
};

/* 資料檔是純 JSON 而非可執行 JS：公開 repo 若收 PR，「改一個標籤」不該等於「執行任意程式碼」 */
const CURATED = readJson("curated-tags.json", "精選標籤庫");
const CLASSIFY = readJson("official-dims.json", "官方標籤維度歸類");

const rows = [];
const seen = new Set();
function push(dim, enName, zh, flags, note, id, curated) {
  const k = enName.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  rows.push([dim, enName, zh, flags, note || "", id || 0, curated ? 1 : 0]);
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
    const noteFull = (o.tc && o.tc !== zh ? `亦稱「${zh}」。` : "") + (note || "") + extra;
    if (!push(dim, o.en, zhShow, flags.replace("u", ""), noteFull, o.id, true)) merged++;
  } else {
    unofficial++;
    const sub = SUBSTITUTE[name] ? `商店頁請改掛 ${SUBSTITUTE[name]}。` : "";
    const joined = [note, sub].filter(Boolean).join("；").replace(/；(?=商店頁)/, "。");
    push(dim, name, zh, flags.includes("u") ? flags : flags + "u", joined, 0, true);
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
console.log(`合併後總計 ${rows.length} 筆，未分類 ${unclassified.length} 筆：${unclassified.join(", ") || "無"}`);
console.log(`合成 ID 起點 ${SYNTH_BASE}，最大 ID ${Math.max(...ids)}（上限 ${ID_MAX}）`);
console.log(out === before ? "index.html 內容未變（標籤與 core.js 皆無變動）" : "index.html 已更新");
