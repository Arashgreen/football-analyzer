/*
 * dataLayer.js — FotMob client for the standalone app (no server).
 * Same logic as server.js of the web version:
 *   search -> team -> league fixtures -> per-match details -> aggregates.
 * Add new stats by extending STAT_KEYS and goalBuckets logic stays intact.
 */
const FM = "https://www.fotmob.com/api/data";
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
const CACHE_TTL = 15 * 60 * 1000;

const STAT_KEYS = ["total_shots", "ShotsOnTarget", "Offsides", "corners", "keeper_saves"];

const memCache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cacheGet(k) {
  const v = memCache.get(k);
  if (v && Date.now() - v.t < CACHE_TTL) return v.data;
  if (v) memCache.delete(k);
  return null;
}
function cacheSet(k, d) { memCache.set(k, { t: Date.now(), data: d }); }

async function jget(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(800 * (i + 1));
    }
  }
}

// ---------- public API (same shape as the web backend) ----------
const DataLayer = {
  async search(q) {
    const d = await jget(`${FM}/search/suggest?term=${encodeURIComponent(q)}`);
    const out = [];
    for (const grp of Array.isArray(d) ? d : []) {
      for (const s of grp.suggestions || []) {
        if (s.type === "team") out.push({ id: s.id, name: s.name, league: s.leagueName || "" });
      }
    }
    const best = new Map();
    for (const t of out) {
      const cur = best.get(t.id);
      if (!cur || t.name.length < cur.name.length) best.set(t.id, t);
    }
    return [...best.values()].slice(0, 12);
  },

  async analyze(teamId) {
    const key = "team:" + teamId;
    const hit = cacheGet(key);
    if (hit) return hit;

    const t = await jget(`${FM}/teams?id=${teamId}`);
    const details = t?.details || {};
    const leagueId = details.primaryLeagueId;
    const season = details.latestSeason || "";
    if (!leagueId) throw new Error("لیگ این تیم در دسترس نیست");

    const lg = await jget(`${FM}/leagues?id=${leagueId}`);
    const idStr = String(teamId);
    const myMatches = (lg?.fixtures?.allMatches || []).filter(
      (m) => m.status?.finished && (String(m.home.id) === idStr || String(m.away.id) === idStr)
    );

    const perMatch = [];
    const totals = { gf: 0, ga: 0, total_shots: 0, ShotsOnTarget: 0, Offsides: 0, corners: 0, keeper_saves: 0 };
    const bucketTotals = Array(6).fill(0);
    let noStats = 0;

    for (const m of myMatches) {
      const isHome = String(m.home.id) === idStr;
      const parts = String(m.status.scoreStr || "0-0").split("-").map((x) => parseInt(x.trim(), 10));
      let gf = 0, ga = 0;
      if (parts.length === 2 && parts.every(Number.isFinite)) {
        gf = isHome ? parts[0] : parts[1];
        ga = isHome ? parts[1] : parts[0];
      }
      let st = { total_shots: 0, ShotsOnTarget: 0, Offsides: 0, corners: 0, keeper_saves: 0 };
      let md = null;
      try {
        md = await jget(`${FM}/matchDetails?matchId=${m.id}`);
        st = extractTeamStats(md, isHome);
        if (!st.total_shots && !st.ShotsOnTarget && !st.corners) noStats++;
      } catch (_) { noStats++; }
      let buckets = Array(6).fill(0);
      try {
        buckets = goalBucketsForTeam(md || {}, isHome, isHome ? gf : ga, isHome ? ga : gf);
      } catch (_) {}
      await sleep(400);
      const row = {
        id: m.id,
        date: (m.status.utcTime || "").slice(0, 10),
        opponent: isHome ? m.away.name : m.home.name,
        venue: isHome ? "خانه" : "بیرون",
        score: String(m.status.scoreStr || "").trim(),
        result: gf > ga ? "برد" : gf < ga ? "باخت" : "مساوی",
        gf, ga, ...st, buckets,
      };
      perMatch.push(row);
      for (const k of Object.keys(totals)) totals[k] += row[k];
      for (let i = 0; i < 6; i++) bucketTotals[i] += buckets[i];
    }

    const played = perMatch.length;
    const avg = (v) => (played ? +(v / played).toFixed(2) : 0);
    const data = {
      team: { id: details.id, name: details.name, shortName: details.shortName, country: details.country },
      league: lg?.details?.name || "",
      season,
      played,
      matchesWithStats: played - noStats,
      totals,
      averages: {
        gf: avg(totals.gf), ga: avg(totals.ga), total_shots: avg(totals.total_shots),
        ShotsOnTarget: avg(totals.ShotsOnTarget), Offsides: avg(totals.Offsides),
        corners: avg(totals.corners), keeper_saves: avg(totals.keeper_saves),
      },
      goalBuckets: {
        labels: ["0-15", "16-30", "31-45", "46-60", "61-75", "76-90"],
        totals: bucketTotals,
        avg: bucketTotals.map((v) => avg(v)),
      },
      matches: perMatch.reverse(),
    };
    cacheSet(key, data);
    return data;
  },
};

// ---------- extraction helpers ----------
function extractTeamStats(matchDetails, isHome) {
  const all = matchDetails?.content?.stats?.Periods?.All;
  const flat = {};
  if (all) {
    for (const grp of all.stats || []) {
      for (const row of grp.stats || []) {
        if (row.type === "title" || !row.key || !Array.isArray(row.stats)) continue;
        if (!(row.key in flat)) flat[row.key] = row.stats;
      }
    }
  }
  const idx = isHome ? 0 : 1;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const stats = {};
  for (const k of STAT_KEYS) stats[k] = num((flat[k] || [])[idx]);
  return stats;
}

// goals per 15-minute bucket; a goal belongs to the team whose score incremented
function goalBucketsForTeam(matchDetails, isHome, finalHome, finalAway) {
  const buckets = Array(6).fill(0);
  const evs = matchDetails?.content?.matchFacts?.events?.events || [];
  const goals = evs.filter((e) => e.type === "Goal" && !e.isPenaltyShootoutEvent);
  for (const g of goals) {
    const before = { h: Number(g.homeScore) || 0, a: Number(g.awayScore) || 0 };
    let after = null;
    const idx = evs.indexOf(g);
    for (let j = idx + 1; j < evs.length && !after; j++) {
      const e = evs[j];
      if (Number.isFinite(Number(e.homeScore)) && Number.isFinite(Number(e.awayScore)))
        after = { h: Number(e.homeScore), a: Number(e.awayScore) };
    }
    if (!after) after = { h: finalHome, a: finalAway };
    const homeGoal = after.h > before.h, awayGoal = after.a > before.a;
    if (!homeGoal && !awayGoal) continue;
    const min = Math.min(Number(g.time) || 0, 90);
    const b = Math.min(Math.floor(min / 15), 5);
    if ((isHome && homeGoal) || (!isHome && awayGoal)) buckets[b]++;
  }
  return buckets;
}

// expose for the UI layer (top-level `const` doesn't touch `window`)
window.DataLayer = DataLayer;
