// 환생 점검: 무엇이 초기화되고 무엇이 남는지, 명성 보너스가 값에 제대로 들어가는지, 저장을 되살려도 그대로인지 본다.
// 사용법: node tools/rebirth-test.mjs
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { TECHS, UPGRADES, PERKS, TRUCKS, TOOL_PRICE, START_MONEY, FAME_BASE, FAME_REF, fmtWon } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
let errors = 0;
const ok = (what, cond, more = '') => {
  console.log(`${cond ? 'OK' : '실패'}  ${what}${more ? ` · ${more}` : ''}`);
  if (!cond) errors++;
};
const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-9 + 1e-6;
const roundtrip = (save) => Game.restore(data, JSON.parse(JSON.stringify(save)));
const DT = 1 / 30;
const run = (g, sec) => { for (let i = 0; i < sec * 30; i++) g.tick(DT); };

// 다 키운 회차를 만든다
function grown(legacy) {
  const g = new Game(data, { money: 1e15, legacy });
  g.applyStage(g.regions.length - 1, true);
  g.updateSiteAvailability(true);
  for (const t of TECHS) g.techs.add(t.id);
  for (const u of UPGRADES) g.upg[u.id] = 3;
  const list = [...g.routes.values()].filter((r) => r.valid);
  for (const r of list.slice(0, 120)) g.buyTruck(r, 1);
  const nodes = g.net.nodes.filter((n) => !n.terminal && n.inE.length >= 2);
  g.setControl(nodes[3], 'signal');
  g.setControl(nodes[9], 'roundabout');
  g.setControl(nodes[15], 'interchange');
  const road = g.net.roads.find((r) => r.kind === 'n' && g.canAddLane(r));
  g.addLane(road);
  const signEdge = nodes[20].inE[0];
  g.setSign(signEdge, 1);
  const project = g.projects.find((p) => g.projectAvailable(p));
  if (project) g.buildProject(project);
  run(g, 20);
  g.flags.openAt = 7000;
  g.endless = 2;
  return { g, nodes, road, signEdge, project };
}

// ── 값 ───────────────────────────────────────────────
{
  const g = new Game(data);
  const first = g.rebirthSave();
  ok('처음부터 환생할 수 있지만 받는 명성은 0', first.legacy.runs === 1 && first.legacy.fame === 0);
  const byRegion = g.regions.map((_, i) => g.fameFromRegions(i)).join();
  ok('권역을 더 열수록 명성이 커진다', byRegion === '0,1,3,6,10,15,21,28,36', byRegion);
  g.applyStage(g.regions.length - 2, true);
  ok('권역을 다 열기 전에 환생해도 연 만큼 받는다', g.rebirthSave().legacy.fame === 28);
  g.time = 1234;
  g.applyStage(g.regions.length - 1);
  ok('마지막 권역을 열면 시각이 남는다', g.flags.openAt === 1234);
  g.totalEarned = FAME_REF;
  ok('번 돈과 연 권역의 명성을 더한다', g.fameFromMoney() === FAME_BASE && g.fameGain() === FAME_BASE + 36);
  g.totalEarned = 0;
  g.applyStage(0, true);
  g.totalEarned = FAME_REF;
  ok('FAME_REF를 벌면 명성 FAME_BASE', g.fameGain() === FAME_BASE, `${fmtWon(FAME_REF)} → ${g.fameGain()}`);
  const before = g.fameGain();
  g.totalEarned += g.fameNext();
  ok('명성 1을 더 받는 데 필요한 돈이 맞다', g.fameGain() === before + 1);
  g.totalEarned = 0;
  ok('아무것도 안 벌면 명성 0', g.fameGain() === 0);
}

{
  const route = () => [...g.routes.values()][0];
  const g = new Game(data, { legacy: { perks: { truck: 10, build: 5, pay: 3, rate: 4, pts: 2, offline: 2, fame: 1 } } });
  const r = route();
  ok('트럭값 −30%', near(g.truckPrice(r, 0), TRUCKS[0].price * 0.7));
  ok('한꺼번에 사는 값도 같은 비율', near(g.truckBatchPrice(r, 0, 3), new Game(data).truckBatchPrice(route.call ? [...new Game(data).routes.values()][0] : r, 0, 3) * 0.7));
  const node = g.net.nodes.find((n) => !n.terminal && n.inE.length >= 2);
  ok('입체교차로 −20%', near(g.controlPrice(node, 'interchange'), TOOL_PRICE.interchange * 0.8));
  ok('양보 표지 −20%', near(g.signPrice(node.inE[0], 1), TOOL_PRICE.yield * 0.8));
  ok('납품가 ×1.3', near(g.payMult(), 1.3));
  const base = new Game(data);
  const s = g.sites.find((q) => q.available && q.produces);
  ok('생산 +20%', near(g.siteRate(s), base.siteRate(base.siteById.get(s.id)) * 1.2));
  g.income = 100;
  const off = g.applyOffline(100);
  ok('자리 비운 수익 70%', near(off.earned, 100 * 100 * 0.7), `${off.share}`);
  g.totalEarned = FAME_REF;
  ok('명성 +10%', g.fameGain() === Math.floor(FAME_BASE * 1.1));
}

