/**
 * T1：已知答案配對測試。
 * 拿每款遊戲在 Steam 商店頁最具代表性的前 6 個標籤（依 count 排序，僅保留
 * tags.json 收錄的 tagid）去配 core.matchGames，檢查這款遊戲能不能把自己排到前面。
 *
 * 用法：
 *   node t1.js            連網抓商店頁 InitAppTagModal，寫 steam_tags.json 後重算
 *   node t1.js --offline  不連網，只讀既有 steam_tags.json 重算（驗收者用這個對數字）
 *
 * 範圍鎖：只讀 ARMY/baseline/*、ARMY/taskT1/games.json；只寫 ARMY/taskT1/ 底下的檔案。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ARMY = path.join(__dirname, "..");
const BASELINE = path.join(ARMY, "baseline");
const T1 = __dirname;

const OFFLINE = process.argv.includes("--offline");
const DELAY_MS = 1600;
const MAX_RETRY = 3;
const MAX_CONSEC_FAIL = 5;

const core = require(path.join(BASELINE, "core.js"));
const T = require(path.join(BASELINE, "tags.json"));
const GI = require(path.join(BASELINE, "game-index.json"));
const IDX = core.makeIndex(T);
const games = require(path.join(T1, "games.json"));

// tagid -> tags.json 列，只用來判斷「tagid 是否存在」與取回英文名
const tagById = {};
T.forEach(row => { tagById[row[5]] = row; });

// appid -> 基準索引裡的遊戲列，用來算 recorded 與確認遊戲是否在索引中
const gameByAppid = {};
(GI.games || []).forEach(g => { gameByAppid[g[0]] = g; });

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 從商店頁 HTML 找出 InitAppTagModal( appid, [ {...}, ... ], ... ) 裡的標籤陣列。
 *  用逐字元、字串安全的括號配對，避免標籤名裡出現 [ ] 時被天真的正規表達式切壞。 */
