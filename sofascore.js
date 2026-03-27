/**
 * sofascore.js
 * 
 * Wrapper rundt Sofascore sitt uoffisielle API.
 * Bruker standard fetch med realistiske browser-headers
 * for å unngå rate limiting.
 */

const BASE = 'https://api.sofascore.com/api/v1';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Referer': 'https://www.sofascore.com/',
  'Origin': 'https://www.sofascore.com',
  'Cache-Control': 'no-cache',
};

/**
 * Henter alle live fotballkamper.
 * Returnerer en normalisert liste med kamp-objekter.
 */
async function fetchLiveMatches() {
  const url = `${BASE}/sport/football/events/live`;
  const res = await fetchWithRetry(url);
  const data = await res.json();

  const events = data?.events ?? [];

  return events.map(event => ({
    id: String(event.id),
    homeTeam: event.homeTeam?.name ?? 'Ukjent',
    awayTeam: event.awayTeam?.name ?? 'Ukjent',
    homeScore: event.homeScore?.current ?? 0,
    awayScore: event.awayScore?.current ?? 0,
    minute: event.time?.played ?? 0,
    status: event.status?.description ?? '',
    leagueName: event.tournament?.name ?? '',
    leagueCategory: event.tournament?.category?.name ?? '',
    leagueId: String(event.tournament?.id ?? ''),
    countryCode: event.tournament?.category?.alpha2 ?? '',
    startTimestamp: event.startTimestamp ?? 0,
    // Stats fylles inn av fetchMatchStats
    xgHome: null,
    xgAway: null,
    shotsTotal: null,
    shotsOnTarget: null,
    dangerousAttacks: null,
    possession: null,
    cornerKicks: null,
  }));
}

/**
 * Henter live statistikk for en enkelt kamp.
 * Sofascore eksponerer dette under /event/:id/statistics
 */
async function fetchMatchStats(matchId) {
  const url = `${BASE}/event/${matchId}/statistics`;

  try {
    const res = await fetchWithRetry(url);
    const data = await res.json();

    // Statistikk er gruppert i perioder — vi vil ha "All" eller første periode
    const groups = data?.statistics ?? [];
    const allPeriod = groups.find(g => g.period === 'ALL') ?? groups[0];
    const stats = allPeriod?.groups ?? [];

    const get = (key) => findStat(stats, key);

    return {
      xgHome: get('Expected goals') ? parseFloat(get('Expected goals').homeValue ?? 0) : null,
      xgAway: get('Expected goals') ? parseFloat(get('Expected goals').awayValue ?? 0) : null,
      shotsTotal: parseIntStat(get('Shots') ?? get('Total shots')),
      shotsOnTarget: parseIntStat(get('Shots on target') ?? get('On target')),
      dangerousAttacks: parseIntStat(get('Dangerous attacks') ?? get('Attacks')),
      possession: parseFloatStat(get('Ball possession') ?? get('Possession')),
      cornerKicks: parseIntStat(get('Corner kicks') ?? get('Corners')),
    };
  } catch (err) {
    // Stats ikke tilgjengelig for alle kamper — returner nulls
    console.warn(`[SOFASCORE] Stats utilgjengelig for kamp ${matchId}: ${err.message}`);
    return {
      xgHome: null, xgAway: null,
      shotsTotal: null, shotsOnTarget: null,
      dangerousAttacks: null, possession: null, cornerKicks: null,
    };
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Finn en statistikk-rad etter navn (case-insensitive delvis match)
 */
function findStat(groups, key) {
  const lower = key.toLowerCase();
  for (const group of groups) {
    for (const item of (group.statisticsItems ?? [])) {
      if (item.name?.toLowerCase().includes(lower)) return item;
    }
  }
  return null;
}

function parseIntStat(item) {
  if (!item) return null;
  // homeValue er streng som "3" eller "3/8" (gjort/forsøkt)
  const val = item.homeValue?.toString().split('/')[0];
  return val ? parseInt(val) : null;
}

function parseFloatStat(item) {
  if (!item) return null;
  const val = item.homeValue?.toString().replace('%', '');
  return val ? parseFloat(val) : null;
}

/**
 * fetch med retry og eksponentiell backoff.
 * Sofascore rate-limiter aggressive polling — vi venter og prøver igjen.
 */
async function fetchWithRetry(url, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });

      if (res.status === 429) {
        const waitMs = 2000 * Math.pow(2, attempt);
        console.warn(`[SOFASCORE] Rate limited. Venter ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;

    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { fetchLiveMatches, fetchMatchStats };
