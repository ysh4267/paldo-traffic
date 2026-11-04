// 단계별로 모든 거점이 실제로 연결되고 화물을 팔 곳이 있는지 점검한다
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { GOODS } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
const g = new Game(data);
let fails = 0;
for (let stage = 0; stage < g.regions.length; stage++) {
  if (stage > 0) g.applyStage(stage, true);
  // 해당 단계 거점을 모두 연다
  g.regions[stage].pts = g.regionGoal(stage) * 0.999;
  g.updateSiteAvailability(true);
  g.refreshRoutes();
  const avail = g.sites.filter((s) => s.available);
  const noRoute = avail.filter((s) => s.produces && !s.routesOut.some((r) => r.valid));
  const here = avail.filter((s) => s.stage === stage);
  const inOnly = avail.filter((s) => !s.produces && !s.routesIn.some((r) => r.valid));
  const inFact = avail.filter((s) => s.inputs && !s.routesIn.some((r) => r.valid));
  const open = g.net.roads.filter((r) => r.open).length;
  console.log(`\n[${stage}] ${g.regions[stage].short}: 거점 ${avail.length} (신규 ${here.length}) 열린 도로 ${open}/${g.net.roads.length}`);
  fails += noRoute.length + inOnly.length + inFact.length;
  if (noRoute.length) console.log('  판매처 없음:', noRoute.map((s) => `${s.name}(${GOODS[s.goods].name})`).join(', '));
  if (inOnly.length) console.log('  납품 노선 없음:', inOnly.map((s) => s.name).join(', '));
  if (inFact.length) console.log('  원료 공급 없음:', inFact.map((s) => s.name).join(', '));
  const newRoutes = [...g.routes.values()].filter((r) => r.from.stage === stage && r.valid);
  console.log('  신규 노선 예:', newRoutes.slice(0, 6).map((r) => `${r.from.name}→${r.to.name} ${Math.round(r.dist)}km`).join(' | '));
  const invalid = [...g.routes.values()].filter((r) => !r.valid);
  if (invalid.length) console.log('  끊긴 노선:', invalid.slice(0, 8).map((r) => `${r.from.name}→${r.to.name}`).join(' | '));
}
const lens = [...g.routes.values()].filter((r) => r.valid).map((r) => r.dist).sort((a, b) => a - b);
console.log('\n노선', lens.length, '거리 중앙값', Math.round(lens[lens.length >> 1]), '최대', Math.round(lens[lens.length - 1]));
const spurs = g.sites.map((s) => ({ n: s.name, l: s.spurIn ? s.spurIn.road.len : 0 })).sort((a, b) => b.l - a.l).slice(0, 8);
console.log('긴 진입로', spurs.map((s) => `${s.n} ${s.l.toFixed(1)}km`).join(', '));
if (fails) { console.log(`끊긴 거점 ${fails}곳`); process.exit(1); }
