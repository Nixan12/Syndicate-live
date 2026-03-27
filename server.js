/**

- SYNDICATE // Standalone Server — null avhengigheter
- Bruker kun Node.js innebygde moduler (http, https, fs, crypto).
- Faller tilbake til mock-data hvis Sofascore er utilgjengelig.
  */

const http = require(‘http’);
const https = require(‘https’);
const fs = require(‘fs’);
const path = require(‘path’);
const crypto = require(‘crypto’);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, ‘data’);
const LOG_FILE = path.join(DATA_DIR, ‘signals.json’);

fs.mkdirSync(DATA_DIR, { recursive: true });

// ── SIGNAL LOG ────────────────────────────────────────────────────────────────
let signalLog = [];
try {
if (fs.existsSync(LOG_FILE)) {
signalLog = JSON.parse(fs.readFileSync(LOG_FILE, ‘utf8’));
console.log(`[LOGGER] Lastet ${signalLog.length} signaler fra disk`);
}
} catch (e) {}

function saveLog() {
fs.writeFileSync(LOG_FILE, JSON.stringify(signalLog, null, 2));
}

// ── MOCK DATA ENGINE ──────────────────────────────────────────────────────────
const LEAGUES = [
{ name: ‘Premier League’, country: ‘EN’ },
{ name: ‘Bundesliga’, country: ‘DE’ },
{ name: ‘La Liga’, country: ‘ES’ },
{ name: ‘Serie A’, country: ‘IT’ },
{ name: ‘Ligue 1’, country: ‘FR’ },
{ name: ‘Eredivisie’, country: ‘NL’ },
{ name: ‘Eliteserien’, country: ‘NO’ },
{ name: ‘Allsvenskan’, country: ‘SE’ },
];

const TEAMS = {
EN: [[‘Arsenal’,‘Chelsea’],[‘Man City’,‘Liverpool’],[‘Spurs’,‘Man Utd’]],
DE: [[‘Bayern’,‘Dortmund’],[‘Leverkusen’,‘Leipzig’]],
ES: [[‘Real Madrid’,‘Barcelona’],[‘Atletico’,‘Sevilla’]],
IT: [[‘Inter’,‘Milan’],[‘Juventus’,‘Napoli’]],
FR: [[‘PSG’,‘Marseille’],[‘Lyon’,‘Monaco’]],
NL: [[‘Ajax’,‘PSV’],[‘Feyenoord’,‘AZ’]],
NO: [[‘Rosenborg’,‘Molde’],[‘Brann’,‘Vålerenga’]],
SE: [[‘Malmö’,‘IFK Göteborg’],[‘AIK’,‘Djurgården’]],
};

let mockMatches = [];
let matchCounter = 1;

function r(min, max, d=1) { return parseFloat((Math.random()*(max-min)+min).toFixed(d)); }
function ri(min, max) { return Math.floor(Math.random()*(max-min+1))+min; }

function generateMocks() {
mockMatches = [];
LEAGUES.forEach(league => {
const pool = TEAMS[league.country] || [];
const count = ri(1, Math.min(2, pool.length));
for (let i = 0; i < count; i++) {
const pair = pool[i % pool.length];
mockMatches.push({
id: String(matchCounter++),
homeTeam: pair[0], awayTeam: pair[1],
homeScore: 0, awayScore: 0,
minute: ri(20, 44),
leagueName: league.name, countryCode: league.country,
xgHome: r(0.05, 0.95), xgAway: r(0.05, 0.75),
shotsOnTarget: ri(1, 6), dangerousAttacks: ri(3, 18),
possession: ri(35, 65), cornerKicks: ri(0, 7),
isMock: true,
});
}
});
}

