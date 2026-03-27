const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const DATA_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'signals.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

let signalLog = [];
try {
  if (fs.existsSync(LOG_FILE)) {
    signalLog = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  }
} catch(e) {}

function saveLog() {
  fs.writeFileSync(LOG_FILE, JSON.stringify(signalLog, null, 2));
}

const LEAGUES = [
  { name: 'Premier League', country: 'EN' },
  { name: 'Bundesliga', country: 'DE' },
  { name: 'La Liga', country: 'ES' },
  { name: 'Serie A', country: 'IT' },
  { name: 'Ligue 1', country: 'FR' },
  { name: 'Eredivisie', country: 'NL' },
  { name: 'Eliteserien', country: 'NO' },
  { name: 'Allsvenskan', country: 'SE' },
];

const TEAMS = {
  EN: [['Arsenal','Chelsea'],['Man City','Liverpool'],['Spurs','Man Utd']],
  DE: [['Bayern','Dortmund'],['Leverkusen','Leipzig']],
  ES: [['Real Madrid','Barcelona'],['Atletico','Sevilla']],
  IT: [['Inter','Milan'],['Juventus','Napoli']],
  FR: [['PSG','Marseille'],['Lyon','Monaco']],
  NL: [['Ajax','PSV'],['Feyenoord','AZ']],
  NO: [['Rosenborg','Molde'],['Brann','Valerenga']],
  SE: [['Malmo','IFK Goteborg'],['AIK','Djurgarden']],
};

let mockMatches = [];
let matchCounter = 1;

function r(min, max, d) { d = d || 1; return parseFloat((Math.random()*(max-min)+min).toFixed(d)); }
function ri(min, max) { return Math.floor(Math.random()*(max-min+1))+min; }

function generateMocks() {
  mockMatches = [];
  LEAGUES.forEach(function(league) {
    var pool = TEAMS[league.country] || [];
    var count = ri(1, Math.min(2, pool.length));
    for (var i = 0; i < count; i++) {
      var pair = pool[i % pool.length];
      mockMatches.push({
        id: String(matchCounter++),
        homeTeam: pair[0], awayTeam: pair[1],
        homeScore: 0, awayScore: 0,
        minute: ri(20, 44),
        leagueName: league.name, countryCode: league.country,
        xgHome: r(0.05, 0.95), xgAway: r(0.05, 0.75),
        shotsOnTarget: ri(1, 6), dangerousAttacks: ri(3, 18),
        possession: ri(35, 65), cornerKicks: ri(0, 7),
        odds: r(1.4, 3.2),
        isMock: true,
      });
    }
  });
}

function tickMocks() {
  mockMatches = mockMatches.filter(function(m) { return m.minute < 45; });
  mockMatches.forEach(function(m) {
    m.minute += ri(0, 2);
    m.xgHome = Math.min(m.xgHome + r(0, 0.1), 2.5);
    m.xgAway = Math.min(m.xgAway + r(0, 0.08), 2.0);
    if (Math.random() > 0.75) m.shotsOnTarget++;
    m.dangerousAttacks += ri(0, 2);
    m.possession = Math.max(30, Math.min(70, m.possession + ri(-2, 2)));
    if (Math.random() > 0.85) m.cornerKicks++;
    m.odds = Math.max(1.1, Math.min(5.0, m.odds + r(-0.05, 0.05)));
  });
  if (Math.random() > 0.5 && mockMatches.length < 16) {
    var league = LEAGUES[ri(0, LEAGUES.length-1)];
    var pool = TEAMS[league.country] || [];
    if (pool.length > 0) {
      var pair = pool[ri(0, pool.length-1)];
      mockMatches.push({
        id: String(matchCounter++),
        homeTeam: pair[0], awayTeam: pair[1],
        homeScore: 0, awayScore: 0,
        minute: ri(10, 25),
        leagueName: league.name, countryCode: league.country,
        xgHome: r(0, 0.3), xgAway: r(0, 0.25),
        shotsOnTarget: ri(0, 2), dangerousAttacks: ri(1, 5),
        possession: ri(40, 60), cornerKicks: ri(0, 2),
        odds: r(1.6, 3.0),
        isMock: true,
      });
    }
  }
}

