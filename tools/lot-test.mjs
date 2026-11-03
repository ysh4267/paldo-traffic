// 주차장 점검: 사고팔고 구난하고 저장을 되살려도 칸 수가 어긋나지 않고 트럭이 멈춰 서지 않으며, 안에서 움직이는 트럭끼리 겹치지 않는지 본다.
// 사용법: node tools/lot-test.mjs [분]
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { TRUCKS } from '../js/game/defs.js';

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

// 지난 점검 때 주차장 통로에 있던 트럭의 위치
let lastPos = new Map();

function check(when) {
  const errs = [];
  const pos = new Map();
  for (const v of g.lotVehicles) {
    const L = v.lot;
    if (L.phase !== 'in') continue;
    pos.set(v, L.s);
    if (lastPos.has(v) && Math.abs(lastPos.get(v) - L.s) < 0.01) errs.push(`${L.site.name} 통로에서 움직이지 않는 트럭`);
  }
  lastPos = pos;
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
    for (const v of s.lot.active) {
      if (!v.lot || v.lot.site !== s || !v.lot.active) errs.push(`${s.name} 움직이는 트럭 목록이 어긋남`);
    }
    let waiting = 0;
    for (const v of g.lotVehicles) if (v.lot.site === s && v.lot.phase === 'back' && !v.lot.go) waiting++;
    if (waiting !== s.lot.waiting) errs.push(`${s.name} 후진 대기 수 ${s.lot.waiting} != ${waiting}`);
  }
  for (const v of g.traffic.vehicles) {
    if (v.len !== v.model.len) errs.push('트럭 길이와 차종이 어긋남');
    if (v.model !== TRUCKS[v.modelIdx]) errs.push('트럭 차종 번호가 어긋남');
    if (v.nextModel !== null && v.lot && v.lot.phase === 'park') errs.push('칸에 선 트럭의 전환이 밀려 있음');
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

// 움직이는 트럭 몸통끼리 이 거리보다 가까우면 겹친 것으로 센다
const OVERLAP = 0.15;
let overlapSamples = 0, overlaps = 0;
function bodyGap(a, b) {
  let best = Infinity;
  for (let i = 0; i <= 4; i++) {
    const x = a.ax + ((a.bx - a.ax) * i) / 4, y = a.ay + ((a.by - a.ay) * i) / 4;
    for (let j = 0; j <= 4; j++) {
      const u = b.ax + ((b.bx - b.ax) * j) / 4, w = b.ay + ((b.by - b.ay) * j) / 4;
      best = Math.min(best, Math.hypot(x - u, y - w));
    }
  }
  return best;
}
function countOverlaps() {
  for (const s of g.sites) {
    const list = s.lot ? s.lot.active : [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        overlapSamples++;
        if (bodyGap(list[i].lot, list[j].lot) < OVERLAP) overlaps++;
      }
    }
  }
}

// 여러 노선을 한꺼번에 사고 바꿀 때 미리 보여 준 값과 실제 값이 같아야 한다. 돈이 모자랄 때도 본다
function bulkCheck(list) {
  const picked = list.filter(() => rnd() < 0.08);
  const money = g.money;
  const model = Math.floor(rnd() * 4), to = 1 + Math.floor(rnd() * 3);
  const count = 1 + Math.floor(rnd() * 3);
  g.money = rnd() < 0.5 ? money : g.planBuy(picked, model, count).full * rnd();
  const buy = g.planBuy(picked, model, count);
  const m0 = g.money;
  const got = g.bulkBuy(picked, model, count);
  let bad = got.n !== buy.n || Math.abs(got.paid - buy.cost) > 1 || Math.abs(m0 - g.money - buy.cost) > 1;
  g.money = rnd() < 0.5 ? money : g.planConvert(picked, to).full * rnd();
  const conv = g.planConvert(picked, to);
  const m1 = g.money;
  let n = 0;
  for (const q of picked) n += g.convertTrucks(q, to).n;
  bad = bad || n !== conv.n || Math.abs(m1 - g.money - conv.cost) > 1 || g.money < -1;
  const sites = g.sites.filter((s) => s.available && s.produces && rnd() < 0.05);
  g.money = rnd() < 0.5 ? money : g.planSites(sites, (s) => g.upgradeCost(s)).full * rnd();
  const up = g.planSites(sites, (s) => g.upgradeCost(s));
  const m2 = g.money;
  for (const s of up.list) if (!g.buyUpgrade(s)) bad = true;
  bad = bad || Math.abs(m2 - g.money - up.cost) > 1;
  g.money = money;
  if (bad) console.log('일괄 값이 미리 보여 준 것과 다릅니다', { want: buy.n, got: got.n, cost: buy.cost, paid: got.paid, convWant: conv.n, convGot: n });
  return bad ? 1 : 0;
}

let errors = 0;
let lastDeliv = 0;
for (let t = 0, tick = 0; t < MINUTES * 60; t += DT, tick++) {
  g.tick(DT);
  if (tick % 6 === 0) countOverlaps();
  if (tick % 90 === 0) {
    const list = routes();
    const r = list[Math.floor(rnd() * list.length)];
    const roll = rnd();
    if (roll < 0.35) g.buyTruck(r, Math.floor(rnd() * 4));
    else if (roll < 0.45) g.convertTrucks(r, 1 + Math.floor(rnd() * 3), 2);
    else if (roll < 0.5) errors += bulkCheck(list);
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
// 직전 점검과 시간 차이가 없을 수 있으니, 움직였는지는 여기서 보지 않는다
lastPos = new Map();
errors += check('끝');
const share = overlaps / Math.max(1, overlapSamples);
console.log(`겹침 ${overlaps}건 / ${overlapSamples}짝 (${(share * 100).toFixed(2)}%), 비집고 지나간 횟수 ${g.lotGhosts}`);
if (share > 0.01) { console.log('주차장 안에서 트럭이 너무 자주 겹칩니다'); errors++; }
console.log(errors ? `오류 ${errors}건` : '모두 통과');
process.exit(errors ? 1 : 0);
