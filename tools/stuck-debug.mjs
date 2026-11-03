// 오래 멈춘 교차로의 상태를 덤프해 교착 원인을 찾는다
import fs from 'node:fs';
import { Game } from '../js/game/game.js';
import { TRUCKS } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
const g = new Game(data);
const DT = 1 / 30;
const MIN = Number(process.argv[2]) || 25;
let last = 0;
for (let t = 0; t < MIN * 60; t += DT) {
  g.tick(DT);
  if (t - last >= 1) {
    last = t;
    // 무조건 트럭을 늘려 교통량을 높인다
    for (const s of g.sites) {
      if (!s.available || !s.produces) continue;
      const r = s.routesOut.filter((q) => q.valid).sort((a, b) => a.trucks.length - b.trucks.length)[0];
      if (r && s.stock > g.siteCap(s) * 0.5 && g.money > g.truckPrice(r, 0)) g.buyTruck(r, 0);
    }
  }
  g.events.length = 0;
}
const stuck = g.net.nodes.filter((n) => n.stuckT > 20).sort((a, b) => b.stuckT - a.stuckT);
console.log('trucks', g.truckCount, 'stuck nodes', stuck.length);
for (const n of stuck.slice(0, 6)) {
  console.log(`\n== ${n.name} id=${n.id} control=${n.control} terminal=${n.terminal} deg=${n.roads.length} R=${n.R.toFixed(2)} stuck=${n.stuckT.toFixed(1)} major=${[...n.major]} active=${n.active.length}`);
  for (const a of n.active) console.log(`   active v${a.id} state=${a.state} lane=${a.lane ? a.lane.edge.id + '/' + a.lane.index + ' s=' + a.s.toFixed(2) + ' L=' + a.lane.edge.L.toFixed(2) : '-'} conn=${!!a.conn} len=${a.len} v=${a.v.toFixed(2)} pi=${a.pi}/${a.path.length}`);
  for (const e of n.inE) {
    for (const lane of e.lanes) {
      const f = lane.veh[0];
      if (!f) continue;
      const nx = f.path[f.pi + 1];
      const t = nx ? e.turns.get(nx.id) : null;
      const fr = nx && nx.lanes ? nx.lanes.map((l) => `${l.free().toFixed(2)}(p${l.pending.toFixed(2)},n${l.veh.length})`).join(' ') : '';
      console.log(`  in e${e.id} ${e.road.kind} L=${e.L.toFixed(2)} lane${lane.index} n=${lane.veh.length} front v${f.id} s=${f.s.toFixed(2)} v=${f.v.toFixed(2)} granted=${f.granted} wait=${f.waitT.toFixed(1)} res=${f.res ? f.res.name : '-'} pi=${f.pi}/${f.path.length} next=${nx ? 'e' + nx.id + ' to ' + g.net.nodes[nx.to].name : 'END'} turn=${t ? t.kind : 'NONE'} targetFree=[${fr}] site=${f.pi >= f.path.length - 1 ? g.net.nodes[e.to].name : ''}`);
    }
  }
}

// 의존 사슬 추적: 막힌 맨 앞 차가 기다리는 다음 차로를 따라가 고리를 찾는다
console.log('\n--- dependency chains');
const seenLanes = new Set();
for (const n of stuck) {
  for (const e of n.inE) for (const lane of e.lanes) {
    const f = lane.veh[0];
    if (!f || f.v > 0.1 || f.granted || seenLanes.has(lane)) continue;
    const chain = [];
    const visited = new Map();
    let cur = lane;
    while (cur && !visited.has(cur)) {
      visited.set(cur, chain.length);
      const h = cur.veh[0];
      if (!h) { chain.push(`(${cur.edge.id}:empty)`); cur = null; break; }
      const nx = h.path[h.pi + 1];
      const nodeName = g.net.nodes[cur.edge.to].name;
      if (!nx) { chain.push(`e${cur.edge.id}→SITE ${nodeName}(bays ${g.net.nodes[cur.edge.to].site?.unloadBays.length}/${g.net.nodes[cur.edge.to].site?.bays})`); cur = null; break; }
      const free = nx.lanes.map((l) => l.free().toFixed(2));
      chain.push(`e${cur.edge.id}@${nodeName}[n${cur.veh.length} v=${h.v.toFixed(1)} g=${h.granted}]→e${nx.id}(${free})`);
      if (nx.road.kind === 'f') { cur = null; break; }
      // 다음 차로 중 가장 앞차가 멈춘 것
      cur = nx.lanes.find((l) => l.veh.length) || null;
    }
    if (cur && visited.has(cur)) chain.push(`CYCLE back to step ${visited.get(cur)}`);
    for (const l of visited.keys()) seenLanes.add(l);
    console.log(chain.join('\n   '));
    console.log('');
  }
}
