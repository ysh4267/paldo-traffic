// 트럭 전환 점검: 나르는 양은 그대로 두고 대수만 줄어드는지, 사라지는 트럭이 말썽을 일으키지 않는지 본다.
// 사용법: node tools/convert-test.mjs
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { TRUCKS } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'OK ' : '실패'} ${name} ${extra}`);
};
let seed = 2026;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const run = (g, sec) => { for (let i = 0; i < sec * 30; i++) g.tick(1 / 30); };
const T1 = 0, T5 = 1, T25 = 2, FAST = 3;

const fresh = () => {
  const g = new Game(data, { money: 1e15 });
  g.applyStage(2, true);
  g.regions[2].pts = g.regionGoal(2) * 0.5;
  g.updateSiteAvailability(true);
  for (const id of ['cargo5', 'trailer', 'express']) g.techs.add(id);
  return g;
};
const pick = (g) => [...g.routes.values()].filter((r) => r.valid && !r.from.inputs && r.from.available && r.to.available).sort((a, b) => a.dist - b.dist)[0];
const tons = (r) => r.trucks.reduce((s, v) => s + TRUCKS[v.nextModel ?? v.modelIdx].cap, 0);
const fill = (g, r, model, n) => { for (let i = 0; i < n; i++) g.buyTruck(r, model); };

// ── 대수 ──────────────────────────────────────────────
for (const [from, count, to, want, name] of [
  [T1, 5, T5, 1, '1톤 5대 → 5톤 1대'],
  [T1, 14, T5, 3, '1톤 14대 → 5톤 3대'],
  [T1, 25, T25, 1, '1톤 25대 → 25톤 1대'],
  [T5, 5, T25, 1, '5톤 5대 → 25톤 1대'],
  [T1, 8, FAST, 1, '1톤 8대 → 특송 1대'],
  [T5, 8, FAST, 5, '5톤 8대 → 특송 5대'],
  [T1, 3, T5, 1, '1톤 3대 → 5톤 1대'],
]) {
  const g = fresh(), r = pick(g);
  fill(g, r, from, count);
  const before = tons(r), m0 = g.money;
  const plan = g.planConvert([r], to);
  const out = g.convertTrucks(r, to);
  ok(name, r.trucks.length === want && out.n === count && out.k === want, `${r.trucks.length}대`);
  ok('  나르는 양이 줄지 않는다', tons(r) >= before && tons(r) < before + TRUCKS[to].cap, `${before}t → ${tons(r)}t`);
  ok('  값을 낸다', out.paid > 0 && Math.abs(m0 - g.money - out.paid) < 1, `₩${Math.round(out.paid).toLocaleString('en-US')}`);
  ok('  계획과 같다', plan.n === out.n && plan.k === out.k && Math.abs(plan.cost - out.paid) < 1);
  ok('  모두 새 차종이다', r.trucks.every((v) => (v.nextModel ?? v.modelIdx) === to));
}

// ── 일부만 ────────────────────────────────────────────
{
  const g = fresh(), r = pick(g);
  fill(g, r, T1, 14);
  const out = g.convertTrucks(r, T5, 1);
  ok('한 대만 만들면 5대만 쓴다', out.k === 1 && out.n === 5 && r.trucks.length === 10, `${r.trucks.length}대`);
  ok('나머지는 그대로다', r.trucks.filter((v) => (v.nextModel ?? v.modelIdx) === T1).length === 9);
  const g2 = fresh(), r2 = pick(g2);
  fill(g2, r2, T1, 14);
  const whole = g2.convertPlan(r2, T5);
  g2.money = g2.convertPlan(r2, T5, 1).cost * 1.2;
  ok('(돈이 정말 모자란 경우다)', g2.money < whole.cost);
  const plan = g2.planConvert([r2], T5);
  const got = g2.convertTrucks(r2, T5);
  ok('돈이 모자라면 닿는 만큼만', got.k >= 1 && got.k < whole.keep && g2.money >= 0, `${got.n}대 → ${got.k}대`);
  ok('계획도 같다', plan.n === got.n && plan.k === got.k && Math.abs(plan.cost - got.paid) < 1);
  const g3 = fresh(), r3 = pick(g3);
  fill(g3, r3, T1, 14);
  g3.money = 1;
  ok('한 푼도 없으면 그대로다', g3.convertTrucks(r3, T5).n === 0 && r3.trucks.length === 14);
  const g4 = fresh(), r4 = pick(g4);
  fill(g4, r4, T25, 3);
  ok('더 작은 차로는 바꾸지 않는다', g4.convertTrucks(r4, T5).n === 0 && r4.trucks.length === 3);
}

// ── 달리는 중에 ───────────────────────────────────────
{
  const g = fresh(), r = pick(g);
  fill(g, r, T1, 25);
  run(g, 60);
  const paid0 = g.deliveries;
  const onRoad = r.trucks.filter((v) => v.lane || v.conn).length;
  const out = g.convertTrucks(r, T25);
  ok('달리는 트럭이 있어도 대수는 바로 준다', out.k === 1 && r.trucks.length === 1 && onRoad > 0, `달리던 트럭 ${onRoad}대`);
  ok('사라질 트럭은 도로에 남아 있다', g.truckCount > 1, `${g.truckCount}대`);
  run(g, 150);
  ok('사라질 트럭은 다음 거점에서 사라진다', g.truckCount === 1, `${g.truckCount}대`);
  ok('싣고 있던 짐은 내려놓는다', g.deliveries > paid0, `배송 ${paid0} → ${g.deliveries}`);
  ok('줄과 칸에 남은 흔적이 없다', [...g.sites].every((s) => s.yard.every((v) => g.traffic.vehicles.has(v)) && s.exitQ.every((v) => g.traffic.vehicles.has(v)) && s.unloadQ.every((v) => g.traffic.vehicles.has(v))));
  ok('입장 수가 어긋나지 않는다', g.sites.every((s) => s.inbound >= 0));
  const left = r.trucks[0];
  ok('남은 트럭이 새 차종으로 달린다', left.modelIdx === T25 && left.model === TRUCKS[T25], left.model.short);
  const d0 = r.delivered;
  run(g, 120);
  ok('새 트럭이 계속 나른다', r.delivered > d0, `${d0}t → ${r.delivered}t`);
}

// ── 저장 ──────────────────────────────────────────────
{
  const g = fresh(), r = pick(g);
  fill(g, r, T1, 10);
  run(g, 40);
  g.convertTrucks(r, T5);
  const save = JSON.parse(JSON.stringify(g.serialize()));
  const h = Game.restore(data, save);
  const q = h.routes.get(r.id);
  ok('저장해도 줄어든 대수가 남는다', q.trucks.length === 2 && q.trucks.every((v) => v.modelIdx === T5), `${q.trucks.length}대`);
  run(h, 60);
  ok('되살린 뒤에도 잘 달린다', h.truckCount === 2);
}

// ── 팔기 ──────────────────────────────────────────────
{
  const g = fresh(), r = pick(g);
  fill(g, r, T1, 6);
  run(g, 30);
  while (r.trucks.length) g.sellTruck(r);
  run(g, 120);
  ok('판 트럭도 모두 사라진다', g.truckCount === 0, `${g.truckCount}대`);
}

console.log(fails ? `실패 ${fails}건` : '모두 통과');
process.exit(fails ? 1 : 0);