function extractTagsArray(html) {
  const marker = "InitAppTagModal(";
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const bracketStart = html.indexOf("[", start + marker.length);
  if (bracketStart === -1) return null;
  let depth = 0, inStr = false, strCh = "", esc = false, j = bracketStart;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { j++; break; } }
  }
  const arrText = html.slice(bracketStart, j);
  try {
    const parsed = JSON.parse(arrText);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

async function fetchStoreTags(appid) {
  const url = `https://store.steampowered.com/app/${appid}/?l=english`;
  const res = await fetch(url, {
    headers: {
      "Cookie": "birthtime=946684801; lastagecheckage=1-0-2000; wants_mature_content=1",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const html = await res.text();
  const tags = extractTagsArray(html);
  if (!tags) throw new Error("找不到或無法解析 InitAppTagModal");
  return tags;
}

function median(nums) {
  const arr = nums.slice().sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  const v = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  return v;
}

function computeRow(game, rawTags, errorMsg) {
  const row = { appid: game.appid, name: game.name, segment: game.segment };
  if (errorMsg) { row.error = errorMsg; row.top6 = []; row.recorded = null; row.selfRank = null;
    row.selfScore = null; row.top1Score = null; row.top1Name = null; return row; }

  const valid = (rawTags || []).filter(t => t && tagById[t.tagid]);
  valid.sort((a, b) => (b.count || 0) - (a.count || 0));
  const top6raw = valid.slice(0, 6);
  const top6 = top6raw.map(t => ({ tagid: t.tagid, name: t.name, count: t.count, en: tagById[t.tagid][1] }));
  row.top6 = top6;

  if (!top6.length) { row.error = "商店頁標籤中沒有一個存在於 tags.json"; row.recorded = null;
    row.selfRank = null; row.selfScore = null; row.top1Score = null; row.top1Name = null; return row; }

  const idxGame = gameByAppid[game.appid];
  if (!idxGame) {
    row.recorded = null;
  } else {
    const tagSet = new Set(idxGame[4] || []);
    row.recorded = top6.filter(t => tagSet.has(t.tagid)).length;
  }

  const sel = top6.map(t => ({ en: t.en, role: "core" }));
  const m = core.matchGames(sel, GI, IDX, { limit: 100000 });
  const rank = m.games.findIndex(g => g.appid === game.appid);
  row.selfRank = rank === -1 ? null : rank + 1;
  row.selfScore = rank === -1 ? null : m.games[rank].score;
  row.top1Score = m.games.length ? m.games[0].score : null;
  row.top1Name = m.games.length ? m.games[0].name : null;
  return row;
}

function summarize(rows) {
  const n = rows.length;
  const hitAt1 = rows.filter(r => r.selfRank === 1).length / n;
  const hitAt6 = rows.filter(r => r.selfRank !== null && r.selfRank <= 6).length / n;
  const ranksForMedian = rows.map(r => r.selfRank === null ? Infinity : r.selfRank);
  const medRank = median(ranksForMedian);
  const medianRank = medRank === Infinity ? "Infinity" : medRank;

  const recordedVals = rows.filter(r => r.recorded !== null && r.recorded !== undefined).map(r => r.recorded);
  const medianRecorded = median(recordedVals);

  const byRecorded = {};
  for (let k = 0; k <= 6; k++) byRecorded[k] = { count: 0, hitAt6: 0 };
  byRecorded.null = { count: 0, hitAt6: 0 };
  rows.forEach(r => {
    const key = (r.recorded === null || r.recorded === undefined) ? "null" : r.recorded;
    byRecorded[key].count++;
    if (r.selfRank !== null && r.selfRank <= 6) byRecorded[key].hitAt6++;
  });
  Object.keys(byRecorded).forEach(k => {
    const b = byRecorded[k];
    b.hitAt6 = b.count ? b.hitAt6 / b.count : null;
  });

  const bySegment = {};
  for (let s = 1; s <= 4; s++) bySegment[s] = { count: 0, hitAt6: 0 };
  rows.forEach(r => {
    const b = bySegment[r.segment];
    if (!b) return;
    b.count++;
    if (r.selfRank !== null && r.selfRank <= 6) b.hitAt6++;
  });
  Object.keys(bySegment).forEach(s => {
    const b = bySegment[s];
    b.hitAt6 = b.count ? b.hitAt6 / b.count : null;
  });

  return { n, hitAt1, hitAt6, medianRank, medianRecorded, byRecorded, bySegment };
}

async function main() {
  const rows = [];
  let rawTagsByAppid = {};
  const stPath = path.join(T1, "steam_tags.json");

  if (OFFLINE) {
    if (!fs.existsSync(stPath)) { console.error("✗ --offline 需要既有 steam_tags.json，找不到檔案"); process.exit(1); }
    rawTagsByAppid = JSON.parse(fs.readFileSync(stPath, "utf8"));
    for (const g of games) {
      const entry = rawTagsByAppid[g.appid];
      if (entry && entry.error) rows.push(computeRow(g, null, entry.error));
      else rows.push(computeRow(g, entry, null));
    }
  } else {
    let consecFail = 0, stoppedForRateLimit = false;
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      if (i > 0) await sleep(DELAY_MS);

      let lastErr = null, tags = null;
      for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        try {
          tags = await fetchStoreTags(g.appid);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e.message || String(e);
          if (attempt < MAX_RETRY) await sleep(DELAY_MS);
        }
      }

      if (tags) {
        rawTagsByAppid[g.appid] = tags;
        rows.push(computeRow(g, tags, null));
        consecFail = 0;
      } else {
        rawTagsByAppid[g.appid] = { error: lastErr };
        rows.push(computeRow(g, null, lastErr));
        consecFail++;
        if (consecFail >= MAX_CONSEC_FAIL) {
          stoppedForRateLimit = true;
          // 剩下沒跑到的款也要留在 40 列裡，標記未執行
          for (let j = i + 1; j < games.length; j++) {
            rawTagsByAppid[games[j].appid] = { error: "未執行：疑似被限流，提前停止" };
            rows.push(computeRow(games[j], null, "未執行：疑似被限流，提前停止"));
          }
          break;
        }
      }
    }
    fs.writeFileSync(stPath, JSON.stringify(rawTagsByAppid, null, 1));
    if (stoppedForRateLimit) console.error("⚠ 連續 5 款失敗，疑似被 Steam 限流，已停止並交出部分結果");
  }

  const summary = summarize(rows);
  const out = { generatedAt: new Date().toISOString(), offline: OFFLINE, summary, rows };
  fs.writeFileSync(path.join(T1, "results.json"), JSON.stringify(out, null, 1));

  console.log("完成 " + rows.length + " / " + games.length + " 款");
  console.log("hitAt1=" + summary.hitAt1.toFixed(3) + " hitAt6=" + summary.hitAt6.toFixed(3) +
    " medianRank=" + summary.medianRank + " medianRecorded=" + summary.medianRecorded);
}

main().catch(e => { console.error("致命錯誤：", e); process.exit(1); });
