// 정체 브리핑 점검: 노선별 정체를 제대로 재는지, 고칠 곳을 제대로 고르는지 본다.
// 사용법: node tools/brief-test.mjs
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { TRUCKS } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
const DT = 1 / 30;
let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'OK ' : '실패'} ${name} ${extra}`);
};
// 같은 조건으로 견주려고 난수를 고정한다
let seed = 2026;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const run = (g, sec) => { for (let i = 0; i < sec * 30; i++) g.tick(DT); };
const fresh = (stage) => {
  const g = new Game(data, { money: 1e15 });
  g.applyStage(stage, true);
  g.regions[stage].pts = g.regionGoal(stage) * 0.5;
  g.updateSiteAvailability(true);
  for (const id of ['cargo5', 'trailer', 'express', 'signal', 'roundabout', 'interchange', 'tow']) g.techs.add(id);
  return g;
};
const open = (g) => [...g.routes.values()].filter((r) => r.valid && r.from.available && r.to.available);

// ── 빈 도로 ───────────────────────────────────────────
{
  const g = fresh(0);
  // 원료가 있어야 트럭이 움직이니 원료가 필요 없는 거점에서 출발한다
  const r = open(g).filter((q) => !q.from.inputs).sort((a, b) => b.dist - a.dist)[0];
  ok('처음엔 기록이 없다', r.legs[0].n === 0 && r.legs[1].n === 0);
  g.buyTruck(r, 0);
  run(g, 300);
  const j = g.routeJam(r);
  ok('한 대만 달리면 가는 길 기록이 쌓인다', r.legs[1].n > 0, `${r.legs[1].n}회`);
  ok('돌아오는 길 기록도 쌓인다', r.legs[0].n > 0, `${r.legs[0].n}회`);
  ok('빈 도로는 평소 시간과 비슷하다', j.ratio < 1.35, `×${j.ratio.toFixed(2)}`);
  ok('빈 도로는 막히는 노선이 아니다', g.routeJams.length === 0, `${g.routeJams.length}개`);
  ok('묶인 트럭이 거의 없다', j.lost < 0.3, j.lost.toFixed(2));
}

// ── 배 시간 ───────────────────────────────────────────
{
  const g = fresh(data.regions.length - 1);
  const r = open(g).find((q) => !q.from.inputs && q.pathTo.some((e) => e.road.kind === 'f'));
  ok('배편 노선이 있다', !!r);
  if (r) {
    ok('뱃길 시간을 잰다', r.shipTo > 0 && r.shipBack > 0, `${r.shipTo.toFixed(0)}초`);
    const slow = g.quietTime(r, 1, TRUCKS[2]), quick = g.quietTime(r, 1, TRUCKS[3]);
    const land = g.freeRun(r.pathTo, TRUCKS[2], true) - g.freeRun(r.pathTo, TRUCKS[3], true);
    ok('배 타는 시간은 트럭 속도와 상관없다', slow > quick && Math.abs(slow - quick - land * 1.05) < 0.01);
    g.buyTruck(r, 0);
    run(g, 600);
    const j = g.routeJam(r);
    ok('배를 타고 오간 기록이 쌓인다', r.legs[1].n > 0 && r.legs[0].n > 0, `${r.legs[1].n}회`);
    ok('배를 기다리는 시간은 정체가 아니다', j.ratio < 1.35, `×${j.ratio.toFixed(2)}`);
  }
}

// ── 막힘 ──────────────────────────────────────────────
{
  const g = fresh(2);
  const routes = open(g);
  for (const r of routes) for (let i = 0; i < 6; i++) g.buyTruck(r, 0);
  run(g, 240);
  ok('트럭이 넘치면 막히는 노선이 잡힌다', g.routeJams.length > 5, `${g.routeJams.length}개`);
  ok('묶인 트럭이 많은 순서다', g.routeJams.every((j, i) => !i || g.routeJams[i - 1].lost >= j.lost));
  ok('값이 모두 정상이다', g.routeJams.every((j) => Number.isFinite(j.ratio) && Number.isFinite(j.lost) && j.ratio >= 1 && j.lost >= 0 && j.lost <= j.trucks));
  const withSpots = g.routeJams.map((j) => ({ j, sp: g.routeSpots(j.route) }));
  ok('대부분 고칠 곳을 찾는다', withSpots.filter((q) => q.sp.nodes.length || q.sp.roads.length).length >= withSpots.length * 0.8);
  ok('맨 앞으로 표시된 곳이 있다', withSpots.filter((q) => q.sp.nodes.some((z) => z.head) || q.sp.roads.some((z) => z.head)).length >= withSpots.length * 0.6);
  let onPath = true, headFirst = true, capped = true;
  for (const { j, sp } of withSpots) {
    const r = j.route;
    const roads = new Set([...r.pathTo, ...r.pathBack].map((e) => e.road));
    const nodes = new Set([...r.pathTo, ...r.pathBack].flatMap((e) => [e.from, e.to]));
    for (const q of sp.roads) if (!roads.has(q.road)) onPath = false;
    for (const q of sp.nodes) if (!nodes.has(q.node.id)) onPath = false;
    for (const list of [sp.nodes, sp.roads]) {
      if (list.length > 4) capped = false;
      list.forEach((q, i) => { if (i && q.head && !list[i - 1].head) headFirst = false; });
    }
  }
  ok('고칠 곳은 모두 노선 위에 있다', onPath);
  ok('맨 앞이 먼저 나온다', headFirst);
  ok('노선마다 네 곳까지만 보여 준다', capped);
  ok('고를 수 없는 교차로는 고르지 않는다', withSpots.every((q) => q.sp.nodes.every((z) => z.site || (!z.node.terminal && z.node.inE.length >= 3))));
  ok('거점 입구는 거점으로 알려 준다', withSpots.every((q) => q.sp.nodes.every((z) => !z.site || z.node.site === z.site)));
  // 대기장에서 기다리는 트럭은 달리는 중이 아니다
  const yard = g.sites.flatMap((s) => s.yard);
  ok('대기장의 트럭은 달리는 중으로 치지 않는다', yard.length > 0 && yard.every((v) => v.legStart === null), `${yard.length}대`);
  // 구난된 트럭은 시간을 더 재지 않는다
  const jam = g.jams.find((q) => !q.site);
  if (jam) {
    const towed = new Set();
    const park = g.parkNow.bind(g);
    g.parkNow = (s, v) => { park(s, v); towed.add(v); };
    g.tow(jam.node, true);
    g.parkNow = park;
    ok('구난한 트럭은 기록을 비운다', towed.size > 0 && [...towed].every((v) => v.legStart === null), `${towed.size}대`);
  }
  // 저장을 되살려도 값이 깨지지 않는다
  const save = JSON.parse(JSON.stringify(g.serialize()));
  const h = Game.restore(data, save);
  run(h, 30);
  h.updateRouteJams();
  const all = [...h.routes.values()].filter((r) => r.valid && r.trucks.length).map((r) => h.routeJam(r));
  ok('되살린 뒤에도 값이 정상이다', all.length > 0 && all.every((j) => Number.isFinite(j.ratio) && Number.isFinite(j.lost)), `노선 ${all.length}개`);
  ok('되살린 트럭의 시간도 잰다', [...h.traffic.vehicles].some((v) => v.legStart !== null));
}

// ── 고치면 나아지는가 ────────────────────────────────
{
  const trial = (fix) => {
    seed = 77;
    const g = fresh(2);
    for (const r of open(g)) for (let i = 0; i < 4; i++) g.buyTruck(r, 0);
    run(g, 120);
    let n = 0;
    const done = new Set();
    for (let t = 0; t < 12; t++) {
      if (fix) {
        scan: for (const j of g.routeJams) {
          const sp = g.routeSpots(j.route);
          for (const q of sp.nodes) if (q.head && !q.site && !done.has(q.node)) { done.add(q.node); if (g.setControl(q.node, 'interchange')) { n++; break scan; } }
          for (const q of sp.roads) if (q.head && !done.has(q.road) && g.canAddLane(q.road)) { done.add(q.road); if (g.addLane(q.road)) { n++; break scan; } }
        }
      }
      run(g, 15);
    }
    run(g, 240);
    const all = [...g.routes.values()].filter((r) => r.valid && r.trucks.length).map((r) => g.routeJam(r));
    return { n, jams: g.routeJams.length, mean: all.reduce((s, j) => s + j.ratio, 0) / all.length, stopped: g.movingStats().stopped };
  };
  const a = trial(false), b = trial(true);
  console.log(`  그대로 두면 평균 ×${a.mean.toFixed(2)}, 막힌 노선 ${a.jams}개, 정지 ${a.stopped}대 / 고치면 평균 ×${b.mean.toFixed(2)}, 막힌 노선 ${b.jams}개, 정지 ${b.stopped}대 (${b.n}곳)`);
  ok('고른 곳을 고치면 정체가 줄어든다', b.n >= 8 && b.mean < a.mean * 0.9);
}

console.log(fails ? `실패 ${fails}건` : '모두 통과');
process.exit(fails ? 1 : 0);