function calcSignalScore(m) {
  var score = 0;
  var sot = m.shotsOnTarget||0;
  var tot = m.totalShots||0;
  var pos = m.possession||50;
  var min = m.minute||0;
  var cor = m.cornerKicks||0;
  var ratio = tot > 0 ? sot/tot : 0;

  // Skudd paa maal
  if (sot>=4) score+=25; else if (sot>=2) score+=12; else if (sot>=1) score+=5;

  // Totale skudd
  if (tot>=8) score+=15; else if (tot>=5) score+=8;

  // Skudd-ratio (kvalitet)
  if (ratio>=0.5 && sot>=2) score+=10;

  // Possession dominans
  if (pos>=65||pos<=35) score+=10;

  // Cornere
  if (cor>=5) score+=12; else if (cor>=3) score+=6;

  // Tidsvindu
  if (min>=28&&min<=42) score+=18; else if (min>=20&&min<=27) score+=8;

  var s = Math.min(score, 90);
  return { score: s, tier: s>=65?'STERKT':s>=40?'MODERAT':'LAVT' };
}

var wsClients = new Set();

function handleUpgrade(req, socket) {
  var key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  var accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  wsClients.add(socket);
  sendWs(socket, { type: 'LOG_UPDATE', data: signalLog });
  console.log('[WS] Klient tilkoblet. Totalt: ' + wsClients.size);
  socket.on('data', function(buf) {
    try { var msg = decodeFrame(buf); if (msg) onWsMessage(socket, msg); } catch(e) {}
  });
  socket.on('close', function() { wsClients.delete(socket); });
  socket.on('error', function() { wsClients.delete(socket); });
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  var masked = !!(buf[1] & 0x80);
  var plen = buf[1] & 0x7f;
  var off = 2;
  if (plen === 126) { plen = buf.readUInt16BE(2); off = 4; }
  else if (plen === 127) { off = 10; }
  var mask = masked ? buf.slice(off, off+4) : null;
  off += masked ? 4 : 0;
  var payload = buf.slice(off, off+plen);
  if (masked) for (var i=0;i<payload.length;i++) payload[i]^=mask[i%4];
  try { return JSON.parse(payload.toString()); } catch(e) { return null; }
}

function encodeFrame(data) {
  var payload = Buffer.from(JSON.stringify(data));
  var len = payload.length;
  var hdr;
  if (len < 126) { hdr = Buffer.alloc(2); hdr[0]=0x81; hdr[1]=len; }
  else { hdr = Buffer.alloc(4); hdr[0]=0x81; hdr[1]=126; hdr.writeUInt16BE(len,2); }
  return Buffer.concat([hdr, payload]);
}

function sendWs(socket, data) {
  try { socket.write(encodeFrame(data)); } catch(e) { wsClients.delete(socket); }
}

function broadcast(data) {
  wsClients.forEach(function(s) { sendWs(s, data); });
}

function onWsMessage(socket, msg) {
  if (msg.type === 'LOG') {
    var entry = Object.assign({}, msg.data, {
      id: msg.data.matchId + '-' + Date.now(),
      loggedAt: new Date().toISOString(),
      result: null, gain: null, stake: 100,
    });
    signalLog.push(entry);
    saveLog();
    broadcast({ type: 'LOG_UPDATE', data: signalLog });
    console.log('[LOG] ' + entry.home + ' vs ' + entry.away + ' @ ' + (entry.odds || '?'));
  }
}