{
  const g = new Game(data, { legacy: { fame: 0, total: 50, perks: {} } });
  ok('모은 명성 50이면 납품 대금 ×1.5', near(g.payMult(), 1.5));
  ok('모은 명성 50이면 납품 실적 ×1.5', near(g.ptsMult(), 1.5));
  const h = new Game(data, { legacy: { fame: 0, total: 50, perks: { pay: 2, pts: 3 } } });
  ok('보너스와 곱해진다', near(h.payMult(), 1.5 * 1.2) && near(h.ptsMult(), 1.5 * 1.3));
}

// ── 상점 ─────────────────────────────────────────────
{
  const g = new Game(data, { legacy: { fame: 3 } });
  ok('명성이 모자라면 못 산다', !g.buyPerk('roads') && g.legacy.fame === 3);
  const c = g.perkCost('pay');
  ok('사면 명성이 줄고 단계가 오른다', g.buyPerk('pay') && g.legacy.fame === 3 - c && g.perk('pay') === 1);
  g.legacy.fame = 1e6;
  const roads = PERKS.find((p) => p.id === 'roads');
  ok('최고 단계를 넘겨 살 수 없다', g.buyPerk('roads') && !g.buyPerk('roads') && g.perk('roads') === roads.max);
  ok('없는 보너스는 못 산다', !g.buyPerk('nope'));
  for (const p of PERKS) {
    const text = p.fmt(1) + p.fmt(p.endless ? 999 : p.max);
    if (!text || text.includes('undefined') || text.includes('NaN')) ok(`${p.name} 문구`, false, text);
  }
  ok('보너스 문구가 모든 단계에서 멀쩡하다', true);
}

// ── 끝없는 보너스 ────────────────────────────────────
{
  const g = new Game(data, { legacy: { fame: 1e300 } });
  const endless = PERKS.filter((p) => p.endless);
  ok('최고 단계가 없는 보너스가 있다', endless.length >= 3 && endless.every((p) => p.max === Infinity));
  for (const p of endless) for (let i = 0; i < 300; i++) g.buyPerk(p.id);
  ok('300단계까지 계속 살 수 있다', endless.every((p) => g.perk(p.id) === 300));
  ok('납품 대금과 실적이 곱으로 오른다', near(g.payMult(), Math.pow(1.05, 300)) && near(g.ptsMult(), Math.pow(1.05, 300)));
  ok('적재량이 오른다', near(g.truckCap(TRUCKS[0]), TRUCKS[0].cap * 16));
  ok('트럭값과 공사비가 0이 되지 않는다', near(g.modelPrice(0), TRUCKS[0].price / 13) && near(g.buildMult(), 1 / 13));
  g.totalEarned = FAME_REF;
  ok('환생 때 얻는 명성이 오른다', g.fameGain() === FAME_BASE * 16);
  const n = roundtrip(g.rebirthSave());
  ok('환생해도 단계가 남는다', endless.every((p) => n.perk(p.id) === 300));
}

// 적재량이 창고보다 훨씬 커도 트럭이 영영 기다리지 않는다
{
  const g = new Game(data, { money: 1e15, legacy: { perks: { load: 400 } } });
  g.techs.add('trailer');
  const r = [...g.routes.values()].filter((q) => q.valid).sort((a, b) => a.dist - b.dist)[0];
  g.buyTruck(r, 2);
  const big = g.truckCap(TRUCKS[2]) * 0.25 > g.siteCap(r.from);
  run(g, 120);
  ok('창고보다 큰 트럭도 납품한다', big && g.deliveries > 0, `${g.deliveries}회`);
}

