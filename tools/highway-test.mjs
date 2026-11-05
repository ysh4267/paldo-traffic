// 고속도로 점검: 국도로 끊긴 구간이 이어지는지, 노선 전체를 한 번에 넓힐 수 있는지, 모든 트럭을 큰 차종으로 바꿀 수 있는지 본다.
// 사용법: node tools/highway-test.mjs
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { bridgeHighwayGaps, MAX_LANES, BASE_LANES } from '../js/sim/network.js';
import { TRUCKS, TECHS } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
let errors = 0;
const ok = (what, cond, more = '') => {
  console.log(`${cond ? 'OK' : '실패'}  ${what}${more ? ` · ${more}` : ''}`);
  if (!cond) errors++;
};
const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-9 + 1e-6;

// ── 끊긴 구간 ────────────────────────────────────────
{
  const out = bridgeHighwayGaps(data.nodes, data.roads);
  const changed = out.map((d, i) => [d, data.roads[i]]).filter(([p, q]) => p !== q);
  console.log(`  고속도로로 올린 국도 ${changed.length}조각: ${[...new Set(changed.map(([p]) => p.n))].join(', ')}`);
  ok('끊긴 구간을 잇는다', changed.length >= 10);
  for (const [p, q] of changed) console.log(`    ${q.n}${q.lock ? '(미건설)' : ''} ${q.a}-${q.b} → ${p.n}`);
  ok('국도와 미건설 구간만 올린다', changed.every(([p, q]) => (q.k === 'n' || q.lock) && p.k === 'x' && !p.lock && p.a === q.a && p.b === q.b));
  ok('원본 자료를 고치지 않는다', data.roads.every((d) => d.k !== 'x' || d.n));
  ok('공사로 잠긴 도로의 이름으로 잇지 않는다', changed.every(([p]) => !data.roads.some((d) => d.k === 'x' && d.n === p.n && d.lock && (d.a === p.a || d.b === p.a || d.a === p.b || d.b === p.b))));
  ok('다시 돌려도 같다', bridgeHighwayGaps(data.nodes, out).every((d, i) => d.k === out[i].k && d.n === out[i].n));

  // 경부고속도로는 원래 5조각이고 국도와 미건설 구간으로 끊겨 있었다
  const pieces = (roads, name) => {
    const list = roads.filter((d) => d.k === 'x' && d.n === name);
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const d of list) { for (const e of [d.a, d.b]) if (!parent.has(e)) parent.set(e, e); parent.set(find(d.a), find(d.b)); }
    return new Set([...parent.keys()].map(find)).size;
  };
  const before = pieces(data.roads, '경부고속도로'), after = pieces(out, '경부고속도로');
  ok('경부고속도로가 한 줄로 이어진다', before === 5 && after === 1, `${before} → ${after}묶음`);
  const g = new Game(data);
  const road = g.net.roads.find((r) => data.roads[r.id].k === 'n' && r.kind === 'x');
  ok('올린 도로는 고속도로로 달린다', road.lanes === BASE_LANES.x && road.name && road.ref);
  const left = data.projects.filter((p) => g.projById.get(p.id).roads.length === 0).map((p) => p.id);
  ok('건설 공사가 통째로 사라지지 않는다', left.every((id) => !data.roads.some((d) => d.lock === id)), left.join());
  const unlocked = g.net.roads.filter((r) => data.roads[r.id].lock && !r.lock);
  ok('미건설에서 풀린 구간은 처음부터 지어져 있다', unlocked.every((r) => r.built));
}

