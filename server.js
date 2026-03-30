require('dotenv').config();
const express = require('express');
const Parser = require('rss-parser');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');

const app = express();
const parser = new Parser({
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; ConflictTracker/2.0; +https://chocolair.ae)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  }
});

// --- Pure JS JSON storage (no native modules) ---
const DATA_DIR = path.join(__dirname, 'database');
const DATA_FILE = path.join(DATA_DIR, 'articles.json');
const CLUSTER_FILE = path.join(DATA_DIR, 'clusters.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadData(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
}

let articles = loadData(DATA_FILE, []);
let clusters = loadData(CLUSTER_FILE, []);
let nextId = articles.length ? Math.max(...articles.map(a => a.id)) + 1 : 1;
let nextClusterId = clusters.length ? Math.max(...clusters.map(c => c.id)) + 1 : 1;

function persistData() {
  if (articles.length > 3000) articles = articles.slice(-3000);
  saveData(DATA_FILE, articles);
  saveData(CLUSTER_FILE, clusters);
}

// --- RSS Feeds (verified working sources, diverse perspectives) ---
const FEEDS = [
  // === Western / International ===
  { name: 'Al Jazeera',          region: 'Qatar',          perspective: 'Arab',            url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'BBC Middle East',     region: 'UK',             perspective: 'Western',         url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml' },
  { name: 'France 24',           region: 'France',         perspective: 'Western',         url: 'https://www.france24.com/en/middle-east/rss' },
  { name: 'Sky News World',      region: 'UK',             perspective: 'Western',         url: 'https://feeds.skynews.com/feeds/rss/world.xml' },
  { name: 'The Guardian ME',     region: 'UK',             perspective: 'Western',         url: 'https://www.theguardian.com/world/middleeast/rss' },
  { name: 'DW World',            region: 'Germany',        perspective: 'Western',         url: 'https://rss.dw.com/rdf/rss-en-world' },
  { name: 'CNN World',           region: 'US',             perspective: 'Western',         url: 'http://rss.cnn.com/rss/edition_world.rss' },
  { name: 'NY Times ME',         region: 'US',             perspective: 'Western',         url: 'https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml' },
  { name: 'Washington Post',     region: 'US',             perspective: 'Western',         url: 'https://feeds.washingtonpost.com/rss/world' },
  { name: 'The Independent',     region: 'UK',             perspective: 'Western',         url: 'https://www.independent.co.uk/news/world/middle-east/rss' },
  { name: 'Euronews',            region: 'Europe',         perspective: 'Western',         url: 'https://www.euronews.com/rss?level=theme&name=news' },
  { name: 'Radio Free Europe',   region: 'US/RFE',         perspective: 'Western',         url: 'https://www.rferl.org/api/epiqq' },

  // === Israeli Sources ===
  { name: 'Times of Israel',     region: 'Israel',         perspective: 'Israeli',         url: 'https://www.timesofisrael.com/feed/' },
  { name: 'Jerusalem Post',      region: 'Israel',         perspective: 'Israeli',         url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx' },
  { name: 'i24 News',            region: 'Israel',         perspective: 'Israeli',         url: 'https://www.i24news.tv/en/rss' },
  { name: 'Arutz Sheva',         region: 'Israel',         perspective: 'Israeli',         url: 'https://www.israelnationalnews.com/rss.aspx' },
  { name: 'The Jewish Chronicle',region: 'UK',             perspective: 'Israeli',         url: 'https://www.thejc.com/rss' },

  // === Arab / Pan-Arab Sources ===
  { name: 'Middle East Eye',     region: 'UK/Pan-Arab',    perspective: 'Arab',            url: 'https://www.middleeasteye.net/rss' },
  { name: 'Middle East Monitor', region: 'UK/Pan-Arab',    perspective: 'Arab',            url: 'https://www.middleeastmonitor.com/feed/' },
  { name: 'Al Monitor',          region: 'US',             perspective: 'Arab',            url: 'https://www.al-monitor.com/rss.xml' },
  { name: 'Mondoweiss',          region: 'US',             perspective: 'Pro-Palestinian', url: 'https://mondoweiss.net/feed/' },
  { name: 'Electronic Intifada', region: 'US',             perspective: 'Pro-Palestinian', url: 'https://electronicintifada.net/rss.xml' },

  // === Gulf / Saudi Sources ===

  // === Iranian / Pro-Iran Sources ===

  // === Kurdish / Iraq ===
  { name: 'Kurdistan 24',        region: 'Kurdistan',      perspective: 'Kurdish',         url: 'https://www.kurdistan24.net/en/rss.xml' },

  // === Turkish Sources ===
  { name: 'Daily Sabah',         region: 'Turkey',         perspective: 'Turkish',         url: 'https://www.dailysabah.com/rss' },

  // === Russian Sources ===
  { name: 'RT News',             region: 'Russia',         perspective: 'Russian',         url: 'https://www.rt.com/rss/news/' },
  { name: 'Sputnik World',       region: 'Russia',         perspective: 'Russian',         url: 'https://sputnikglobe.com/export/rss2/archive/index.xml' },

  // === Chinese Sources ===
  { name: 'Xinhua World',        region: 'China',          perspective: 'Chinese',         url: 'https://www.xinhuanet.com/english/rss/worldrss.xml' },

  // === South Asia / Global ===
  { name: 'WION',                region: 'India',          perspective: 'South Asian',     url: 'https://feeds.feedburner.com/wionews' },
  { name: 'NDTV World',          region: 'India',          perspective: 'South Asian',     url: 'https://feeds.feedburner.com/ndtvnews-world-news' },

  // === Defense / Military ===
  { name: 'US DoD',              region: 'US',             perspective: 'US Military',     url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?max=10&ContentType=1&Site=945' },
  { name: 'Defense News',        region: 'US',             perspective: 'Defense',         url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?rss=true' },
  { name: 'Breaking Defense',    region: 'US',             perspective: 'Defense',         url: 'https://breakingdefense.com/feed/' },
  { name: 'Antiwar.com',         region: 'US',             perspective: 'Anti-War',        url: 'https://www.antiwar.com/blog/feed/' },

  // === Additional verified sources ===
  { name: 'The Cradle',         region: 'Lebanon',        perspective: 'Arab',            url: 'https://thecradle.co/rss' },
  { name: 'Moon of Alabama',    region: 'Germany',        perspective: 'Anti-War',        url: 'https://www.moonofalabama.org/atom.xml' },
  // === Think Tanks / Analysis ===
  { name: 'UN News ME',          region: 'International',  perspective: 'UN/Neutral',      url: 'https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml' },
];

const KEYWORDS = [
  'iran', 'iranian', 'irgc', 'tehran', 'khamenei',
  'israel', 'israeli', 'idf', 'netanyahu',
  'hezbollah', 'nasrallah', 'lebanon', 'beirut',
  'hamas', 'gaza', 'west bank', 'palestine', 'rafah',
  'houthi', 'yemen', 'sanaa', 'ansarallah', 'red sea',
  'syria', 'damascus',
  'iraq', 'baghdad', 'militia',
  'saudi', 'riyadh', 'aramco',
  'missile', 'strike', 'airstrike', 'drone', 'ballistic',
  'conflict', 'ceasefire', 'escalation', 'hostage',
  'hormuz', 'us forces', 'pentagon', 'middle east',
  'nuclear', 'sanctions', 'us military', 'war',
  'explosion', 'attack', 'killed', 'wounded', 'bombing'
];

function isRelevant(item) {
  const text = ((item.title || '') + ' ' + (item.contentSnippet || '')).toLowerCase();
  return KEYWORDS.some(kw => text.includes(kw));
}

// --- SSE Clients ---
const sseClients = new Set();
function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch { sseClients.delete(res); } });
}

// --- AI Scoring Queue ---
let aiQueue = [];
let aiProcessing = false;

async function scoreArticle(article) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key === 'REPLACE_WITH_YOUR_KEY') return null;

  const prompt = `Analyze this Middle East news article. Respond ONLY with a valid JSON object, no other text.

Title: ${article.title}
Summary: ${article.summary || ''}

JSON:
{
  "severity": <1-10>,
  "severity_label": <"critical"|"high"|"medium"|"low">,
  "actors": [<from: "Iran","IRGC","Israel","IDF","Hezbollah","Hamas","Houthis","US","Saudi Arabia","Lebanon","Syria","Iraq","Yemen","Gaza","Qatar","Turkey","Egypt">],
  "countries": [<country names>],
  "event_type": <"strike"|"rocket_fire"|"ground_op"|"diplomatic"|"maritime"|"drone"|"nuclear"|"sanctions"|"protest"|"other">,
  "is_timeline_event": <true if major escalation, false otherwise>,
  "timeline_summary": <"one sentence if is_timeline_event, else null">
}`;

  for (const model of [
    process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free',
    process.env.OPENROUTER_FALLBACK || 'stepfun/step-3.5-flash:free'
  ]) {
    try {
      const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model, messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0.1,
      }, {
        headers: { 'Authorization': `Bearer ${key}`, 'HTTP-Referer': 'https://chocolair.ae', 'X-Title': 'Middle East Conflict Tracker', 'Content-Type': 'application/json' },
        timeout: 20000,
      });
      const content = res.data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (err) {
      console.error(`AI error (${model}):`, err.message);
    }
  }
  return null;
}