// ── 환생 ─────────────────────────────────────────────
{
  const { g } = grown({ fame: 5, total: 40, runs: 1, earned: 1000, best: { time: 99999 }, perks: { pay: 2, seed: 3, tech: 4, study: 2 } });
  g.totalEarned = FAME_REF * 4;
  const gain = g.fameGain();
  const earned = g.totalEarned, openAt = g.flags.openAt;
  const n = roundtrip(g.rebirthSave());
  ok('명성이 쌓인다', n.legacy.fame === 5 + gain && n.legacy.total === 40 + gain, `+${gain}`);
  ok('회차와 번 돈 기록이 쌓인다', n.legacy.runs === 2 && n.legacy.earned === 1000 + earned);
  ok('최단 기록을 고친다', n.legacy.best.time === Math.min(99999, openAt) && n.legacy.best.boom === 2);
  ok('보너스가 남는다', n.perk('pay') === 2 && n.perk('seed') === 3);
  ok('시작 자금 ×8', near(n.money, START_MONEY * 8));
  ok('권역이 처음으로 돌아간다', n.stage === 0 && n.regions.every((r) => r.pts === 0) && !n.allUnlocked);
  ok('완성 표시와 붐 단계가 풀린다', !n.flags.allDone && n.endless === 0 && n.endlessPts === 0);
  ok('트럭과 노선이 비었다', n.truckCount === 0 && [...n.routes.values()].every((r) => !r.trucks.length && !r.earned));
  ok('번 돈과 시간이 0', n.totalEarned === 0 && n.time === 0 && n.deliveries === 0);
  ok('기술 이전 4개', n.techs.size === 4 && TECHS.slice(0, 4).every((t) => n.techs.has(t.id)));
  ok('연구 2단계로 시작', UPGRADES.every((u) => n.upg[u.id] === 2));
  ok('거점이 처음 것만 열렸다', n.sites.filter((s) => s.available).every((s) => s.stage === 0 && s.level === 0));
  ok('교통 시설이 비었다', n.net.nodes.every((q) => q.control === 'auto') && n.net.edges.every((e) => !e.sign));
  ok('차로가 처음으로', n.net.roads.every((r) => r.lanes === (r.kind === 'x' ? 2 : 1)));
  ok('대교가 안 지어졌다', n.projects.every((p) => !p.built));
  ok('튜토리얼이 안 나온다', !n.flags.tutorial);

  // 새 회차가 실제로 돌아가는지
  const r0 = [...n.routes.values()].filter((r) => r.valid).sort((a, b) => a.dist - b.dist)[0];
  for (let i = 0; i < 4; i++) n.buyTruck(r0, 0);
  run(n, 120);
  ok('새 회차에서 납품이 된다', n.deliveries > 0 && n.totalEarned > 0, `${n.deliveries}회 ${fmtWon(n.totalEarned)}`);
  ok('새 트럭도 엔진 튜닝을 받는다', r0.trucks.every((v) => near(v.speedF, v.model.speed * (1 + n.upg.speed * 0.05))));

  // 저장을 되살려도 명성이 그대로
  const again = roundtrip(n.serialize());
  ok('회차 중 저장을 되살려도 명성과 보너스가 남는다', again.legacy.fame === n.legacy.fame && again.perk('pay') === 2 && again.legacy.runs === 2);
}

// ── 도로 유산 ────────────────────────────────────────
{
  const { g, nodes, road, signEdge, project } = grown({ perks: { roads: 1 } });
  const n = roundtrip(g.rebirthSave());
  ok('교차로가 남는다', n.net.nodes[nodes[3].id].control === 'signal' && n.net.nodes[nodes[9].id].control === 'roundabout' && n.net.nodes[nodes[15].id].control === 'interchange');
  ok('차로가 남는다', n.net.roads[road.id].lanes === road.lanes);
  ok('표지가 남는다', n.net.edges[signEdge.id].sign === 1);
  if (project) ok('대교가 남는다', n.projById.get(project.id).built);
  ok('그래도 트럭과 권역은 처음으로', n.truckCount === 0 && n.stage === 0);
  const r0 = [...n.routes.values()].filter((r) => r.valid).sort((a, b) => a.dist - b.dist)[0];
  for (let i = 0; i < 4; i++) n.buyTruck(r0, 0);
  run(n, 60);
  ok('시설이 남은 채로 잘 돌아간다', n.deliveries > 0, `${n.deliveries}회`);
  n.regions[0].pts = n.regionGoal(0);
  n.checkProgress();
  run(n, 5);
  ok('다음 권역을 열어도 멀쩡하다', n.stage === 1);
}

// ── 예전 저장 ────────────────────────────────────────
{
  const g = new Game(data);
  const save = JSON.parse(JSON.stringify(g.serialize()));
  delete save.legacy;
  const n = Game.restore(data, save);
  ok('명성이 없던 저장도 열린다', n.legacy.fame === 0 && n.legacy.runs === 0 && n.perk('pay') === 0);
  ok('보너스 없는 값은 그대로', near(n.payMult(), 1) && near(n.ptsMult(), 1) && near(n.buildMult(), 1) && near(n.modelPrice(0), TRUCKS[0].price));
}

// 자동 배차를 켜 둔 예전 저장
{
  const g = new Game(data);
  const r = [...g.routes.values()].filter((q) => q.valid).sort((a, b) => a.dist - b.dist)[0];
  const save = JSON.parse(JSON.stringify(g.serialize()));
  save.techs = [...save.techs, 'autobuy'];
  save.routes = [{ id: r.id, m: [0, 0], p: [100, 100], e: 5, d: 1, a: 1, sel: 2 }];
  save.legacy = { perks: { tech: 12 } };
  const n = Game.restore(data, save);
  n.money = 1e18;
  run(n, 30);
  ok('자동 배차 저장이 열리고 트럭이 저절로 늘지 않는다', n.routes.get(r.id).trucks.length === 2);
  ok('자동 배차 연구가 없다', !TECHS.some((t) => t.id === 'autobuy'));
  ok('다시 저장하면 자동 배차가 남지 않는다', n.serialize().routes.every((q) => !('a' in q) && !('sel' in q)));
  ok('기술 이전을 12단계 사 둔 저장도 값이 맞다', Game.freshSave(save.legacy).techs.length === TECHS.length);
}

console.log(errors ? `실패 ${errors}건` : '모두 통과');
process.exit(errors ? 1 : 0);
