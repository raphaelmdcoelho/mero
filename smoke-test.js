/**
 * Smoke test — run with: node smoke-test.js
 * Server must be running on localhost:3000
 */
const http = require('http');

let cookieJar = '';

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 3000,
      path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookieJar ? { Cookie: cookieJar } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const r = http.request(opts, res => {
      // Capture cookies
      const sc = res.headers['set-cookie'];
      if (sc) cookieJar = sc.map(c => c.split(';')[0]).join('; ');
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function pass(label) { console.log(`  ✓ ${label}`); }
function fail(label, msg) { console.error(`  ✗ ${label}: ${msg}`); process.exitCode = 1; }

async function run() {
  console.log('\n=== Mero Smoke Test ===\n');

  // 1. Register
  const reg = await req('POST', '/api/auth/register', { username: 'SmokeHero', password: 'abc123' });
  if (reg.status === 200 && reg.body.accessToken) pass('Register');
  else fail('Register', JSON.stringify(reg.body));
  const token = reg.body.accessToken;

  // 2. Login
  const login = await req('POST', '/api/auth/login', { username: 'SmokeHero', password: 'abc123' });
  if (login.status === 200 && login.body.accessToken) pass('Login');
  else fail('Login', JSON.stringify(login.body));
  const loginToken = login.body.accessToken;

  // 3. Refresh
  const refresh = await req('POST', '/api/auth/refresh');
  if (refresh.status === 200 && refresh.body.accessToken) pass('Token refresh');
  else fail('Token refresh', JSON.stringify(refresh.body));

  // 4. 401 without token
  const unauth = await req('GET', '/api/characters');
  if (unauth.status === 401) pass('401 on unauthenticated request');
  else fail('401 check', `got ${unauth.status}`);

  // 5. Create character
  const char = await req('POST', '/api/characters', { name: 'Draven', class: 'Rogue' }, loginToken);
  if (char.status === 201 && char.body.id) pass(`Create character (id=${char.body.id})`);
  else fail('Create character', JSON.stringify(char.body));
  const charId = char.body.id;

  // Verify starter gear
  if (char.body.equippedWeapon?.name === 'Wooden Sword' && char.body.equippedArmor?.name === 'Leather Armor') {
    pass('Starter gear equipped');
  } else fail('Starter gear', JSON.stringify({ w: char.body.equippedWeapon, a: char.body.equippedArmor }));

  // 6. List characters
  const list = await req('GET', '/api/characters', null, loginToken);
  if (list.status === 200 && Array.isArray(list.body) && list.body.length > 0) pass('List characters');
  else fail('List characters', JSON.stringify(list.body));

  // 7. Start dungeon
  const startDungeon = await req('POST', `/api/game/${charId}/start`, { action: 'dungeon', difficulty: 'easy' }, loginToken);
  if (startDungeon.status === 200 && startDungeon.body.activity === 'dungeon') pass('Start dungeon');
  else fail('Start dungeon', JSON.stringify(startDungeon.body));

  // 8. Tick (XP and HP change noted)
  await new Promise(r => setTimeout(r, 2000)); // wait 2 seconds
  const tick = await req('GET', `/api/game/${charId}/tick`, null, loginToken);
  if (tick.status === 200 && tick.body.xp !== undefined) pass(`Tick (xp=${tick.body.xp}, hp=${tick.body.hp})`);
  else fail('Tick', JSON.stringify(tick.body));

  // 9. Stop dungeon
  const stop = await req('POST', `/api/game/${charId}/stop`, {}, loginToken);
  if (stop.status === 200 && stop.body.activity === null) pass('Stop dungeon');
  else fail('Stop dungeon', JSON.stringify(stop.body));

  // 10. Tavern rest
  const tavern = await req('POST', `/api/game/${charId}/start`, { action: 'tavern' }, loginToken);
  if (tavern.status === 200 && tavern.body.activity === 'tavern') pass('Start tavern rest');
  else fail('Tavern rest', JSON.stringify(tavern.body));

  // 11. Equip item
  const stopTavern = await req('POST', `/api/game/${charId}/stop`, {}, loginToken);
  const equip = await req('PUT', `/api/characters/${charId}/equip`, { slot: 'weapon', item_id: 1 }, loginToken);
  if (equip.status === 200 && equip.body.weapon_id === 1) pass('Equip item');
  else fail('Equip item', JSON.stringify(equip.body));

  // 12. Delete character
  const del = await req('DELETE', `/api/characters/${charId}`, null, loginToken);
  if (del.status === 200 && del.body.ok) pass('Delete character');
  else fail('Delete character', JSON.stringify(del.body));

  // 13. Logout
  const logout = await req('POST', '/api/auth/logout', {});
  if (logout.status === 200) pass('Logout');
  else fail('Logout', JSON.stringify(logout.body));

  console.log('\n=== Done ===\n');
}

run().catch(err => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