async function processAIQueue() {
  if (aiProcessing || aiQueue.length === 0) return;
  aiProcessing = true;
  while (aiQueue.length > 0) {
    const articleId = aiQueue.shift();
    const article = articles.find(a => a.id === articleId);
    if (!article || article.ai_scored) continue;
    const result = await scoreArticle(article);
    if (result) {
      article.severity = result.severity || article.severity;
      article.severity_label = result.severity_label || article.severity_label;
      article.actors = result.actors || [];
      article.countries = result.countries || [];
      article.event_type = result.event_type || 'other';
      article.is_timeline_event = !!result.is_timeline_event;
      article.timeline_summary = result.timeline_summary || null;
      article.ai_scored = true;
      broadcastSSE({ type: 'article_scored', id: article.id, severity: article.severity, severity_label: article.severity_label });
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  persistData();
  aiProcessing = false;
}

// --- Keyword severity fallback ---
function quickSeverity(title, summary) {
  const text = (title + ' ' + (summary || '')).toLowerCase();
  if (['ballistic missile','nuclear','ground invasion','chemical weapon','mass casualt'].some(w => text.includes(w))) return { severity: 9.0, label: 'critical' };
  if (['airstrike','missile strike','rocket barrage','explosion','killed','drone strike','military operation','attack on'].some(w => text.includes(w))) return { severity: 7.0, label: 'high' };
  if (['ceasefire','diplomatic','talks','negotiat','humanitarian','aid'].some(w => text.includes(w))) return { severity: 2.0, label: 'low' };
  return { severity: 5.0, label: 'medium' };
}

// --- Quick actor/country extraction from keywords ---
function quickExtract(title, summary) {
  const text = (title + ' ' + (summary || '')).toLowerCase();
  const actors = [];
  const countries = [];
  if (text.includes('iran') || text.includes('irgc') || text.includes('tehran')) { actors.push('Iran'); countries.push('Iran'); }
  if (text.includes('israel') || text.includes('idf')) { actors.push('Israel'); countries.push('Israel'); }
  if (text.includes('hezbollah')) { actors.push('Hezbollah'); if (!countries.includes('Lebanon')) countries.push('Lebanon'); }
  if (text.includes('lebanon') || text.includes('beirut')) { if (!countries.includes('Lebanon')) countries.push('Lebanon'); }
  if (text.includes('hamas')) { actors.push('Hamas'); if (!countries.includes('Gaza')) countries.push('Gaza'); }
  if (text.includes('gaza') || text.includes('west bank') || text.includes('rafah')) { if (!countries.includes('Gaza')) countries.push('Gaza'); }
  if (text.includes('houthi') || text.includes('ansarallah')) { actors.push('Houthis'); if (!countries.includes('Yemen')) countries.push('Yemen'); }
  if (text.includes('yemen') || text.includes('sanaa')) { if (!countries.includes('Yemen')) countries.push('Yemen'); }
  if (text.includes('syria') || text.includes('damascus')) { countries.push('Syria'); }
  if (text.includes('iraq') || text.includes('baghdad') || text.includes('militia')) { countries.push('Iraq'); }
  if (text.includes('saudi') || text.includes('riyadh')) { actors.push('Saudi Arabia'); countries.push('Saudi Arabia'); }
  if (text.includes('us forces') || text.includes('pentagon') || text.includes('us military') || text.includes('american')) { actors.push('US'); }
  if (text.includes('red sea') || text.includes('hormuz')) { if (!countries.includes('Iran')) actors.push('Iran'); }
  return { actors: [...new Set(actors)], countries: [...new Set(countries)] };
}

// --- RSS Fetch ---
const seenLinks = new Set(articles.map(a => a.link));

async function fetchNews() {
  let newCount = 0;
  await Promise.allSettled(FEEDS.map(async feed => {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items) {
        if (!isRelevant(item)) continue;
        const link = item.link || '';
        if (seenLinks.has(link)) continue;
        const title = item.title || 'No title';
        const summary = item.contentSnippet ? item.contentSnippet.slice(0, 300) : '';
        const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();
        const qs = quickSeverity(title, summary);
        const qe = quickExtract(title, summary);
        const article = {
          id: nextId++, title, summary, link, source: feed.name,
          source_region: feed.region, source_perspective: feed.perspective,
          published_at: pubDate, fetched_at: new Date().toISOString(),
          severity: qs.severity, severity_label: qs.label,
          actors: qe.actors, countries: qe.countries,
          event_type: 'other', cluster_id: null,
          is_timeline_event: false, timeline_summary: null, ai_scored: false
        };
        articles.push(article);
        seenLinks.add(link);
        aiQueue.push(article.id);
        newCount++;
      }
    } catch (err) {
      console.error(`Feed error ${feed.name}:`, err.message);
    }
  }));

  if (newCount > 0) {
    console.log(`[${new Date().toISOString()}] Added ${newCount} new articles (total: ${articles.length})`);
    persistData();
    broadcastSSE({ type: 'new_articles', count: newCount });
    // Broadcast stats so clients update counters without a full reload
    const _r24 = articles.filter(a => Date.now() - new Date(a.published_at) < 86400000);
    broadcastSSE({ type: 'stats_update', total: articles.length, last24h: _r24.length, sources: new Set(_r24.map(a => a.source)).size });
    processAIQueue();
  }
}

