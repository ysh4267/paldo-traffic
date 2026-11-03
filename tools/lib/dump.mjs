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
  console.log('\n--- 주차장');
  const lots = g.sites.filter((s) => s.lot && (s.lot.active.some((v) => v.v < 0.1) || s.exitQ.length > 1)).sort((a, b) => (b.lot.active.length + b.exitQ.length) - (a.lot.active.length + a.exitQ.length));
  for (const s of lots.slice(0, limit + 2)) {
    const lanes = s.spurOut.lanes.map((l) => `${l.free().toFixed(2)}(n${l.veh.length})`).join(' ');
    const inn = s.spurIn.lanes.map((l) => `n${l.veh.length}${l.lastExit ? ` le=v${l.lastExit.id}[${l.lastExit.state} moved=${(l.lastExit.odo - l.lastExitOdo).toFixed(2)}]` : ''}`).join(' ');
    console.log(`\n== ${s.name} 칸 ${s.lot.used}/${s.lot.cap} 대기 ${s.lot.waiting} 내리기 ${s.unloadBays.length}/${s.bays} 들어오는 중 ${s.inbound} 하차줄 ${s.unloadQ.length} 대기장 ${s.yard.length} 출구줄 ${s.exitQ.length} 나가는 진입로 [${lanes}] 들어오는 진입로 [${inn}]`);
    for (const v of s.lot.active) console.log(`   v${v.id} ${v.model.short} ${v.lot.phase}${v.lot.go ? '!' : ''}${v.lot.ghost > 0 ? ' 비켜 지나감' : ''} 칸${v.lot.stall} s=${v.lot.s.toFixed(2)}/${v.lot.seg.len.toFixed(2)} 꺾기=${v.lot.seg.commitS ? v.lot.seg.commitS.toFixed(2) : '-'} v=${v.v.toFixed(2)} 대기=${v.lot.wait.toFixed(1)} 멈춤=${v.lot.hold.toFixed(2)}`);
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
