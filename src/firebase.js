// T-Minus Firebase — 排行榜系統
// 使用 Firebase Firestore REST API（不需要安裝 SDK）

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyADlMFY8w8uEK8TBexgo0wb2d0UmU58qQU",
  projectId: "t-minus-7bc1e",
};

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const API_KEY = FIREBASE_CONFIG.apiKey;
const MAX_RANK = 10; // 只保留前10名

function toFirestore(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string")  fields[k] = { stringValue: v };
    if (typeof v === "number")  fields[k] = { integerValue: String(Math.round(v)) };
    if (typeof v === "boolean") fields[k] = { booleanValue: v };
  }
  return { fields };
}

function fromFirestore(doc) {
  const out = { _id: doc.name?.split("/").pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) {
    if (v.stringValue  !== undefined) out[k] = v.stringValue;
    if (v.integerValue !== undefined) out[k] = parseInt(v.integerValue);
    if (v.booleanValue !== undefined) out[k] = v.booleanValue;
  }
  return out;
}

async function runQuery(collectionId, filters=[], orderBy="score", limit=20) {
  const where = filters.length === 1 ? { fieldFilter: filters[0] } :
    filters.length > 1 ? { compositeFilter: { op: "AND", filters: filters.map(f=>({ fieldFilter:f })) } } :
    undefined;

  const query = {
    structuredQuery: {
      from: [{ collectionId }],
      orderBy: [{ field: { fieldPath: orderBy }, direction: "DESCENDING" }],
      limit,
    },
  };
  if (where) query.structuredQuery.where = where;

  const res = await fetch(`${BASE_URL}:runQuery?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  const data = await res.json();
  return data.filter(d => d.document).map(d => fromFirestore(d.document));
}

// ─── 生存挑戰分榜 ─────────────────────────────────────────────────────────────
export async function uploadSurvivalScore({ name, score, elapsed, wave, rocketId }) {
  try {
    // 查第20名的分數
    const top20 = await runQuery("survival_scores", [], "score", MAX_RANK);
    const cutoff = top20.length >= MAX_RANK ? top20[top20.length-1].score : 0;

    // 分數不夠高就不上傳
    if (top20.length >= MAX_RANK && score <= cutoff) return null;

    // 上傳
    await fetch(`${BASE_URL}/survival_scores?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toFirestore({ name, score, elapsed, wave, rocketId, createdAt: Date.now() })),
    });

    // 計算排名
    const above = top20.filter(s => s.score > score).length;
    return above + 1;
  } catch (e) {
    console.error("uploadSurvivalScore:", e);
    return null;
  }
}

export async function getSurvivalLeaderboard(limit=10) {
  try { return await runQuery("survival_scores", [], "score", limit); }
  catch(e) { return []; }
}

// ─── 大關任務分榜 ─────────────────────────────────────────────────────────────
export async function uploadMissionScore({ name, planetId, score, pct, rocketId }) {
  try {
    await fetch(`${BASE_URL}/mission_scores?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toFirestore({ name, planetId, score, pct, rocketId, createdAt: Date.now() })),
    });
    return null;
  } catch (e) {
    console.error("uploadMissionScore:", e);
    return null;
  }
}

export async function getMissionLeaderboard(planetId, limit=10) {
  try {
    // 先拿全部 mission_scores，JS 端再 filter planetId
    // 避免 Firestore 複合索引需求（filter + orderBy 同時用）
    const res = await fetch(`${BASE_URL}:runQuery?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "mission_scores" }],
          orderBy: [{ field: { fieldPath: "score" }, direction: "DESCENDING" }],
          limit: 100, // 拿夠用即可，降低讀取消耗
        },
      }),
    });
    const data = await res.json();
    const all = data.filter(d => d.document).map(d => fromFirestore(d.document));
    return all.filter(s => s.planetId === planetId).slice(0, limit);
  } catch(e) {
    console.error("getMissionLeaderboard:", e);
    return [];
  }
}