// --- Clustering ---
function clusterArticles() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = articles.filter(a => new Date(a.published_at) > cutoff && !a.cluster_id);
  const used = new Set();

  for (let i = 0; i < recent.length; i++) {
    if (used.has(i)) continue;
    const group = [recent[i]];
    const aActors = recent[i].actors || [];
    const aCountries = recent[i].countries || [];

    for (let j = i + 1; j < recent.length; j++) {
      if (used.has(j)) continue;
      const bActors = recent[j].actors || [];
      const bCountries = recent[j].countries || [];
      const sharedActors = aActors.filter(a => bActors.includes(a));
      const sharedCountries = aCountries.filter(c => bCountries.includes(c));
      if (sharedActors.length >= 1 && sharedCountries.length >= 1) {
        group.push(recent[j]);
        used.add(j);
      }
    }

    if (group.length >= 2) {
      used.add(i);
      const clusterId = nextClusterId++;
      const cluster = { id: clusterId, title: group[0].title.slice(0, 100), connection_type: 'direct_event', article_count: group.length, created_at: new Date().toISOString() };
      clusters.push(cluster);
      group.forEach(a => { a.cluster_id = clusterId; });
    }
  }
  if (clusters.length > 100) clusters = clusters.slice(-100);
  persistData();
}

// --- Geographic mapping ---
const GEO_MAP = {
  'Iran': [32.4, 53.7], 'IRGC': [32.4, 53.7],
  'Israel': [31.5, 34.8], 'IDF': [31.5, 34.8],
  'Hezbollah': [33.5, 35.5], 'Lebanon': [33.9, 35.5],
  'Hamas': [31.4, 34.4], 'Gaza': [31.4, 34.4],
  'Houthis': [15.4, 44.2], 'Yemen': [15.4, 44.2],
  'Syria': [34.8, 38.9], 'Iraq': [33.3, 44.4],
  'Saudi Arabia': [24.7, 46.7], 'US': [26.5, 56.3],
  'Qatar': [25.3, 51.5], 'Turkey': [39.9, 32.9], 'Egypt': [26.8, 30.8],
};

