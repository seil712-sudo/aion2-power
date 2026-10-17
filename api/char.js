// 아이온2 전투력 중계 서버 (Vercel Serverless Function, 서울 리전)
// GET /api/char?name=캐릭터명&server=서버명  → 전투력 등 요약 정보
// GET /api/char?servers=1                   → 서버 목록

const ALLOWED_ORIGINS = [
  'https://seil712-sudo.github.io',
  'http://localhost:8765',
];
const NC = 'https://aion2.plaync.com';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ ok: false, error: 'GET만 지원합니다' }); return; }

  try {
    if (req.query.servers) {
      const servers = await getServers();
      res.setHeader('Cache-Control', 's-maxage=86400');
      res.status(200).json({ ok: true, servers });
      return;
    }
    const name = String(req.query.name || '').trim();
    const server = String(req.query.server || '').trim();
    if (!name || !server) { res.status(400).json({ ok: false, error: 'name, server 둘 다 필요합니다' }); return; }

    const result = await lookup(name, server);
    if (result.ok) res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=600'); // 같은 캐릭터는 10분 캐시
    res.status(result.ok ? 200 : 404).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e), region: process.env.VERCEL_REGION || null });
  }
}

async function getServers() {
  const r = await fetch(`${NC}/api/gameinfo/servers?lang=ko`, { headers: ncHeaders() });
  if (!r.ok) throw new Error(`NC 서버 목록 응답 ${r.status} / ${(await r.text()).slice(0, 160)}`);
  const d = await r.json();
  return (d.serverList || []).map(s => ({ id: s.serverId, name: s.serverName, short: s.serverShortName, race: s.raceId }));
}

async function lookup(name, serverName) {
  const servers = await getServers();
  const sv = servers.find(s => s.name === serverName || s.short === serverName);
  if (!sv) return { ok: false, error: `서버 "${serverName}" 를 찾을 수 없습니다`, servers: servers.map(s => s.name) };

  const sr = await fetch(`${NC}/api/search/character?keyword=${encodeURIComponent(name)}&race=${sv.race}&serverId=${sv.id}&page=1&size=30`, { headers: ncHeaders() });
  if (!sr.ok) throw new Error(`NC 검색 응답 ${sr.status}`);
  const sd = await sr.json();
  const list = (sd.list || []).map(c => ({ ...c, plainName: String(c.name || '').replace(/<[^>]+>/g, '') }));
  const found = list.find(c => c.plainName === name && c.serverId === sv.id) || list.find(c => c.plainName === name);
  if (!found) return { ok: false, error: `"${serverName}" 서버에서 "${name}" 캐릭터를 찾을 수 없습니다`, candidates: list.slice(0, 5).map(c => ({ name: c.plainName, server: c.serverName, level: c.level })) };

  const ir = await fetch(`${NC}/api/character/info?lang=ko&characterId=${found.characterId}&serverId=${found.serverId}`, { headers: ncHeaders() });
  if (!ir.ok) throw new Error(`NC 캐릭터 정보 응답 ${ir.status}`);
  const info = await ir.json();
  const p = info.profile || {};
  const itemLevel = ((info.stat && info.stat.statList) || []).find(s => s.type === 'ItemLevel');

  return {
    ok: true,
    name: p.characterName || found.plainName,
    server: p.serverName || found.serverName,
    serverId: p.serverId || found.serverId,
    race: p.raceName || null,
    className: p.className || null,
    level: p.characterLevel ?? found.level ?? null,
    combatPower: p.combatPower ?? null,
    itemLevel: itemLevel ? itemLevel.value : null,
    title: p.titleName || null,
    characterId: p.characterId || decodeURIComponent(found.characterId),
    url: `${NC}/ko-kr/characters/${found.serverId}/${found.characterId}`,
    fetchedAt: new Date().toISOString(),
  };
}

function ncHeaders() {
  return {
    'Accept': 'application/json',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Referer': `${NC}/ko-kr/characters/index`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  };
}
