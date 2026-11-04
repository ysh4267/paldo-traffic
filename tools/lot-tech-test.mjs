// 주차 유도 시스템 점검: 표시한 만큼 입출차 시간이 줄고, 속도가 끊기지 않고, 저장과 환생에도 이어지는지 본다
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { TECHS, UPGRADES } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'OK ' : '실패'} ${name} ${extra}`); };
const seed = (n) => { let q = n; Math.random = () => { q = (q * 1664525 + 1013904223) >>> 0; return q / 4294967296; }; };
const u = UPGRADES.find((q) => q.id === 'lot');

function setup(level, stage = 4) {
  seed(7);
  const g = new Game(data, { money: 1e16 });
  g.applyStage(stage, true);
  g.regions[stage].pts = g.regionGoal(stage) * 0.5;
  g.updateSiteAvailability(true);
  g.refreshRoutes();
  for (const t of TECHS) g.techs.add(t.id);
  for (let i = 0; i < level; i++) g.buyUpg('lot');
  for (const s of g.sites) if (s.available) { s.bays = 12; s.stock = 1e6; }
  g.siteCap = () => 1e9;
  return g;
}

// 빈 주차장에서 트럭 한 대가 드나드는 데 걸리는 시간
function lone(level) {
  const g = setup(level);
  const A = g.sites.find((s) => s.name === '나주 배밭');
  const r = A.routesOut.find((q) => q.valid);
  const v = g.addTruck(r, 0, 0);
  const span = { in: [], out: [] };
  let was = null, t0 = 0, jump = 0, jumpAt = 0, last = v.v;
  for (let i = 0; i < 30 * 200; i++) {
    g.tick(1 / 30);
    const inLot = v.lot && v.state === 'lot' ? v.lot.phase : null;
    const cur = inLot === 'in' ? 'in' : inLot === 'back' || inLot === 'out' || inLot === 'exit' ? 'out' : null;
    if (cur !== was) {
      if (was && span[was]) span[was].push(g.time - t0);
      t0 = g.time;
      was = cur;
    }
    // 차로에 들어선 바로 뒤의 속도. 주차장 안 속도 기준으로 바뀌지 않았는지 본다
    if (v.lane && last !== null && !jumpAt && v.s < 0.4 && v.pi === 0) { jump = v.v; jumpAt = 1; }
    if (!v.lane) jumpAt = 0;
    last = v.v;
  }
  const avg = (a) => (a.length ? a.reduce((s, q) => s + q, 0) / a.length : NaN);
  return { in: avg(span.in), out: avg(span.out), n: span.in.length, jump, g, r, v };
}

const base = lone(0), half = lone(5), top = lone(10);
console.log(`트럭 한 대: 들어가기 ${base.in.toFixed(2)}초 → 5단계 ${half.in.toFixed(2)}초 → 10단계 ${top.in.toFixed(2)}초 / 나오기 ${base.out.toFixed(2)}초 → ${half.out.toFixed(2)}초 → ${top.out.toFixed(2)}초`);
ok('표시와 같다: 들어가는 시간 10단계', Math.abs(top.in / base.in - 0.5) < 0.12, (top.in / base.in).toFixed(2));
ok('표시와 같다: 나오는 시간 10단계', Math.abs(top.out / base.out - 0.5) < 0.12, (top.out / base.out).toFixed(2));
ok('표시와 같다: 나오는 시간 5단계', Math.abs(half.out / base.out - 0.75) < 0.1, (half.out / base.out).toFixed(2));

// 큰길로 나오는 속도와 평소 시간
ok('10단계에서도 나온 트럭이 제한 속도를 넘지 않는다', top.jump <= top.r.pathTo[0].speed * top.v.speedF + 0.15, `${top.jump.toFixed(2)} / ${(top.r.pathTo[0].speed * top.v.speedF).toFixed(2)}`);
for (const [name, q] of [['0단계', base], ['10단계', top]]) {
  const j = q.g.routeJam(q.r);
  ok(`${name} 빈 길은 막히지 않는다`, j.to.ratio < 1.3 && j.back.ratio < 1.3, `가는 길 ${j.to.ratio.toFixed(2)}배, 돌아오는 길 ${j.back.ratio.toFixed(2)}배`);
}

// 값
{
  const g = setup(0);
  const c0 = g.upgradeCostOf('lot'), m0 = g.money;
  ok('처음 값', c0 === u.base);
  ok('사면 돈이 줄고 배수가 오른다', g.buyUpg('lot') && g.money === m0 - c0 && Math.abs(g.lotF - 1 / 0.95) < 1e-9);
  for (let i = 1; i < u.max; i++) g.buyUpg('lot');
  ok('최고 단계에서 두 배', Math.abs(g.lotF - 2) < 1e-9, `${g.lotF}`);
  ok('더 살 수 없다', !g.buyUpg('lot') && g.upg.lot === u.max);
  ok('글자', u.fmt(u.max * u.per) === '입출차 시간 −50%', u.fmt(u.max * u.per));
}

// 많이 몰아도 멈추지 않고 주차장 규칙이 지켜지는지
function run(level) {
  const g = setup(level);
  const A = g.sites.find((s) => s.name === '광주 식품공장');
  const local = [...g.routes.values()].filter((r) => r.valid && r.from.available && r.to.available && (r.from === A || r.to === A));
  for (const r of local) for (let k = 0; k < 6; k++) g.addTruck(r, k % 2, 0);
  for (let i = 0; i < 30 * 60; i++) g.tick(1 / 30);
  const d0 = g.deliveries;
  let wait = 0, n = 0, errs = 0;
  for (let i = 0; i < 30 * 180; i++) {
    g.tick(1 / 30);
    if (i % 30) continue;
    for (const s of g.sites) {
      if (!s.lot) continue;
      wait += s.lot.waiting;
      n++;
      if (s.lot.used !== s.lot.stalls.filter(Boolean).length || s.lot.waiting < 0) errs++;
    }
  }
  return { per: (g.deliveries - d0) / 3, errs, trucks: g.truckCount, wait: wait / n, stop: g.movingStats() };
}
const r0 = run(0), r10 = run(10);
console.log(`트럭 ${r0.trucks}대: 분당 배송 ${r0.per.toFixed(0)} → ${r10.per.toFixed(0)}, 후진 대기 ${r0.wait.toFixed(3)} → ${r10.wait.toFixed(3)}, 선 트럭 ${r0.stop.stopped}/${r0.stop.onRoad} → ${r10.stop.stopped}/${r10.stop.onRoad}`);
ok('주차장 칸 수가 어긋나지 않는다', !r0.errs && !r10.errs);
ok('10단계에서 배송이 줄지 않는다', r10.per >= r0.per * 0.97);

// 저장
{
  const g = setup(3);
  const save = JSON.parse(JSON.stringify(g.serialize()));
  const a = Game.restore(data, save);
  ok('저장을 열어도 단계와 배수가 이어진다', a.upg.lot === 3 && Math.abs(a.lotF - 1 / 0.85) < 1e-9 && a.traffic.lotF === a.lotF);
  delete save.upg.lot;
  const b = Game.restore(data, save);
  ok('이 연구가 없던 저장은 0단계로 열린다', b.upg.lot === 0 && b.lotF === 1);
}
// 환생
{
  const fresh = Game.freshSave({ runs: 1, fame: 0, earned: 0, best: {}, total: 0, perks: { study: 2 } });
  const g = Game.restore(data, fresh);
  ok('연구 유산이 입출차에도 듣는다', g.upg.lot === 2 && Math.abs(g.lotF - 1 / 0.9) < 1e-9);
}
console.log(fails ? `실패 ${fails}건` : '모두 통과');
process.exit(fails ? 1 : 0);