// --- Cron jobs ---

// --- SSE Heartbeat (keep connections alive every 25s) ---
setInterval(() => {
  sseClients.forEach(res => {
    try { res.write(': heartbeat\n\n'); }
    catch(e) { sseClients.delete(res); }
  });
}, 25000);

cron.schedule('* * * * *', fetchNews);
cron.schedule('*/10 * * * *', clusterArticles);

// --- API Routes ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/news', (req, res) => {
  const { limit = 60, country, severity, offset = 0 } = req.query;
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  let filtered = articles.filter(a => new Date(a.published_at) > cutoff);
  if (country) filtered = filtered.filter(a => (a.actors||[]).includes(country) || (a.countries||[]).includes(country));
  if (severity === 'critical') filtered = filtered.filter(a => a.severity_label === 'critical');
  filtered.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  res.json({ articles: filtered.slice(Number(offset), Number(offset) + Number(limit)), total: filtered.length });
});

app.get('/api/timeline', (req, res) => {
  const cutoff = Date.now() - 72 * 60 * 60 * 1000;
  let events = articles.filter(a => a.is_timeline_event && new Date(a.published_at) > cutoff);
  if (events.length < 5) {
    const fallback = articles
      .filter(a => new Date(a.published_at) > cutoff && a.severity >= 7)
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 20);
    const seen = new Set(events.map(e => e.id));
    events = [...events, ...fallback.filter(a => !seen.has(a.id))];
  }
  events.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  res.json({ events: events.slice(0, 30) });
});

