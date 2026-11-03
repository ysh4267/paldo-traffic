// 밸런스 확인용 자동 플레이어. 실제 게임 코드를 그대로 돌려 진행 속도와 정체를 기록한다.
// 사용법: node tools/bot.mjs [분] [human|notools] [생각 간격(초)]
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { TECHS, UPGRADES, TRUCKS, GOODS, fmtWon, fmtTime } from '../js/game/defs.js';
import { dumpJams } from './lib/dump.mjs';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
const MINUTES = Number(process.argv[2]) || 30;
const MODE = process.argv[3] || 'human';
const THINK = Number(process.argv[4]) || 2.5; // 사람이 몇 초마다 한 번 움직이는가
const g = new Game(data);

const DT = 1 / 30;
const log = [];
const events = [];
let lastDecide = 0, lastLog = 0;
let stepMs = 0, steps = 0, maxTrucks = 0;

function bestModel(route) {
  const s = route.from;
  const rate = g.siteRate(s);
  const rt = route.freeTime * 2 + 6;
  const perTrip = rate * rt;
  let best = 0;
  for (let i = 0; i < TRUCKS.length; i++) {
    if (!g.modelUnlocked(i) || TRUCKS[i].id === 'express') continue;
    if (TRUCKS[i].cap <= perTrip * 1.3) best = i;
  }
  return best;
}

// 한 번에 한 동작만 한다 (사람처럼)
function act() {
  const useTools = MODE !== 'notools';
  // 1. 심각한 정체 먼저
  if (useTools) {
    for (const j of g.jams) {
      const n = j.node;
      if (j.waiting < 5) continue;
      if (j.site) {
        if (g.money >= g.bayCost(j.site)) { g.buyBay(j.site); return 'bay'; }
        continue;
      }
      if (n.control === 'auto') {
        if (g.techs.has('interchange') && n.flow > 2.2 && g.money >= g.controlPrice(n, 'interchange')) { g.setControl(n, 'interchange'); return 'ic'; }
        if (g.techs.has('signal') && g.money >= g.controlPrice(n, 'signal')) { g.setControl(n, 'signal'); return 'sig'; }
        // 양보 표지로 임시 처방
        if (!n.inE.some((e) => e.sign) && !n.major.size) {
          const quiet = n.inE.filter((e) => e.road.open).sort((a, b) => a.count - b.count)[0];
          if (quiet && g.money >= g.signPrice(quiet, 1)) { g.setSign(quiet, 1); return 'yield'; }
        }
      } else if (n.control === 'signal' && g.techs.has('interchange') && n.waiting > 12 && g.money >= g.controlPrice(n, 'interchange')) {
        g.setControl(n, 'interchange'); return 'ic2';
      }
      for (const e of n.inE) {
        if (e.cong > 0.55 && g.canAddLane(e.road) && g.money >= g.lanePrice(e.road)) { g.addLane(e.road); return 'lane'; }
      }
      if (j.stuck > 50 && g.techs.has('tow') && g.money >= g.towPrice(n)) { g.tow(n); return 'tow'; }
    }
  }
  // 2. 연구
  for (const t of TECHS) {
    if (!g.techs.has(t.id) && g.techVisible(t) && g.money >= t.cost) { g.buyTech(t.id); return 'tech'; }
  }
  // 다음 연구비를 모으는 중이면 트럭을 잠시 멈춘다
  const saving = TECHS.find((t) => !g.techs.has(t.id) && g.techVisible(t) && t.cost < g.income * 240);
  if (saving) return null;
  // 3. 트럭 (값비싼 화물 우선)
  const ms = g.movingStats();
  const congested = ms.onRoad > 30 && ms.stopped / ms.onRoad > 0.35;
  const servesGoal = (s) => s.routesOut.some((r) => r.valid && r.to.region === g.stage);
  const sites = g.sites.filter((s) => s.available && s.produces).sort((a, b) => (servesGoal(b) - servesGoal(a)) || (b.region - a.region) || (GOODS[b.goods].price - GOODS[a.goods].price));
  for (const s of sites) {
    const routes = s.routesOut.filter((r) => r.valid);
    if (!routes.length) continue;
    const cap = g.siteCap(s);
    if (s.stock > cap * 0.55 && !s.yard.length && !(congested && useTools)) {
      const toGoal = routes.filter((q) => q.to.region === g.stage);
      const pool = toGoal.length ? toGoal : routes;
      const unopened = pool.find((q) => !q.trucks.length);
      const r = unopened || pool.slice().sort((a, b) => a.trucks.length - b.trucks.length)[0];
      const m = bestModel(r);
      if (g.money >= g.truckPrice(r, m)) { g.buyTruck(r, m); return 'truck'; }
    }
  }
  // 4. 생산 증설
  for (const s of sites) {
    const cap = g.siteCap(s);
    const ready = s.inputs ? s.inBuf.every((v) => v > g.inputCap(s) * 0.3) : true;
    if (s.yard.length >= 2 && ready && s.stock < cap * 0.3 && g.money >= g.upgradeCost(s)) { g.buyUpgrade(s); return 'upg'; }
  }
  // 5. 공용 연구
  for (const u of UPGRADES) {
    if (g.upg[u.id] < u.max && g.upgradeCostOf(u.id) < g.money * 0.5) { g.buyUpg(u.id); return 'upgtech'; }
  }
  // 6. 프로젝트
  if (useTools) for (const p of g.projects) if (g.projectAvailable(p) && g.money >= g.projectPrice(p) * 1.5) { g.buildProject(p); return 'proj'; }
  return null;
}

