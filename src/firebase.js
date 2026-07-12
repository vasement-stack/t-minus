// T-Minus Firebase — 排行榜系統
// 使用 Firebase Firestore REST API（不需要安裝 SDK）

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyADlMFY8w8uEK8TBexgo0wb2d0UmU58qQU",
  projectId: "t-minus-7bc1e",
};

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const API_KEY = FIREBASE_CONFIG.apiKey;
const MAX_RANK = 10;
const CACHE_TTL = 60 * 60 * 1000; // 1小時，毫秒

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

async function runQuery(collectionId, orderBy="score", limit=10) {
  const res = await fetch(`${BASE_URL}:runQuery?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        orderBy: [{ field: { fieldPath: orderBy }, direction: "DESCENDING" }],
        limit,
      },
    }),
  });
  const data = await res.json();
  return data.filter(d => d.document).map(d => fromFirestore(d.document));
}

// ─── 全域快取：存在 Firestore 的 cache collection ────────────────────────────
// 每個 cache document 的 key：survival / mission_0 / mission_1 ... mission_7
// 結構：{ data: JSON string, updatedAt: timestamp }

async function getCache(key) {
  try {
    const res = await fetch(`${BASE_URL}/cache/${key}?key=${API_KEY}`);
    if (!res.ok) return null;
    const doc = await res.json();
    if (!doc.fields) return null;
    const updatedAt = parseInt(doc.fields.updatedAt?.integerValue || 0);
    if (Date.now() - updatedAt > CACHE_TTL) return null; // 過期
    const raw = doc.fields.data?.stringValue;
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

async function setCache(key, data) {
  try {
    await fetch(`${BASE_URL}/cache/${key}?key=${API_KEY}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          data: { stringValue: JSON.stringify(data) },
          updatedAt: { integerValue: String(Date.now()) },
        },
      }),
    });
  } catch(e) { /* 快取寫入失敗不影響主功能 */ }
}

// ─── 生存挑戰分榜 ─────────────────────────────────────────────────────────────
export async function uploadSurvivalScore({ name, score, elapsed, wave, rocketId }) {
  try {
    const top = await runQuery("survival_scores", "score", MAX_RANK);
    const cutoff = top.length >= MAX_RANK ? top[top.length-1].score : 0;
    if (top.length >= MAX_RANK && score <= cutoff) return null;

    await fetch(`${BASE_URL}/survival_scores?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toFirestore({ name, score, elapsed, wave, rocketId, createdAt: Date.now() })),
    });

    // 上傳後清除快取，讓下次查詢拿到最新資料
    await setCache("survival", null);

    const above = top.filter(s => s.score > score).length;
    return above + 1;
  } catch (e) {
    console.error("uploadSurvivalScore:", e);
    return null;
  }
}

export async function getSurvivalLeaderboard(limit=10) {
  try {
    // 先查全域快取
    const cached = await getCache("survival");
    if (cached) return cached.slice(0, limit);

    // 快取不存在或過期，重新查
    const scores = await runQuery("survival_scores", "score", limit);
    await setCache("survival", scores);
    return scores;
  } catch(e) { return []; }
}

// ─── 大關任務分榜 ─────────────────────────────────────────────────────────────
export async function uploadMissionScore({ name, planetId, score, pct, rocketId }) {
  try {
    await fetch(`${BASE_URL}/mission_scores?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toFirestore({ name, planetId, score, pct, rocketId, createdAt: Date.now() })),
    });
    // 清除該星球的快取
    await setCache(`mission_${planetId}`, null);
    return null;
  } catch (e) {
    console.error("uploadMissionScore:", e);
    return null;
  }
}

export async function getMissionLeaderboard(planetId, limit=10) {
  try {
    // 先查全域快取
    const cacheKey = `mission_${planetId}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached.slice(0, limit);

    // 快取不存在或過期，重新查全部再篩選
    const res = await fetch(`${BASE_URL}:runQuery?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "mission_scores" }],
          orderBy: [{ field: { fieldPath: "score" }, direction: "DESCENDING" }],
          limit: 100,
        },
      }),
    });
    const data = await res.json();
    const all = data.filter(d => d.document).map(d => fromFirestore(d.document));
    const filtered = all.filter(s => s.planetId === planetId).slice(0, limit);

    // 存入快取
    await setCache(cacheKey, filtered);
    return filtered;
  } catch(e) {
    console.error("getMissionLeaderboard:", e);
    return [];
  }
}