app.get('/api/clusters', (req, res) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentClusters = clusters
    .filter(c => new Date(c.created_at) > cutoff)
    .slice(-10)
    .reverse();
  const result = recentClusters.map(cl => ({
    ...cl,
    articles: articles.filter(a => a.cluster_id === cl.id).slice(0, 5)
  }));
  res.json({ clusters: result });
});

app.get('/api/analytics', (req, res) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = articles.filter(a => new Date(a.published_at) > cutoff);
  const bySeverity = ['critical','high','medium','low'].map(label => ({
    severity_label: label, count: recent.filter(a => a.severity_label === label).length
  })).filter(s => s.count > 0);

  const countrySeverity = {};
  recent.forEach(a => {
    (a.countries || []).forEach(c => {
      if (!countrySeverity[c]) countrySeverity[c] = { total: 0, count: 0 };
      countrySeverity[c].total += a.severity;
      countrySeverity[c].count++;
    });
  });
  const countryAvg = Object.entries(countrySeverity)
    .map(([country, v]) => ({ country, avg_severity: +(v.total / v.count).toFixed(1), count: v.count }))
    .sort((a, b) => b.avg_severity - a.avg_severity);

  const avgSeverity = recent.length ? +(recent.reduce((s, a) => s + a.severity, 0) / recent.length).toFixed(1) : 5;

  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(); day.setDate(day.getDate() - i);
    const dayStr = day.toISOString().slice(0, 10);
    const dayArts = articles.filter(a => a.published_at.startsWith(dayStr));
    trend.push({ day: dayStr, avg_severity: dayArts.length ? +(dayArts.reduce((s, a) => s + a.severity, 0) / dayArts.length).toFixed(1) : 0, count: dayArts.length });
  }

  const actorCounts = {};
  recent.forEach(a => (a.actors || []).forEach(actor => { actorCounts[actor] = (actorCounts[actor] || 0) + 1; }));
  const topActors = Object.entries(actorCounts).map(([actor, count]) => ({ actor, count })).sort((a, b) => b.count - a.count).slice(0, 10);

  const activeSourceCount = new Set(recent.map(a => a.source)).size;
  res.json({ totalArticles: recent.length, last24h: recent.length, bySeverity, countryAvg, avgSeverity, trend, topActors, activeSourceCount, totalFeedCount: FEEDS.length });
});

