// 교통 시뮬레이션 단독 검증. 교차로 제어별 처리량과 충돌 불변식을 확인한다.
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { fmtWon } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
const g = new Game(data);
console.log('sites', g.sites.length, 'available', g.sites.filter((s) => s.available).map((s) => s.name).join(','));
console.log('routes', [...g.routes.values()].map((r) => `${r.from.name}→${r.to.name} ${Math.round(r.dist)}km ${Math.round(r.freeTime)}s ₩${Math.round(r.perTon)}/t v=${r.valid}`).join('\n  '));

const r0 = [...g.routes.values()][0];
console.log('first truck price', fmtWon(g.truckPrice(r0, 0)));
g.buyTruck(r0, 0); g.buyTruck(r0, 0);

const DT = 1 / 60;
let last = 0;
for (let t = 0; t < 180; t += DT) {
  g.tick(DT);
  if (t - last >= 30) {
    last = t;
    console.log(`t=${t.toFixed(0)} money=${fmtWon(g.money)} deliveries=${g.deliveries} income=${fmtWon(g.income)}/s stock=${r0.from.stock.toFixed(1)} inbuf=${r0.to.inBuf ? r0.to.inBuf[0].toFixed(1) : '-'} states=${[...g.traffic.vehicles].map((v) => v.state + (v.lane ? 'L' : v.conn ? 'C' : '')).join(',')}`);
  }
}
for (const e of g.events.slice(0, 12)) console.log(e.type, e.site ? e.site.name : '');
