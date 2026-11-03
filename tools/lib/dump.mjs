// 막힌 교차로와 의존 사슬을 출력하는 진단 도구
export function dumpJams(g, limit = 4) {
  const stuck = g.net.nodes.filter((n) => n.stuckT > 15).sort((a, b) => b.stuckT - a.stuckT);
  console.log('trucks', g.truckCount, 'stuck nodes', stuck.length);
  for (const n of stuck.slice(0, limit)) {
    console.log(`\n== ${n.name} id=${n.id} control=${n.control} terminal=${n.terminal} deg=${n.roads.length} R=${n.R.toFixed(2)} stuck=${n.stuckT.toFixed(1)} major=${[...n.major]} active=${n.active.length}`);
    for (const a of n.active) console.log(`   active v${a.id} state=${a.state} lane=${a.lane ? `e${a.lane.edge.id}/${a.lane.index} s=${a.s.toFixed(2)} L=${a.lane.edge.L.toFixed(2)}` : '-'} conn=${!!a.conn}${a.conn ? ` s=${a.s.toFixed(2)}/${a.conn.len.toFixed(2)}` : ''} len=${a.len} v=${a.v.toFixed(2)} pi=${a.pi}/${a.path.length} granted=${a.granted} res=${a.res ? a.res.name : '-'} resLane=${a.resLane ? `e${a.resLane.edge.id}` : '-'} tl=${a.targetLane ? `e${a.targetLane.edge.id}/${a.targetLane.index}` : '-'} ml=${a.mergeLead ? `v${a.mergeLead.id}[${a.mergeLead.state} tl=${a.mergeLead.targetLane ? `e${a.mergeLead.targetLane.edge.id}/${a.mergeLead.targetLane.index}` : '-'} lane=${a.mergeLead.lane ? 'e' + a.mergeLead.lane.edge.id : '-'} conn=${!!a.mergeLead.conn} s=${a.mergeLead.s.toFixed(2)} v=${a.mergeLead.v.toFixed(2)} ml=${a.mergeLead.mergeLead ? 'v' + a.mergeLead.mergeLead.id : '-'}]` : '-'} laneLE=${a.lane && a.lane.lastExit ? `v${a.lane.lastExit.id}[${a.lane.lastExit.state} moved=${(a.lane.lastExit.odo - a.lane.lastExitOdo).toFixed(2)}]` : '-'} connVeh=${a.nextConn ? a.nextConn.veh.length : '-'} connV=${a.connV.toFixed(2)}`);
    for (const e of n.inE) {
      for (const lane of e.lanes) {
        const f = lane.veh[0];
        if (!f) continue;
        const nx = f.path[f.pi + 1];
        const t = nx ? e.turns.get(nx.id) : null;
        const fr = nx && nx.lanes ? nx.lanes.map((l) => `${l.free().toFixed(2)}(p${l.pending.toFixed(2)},n${l.veh.length})`).join(' ') : '';
        console.log(`  in e${e.id} ${e.road.kind} sign=${e.sign} L=${e.L.toFixed(2)} lane${lane.index} n=${lane.veh.length} front v${f.id} s=${f.s.toFixed(2)} v=${f.v.toFixed(2)} g=${f.granted} wait=${f.waitT.toFixed(1)} stall=${(lane.stall || 0).toFixed(0)} res=${f.res ? f.res.name : '-'} next=${nx ? `e${nx.id}→${g.net.nodes[nx.to].name}` : 'END'} turn=${t ? t.kind : 'NONE'} free=[${fr}]`);
      }
    }
  }
  console.log('\n--- 의존 사슬');
  const seenLanes = new Set();
  let printed = 0;
  for (const n of stuck) {
    for (const e of n.inE) for (const lane of e.lanes) {
      const f = lane.veh[0];
      if (!f || f.v > 0.1 || f.granted || seenLanes.has(lane) || printed > 6) continue;
      const chain = [];
      const visited = new Map();
      let cur = lane;
      while (cur && !visited.has(cur)) {
        visited.set(cur, chain.length);
        const h = cur.veh[0];
        if (!h) { chain.push(`(e${cur.edge.id}:빈차로)`); cur = null; break; }
        const nx = h.path[h.pi + 1];
        const node = g.net.nodes[cur.edge.to];
        if (!nx) { chain.push(`e${cur.edge.id}→거점 ${node.name} (하차 ${node.site?.unloadBays.length}/${node.site?.bays}, 대기장 ${node.site?.yard.length})`); cur = null; break; }
        chain.push(`e${cur.edge.id}@${node.name}[n${cur.veh.length} v=${h.v.toFixed(1)} g=${h.granted}]→e${nx.id}(${nx.lanes.map((l) => l.free().toFixed(1))})`);
        if (nx.road.kind === 'f') { cur = null; break; }
        cur = nx.lanes.reduce((best, l) => (l.free() < (best ? best.free() : Infinity) ? l : best), null);
      }
      if (cur && visited.has(cur)) chain.push(`*** 순환! ${visited.get(cur)}번째로 돌아옴`);
      for (const l of visited.keys()) seenLanes.add(l);
      printed++;
      console.log(chain.join('\n   ') + '\n');
    }
  }
}