const t0 = Date.now();
const total = MINUTES * 60;
const acts = {};
for (let t = 0; t < total; t += DT) {
  const a = performance.now();
  g.tick(DT);
  stepMs += performance.now() - a; steps++;
  if (t - lastDecide >= THINK) {
    lastDecide = t;
    const what = act();
    if (what) acts[what] = (acts[what] || 0) + 1;
  }
  maxTrucks = Math.max(maxTrucks, g.truckCount);
  while (g.events.length) {
    const e = g.events.shift();
    if (e.type === 'region') {
      const ms = g.movingStats();
      log.push(`[${fmtTime(t)}] ★ ${e.region.short} 개통 money=${fmtWon(g.money)} income=${fmtWon(g.income * 60)}/분 trucks=${g.truckCount} stopped=${ms.stopped}/${ms.onRoad}`);
    }
    if (e.type === 'alldone') log.push(`[${fmtTime(t)}] ★★ 전국 달성`);
    if (e.type === 'boom') log.push(`[${fmtTime(t)}] 붐 ${e.level}`);
    if (e.type === 'tech') events.push(`${fmtTime(t)} ${e.tech.name}`);
    if (e.type === 'project') events.push(`${fmtTime(t)} [건설] ${e.project.name}`);
  }
  if (t - lastLog >= 300) {
    lastLog = t;
    const ms = g.movingStats();
    const top = g.jams.slice(0, 3).map((j) => `${j.node.name}(${j.waiting})`).join(' ');
    log.push(`[${fmtTime(t)}] s${g.stage} ${(g.progress() * 100).toFixed(0)}% ${fmtWon(g.money)} ${fmtWon(g.income * 60)}/분 trucks=${g.truckCount} stop=${ms.stopped}/${ms.onRoad} 정시=${(g.onTimeRate * 100).toFixed(0)}% jam: ${top}`);
  }
}
console.log(log.join('\n'));
console.log('연구:', events.join(' | '));
const stat = { lanes: 0, signal: 0, roundabout: 0, interchange: 0 };
for (const r of g.net.roads) if (r.lanes > (r.kind === 'x' ? 2 : 1)) stat.lanes++;
for (const n of g.net.nodes) if (stat[n.control] !== undefined) stat[n.control]++;
console.log('final', JSON.stringify(stat), 'acts', JSON.stringify(acts), 'maxTrucks', maxTrucks, 'routes open', [...g.routes.values()].filter((r) => r.trucks.length).length, '/', g.routes.size);
console.log('sim speed:', (total / ((Date.now() - t0) / 1000)).toFixed(0), 'x, avg step', (stepMs / steps).toFixed(3), 'ms');
if (process.argv[5] === 'dump') dumpJams(g);