function tickMocks() {
mockMatches = mockMatches.filter(m => m.minute < 45);
mockMatches.forEach(m => {
m.minute += ri(0, 2);
m.xgHome = Math.min(m.xgHome + r(0, 0.1), 2.5);
m.xgAway = Math.min(m.xgAway + r(0, 0.08), 2.0);
if (Math.random() > 0.75) m.shotsOnTarget++;
m.dangerousAttacks += ri(0, 2);
m.possession = Math.max(30, Math.min(70, m.possession + ri(-2, 2)));
if (Math.random() > 0.85) m.cornerKicks++;
});
if (Math.random() > 0.5 && mockMatches.length < 16) {
const league = LEAGUES[ri(0, LEAGUES.length-1)];
const pool = TEAMS[league.country] || [];
if (pool.length > 0) {
const pair = pool[ri(0, pool.length-1)];
mockMatches.push({
id: String(matchCounter++),
homeTeam: pair[0], awayTeam: pair[1],
homeScore: 0, awayScore: 0,
minute: ri(10, 25),
leagueName: league.name, countryCode: league.country,
xgHome: r(0, 0.3), xgAway: r(0, 0.25),
shotsOnTarget: ri(0, 2), dangerousAttacks: ri(1, 5),
possession: ri(40, 60), cornerKicks: ri(0, 2),
isMock: true,
});
}
}
}

// ── SIGNAL SCORING ────────────────────────────────────────────────────────────
function calcSignalScore(m) {
let score = 0;
const xgT = (m.xgHome||0)+(m.xgAway||0);
const xgD = Math.abs((m.xgHome||0)-(m.xgAway||0));
const sot = m.shotsOnTarget||0;
const da  = m.dangerousAttacks||0;
const pos = m.possession||50;
const min = m.minute||0;
const cor = m.cornerKicks||0;

if (xgT>=1.2) score+=25; else if (xgT>=0.7) score+=15; else if (xgT>=0.4) score+=7;
if (xgD>=0.5) score+=10;
if (sot>=5) score+=20; else if (sot>=3) score+=12; else if (sot>=1) score+=5;
if (da>=15) score+=15; else if (da>=9) score+=9; else if (da>=5) score+=4;
if (pos>=65||pos<=35) score+=8;
if (min>=28&&min<=42) score+=15; else if (min>=20&&min<=27) score+=7;
if (cor>=5) score+=7; else if (cor>=3) score+=3;

const s = Math.min(score, 100);
return { score: s, tier: s>=70?‘STERKT’:s>=45?‘MODERAT’:‘LAVT’ };
}

// ── WEBSOCKET (innebygd, ingen ws-pakke) ──────────────────────────────────────
const wsClients = new Set();

function handleUpgrade(req, socket) {
const key = req.headers[‘sec-websocket-key’];
if (!key) { socket.destroy(); return; }

const accept = crypto.createHash(‘sha1’)
.update(key + ‘258EAFA5-E914-47DA-95CA-C5AB0DC85B11’)
.digest(‘base64’);

socket.write(
‘HTTP/1.1 101 Switching Protocols\r\n’ +
‘Upgrade: websocket\r\n’ +
‘Connection: Upgrade\r\n’ +
`Sec-WebSocket-Accept: ${accept}\r\n\r\n`
);

wsClients.add(socket);
sendWs(socket, { type: ‘LOG_UPDATE’, data: signalLog });
console.log(`[WS] Klient tilkoblet. Totalt: ${wsClients.size}`);

socket.on(‘data’, buf => {
try {
const msg = decodeFrame(buf);
if (msg) onWsMessage(socket, msg);
} catch(e) {}
});
socket.on(‘close’, () => { wsClients.delete(socket); });
socket.on(‘error’, () => { wsClients.delete(socket); });
}

function decodeFrame(buf) {
if (buf.length < 2) return null;
const masked = !!(buf[1] & 0x80);
let plen = buf[1] & 0x7f;
let off = 2;
if (plen === 126) { plen = buf.readUInt16BE(2); off = 4; }
else if (plen === 127) { off = 10; }
const mask = masked ? buf.slice(off, off+4) : null;
off += masked ? 4 : 0;
const payload = buf.slice(off, off+plen);
if (masked) for (let i=0;i<payload.length;i++) payload[i]^=mask[i%4];
try { return JSON.parse(payload.toString()); } catch { return null; }
}

function encodeFrame(data) {
const payload = Buffer.from(JSON.stringify(data));
const len = payload.length;
let hdr;
if (len < 126) { hdr = Buffer.alloc(2); hdr[0]=0x81; hdr[1]=len; }
else { hdr = Buffer.alloc(4); hdr[0]=0x81; hdr[1]=126; hdr.writeUInt16BE(len,2); }
return Buffer.concat([hdr, payload]);
}

function sendWs(socket, data) {
try { socket.write(encodeFrame(data)); } catch(e) { wsClients.delete(socket); }
}

