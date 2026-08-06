/**
 * merge-notes.js — 把 data/tag-notes-part*.json 併進 data/tag-notes.json 後刪除分檔。
 * 只是撰寫時的暫用工具：內容量大，分批寫檔比一次改一個大檔安全。
 * 併入前會擋下重複的標籤鍵與不存在的標籤。
 */
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "data");

const main = path.join(DIR, "tag-notes.json");
const notes = JSON.parse(fs.readFileSync(main, "utf8"));
const tags = new Set(JSON.parse(fs.readFileSync(path.join(DIR, "tags.json"), "utf8")).map(r => r[1]));

const parts = fs.readdirSync(DIR).filter(f => /^tag-notes-part.*\.json$/.test(f)).sort();
if (!parts.length) { console.log("沒有待併入的分檔"); process.exit(0); }

let added = 0;
const dup = [], unknown = [];
for (const f of parts) {
  const p = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  for (const [tag, v] of Object.entries(p)) {
    if (tag.startsWith("_")) continue;
    if (notes[tag]) { dup.push(`${f}: ${tag}`); continue; }
    if (!tags.has(tag)) { unknown.push(`${f}: ${tag}`); continue; }
    notes[tag] = v; added++;
  }
}
if (dup.length) { console.error("重複的標籤鍵（主檔已有）：\n  " + dup.join("\n  ")); process.exit(1); }
if (unknown.length) { console.error("標籤表裡沒有這些標籤：\n  " + unknown.join("\n  ")); process.exit(1); }

/* 保留 _說明 在最前面，其餘依標籤名排序，方便日後比對 */
const { _說明, ...rest } = notes;
const sorted = { _說明 };
Object.keys(rest).sort().forEach(k => { sorted[k] = rest[k]; });

fs.writeFileSync(main, JSON.stringify(sorted, null, 1)
  .replace(/\{\n +"k"/g, '{ "k"')
  .replace(/",\n +"g": \[/g, '", "g": [')
  .replace(/\n +\]\n +\}/g, "] }") + "\n");
parts.forEach(f => fs.unlinkSync(path.join(DIR, f)));
console.log(`併入 ${added} 個標籤，刪除分檔 ${parts.join(", ")}；主檔現有 ${Object.keys(sorted).length - 1} 個標籤`);