app.get('/api/heatmap', (req, res) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = articles.filter(a => new Date(a.published_at) > cutoff);
  const pointMap = {};
  recent.forEach(a => {
    [...(a.actors || []), ...(a.countries || [])].forEach(key => {
      const coords = GEO_MAP[key];
      if (!coords) return;
      const k = coords.join(',');
      if (!pointMap[k]) pointMap[k] = { lat: coords[0], lng: coords[1], total: 0, count: 0 };
      pointMap[k].total += a.severity;
      pointMap[k].count++;
    });
  });
  const points = Object.values(pointMap).map(p => [p.lat, p.lng, Math.min(p.total / p.count / 10, 1)]);
  res.json({ points });
});

// --- Analysis API ---
app.get('/api/analysis', (req, res) => {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = articles.filter(a => new Date(a.published_at) > cutoff);

  // Event type breakdown
  const eventTypes = {};
  recent.forEach(a => { eventTypes[a.event_type||'other'] = (eventTypes[a.event_type||'other']||0) + 1; });
  const eventTypeList = Object.entries(eventTypes)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Source stats
  const sourceMap = {};
  recent.forEach(a => {
    if (!sourceMap[a.source]) sourceMap[a.source] = { count: 0, ai_scored: 0, severity_total: 0, region: a.source_region||'', perspective: a.source_perspective||'' };
    sourceMap[a.source].count++;
    if (a.ai_scored) sourceMap[a.source].ai_scored++;
    sourceMap[a.source].severity_total += a.severity;
  });
  const sourcesStats = Object.entries(sourceMap)
    .map(([name, v]) => ({
      name, count: v.count, ai_scored: v.ai_scored,
      avg_severity: v.count ? +(v.severity_total / v.count).toFixed(1) : 0,
      region: v.region, perspective: v.perspective
    }))
    .sort((a, b) => b.count - a.count);

  // Actor co-occurrence (which actors appear together most)
  const pairMap = {};
  recent.forEach(a => {
    const actors = a.actors || [];
    for (let i = 0; i < actors.length; i++) {
      for (let j = i+1; j < actors.length; j++) {
        const key = [actors[i], actors[j]].sort().join(' ↔ ');
        pairMap[key] = (pairMap[key]||0) + 1;
      }
    }
  });
  const actorPairs = Object.entries(pairMap)
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Hot zones (countries by article count + avg severity)
  const zones = {};
  recent.forEach(a => {
    (a.countries||[]).forEach(c => {
      if (!zones[c]) zones[c] = { count: 0, severity_total: 0 };
      zones[c].count++;
      zones[c].severity_total += a.severity;
    });
  });
  const hotZones = Object.entries(zones)
    .map(([country, v]) => ({ country, count: v.count, avg_severity: +(v.severity_total/v.count).toFixed(1) }))
    .sort((a, b) => (b.count * b.avg_severity) - (a.count * a.avg_severity))
    .slice(0, 8);

  // AI scoring coverage
  const aiCoverage = recent.length ? Math.round(recent.filter(a => a.ai_scored).length / recent.length * 100) : 0;

  res.json({ eventTypeList, sourcesStats, actorPairs, hotZones, aiCoverage, totalAnalyzed: recent.length });
});

