// 교차로 방식별 처리량 비교. 각 방향에서 포화 수요를 넣고 분당 통과 대수를 잰다.
import fs from 'node:fs';
import { Network } from '../js/sim/network.js';
import { Traffic } from '../js/sim/traffic.js';
import { TRUCKS } from '../js/game/defs.js';

const data = JSON.parse(fs.readFileSync('data/korea.json', 'utf8'));
const DT = 1 / 60;

function run(control, { degree = 4, lanes = 1, smart = false, seconds = 150, signs = null, seed = 7, straightShare = 0.6 } = {}) {
  const net = new Network(data);
  for (const r of net.roads) r.open = true;
  let rngState = seed;
  const rnd = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; };
  const node = net.nodes.find((n) => !n.terminal && n.roads.length === degree && n.roads.every((r) => r.kind === 'n' && r.len > 14 && r.len < 40));
  if (!node) throw new Error('no node');
  let done = 0;
  const traffic = new Traffic(net, {
    arrive: (v) => { traffic.vehicles.delete(v); return true; },
  });
  traffic.smartSignals = smart;
  for (const r of node.roads) if (lanes !== r.lanes) net.setLanes(r, lanes);
  traffic.setControl(node, control);
  if (signs) signs(node);
  const model = TRUCKS[0];
  const route = {};
  let measureFrom = 40;
  let startFlow = 0;
  const inject = (e) => {
    const list = e.turnList;
    if (!list || !list.length) return;
    const straight = list.find((t) => t.kind === 'S');
    const t = straight && rnd() < straightShare ? straight : list[Math.floor(rnd() * list.length)];
    const v = traffic.newVehicle(model, route);
    v.path = [e, t.to];
    if (!traffic.inject(v, e, 0)) traffic.vehicles.delete(v); else v.v = e.speed * 0.9;
  };
  let count = 0;
  for (let t = 0; t < seconds; t += DT) {
    if (Math.round(t / DT) % 12 === 0) for (const e of node.inE) inject(e);
    traffic.step(DT);
    count = node.turns.reduce((s, q) => s + q.flow, 0);
    if (t < measureFrom) { startFlow = count; }
  }
  done = count - startFlow;
  return { perMin: Math.round((done / (seconds - measureFrom)) * 60), name: node.name, onRoad: traffic.vehicles.size };
}

console.log('--- 4갈래, 차로 1');
console.log('기본(비보호)      ', run('auto'));
console.log('양보 2방향        ', run('auto', { signs: (n) => { n.inE[0].sign = 1; n.inE[2].sign = 1; } }));
console.log('신호              ', run('signal'));
console.log('감응 신호         ', run('signal', { smart: true }));
console.log('회전교차로        ', run('roundabout'));
console.log('입체교차로        ', run('interchange'));
console.log('--- 4갈래, 차로 2');
console.log('기본              ', run('auto', { lanes: 2 }));
console.log('신호              ', run('signal', { lanes: 2 }));
console.log('감응 신호         ', run('signal', { lanes: 2, smart: true }));
console.log('회전교차로        ', run('roundabout', { lanes: 2 }));
console.log('입체교차로        ', run('interchange', { lanes: 2 }));
console.log('--- 3갈래, 차로 1');
console.log('기본              ', run('auto', { degree: 3 }));
console.log('신호              ', run('signal', { degree: 3 }));
console.log('회전교차로        ', run('roundabout', { degree: 3 }));
console.log('입체교차로        ', run('interchange', { degree: 3 }));
