// 밸런스 확인용 자동 플레이어. 실제 게임 코드를 그대로 돌려 진행 속도와 정체를 기록한다.
// 사용법: node tools/bot.mjs [분] [play|lazy]
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { TECHS, UPGRADES, TRUCKS, GOODS, fmtWon, fmtTime } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
const MINUTES = Number(process.argv[2]) || 30;
const MODE = process.argv[3] || 'play';
const g = new Game(data);

const DT = 1 / 30; // 빠른 검증을 위해 30Hz
const log = [];
const stageTimes = {};
let lastDecide = 0, lastLog = 0;
let stepMsTotal = 0, steps = 0;

function bestModel(route) {
  const s = route.from;
  const rate = g.siteRate(s);
  // 왕복 동안 쌓이는 물량에 맞는 트럭
  const rt = route.freeTime * 2 + 6;
  const perTrip = rate * rt;
  let best = 0;
  for (let i = 0; i < TRUCKS.length; i++) {
    if (!g.modelUnlocked(i)) continue;
    if (TRUCKS[i].id === 'express') continue;
    if (TRUCKS[i].cap <= perTrip * 1.2 || i === 0) best = i;
  }
  return best;
}

function decide() {
  // 연구
  for (const t of TECHS) {
    if (!g.techs.has(t.id) && g.techVisible(t) && g.money >= t.cost * 1.1) g.buyTech(t.id);
  }
  for (const u of UPGRADES) {
    if (g.upg[u.id] < u.max && g.upgradeCostOf(u.id) < g.money * 0.25) g.buyUpg(u.id);
  }
  // 트럭·생산
  const sites = g.sites.filter((s) => s.available && s.produces);
  sites.sort((a, b) => GOODS[b.goods].price - GOODS[a.goods].price);
  for (const s of sites) {
    const routes = s.routesOut.filter((r) => r.valid);
    if (!routes.length) continue;
    const cap = g.siteCap(s);
    if (s.stock > cap * 0.55 && !s.yard.length) {
      const opened = routes.filter((r) => r.trucks.length);
      // 먼 노선도 절반쯤 쓴다
      const r = opened.length && opened.length >= routes.length ? opened.sort((a, b) => a.trucks.length - b.trucks.length)[0]
        : routes.find((q) => !q.trucks.length) || routes[0];
      const m = bestModel(r);
      const price = g.truckPrice(r, m);
      if (g.money >= price) g.buyTruck(r, m);
    } else if (s.yard.length >= 2 || (s.inputs && s.stock < cap * 0.2 && s.inBuf.every((v) => v > 5))) {
      const c = g.upgradeCost(s);
      if (g.money >= c) g.buyUpgrade(s);
    }
    // 상하차 대기
    const node = g.net.nodes[s.node];
    if (node.waiting >= 3 && g.money >= g.bayCost(s) * 1.2) g.buyBay(s);
  }
  // 소비처 상하차
  for (const s of g.sites.filter((q) => q.available && q.isCity)) {
    const node = g.net.nodes[s.node];
    if (node.waiting >= 3 && g.money >= g.bayCost(s) * 1.2) g.buyBay(s);
  }
  // 정체 처리
  if (MODE === 'play') {
    for (const j of g.jams.slice(0, 4)) {
      const n = j.node;
      if (n.terminal) continue;
      if (j.waiting < 5) continue;
      if (n.control === 'auto') {
        if (g.techs.has('interchange') && n.flow > 2 && g.money >= g.controlPrice(n, 'interchange') * 1.3) g.setControl(n, 'interchange');
        else if (g.techs.has('signal') && g.money >= g.controlPrice(n, 'signal') * 1.5) g.setControl(n, 'signal');
      } else if (n.control === 'signal' && g.techs.has('interchange') && n.flow > 2.2 && g.money >= g.controlPrice(n, 'interchange') * 2) {
        g.setControl(n, 'interchange');
      }
      // 혼잡한 길에 차로 추가
      for (const e of n.inE) {
        if (e.cong > 0.5 && g.canAddLane(e.road) && g.money >= g.lanePrice(e.road) * 2) { g.addLane(e.road); break; }
      }
    }
    // 프로젝트
    for (const p of g.projects) {
      if (g.projectAvailable(p) && g.money >= g.projectPrice(p) * 2.5) g.buildProject(p);
    }
  }
}

const t0 = Date.now();
const total = MINUTES * 60;
let unstuck = 0;
for (let t = 0; t < total; t += DT) {
  const a = performance.now();
  g.tick(DT);
  stepMsTotal += performance.now() - a; steps++;
  if (t - lastDecide >= 1) {
    lastDecide = t;
    decide();
    for (const n of g.net.nodes) {
      if (n.stuckT > 60 && !n.terminal && g.techs.has('tow')) { unstuck += g.tow(n); }
    }
  }
  while (g.events.length) {
    const e = g.events.shift();
    if (e.type === 'region') {
      stageTimes[e.region.short] = t;
      const ms = g.movingStats();
      log.push(`[${fmtTime(t)}] ★ ${e.region.short} 해금 money=${fmtWon(g.money)} income=${fmtWon(g.income)}/s trucks=${g.truckCount} stopped=${ms.stopped}/${ms.onRoad}`);
    }
    if (e.type === 'alldone') log.push(`[${fmtTime(t)}] ★★ 전국 달성`);
    if (e.type === 'boom') log.push(`[${fmtTime(t)}] 붐타운 ${e.level}`);
    if (e.type === 'tech') log.push(`[${fmtTime(t)}] tech ${e.tech.name}`);
    if (e.type === 'project') log.push(`[${fmtTime(t)}] project ${e.project.name}`);
  }
  if (t - lastLog >= 120) {
    lastLog = t;
    const ms = g.movingStats();
    const top = g.jams.slice(0, 3).map((j) => `${j.node.name}(${j.waiting})`).join(' ');
    log.push(`[${fmtTime(t)}] stage=${g.stage} prog=${(g.progress() * 100).toFixed(0)}% money=${fmtWon(g.money)} income=${fmtWon(g.income)}/s trucks=${g.truckCount} stopped=${ms.stopped}/${ms.onRoad} ontime=${(g.onTimeRate * 100).toFixed(0)}% jams: ${top}`);
  }
}
console.log(log.join('\n'));
const stat = { lanes: 0, signal: 0, roundabout: 0, interchange: 0 };
for (const r of g.net.roads) if (r.lanes > (r.kind === 'x' ? 2 : 1)) stat.lanes++;
for (const n of g.net.nodes) if (stat[n.control] !== undefined) stat[n.control]++;
console.log('final', JSON.stringify(stat), 'towed', unstuck, 'routes open', [...g.routes.values()].filter((r) => r.trucks.length).length, '/', g.routes.size);
console.log('sim speed:', (total / ((Date.now() - t0) / 1000)).toFixed(1), 'x realtime, avg step', (stepMsTotal / steps).toFixed(3), 'ms');