// --- Bias Tracker API ---
app.get('/api/bias', (req, res) => {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = articles.filter(a => new Date(a.published_at) > cutoff);

  // Build source profile
  const sourceProfiles = {};
  FEEDS.forEach(f => {
    sourceProfiles[f.name] = {
      name: f.name, region: f.region, perspective: f.perspective,
      count: 0, severity_total: 0, actor_counts: {}, country_counts: {}
    };
  });

  recent.forEach(a => {
    const p = sourceProfiles[a.source];
    if (!p) return;
    p.count++;
    p.severity_total += a.severity;
    (a.actors||[]).forEach(actor => { p.actor_counts[actor] = (p.actor_counts[actor]||0) + 1; });
    (a.countries||[]).forEach(c => { p.country_counts[c] = (p.country_counts[c]||0) + 1; });
  });

  // Overall actor frequency for computing relative emphasis
  const overallActors = {};
  recent.forEach(a => (a.actors||[]).forEach(actor => { overallActors[actor] = (overallActors[actor]||0) + 1; }));
  const totalArts = recent.length || 1;

  const sources = Object.values(sourceProfiles)
    .filter(p => p.count > 0)
    .map(p => {
      const topActors = Object.entries(p.actor_counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([actor, count]) => ({ actor, count, pct: Math.round(count/p.count*100) }));

      // Compute emphasis score: how much more/less this source covers each actor vs. average
      const emphasis = {};
      Object.entries(p.actor_counts).forEach(([actor, count]) => {
        const sourceRate = count / p.count;
        const avgRate = (overallActors[actor]||0) / totalArts;
        emphasis[actor] = avgRate > 0 ? +(sourceRate / avgRate).toFixed(2) : 1;
      });

      // Top over-emphasized actor
      const overEmphasized = Object.entries(emphasis)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([actor, ratio]) => ({ actor, ratio }));

      return {
        name: p.name,
        region: p.region,
        perspective: p.perspective,
        count: p.count,
        avg_severity: p.count ? +(p.severity_total / p.count).toFixed(1) : 0,
        top_actors: topActors,
        over_emphasized: overEmphasized,
        top_countries: Object.entries(p.country_counts).sort((a, b) => b[1]-a[1]).slice(0,3).map(([c,n])=>({country:c,count:n})),
      };
    })
    .sort((a, b) => b.count - a.count);

  // Perspective group aggregates
  const perspGroups = {};
  sources.forEach(s => {
    if (!perspGroups[s.perspective]) perspGroups[s.perspective] = { count: 0, sources: 0, severity_total: 0, actor_counts: {} };
    const g = perspGroups[s.perspective];
    g.sources++;
    g.count += s.count;
    g.severity_total += s.avg_severity * s.count;
    s.top_actors.forEach(({ actor, count }) => { g.actor_counts[actor] = (g.actor_counts[actor]||0) + count; });
  });
  const perspectiveSummary = Object.entries(perspGroups).map(([perspective, g]) => ({
    perspective, sources: g.sources, articles: g.count,
    avg_severity: g.count ? +(g.severity_total / g.count).toFixed(1) : 0,
    top_actors: Object.entries(g.actor_counts).sort((a, b) => b[1]-a[1]).slice(0,4).map(([a,c])=>({actor:a,count:c})),
  })).sort((a, b) => b.articles - a.articles);

  res.json({ sources, perspectiveSummary });
});


// --- Iran Conflict Gauge (AI-powered, 30-min cache) ---
let iranGaugeCache = null;
let iranGaugeCacheTime = 0;
const IRAN_GAUGE_TTL = 30 * 60 * 1000;