// ── 노선 전체 넓히기 ─────────────────────────────────
{
  const g = new Game(data, { money: 1e16 });
  g.applyStage(g.regions.length - 1, true);
  g.updateSiteAvailability(true);
  const r = g.net.roads.find((q) => q.kind === 'x' && q.name === '경부고속도로' && q.open);
  const all = g.highwayRoads(r);
  ok('같은 이름의 열린 구간을 모은다', all.length > 20 && all.every((q) => q.name === r.name && q.open));
  const before = g.money, plan = g.planHighway(r);
  ok('한 차로 넓게 계획한다', plan.target === 3 && plan.all === all.length && plan.n === plan.all && plan.buy.length === plan.n);
  ok('값은 구간 값의 합이다', near(plan.cost, all.reduce((s, q) => s + g.lanePrice(q), 0)));
  const got = g.buyHighway(r);
  ok('전 구간이 넓어진다', got.n === all.length && all.every((q) => q.lanes === 3));
  ok('돈이 그만큼 줄어든다', near(g.money, before - plan.cost));

  // 먼저 넓혀 둔 구간이 있으면 좁은 곳만 맞춘다
  g.addLane(all[0]);
  const wider = g.planHighway(r);
  ok('이미 넓은 구간은 건너뛴다', wider.target === 4 && wider.all === all.length - 1 && !wider.buy.includes(all[0]));

  // 최대 차로면 더 계획하지 않는다
  for (const q of all) g.net.setLanes(q, MAX_LANES.x);
  ok('최대 차로면 살 것이 없다', g.planHighway(r).target === 0 && g.buyHighway(r).n === 0);
}
{
  // 돈이 모자라면 고른 구간에서 가까운 곳부터 빈틈없이 산다
  const g = new Game(data, { money: 0 });
  g.applyStage(g.regions.length - 1, true);
  const r = g.net.roads.find((q) => q.kind === 'x' && q.name === '경부고속도로' && q.open);
  const whole = g.planHighway(r);
  g.money = whole.full * 0.3;
  const part = g.planHighway(r);
  const mid = (q) => [(q.bb[0] + q.bb[2]) / 2, (q.bb[1] + q.bb[3]) / 2];
  const dist = (q) => Math.hypot(mid(q)[0] - mid(r)[0], mid(q)[1] - mid(r)[1]);
  const farthestBought = Math.max(...part.buy.map(dist));
  const skipped = whole.buy.filter((q) => !part.buy.includes(q));
  ok('돈이 닿는 만큼만 산다', part.n > 0 && part.n < part.all && part.cost <= g.money);
  ok('먼 곳을 먼저 사지 않는다', skipped.every((q) => dist(q) >= farthestBought));
  ok('국도는 노선 넓히기가 없다', g.planHighway(g.net.roads.find((q) => q.kind === 'n')).target === 0);
}

// ── 모든 트럭을 큰 차종으로 ──────────────────────────
{
  const g = new Game(data, { money: 1e15 });
  g.applyStage(3, true);
  g.updateSiteAvailability(true);
  ok('처음에는 1톤뿐이다', g.topModel() === 0);
  g.techs.add('cargo5');
  ok('5톤을 연구하면 5톤', TRUCKS[g.topModel()].id === 'cargo');
  g.techs.add('express');
  ok('특송보다 많이 싣는 차종이 없으면 특송', TRUCKS[g.topModel()].id === 'express');
  g.techs.add('trailer');
  ok('트레일러가 가장 위다', TRUCKS[g.topModel()].id === 'trailer');
  const routes = [...g.routes.values()].filter((q) => q.valid).slice(0, 8);
  for (const q of routes) for (let i = 0; i < 6; i++) g.buyTruck(q, i % 2);
  const to = g.topModel();
  const plan = g.planConvert(routes, to);
  ok('모든 트럭을 계획한다', plan.all === 48 && plan.n === 48 && plan.k === routes.length * 1);
  for (const q of routes) g.convertTrucks(q, to);
  const left = routes.flatMap((q) => q.trucks).filter((v) => !v.retire && (v.nextModel ?? v.modelIdx) !== to);
  ok('남는 트럭은 모두 새 차종이다', left.length === 0, `${routes.reduce((s, q) => s + q.trucks.length, 0)}대`);
  ok('더 바꿀 트럭이 없다', g.planConvert(routes, to).all === 0);
  ok('연구 목록이 그대로다', TECHS.some((t) => t.id === 'trailer'));
}

console.log(errors ? `실패 ${errors}건` : '모두 통과');
process.exit(errors ? 1 : 0);