function broadcast(data) {
for (const s of wsClients) sendWs(s, data);
}

function onWsMessage(socket, msg) {
if (msg.type === ‘LOG’) {
const entry = {
…msg.data,
id: `${msg.data.matchId}-${Date.now()}`,
loggedAt: new Date().toISOString(),
result: null, gain: null, stake: 100,
};
signalLog.push(entry);
saveLog();
broadcast({ type: ‘LOG_UPDATE’, data: signalLog });
console.log(`[LOG] ${entry.home} vs ${entry.away} @ ${entry.odds || '?'}`);
}
}

// ── API-FOOTBALL FETCH ────────────────────────────────────────────────────────
function fetchLiveMatches() {
return new Promise((resolve, reject) => {
const apiKey = process.env.API_FOOTBALL_KEY;
if (!apiKey) return reject(new Error(‘API_FOOTBALL_KEY mangler’));

```
const req = https.get({
  hostname: 'v3.football.api-sports.io',
  path: '/fixtures?live=all',
  headers: {
    'x-apisports-key': apiKey,
  },
  timeout: 8000,
}, res => {
  if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    try {
      const fixtures = JSON.parse(body)?.response ?? [];
      resolve(fixtures.map(f => ({
        id: String(f.fixture?.id),
        homeTeam: f.teams?.home?.name ?? '?',
        awayTeam: f.teams?.away?.name ?? '?',
        homeScore: f.goals?.home ?? 0,
        awayScore: f.goals?.away ?? 0,
        minute: f.fixture?.status?.elapsed ?? 0,
        leagueName: f.league?.name ?? '',
        countryCode: f.league?.country ?? '',
        xgHome: null,
        xgAway: null,
        shotsOnTarget: f.statistics?.[0]?.statistics?.find(s => s.type === 'Shots on Goal')?.value ?? null,
        dangerousAttacks: null,
        possession: parseInt(f.statistics?.[0]?.statistics?.find(s => s.type === 'Ball Possession')?.value ?? '0') || null,
        cornerKicks: f.statistics?.[0]?.statistics?.find(s => s.type === 'Corner Kicks')?.value ?? null,
      })));
    } catch(e) { reject(e); }
  });
});
req.on('error', reject);
req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
```

});
}

// ── POLL LOOP ─────────────────────────────────────────────────────────────────
async function poll() {
let matches;
let source = ‘mock’;

try {
matches = await fetchLiveMatches();
source = ‘api-football’;
console.log(`[POLL] API-Football: ${matches.length} live kamper`);
} catch (err) {
tickMocks();
matches = mockMatches;
console.log(`[POLL] Mock (${err.message}): ${matches.length} kamper`);
}

const scored = matches
.filter(m => m.homeScore === 0 && m.awayScore === 0 && m.minute >= 20 && m.minute <= 44)
.map(m => ({ …m, signalScore: calcSignalScore(m) }))
.sort((a, b) => b.signalScore.score - a.signalScore.score);

broadcast({ type: ‘MATCHES’, data: scored, source, timestamp: Date.now() });
}

// ── HTTP SERVER ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
const urlPath = req.url === ‘/’ ? ‘/index.html’ : req.url;
const filePath = path.join(__dirname, ‘public’, urlPath);
const ext = path.extname(filePath);
const mimes = { ‘.html’:‘text/html’, ‘.js’:‘text/javascript’, ‘.css’:‘text/css’ };

if (req.method === ‘GET’ && fs.existsSync(filePath)) {
res.writeHead(200, { ‘Content-Type’: mimes[ext] || ‘text/plain’ });
fs.createReadStream(filePath).pipe(res);
return;
}
res.writeHead(404); res.end(‘Not found’);
});

server.on(‘upgrade’, (req, socket, head) => {
if (req.headers[‘upgrade’]?.toLowerCase() === ‘websocket’) {
handleUpgrade(req, socket);
}
});

// ── START ─────────────────────────────────────────────────────────────────────
generateMocks();

server.listen(PORT, () => {
console.log(`\n╔══════════════════════════════════════╗`);
console.log(`║  SYNDICATE // Backend kjører         ║`);
console.log(`║  http://localhost:${PORT}               ║`);
console.log(`║  Null npm-avhengigheter              ║`);
console.log(`╚══════════════════════════════════════╝\n`);
poll();
setInterval(poll, 15_000);
});
