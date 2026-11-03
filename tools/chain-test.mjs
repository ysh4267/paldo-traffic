// 상위 화물의 생산 사슬이 끝까지 돌아가는지 확인한다. 모든 권역을 연 뒤 공장마다 원료를 대 주고 납품을 잰다.
// 사용법: node tools/chain-test.mjs [분]
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { GOODS, TRUCKS, fmtWon } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
const g = new Game(data, { money: 1e15 });
g.applyStage(g.regions.length - 1, true);
g.regions[g.stage].pts = g.regionGoal(g.stage) * 0.99;
g.updateSiteAvailability(true);
for (const id of ['cargo5', 'trailer']) g.techs.add(id);
const MINUTES = Number(process.argv[2]) || 12;
const TRAILER = TRUCKS.findIndex((t) => t.id === 'trailer');

// 거점이 아무 데도 이어지지 않으면 사슬이 끊긴 것이다
const missing = [];
for (const s of g.sites) {
  if (!s.available || !s.inputs) continue;
  s.inputs.forEach((slot) => {
    const fed = s.routesIn.some((r) => r.valid && slot.includes(r.goods));
    if (!fed) missing.push(`${s.name} ← ${slot.map((q) => GOODS[q].name).join('/')}`);
  });
}
console.log('원료 노선이 없는 공장:', missing.length ? missing.join(', ') : '없음');
const noOut = g.sites.filter((s) => s.available && s.produces && !s.routesOut.some((r) => r.valid)).map((s) => s.name);
console.log('납품처가 없는 생산지:', noOut.length ? noOut.join(', ') : '없음');

// 모든 노선에 트레일러를 배치한다
for (const r of g.routes.values()) {
  if (!r.valid) continue;
  const rt = r.freeTime * 2 + 6;
  const n = Math.max(1, Math.min(6, Math.ceil((g.siteRate(r.from) * rt) / 25 / Math.max(1, r.from.routesOut.length))));
  for (let i = 0; i < n; i++) g.buyTruck(r, TRAILER);
}
const DT = 1 / 30;
for (let t = 0; t < MINUTES * 60; t += DT) g.tick(DT);

const byGoods = {};
for (const r of g.routes.values()) {
  const q = (byGoods[r.goods] ||= { earned: 0, tons: 0, trucks: 0 });
  q.earned += r.earned; q.tons += r.delivered; q.trucks += r.trucks.length;
}
console.log('화물별:');
for (const k of Object.keys(GOODS)) {
  const q = byGoods[k] || { earned: 0, tons: 0, trucks: 0 };
  console.log(`  ${GOODS[k].name.padEnd(6)} ${fmtWon(q.earned).padStart(10)} ${String(Math.round(q.tons)).padStart(7)}t ${String(q.trucks).padStart(4)}대  분당 ${fmtWon(q.earned / MINUTES)}`);
}
const dead = g.sites.filter((s) => s.available && s.produces && s.inputs && !s.routesOut.some((r) => r.delivered > 0)).map((s) => `${s.name}(원료 ${s.inBuf.map((v) => Math.round(v)).join('/')}t, 재고 ${Math.round(s.stock)}t)`);
console.log('아무것도 내보내지 못한 공장:', dead.length ? dead.join(', ') : '없음');
console.log('분당 수익', fmtWon(g.income * 60), '트럭', g.truckCount);