function apiGet(apiPath) {
  return new Promise(function(resolve, reject) {
    if (!API_KEY) return reject(new Error('API_FOOTBALL_KEY mangler'));
    var req = https.get({
      hostname: 'v3.football.api-sports.io',
      path: apiPath,
      headers: { 'x-apisports-key': API_KEY },
      timeout: 8000,
    }, function(res) {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(body).response || []); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Timeout')); });
  });
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function fetchStats(fixtureId) {
  return apiGet('/fixtures/statistics?fixture=' + fixtureId).then(function(data) {
    if (!data || data.length === 0) {
      console.log('[STATS] Ingen data for kamp ' + fixtureId);
      return { shotsOnTarget: null, possession: null, cornerKicks: null, totalShots: null };
    }
    var homStats = (data[0] && data[0].statistics) || [];
    var types = homStats.map(function(s) { return s.type; }).join(', ');
    console.log('[STATS] Kamp ' + fixtureId + ' (' + homStats.length + ' stats): ' + types.slice(0, 80));
    function getStat(type) {
      for (var i=0; i<homStats.length; i++) {
        if (homStats[i].type === type) return homStats[i].value;
      }
      return null;
    }
    return {
      shotsOnTarget: getStat('Shots on Goal'),
      possession: parseInt(getStat('Ball Possession') || '0') || null,
      cornerKicks: getStat('Corner Kicks'),
      totalShots: getStat('Total Shots'),
    };
  }).catch(function(err) {
    console.log('[STATS] Feil for kamp ' + fixtureId + ': ' + err.message);
    return { shotsOnTarget: null, possession: null, cornerKicks: null, totalShots: null };
  });
}

function fetchOdds(fixtureId) {
  return apiGet('/odds/live?fixture=' + fixtureId).then(function(data) {
    if (!data || !data[0]) return null;
    var bookmakers = data[0].bookmakers || [];
    for (var b=0; b<bookmakers.length; b++) {
      var bets = bookmakers[b].bets || [];
      for (var i=0; i<bets.length; i++) {
        var bet = bets[i];
        if (bet.name && bet.name.toLowerCase().indexOf('first half') !== -1) {
          var values = bet.values || [];
          for (var v=0; v<values.length; v++) {
            if (values[v].value === 'Over' && String(values[v].handicap) === '0.5') {
              return parseFloat(values[v].odd) || null;
            }
          }
        }
      }
    }
    return null;
  }).catch(function() { return null; });
}

function fetchEvents(fixtureId) {
  return apiGet('/fixtures/events?fixture=' + fixtureId).then(function(data) {
    return data || [];
  }).catch(function() { return []; });
}

function resolveSignal(signal, events) {
  var goalBeforeHT = false;
  for (var i=0; i<events.length; i++) {
    var ev = events[i];
    var isGoal = ev.type === 'Goal';
    var isOwnGoal = ev.detail === 'Own Goal';
    var minute = ev.time && ev.time.elapsed ? ev.time.elapsed : 99;
    var extra = ev.time && ev.time.extra ? ev.time.extra : 0;
    var effectiveMinute = minute + (extra || 0);
    if (isGoal && !isOwnGoal && effectiveMinute <= 45) {
      goalBeforeHT = true;
      break;
    }
  }

  if (goalBeforeHT) {
    signal.result = 'win';
    signal.gain = signal.odds ? parseFloat(((signal.odds - 1) * signal.stake).toFixed(2)) : signal.stake;
    signal.resolvedAt = new Date().toISOString();
    signal.resolvedReason = 'Mal registrert for pause';
    console.log('[RESOLVE] VINN: ' + signal.home + ' vs ' + signal.away + ' +' + signal.gain);
    return true;
  }
  return false;
}

async function checkPendingSignals() {
  var pending = signalLog.filter(function(s) { return s.result === null && s.matchId; });
  if (pending.length === 0) return;

  console.log('[CHECK] Sjekker ' + pending.length + ' aktive signaler...');
  var changed = false;

  for (var i=0; i<pending.length; i++) {
    var signal = pending[i];
    try {
      var events = await fetchEvents(signal.matchId);
      await sleep(150);

      var fixtureData = await apiGet('/fixtures?id=' + signal.matchId);
      await sleep(150);

      if (fixtureData && fixtureData[0]) {
        var fixture = fixtureData[0];
        var status = fixture.fixture && fixture.fixture.status ? fixture.fixture.status.short : '';
        var htScore = fixture.score && fixture.score.halftime;
        var htGoals = htScore ? (htScore.home || 0) + (htScore.away || 0) : 0;

        var isHT = status === 'HT' || status === '2H' || status === 'ET' || status === 'FT';

        if (isHT) {
          if (htGoals > 0 || resolveSignal(signal, events)) {
            if (htGoals > 0 && signal.result === null) {
              signal.result = 'win';
              signal.gain = signal.odds ? parseFloat(((signal.odds - 1) * signal.stake).toFixed(2)) : signal.stake;
              signal.resolvedAt = new Date().toISOString();
              signal.resolvedReason = 'Mal i forste omgang';
              console.log('[RESOLVE] VINN: ' + signal.home + ' vs ' + signal.away);
            }
            changed = true;
          } else if (signal.result === null) {
            signal.result = 'loss';
            signal.gain = -signal.stake;
            signal.resolvedAt = new Date().toISOString();
            signal.resolvedReason = '0-0 ved pause';
            console.log('[RESOLVE] TAP: ' + signal.home + ' vs ' + signal.away);
            changed = true;
          }
        }
      }
    } catch(err) {
      console.log('[CHECK] Feil for ' + signal.matchId + ': ' + err.message);
    }
  }

  if (changed) {
    saveLog();
    broadcast({ type: 'LOG_UPDATE', data: signalLog });
  }
}

async function fetchLiveMatches() {
  var fixtures = await apiGet('/fixtures?live=all');
  var candidates = fixtures.filter(function(f) {
    var home = f.goals && f.goals.home !== null ? f.goals.home : 0;
    var away = f.goals && f.goals.away !== null ? f.goals.away : 0;
    var min = f.fixture && f.fixture.status ? f.fixture.status.elapsed || 0 : 0;
    return home === 0 && away === 0 && min >= 1;
  });

  console.log('[POLL] ' + fixtures.length + ' live, ' + candidates.length + ' er 0-0');

  var results = [];
  for (var i=0; i<candidates.length; i++) {
    var f = candidates[i];
    var id = f.fixture.id;
    var stats = await fetchStats(id);
    var odds = await fetchOdds(id);
    await sleep(150);

    results.push({
      id: String(id),
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      homeScore: f.goals.home || 0,
      awayScore: f.goals.away || 0,
      minute: f.fixture.status.elapsed || 0,
      leagueName: f.league.name,
      countryCode: f.league.country,
      xgHome: null,
      xgAway: null,
      shotsOnTarget: stats.shotsOnTarget,
      totalShots: stats.totalShots,
      dangerousAttacks: null,
      possession: stats.possession,
      cornerKicks: stats.cornerKicks,
      odds: odds,
    });
  }
  return results;
}

async function poll() {
  var matches;
  try {
    matches = await fetchLiveMatches();
  } catch(err) {
    tickMocks();
    matches = mockMatches;
    console.log('[POLL] Mock (' + err.message + '): ' + matches.length + ' kamper');
  }

  var scored = matches
    .filter(function(m) { return m.homeScore === 0 && m.awayScore === 0 && m.minute >= 1; })
    .map(function(m) { return Object.assign({}, m, { signalScore: calcSignalScore(m) }); })
    .sort(function(a, b) { return b.signalScore.score - a.signalScore.score; });

  broadcast({ type: 'MATCHES', data: scored, timestamp: Date.now() });

  autoLogSignals(scored);

  await checkPendingSignals();
}

function autoLogSignals(matches) {
  var AUTO_THRESHOLD = 70;
  var loggedIds = {};
  signalLog.forEach(function(s) { loggedIds[s.matchId] = true; });

  matches.forEach(function(m) {
    if (loggedIds[m.id]) return;
    if (!m.signalScore || m.signalScore.score < AUTO_THRESHOLD) return;
    if (m.minute < 28 || m.minute > 42) return;

    var entry = {
      id: m.id + '-' + Date.now(),
      matchId: m.id,
      home: m.homeTeam,
      away: m.awayTeam,
      league: m.leagueName,
      minute: m.minute,
      score: m.signalScore.score,
      odds: m.odds || null,
      xgTotal: m.xgHome !== null && m.xgAway !== null ? m.xgHome + m.xgAway : null,
      shotsOnTarget: m.shotsOnTarget || null,
      loggedAt: new Date().toISOString(),
      auto: true,
      result: null,
      gain: null,
      stake: 100,
    };

    signalLog.push(entry);
    loggedIds[m.id] = true;
    saveLog();
    broadcast({ type: 'LOG_UPDATE', data: signalLog });
    console.log('[AUTO] Signal logget: ' + entry.home + ' vs ' + entry.away + ' score=' + entry.score + ' min=' + entry.minute);
  });
}

var server = http.createServer(function(req, res) {
  var urlPath = req.url === '/' ? '/index.html' : req.url;
  var filePath = path.join(__dirname, 'public', urlPath);
  var ext = path.extname(filePath);
  var mimes = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
  if (req.method === 'GET' && fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  res.writeHead(404); res.end('Not found');
});

server.on('upgrade', function(req, socket, head) {
  if (req.headers['upgrade'] && req.headers['upgrade'].toLowerCase() === 'websocket') {
    handleUpgrade(req, socket);
  }
});

generateMocks();

server.listen(PORT, function() {
  console.log('SYNDICATE kjorer pa port ' + PORT);
  console.log('API-Football: ' + (API_KEY ? 'konfigurert' : 'MANGLER NOKKEL'));
  poll();
  setInterval(poll, 30000);
});