app.get('/api/iran-gauge', async (req, res) => {
  const now = Date.now();
  if (iranGaugeCache && (now - iranGaugeCacheTime) < IRAN_GAUGE_TTL) {
    return res.json(iranGaugeCache);
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key === 'REPLACE_WITH_YOUR_KEY') {
    return res.json({ score: 50, label: 'UNCERTAIN', reasoning: 'AI key not configured.', signals: [], updatedAt: new Date().toISOString(), articlesAnalyzed: 0 });
  }
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const iranArts = articles.filter(a => {
    const text = (a.title + ' ' + (a.summary || '')).toLowerCase();
    return new Date(a.published_at) > cutoff &&
      (text.includes('iran') || text.includes('irgc') || text.includes('tehran') ||
       (a.actors || []).some(x => x === 'Iran' || x === 'IRGC'));
  }).sort((a, b) => b.severity - a.severity).slice(0, 20);

  if (iranArts.length === 0) {
    const r0 = { score: 20, label: 'DIPLOMATIC TRACK', reasoning: 'No significant Iran-related activity in the past 48 hours.', signals: [], updatedAt: new Date().toISOString(), articlesAnalyzed: 0 };
    iranGaugeCache = r0; iranGaugeCacheTime = now; return res.json(r0);
  }

  const headlines = iranArts.map((a, i) => `${i+1}. [${(a.severity_label||'?').toUpperCase()}] ${a.title}`).join('\n');
  const prompt = `You are a senior geopolitical analyst specializing in Middle East conflicts. Based on these recent news headlines about Iran (past 48h), assess the current probability of a direct ground invasion of Iran by Israel or the US.

HEADLINES:
${headlines}

Respond ONLY with valid JSON, no preamble or explanation outside the JSON:
{
  "score": <integer 0-100 where 0=active peace diplomacy, 25=tensions but dialogue, 50=elevated risk, 75=pre-conflict indicators, 100=invasion imminent>,
  "label": <exactly one of: "PEACE LIKELY"|"DIPLOMATIC TRACK"|"ELEVATED TENSION"|"ESCALATION RISK"|"CONFLICT IMMINENT">,
  "reasoning": <2-3 sentences of expert analysis explaining the score based on the headlines>,
  "signals": [<3-4 short signal strings each max 8 words e.g. "Iran nuclear talks stalled" or "IDF mobilizing near border">]
}`;

  for (const model of [
    process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free',
    process.env.OPENROUTER_FALLBACK || 'stepfun/step-3.5-flash:free'
  ]) {
    try {
      const aiRes = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model, messages: [{ role: 'user', content: prompt }], max_tokens: 500, temperature: 0.2,
      }, {
        headers: { 'Authorization': `Bearer ${key}`, 'HTTP-Referer': 'https://chocolair.ae', 'X-Title': 'Middle East Conflict Tracker', 'Content-Type': 'application/json' },
        timeout: 30000,
      });
      const content = aiRes.data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        iranGaugeCache = { ...parsed, updatedAt: new Date().toISOString(), articlesAnalyzed: iranArts.length };
        iranGaugeCacheTime = now;
        return res.json(iranGaugeCache);
      }
    } catch (err) {
      console.error(`Iran gauge AI error (${model}):`, err.message);
    }
  }

  // Heuristic fallback
  const avgSev = iranArts.reduce((s, a) => s + a.severity, 0) / iranArts.length;
  const critCount = iranArts.filter(a => a.severity_label === 'critical').length;
  const score = Math.min(90, Math.round(avgSev * 6 + critCount * 4));
  const label = score >= 75 ? 'ESCALATION RISK' : score >= 50 ? 'ELEVATED TENSION' : score >= 25 ? 'DIPLOMATIC TRACK' : 'PEACE LIKELY';
  iranGaugeCache = { score, label, reasoning: `Heuristic estimate from ${iranArts.length} Iran-related articles. Average severity ${avgSev.toFixed(1)}/10.`, signals: [], updatedAt: new Date().toISOString(), articlesAnalyzed: iranArts.length };
  iranGaugeCacheTime = now;
  res.json(iranGaugeCache);
});

// Initial fetch
fetchNews();

const PORT = process.env.PORT || 4500;
app.listen(PORT, () => console.log(`Conflict Tracker running on port ${PORT}`));
