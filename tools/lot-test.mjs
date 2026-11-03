// 주차장 점검: 사고팔고 구난하고 저장을 되살려도 칸 수가 어긋나지 않고 트럭이 멈춰 서지 않는지 본다.
// 사용법: node tools/lot-test.mjs [분]
import fs from 'node:fs';
import { Game } from '../js/game/game.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
let g = new Game(data, { money: 1e15 });
g.applyStage(4, true);
g.regions[4].pts = g.regionGoal(4) * 0.9;
g.updateSiteAvailability(true);
for (const id of ['cargo5', 'trailer', 'express', 'tow']) g.techs.add(id);
const MINUTES = Number(process.argv[2]) || 12;
const DT = 1 / 30;
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const routes = () => [...g.routes.values()].filter((r) => r.valid);
for (const r of routes()) {
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) g.buyTruck(r, Math.floor(rnd() * 4));
}

function check(when) {
  const errs = [];
  for (const s of g.sites) {
    if (s.inbound < 0) errs.push(`${s.name} inbound ${s.inbound}`);
    if (!s.lot) continue;
    const held = s.lot.stalls.filter(Boolean);
    if (held.length !== s.lot.used) errs.push(`${s.name} used ${s.lot.used} != ${held.length}`);
    for (const v of held) {
      if (!g.traffic.vehicles.has(v)) errs.push(`${s.name} 칸에 사라진 트럭`);
      else if (!v.lot || v.lot.site !== s) errs.push(`${s.name} 칸과 트럭이 어긋남 (${v.state})`);
    }
    s.lot.stalls.forEach((v, i) => { if (v && s.lot.blocked[i]) errs.push(`${s.name} 도로 위 칸 사용`); });
  }
  for (const v of g.lotVehicles) {
    if (!v.lot) errs.push('주차장 목록에 칸 없는 트럭');
    if (v.lane || v.conn) errs.push('도로와 주차장에 동시에 있는 트럭');
  }
  // 모든 트럭은 어딘가에 있어야 한다
  let lost = 0;
  for (const v of g.traffic.vehicles) {
    const s = v.leg === 1 ? v.route.to : v.route.from;
    const onRoad = v.lane || v.conn || v.state === 'ship';
    const inSite = v.lot || [v.route.from, v.route.to].some((q) => q.yard.includes(v) || q.exitQ.includes(v) || q.unloadQ.includes(v) || q.loadBays.some((b) => b.v === v) || q.unloadBays.some((b) => b.v === v));
    const onFerry = g.traffic.ferries.some((f) => f.cargo.includes(v) || f.transfer[0].includes(v) || f.transfer[1].includes(v)) || g.traffic.arrivals.some((a) => a.v === v);
    if (!onRoad && !inSite && !onFerry) { lost++; if (lost <= 3) errs.push(`갈 곳 없는 트럭 ${v.state} leg${v.leg} ${s.name}`); }
  }
  console.log(when, `트럭 ${g.truckCount} 배송 ${g.deliveries} 주차 ${g.lotVehicles.size} 이동 ${g.lotMovers.length} 주차장 ${g.sites.filter((s) => s.lot).length}곳`, errs.length ? `오류 ${errs.length}: ${errs.slice(0, 5).join(' / ')}` : '이상 없음');
  return errs.length;
}

let errors = 0;
let lastDeliv = 0;
for (let t = 0, tick = 0; t < MINUTES * 60; t += DT, tick++) {
  g.tick(DT);
  if (tick % 90 === 0) {
    const list = routes();
    const r = list[Math.floor(rnd() * list.length)];
    const roll = rnd();
    if (roll < 0.45) g.buyTruck(r, Math.floor(rnd() * 4));
    else if (roll < 0.8) g.sellTruck(r);
    else {
      const jam = g.jams[0];
      if (jam) g.tow(jam.node, true);
    }
  }
  if (tick % (30 * 60) === 0) {
    errors += check(`${Math.round(t / 60)}분`);
    if (t > 0 && g.deliveries <= lastDeliv) { console.log('배송이 멈췄습니다'); errors++; }
    lastDeliv = g.deliveries;
  }
  if (tick === 30 * 60 * Math.floor(MINUTES / 2)) {
    // 저장했다가 되살려도 그대로 돌아가야 한다
    g = Game.restore(data, JSON.parse(JSON.stringify(g.serialize())));
    g.money = 1e15;
    errors += check('복원 직후');
    lastDeliv = g.deliveries;
  }
}
errors += check('끝');
console.log(errors ? `오류 ${errors}건` : '모두 통과');
process.exit(errors ? 1 : 0);
