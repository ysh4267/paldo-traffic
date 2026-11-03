// 차선 기반 교통 시뮬레이션. 정체는 교차로 충돌과 차간거리에서 저절로 생긴다.
import { V0, SHIP_SPEED, laneOffset } from './network.js';

export const ACC = 7;      // km/s²
export const BRK = 9;
export const GAP = 0.32;   // 앞차와의 최소 간격 km
const STOP_MARGIN = 0.04;
const GRANT_MARGIN = 0.7;
const SIGNAL_GREEN = 3.4;
const SIGNAL_CLEAR = 0.55;
const SMART_MIN = 1.2;
const SMART_MAX = 8;
const V_AUTO = 0.4;        // 비보호 교차로 통과 속도 비율
const V_TURN = 0.5;
const V_STRAIGHT = 0.92;
const V_RING = 0.52;
const GAP_YIELD = 1.05;    // 양보 쪽이 확인하는 우선 차량까지의 시간 간격 s
const GAP_STOP = 1.5;

export class Vehicle {
  constructor(id, model, route) {
    this.id = id;
    this.model = model;
    this.route = route;
    this.len = model.len;
    this.speedF = model.speed;
    this.lane = null;
    this.conn = null;
    this.s = 0;
    this.v = 0;
    this.path = null;
    this.pi = 0;
    this.granted = false;
    this.nextConn = null;
    this.targetLane = null;
    this.connV = V0;
    this.waitT = 0;
    this.stopT = 0;
    this.res = null;
    this.resTurn = null;
    this.resLane = null;
    this.ringNode = null;
    this.ringList = null;
    this.odo = 0;
    this.state = 'idle'; // idle | road | bay | queue | ship
    this.cargo = 0;
    this.goods = null;
    this.leg = 0;        // 0 상차지로 이동, 1 하차지로 이동
    this.tripStart = 0;
    this.retire = false;
    this.seg = { seg: 0 };
    this.bay = null;
  }
}

export class Ferry {
  constructor(road) {
    this.road = road;
    this.len = road.len;
    this.pos = 0;
    this.dir = 1;
    this.state = 'dock';
    this.t = 0;
    this.cargo = [];
    this.cap = 10;
    this.waiting = [0, 0];
    this.transfer = [[], []];
    this.trips = 0;
  }
  dockNode() { return this.dir === 1 ? this.road.a : this.road.b; }
  sideOf(nodeId) { return nodeId === this.road.a ? 0 : 1; }
}

export class Traffic {
  constructor(net, hooks) {
    this.net = net;
    this.hooks = hooks;
    this.time = 0;
    this.activeLanes = [];
    this.activeConns = [];
    this.signalNodes = new Set();
    this.reqNodes = [];
    this.vehicles = new Set();
    this.ferries = [];
    this.arrivals = []; // 배에서 내린 차
    this.smartSignals = false;
    this.statT = 0;
    this.moved = 0;
    this.nextId = 1;
    for (const r of net.roads) if (r.kind === 'f') { const fy = new Ferry(r); r.ferryObj = fy; this.ferries.push(fy); }
  }

  newVehicle(model, route) {
    const v = new Vehicle(this.nextId++, model, route);
    this.vehicles.add(v);
    return v;
  }

  // ── 진입 ──────────────────────────────────────────────
  activate(lane) {
    if (!lane.active) { lane.active = true; this.activeLanes.push(lane); }
  }

  bestLane(edge, afterEdge, need) {
    let lo = 0, hi = edge.lanes.length - 1;
    if (afterEdge) {
      const t = edge.turns ? edge.turns.get(afterEdge.id) : null;
      if (t) { lo = Math.min(t.laneLo, hi); hi = Math.min(t.laneHi, hi); }
    }
    let best = null, bestF = -Infinity;
    for (let i = hi; i >= lo; i--) {
      const q = edge.lanes[i];
      const f = q.free();
      if (f < need && (q.veh.length || q.pending > 0)) continue;
      if (f > bestF + 0.01) { bestF = f; best = q; }
    }
    return best;
  }

  // 지선 시작점 등 s=0에 차를 올린다. 공간이 없으면 false
  inject(v, edge, pi = 0) {
    const after = v.path[pi + 1] || null;
    const lane = this.bestLane(edge, after, v.len + GAP);
    if (!lane) return false;
    v.pi = pi;
    v.lane = lane;
    v.conn = null;
    v.s = 0;
    v.v = 0;
    v.granted = false;
    v.state = 'road';
    v.seg.seg = 0;
    lane.veh.push(v);
    this.activate(lane);
    return true;
  }

  // 저장에서 복원할 때 경로 중간에 배치. 공간이 없으면 false
  placeMidway(v, edgeIndex, frac) {
    const edge = v.path[edgeIndex];
    if (!edge || edge.road.kind === 'f') return false;
    const after = v.path[edgeIndex + 1] || null;
    let lo = 0, hi = edge.lanes.length - 1;
    if (after) {
      const t = edge.turns.get(after.id);
      if (t) { lo = Math.min(t.laneLo, hi); hi = Math.min(t.laneHi, hi); }
    }
    const laneIdx = lo + Math.floor(Math.random() * (hi - lo + 1));
    const lane = edge.lanes[laneIdx];
    const s = Math.min(edge.L - 0.1, Math.max(v.len, edge.L * frac));
    let pos = 0;
    for (; pos < lane.veh.length; pos++) if (lane.veh[pos].s < s) break;
    const ahead = pos > 0 ? lane.veh[pos - 1] : null;
    const behind = pos < lane.veh.length ? lane.veh[pos] : null;
    if (ahead && ahead.s - ahead.len - GAP < s) return false;
    if (behind && s - v.len - GAP < behind.s) return false;
    lane.veh.splice(pos, 0, v);
    v.lane = lane; v.conn = null; v.s = s; v.v = edge.speed * v.speedF * 0.8; v.pi = edgeIndex; v.state = 'road'; v.granted = false;
    this.activate(lane);
    return true;
  }

  // ── 메인 루프 ─────────────────────────────────────────
  step(dt) {
    this.time += dt;
    for (const n of this.signalNodes) this.updateSignal(n, dt);

    const lanes = this.activeLanes;
    for (let i = 0; i < lanes.length; i++) this.collectRequest(lanes[i], dt);
    const rn = this.reqNodes;
    for (let i = 0; i < rn.length; i++) { this.processNode(rn[i]); rn[i].req.length = 0; rn[i].reqOn = false; }
    rn.length = 0;

    const conns = this.activeConns;
    for (let i = 0; i < conns.length; i++) this.stepConn(conns[i], dt);
    for (let i = 0; i < lanes.length; i++) this.stepLane(lanes[i], dt);

    // 비활성 정리
    for (let i = lanes.length - 1; i >= 0; i--) {
      const l = lanes[i];
      if (!l.veh.length && !l.lastExit) { l.active = false; lanes[i] = lanes[lanes.length - 1]; lanes.pop(); }
    }
    for (let i = conns.length - 1; i >= 0; i--) {
      const c = conns[i];
      if (!c.veh.length) { c.active = false; conns[i] = conns[conns.length - 1]; conns.pop(); }
    }

    for (const fy of this.ferries) if (fy.road.open) this.stepFerry(fy, dt);
    this.flushArrivals();

    this.statT += dt;
    if (this.statT >= 0.5) { this.updateStats(this.statT); this.statT = 0; }
  }

  // ── 교차로 허가 요청 ───────────────────────────────────
  collectRequest(lane, dt) {
    const f = lane.veh[0];
    if (!f || f.granted) return;
    const e = lane.edge;
    const dStop = e.L - f.s;
    const reqD = (f.v * f.v) / (2 * BRK) + GRANT_MARGIN;
    if (dStop > reqD) return;
    if (f.pi >= f.path.length - 1) {
      if (dStop < 0.25 && this.hooks.arrive(f)) this.removeFromLane(f);
      return;
    }
    const next = f.path[f.pi + 1];
    if (next.road.kind === 'f') {
      const fy = next.road.ferryObj;
      const side = fy.sideOf(e.to);
      fy.waiting[side]++;
      if (dStop < 0.25 && fy.state === 'dock' && fy.dockNode() === e.to && fy.cargo.length < fy.cap) {
        this.removeFromLane(f);
        f.state = 'ship';
        f.pi++;
        fy.cargo.push(f);
      }
      return;
    }
    f.waitT += dt;
    if (f.v < 0.25) f.stopT += dt; else f.stopT = 0;
    const node = this.net.nodes[e.to];
    if (!node.reqOn) { node.reqOn = true; this.reqNodes.push(node); }
    node.req.push(f);
  }

  processNode(node) {
    const reqs = node.req;
    const control = node.control;
    if (control === 'roundabout') {
      reqs.sort((a, b) => b.waitT - a.waitT);
      for (const f of reqs) this.tryRing(node, f);
      return;
    }
    const hasSign = node.inE.some((e) => e.sign > 0);
    const prioOf = (f) => {
      const e = f.lane.edge;
      if (control !== 'auto') return 0;
      if (e.sign > 0) return e.sign;
      if (hasSign) return 0;
      if (node.major.size) return node.major.has(e.id) ? 0 : 1;
      return 0;
    };
    if (reqs.length > 1) {
      for (const f of reqs) f.prio = prioOf(f);
      reqs.sort((a, b) => (a.prio - b.prio) || (b.waitT - a.waitT));
    } else if (reqs.length) reqs[0].prio = prioOf(reqs[0]);

    const blocked = [];
    for (let i = 0; i < reqs.length; i++) {
      const f = reqs[i];
      const next = f.path[f.pi + 1];
      const turn = f.lane.edge.turns.get(next.id);
      if (!turn) continue;
      const after = f.path[f.pi + 2] || null;
      const need = f.len + GAP;

      // 신호 확인
      let signalOk = true;
      if (control === 'signal') {
        const ph = node.phases[node.phase];
        signalOk = node.clearT <= 0 && ph.allow[turn.id] === 1;
        if (!signalOk && turn.kind === 'R' && f.v < 1.4) signalOk = true; // 적신호 우회전
        if (!signalOk) continue;
      }

      // 정지 표지는 완전히 멈춰야 한다
      const sign = control === 'auto' ? f.lane.edge.sign : 0;
      if (sign === 2 && f.stopT < 0.5) continue;

      // 허가 가능한 차로 탐색
      let target = null, conflicted = false;
      let lo = 0, hi = next.lanes.length - 1;
      if (after) {
        const t2 = next.turns.get(after.id);
        if (t2) { lo = Math.min(t2.laneLo, hi); hi = Math.min(t2.laneHi, hi); }
      }
      let anySpace = false, bestFree = -Infinity;
      for (let k = hi; k >= lo; k--) {
        const tl = next.lanes[k];
        const fr = tl.free();
        if (fr < need && (tl.veh.length || tl.pending > 0)) continue;
        anySpace = true;
        if (this.hasConflict(node, f, turn, tl, control)) { conflicted = true; continue; }
        if (fr > bestFree) { bestFree = fr; target = tl; }
      }
      if (!anySpace) continue;  // 나갈 자리가 없으면 진입 금지 (꼬리물기 방지)

      // 앞서 거절된 차와 충돌하면 추월 금지
      if (target) {
        for (const b of blocked) {
          if (turn.cross[b.turn.id] && control !== 'interchange') { target = null; conflicted = true; break; }
          if (turn.merge[b.turn.id] && b.tl === target) { target = null; conflicted = true; break; }
        }
      }

      // 비우선 방향은 우선 도로 차량 간격을 확인
      if (target && f.prio > 0 && control === 'auto') {
        const horizon = sign === 2 ? GAP_STOP : GAP_YIELD;
        if (this.majorApproaching(node, f, turn, target, horizon)) { target = null; conflicted = true; }
      }

      if (!target) {
        if (conflicted) blocked.push({ turn, tl: next.lanes[lo] });
        continue;
      }
      this.grant(node, f, turn, target);
    }
  }

  hasConflict(node, f, turn, tl, control) {
    const act = node.active;
    for (let i = 0; i < act.length; i++) {
      const a = act[i];
      if (a === f) continue;
      const u = a.resTurn;
      if (u === turn) {
        if (a.resLane === tl && a.resFrom !== f.lane) return true;
        continue;
      }
      if (turn.cross[u.id] && control !== 'interchange') return true;
      if (turn.merge[u.id] && a.resLane === tl) return true;
    }
    return false;
  }

  majorApproaching(node, f, turn, tl, horizon) {
    for (const e of node.inE) {
      if (e === f.lane.edge || e.sign > 0) continue;
      const anySign = node.inE.some((x) => x.sign > 0);
      if (!anySign && node.major.size && !node.major.has(e.id)) continue;
      for (const lane of e.lanes) {
        const g = lane.veh[0];
        if (!g || g.granted || g.pi >= g.path.length - 1) continue;
        const nx = g.path[g.pi + 1];
        const gt = e.turns.get(nx.id);
        if (!gt) continue;
        if (!(turn.cross[gt.id] || (turn.merge[gt.id]))) continue;
        const tt = (e.L - g.s) / Math.max(g.v, 1.2);
        if (tt < horizon) return true;
      }
    }
    return false;
  }

  grant(node, f, turn, tl) {
    if (f.res) this.releaseRes(f);
    const conn = this.net.getConn(f.lane, tl);
    f.granted = true;
    f.nextConn = conn;
    f.targetLane = tl;
    tl.pending += f.len + GAP;
    f.res = node;
    f.resTurn = turn;
    f.resLane = tl;
    f.resFrom = f.lane;
    node.active.push(f);
    f.connV = this.connSpeed(node, f, turn);
    f.waitT = 0;
    f.stopT = 0;
    node.flowCount++;
    turn.flow++;
  }

  connSpeed(node, f, turn) {
    const base = Math.min(f.lane.edge.speed, turn.to.speed) * f.speedF;
    if (node.control === 'interchange') return base * (turn.kind === 'S' ? 1 : 0.72);
    if (node.control === 'signal') return base * (turn.kind === 'S' ? V_STRAIGHT : V_TURN);
    const e = f.lane.edge;
    const anySign = node.inE.some((x) => x.sign > 0);
    const isMajor = anySign ? e.sign === 0 : node.major.size ? node.major.has(e.id) : false;
    if (!isMajor) return V0 * V_AUTO * f.speedF;
    return base * (turn.kind === 'S' ? V_STRAIGHT : V_TURN);
  }

  releaseRes(f) {
    const node = f.res;
    if (!node) return;
    const i = node.active.indexOf(f);
    if (i >= 0) { node.active[i] = node.active[node.active.length - 1]; node.active.pop(); }
    f.res = null;
    f.resTurn = null;
    f.resLane = null;
  }

  // ── 회전교차로 ─────────────────────────────────────────
  tryRing(node, f) {
    const next = f.path[f.pi + 1];
    const turn = f.lane.edge.turns.get(next.id);
    if (!turn) return;
    const after = f.path[f.pi + 2] || null;
    const need = f.len + GAP;
    let lo = 0, hi = next.lanes.length - 1;
    if (after) {
      const t2 = next.turns.get(after.id);
      if (t2) { lo = Math.min(t2.laneLo, hi); hi = Math.min(t2.laneHi, hi); }
    }
    let tl = null, bf = -Infinity;
    for (let k = hi; k >= lo; k--) {
      const q = next.lanes[k];
      const fr = q.free();
      if (fr < need && (q.veh.length || q.pending > 0)) continue;
      if (fr > bf) { bf = fr; tl = q; }
    }
    if (!tl) return;
    const vRing = V0 * V_RING * f.speedF;
    for (let ringIdx = 0; ringIdx < node.ringLanes; ringIdx++) {
      const conn = this.net.getConn(f.lane, tl, ringIdx);
      const list = node.ring[ringIdx];
      const C = conn.ringC;
      if (list.length * (need + 0.4) > C * 0.92) continue;
      let ok = true;
      const entryV = conn.ringP0;
      const dist = (L1) => ((L1 % C) + C) % C;
      for (const w of list) {
        const pw = w.conn ? w.conn.ringP0 + (w.s - w.conn.ringS0) : w.nextConn.ringP0 - (w.nextConn.ringS0 + (w.lane.edge.L - w.s));
        const remain = w.conn ? w.conn.ringS1 - w.s : w.nextConn.ringS1 + (w.lane.edge.L - w.s);
        const behind = dist(entryV - pw);
        const ahead = dist(pw - entryV);
        if (ahead < w.len + GAP + f.len * 0.5) { ok = false; break; }
        if (behind < vRing * 0.85 + need && remain > behind - 0.3) { ok = false; break; }
      }
      if (!ok) continue;
      f.granted = true;
      f.nextConn = conn;
      f.targetLane = tl;
      tl.pending += need;
      f.connV = vRing;
      f.waitT = 0;
      f.ringNode = node;
      f.ringList = list;
      list.push(f);
      node.flowCount++;
      turn.flow++;
      return;
    }
  }

  leaveRing(f) {
    const list = f.ringList;
    if (!list) return;
    const i = list.indexOf(f);
    if (i >= 0) { list[i] = list[list.length - 1]; list.pop(); }
    f.ringList = null;
    f.ringNode = null;
  }

  ringLeaderGap(f) {
    const conn = f.conn;
    const list = f.ringList;
    const C = conn.ringC;
    const pc = conn.ringP0 + (f.s - conn.ringS0);
    let best = Infinity, bestV = 0;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      if (w === f || !w.conn) continue;
      const pw = w.conn.ringP0 + (w.s - w.conn.ringS0);
      const d = ((pw - pc) % C + C) % C;
      const g = d - w.len - GAP;
      if (d < C * 0.5 && g < best) { best = g; bestV = w.v; }
    }
    return [best, bestV];
  }

  // ── 이동 ──────────────────────────────────────────────
  stepConn(conn, dt) {
    const vs = conn.veh;
    const tl = conn.toLane;
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      let gap, leadV;
      if (i > 0) {
        const f = vs[i - 1];
        gap = f.s - f.len - c.s - GAP;
        leadV = f.v;
      } else {
        const t = tl.tail();
        if (t) { gap = conn.len - c.s + t.s - t.len - GAP; leadV = t.v; }
        else { gap = Infinity; leadV = 0; }
      }
      if (c.ringList && c.s < conn.ringS1) {
        const [g2, v2] = this.ringLeaderGap(c);
        if (g2 < gap) { gap = g2; leadV = v2; }
      }
      let vNew = c.v + ACC * dt;
      if (vNew > c.connV) vNew = Math.max(c.connV, c.v - BRK * dt);
      if (gap !== Infinity) {
        const safe = Math.sqrt(Math.max(0, leadV * leadV + 2 * BRK * Math.max(gap, 0)));
        if (safe < vNew) vNew = safe;
      }
      c.v = vNew;
      const ds = vNew * dt;
      c.s += ds;
      c.odo += ds;
      if (c.ringList && c.s > conn.ringS1 + c.len * 0.5) this.leaveRing(c);
    }
    // 끝까지 간 차는 다음 차로로
    while (vs.length && vs[0].s >= conn.len) {
      const c = vs.shift();
      const over = c.s - conn.len;
      this.leaveRing(c);
      tl.pending = Math.max(0, tl.pending - (c.len + GAP));
      const t = tl.tail();
      c.s = t ? Math.min(over, t.s - t.len - GAP) : over;
      c.conn = null;
      c.lane = tl;
      c.pi++;
      c.seg.seg = 0;
      c.granted = false;
      c.nextConn = null;
      c.targetLane = null;
      tl.veh.push(c);
      this.activate(tl);
    }
  }

  stepLane(lane, dt) {
    const vs = lane.veh;
    const e = lane.edge;
    const L = e.L;
    const roadV = e.speed;
    for (let i = 0; i < vs.length; i++) {
      const c = vs[i];
      let gap, leadV;
      let vLim = roadV * c.speedF;
      if (i > 0) {
        const f = vs[i - 1];
        gap = f.s - f.len - c.s - GAP;
        leadV = f.v;
      } else {
        const dStop = L - c.s;
        if (c.granted) {
          const conn = c.nextConn;
          const last = conn.veh.length ? conn.veh[conn.veh.length - 1] : null;
          if (last) { gap = dStop + last.s - last.len - GAP; leadV = last.v; }
          else {
            const t = c.targetLane.tail();
            if (t) { gap = dStop + conn.len + t.s - t.len - GAP; leadV = t.v; }
            else { gap = Infinity; leadV = 0; }
          }
          const lim = Math.sqrt(c.connV * c.connV + 2 * BRK * Math.max(dStop, 0));
          if (lim < vLim) vLim = lim;
        } else {
          gap = dStop - STOP_MARGIN;
          leadV = 0;
        }
        const le = lane.lastExit;
        if (le) {
          const moved = le.odo - lane.lastExitOdo;
          if (moved > le.len + GAP || le.state !== 'road') lane.lastExit = null;
          else if (c.granted) {
            const g2 = dStop + moved - le.len - GAP;
            if (g2 < gap) { gap = g2; leadV = le.v; }
          }
        }
      }
      let vNew = c.v + ACC * dt;
      if (vNew > vLim) vNew = Math.max(vLim, c.v - BRK * dt);
      if (gap !== Infinity) {
        const safe = Math.sqrt(Math.max(0, leadV * leadV + 2 * BRK * Math.max(gap, 0)));
        if (safe < vNew) vNew = safe;
      }
      c.v = vNew;
      const ds = vNew * dt;
      c.s += ds;
      c.odo += ds;
      if (c.res && (c.s >= c.len || c.s >= L - 0.1)) this.releaseRes(c);
    }
    if (!vs.length && lane.lastExit) {
      const le = lane.lastExit;
      if (le.odo - lane.lastExitOdo > le.len + GAP || le.state !== 'road') lane.lastExit = null;
    }

    // 교차로 진입
    while (vs.length) {
      const f = vs[0];
      if (f.s < L) break;
      if (!f.granted) { f.s = L - 0.001; f.v = 0; break; }
      vs.shift();
      const conn = f.nextConn;
      f.s -= L;
      f.lane = null;
      f.conn = conn;
      lane.lastExit = f;
      lane.lastExitOdo = f.odo - f.s;
      conn.veh.push(f);
      if (!conn.active) { conn.active = true; this.activeConns.push(conn); }
    }
  }

  removeFromLane(f) {
    const lane = f.lane;
    if (!lane) return;
    const i = lane.veh.indexOf(f);
    if (i >= 0) lane.veh.splice(i, 1);
    f.lane = null;
    f.v = 0;
    if (f.res) this.releaseRes(f);
  }

  // 차량을 도로에서 완전히 치운다 (구난, 처분)
  extract(f) {
    if (f.res) this.releaseRes(f);
    if (f.ringList) this.leaveRing(f);
    if (f.granted && f.targetLane) f.targetLane.pending = Math.max(0, f.targetLane.pending - (f.len + GAP));
    if (f.lane) {
      const i = f.lane.veh.indexOf(f);
      if (i >= 0) f.lane.veh.splice(i, 1);
      if (f.lane.lastExit === f) f.lane.lastExit = null;
      f.lane = null;
    }
    if (f.conn) {
      const i = f.conn.veh.indexOf(f);
      if (i >= 0) f.conn.veh.splice(i, 1);
      if (f.conn.toLane) f.conn.toLane.pending = Math.max(0, f.conn.toLane.pending);
      if (f.conn.fromLane.lastExit === f) f.conn.fromLane.lastExit = null;
      f.conn = null;
    }
    f.granted = false;
    f.nextConn = null;
    f.targetLane = null;
    f.state = 'idle';
    f.v = 0;
  }

  // ── 뱃길 ──────────────────────────────────────────────
  stepFerry(fy, dt) {
    if (fy.state === 'dock') {
      fy.t += dt;
      const nodeId = fy.dockNode();
      const side = fy.sideOf(nodeId);
      const here = fy.waiting[side];
      const there = fy.waiting[1 - side] + fy.transfer[1 - side].length;
      // 환승 대기 차량 탑승
      const tq = fy.transfer[side];
      while (tq.length && fy.cargo.length < fy.cap) {
        const v = tq.shift();
        v.pi++;
        fy.cargo.push(v);
      }
      const full = fy.cargo.length >= fy.cap;
      const leave = full || (fy.t >= 5 && fy.cargo.length > 0 && here === 0) || (fy.t >= 12 && fy.cargo.length > 0) || (fy.t >= 3 && fy.cargo.length === 0 && there > 0 && here === 0);
      if (leave) { fy.state = 'sail'; fy.t = 0; }
    } else {
      fy.pos += fy.dir * SHIP_SPEED * dt;
      const arrived = fy.dir === 1 ? fy.pos >= fy.len : fy.pos <= 0;
      if (arrived) {
        fy.pos = fy.dir === 1 ? fy.len : 0;
        const nodeId = fy.dir === 1 ? fy.road.b : fy.road.a;
        for (const v of fy.cargo) this.arrivals.push({ v, node: nodeId });
        fy.cargo.length = 0;
        fy.dir = -fy.dir;
        fy.state = 'dock';
        fy.t = 0;
        fy.trips++;
      }
    }
    fy.waiting[0] = 0;
    fy.waiting[1] = 0;
  }

  flushArrivals() {
    const a = this.arrivals;
    for (let i = a.length - 1; i >= 0; i--) {
      const { v, node } = a[i];
      const next = v.path[v.pi + 1];
      if (!next) { a.splice(i, 1); this.hooks.arrive(v); continue; }
      if (next.road.kind === 'f') {
        const fy = next.road.ferryObj;
        fy.transfer[fy.sideOf(node)].push(v);
        a.splice(i, 1);
        continue;
      }
      if (this.inject(v, next, v.pi + 1)) a.splice(i, 1);
    }
  }

  // ── 신호 ──────────────────────────────────────────────
  updateSignal(n, dt) {
    if (!n.phases || !n.phases.length) return;
    if (n.clearT > 0) {
      n.clearT -= dt;
      return;
    }
    n.phaseT -= dt;
    const ph = n.phases[n.phase];
    if (this.smartSignals) {
      // 감응 신호: 대기 차가 없으면 일찍 끊고, 몰리면 연장한다
      const demand = this.phaseDemand(n, n.phase);
      const elapsed = ph.green - n.phaseT;
      if (demand === 0 && elapsed > SMART_MIN) n.phaseT = 0;
      else if (n.phaseT <= 0 && demand > 2 && elapsed < SMART_MAX) n.phaseT = 0.6;
    }
    if (n.phaseT > 0) return;
    // 수요가 있는 다음 현시로
    let nxt = n.phase;
    let bestD = 0;
    for (let i = 1; i <= n.phases.length; i++) {
      const k = (n.phase + i) % n.phases.length;
      const d = this.phaseDemand(n, k);
      if (d > 0) { nxt = k; bestD = d; break; }
    }
    if (nxt !== n.phase) { n.phase = nxt; n.clearT = SIGNAL_CLEAR; }
    n.phaseT = n.phases[n.phase].green;
    return bestD;
  }

  phaseDemand(n, k) {
    const ph = n.phases[k];
    let d = 0;
    for (const e of n.inE) {
      for (const lane of e.lanes) {
        const f = lane.veh[0];
        if (!f || f.granted || f.pi >= f.path.length - 1) continue;
        if (e.L - f.s > 7) continue;
        const nx = f.path[f.pi + 1];
        const t = e.turns.get(nx.id);
        if (t && ph.allow[t.id]) d += lane.veh.length;
      }
    }
    return d;
  }

  // 교차로 형태 변경
  setControl(n, control) {
    const prev = n.control;
    if (prev === control) return;
    n.control = control;
    this.signalNodes.delete(n);
    n.phases = null;
    if (control === 'signal') {
      n.phases = buildPhases(n);
      n.phase = 0;
      n.phaseT = n.phases[0] ? n.phases[0].green : SIGNAL_GREEN;
      n.clearT = 0;
      this.signalNodes.add(n);
    }
    if (control === 'roundabout') {
      n.ring = [[], []];
    }
    if (control !== 'auto') for (const e of n.inE) e.sign = 0;
    this.net.computeGeometry(n);
    for (const e of n.outE) for (const l of e.lanes) l.conns.clear();
    for (const e of n.inE) for (const l of e.lanes) l.conns.clear();
    this.net.version++;
  }

  // ── 통계 ──────────────────────────────────────────────
  updateStats(dt) {
    const net = this.net;
    for (const n of net.nodes) { n.waiting = 0; n.waitSum = 0; n.stuckNow = 0; }
    const K = 1 - Math.exp(-dt / 1.6);
    for (const e of net.edges) {
      let count = 0, sumV = 0, stopped = 0, occupied = 0;
      for (const lane of e.lanes) {
        const vs = lane.veh;
        count += vs.length;
        for (let i = 0; i < vs.length; i++) {
          const c = vs[i];
          sumV += c.v;
          occupied += c.len + GAP;
          if (c.v < 0.5) stopped++;
        }
        const f = vs[0];
        if (f && f.v < 0.2 && !f.granted) lane.stall = (lane.stall || 0) + dt;
        else lane.stall = 0;
        if (lane.stall > 0) {
          const n = net.nodes[e.to];
          if (lane.stall > n.stuckNow) n.stuckNow = lane.stall;
        }
      }
      e.count = count;
      let target = 0;
      if (count > 0) {
        const avg = sumV / count;
        const free = e.speed * 0.9;
        const slow = Math.max(0, 1 - avg / free);
        const dens = Math.min(1, occupied / (e.L * e.lanes.length));
        target = Math.min(1, slow * (0.45 + dens));
        if (stopped / count > 0.55 && dens > 0.3) target = Math.max(target, 0.85);
      }
      e.cong += (target - e.cong) * K;
      if (stopped) {
        const n = net.nodes[e.to];
        n.waiting += stopped;
      }
    }
    for (const n of net.nodes) {
      n.flow += (n.flowCount / dt - n.flow) * (1 - Math.exp(-dt / 12));
      n.flowCount = 0;
      n.stuckT = n.stuckNow;
    }
  }

  // 위치 계산 (렌더링용)
  pose(v, out) {
    if (v.lane) return v.lane.edge.sample(v.s, laneOffset(v.lane.index), out, v.seg);
    if (v.conn) return v.conn.sample(v.s, out);
    return null;
  }
}

// 충돌하지 않는 움직임끼리 묶어 신호 현시를 만든다
export function buildPhases(n) {
  const turns = n.turns;
  const phases = [];
  const done = new Uint8Array(turns.length);
  const order = turns.slice().sort((a, b) => rank(a) - rank(b));
  for (const seed of order) {
    if (done[seed.id]) continue;
    const allow = new Uint8Array(turns.length);
    const members = [seed];
    allow[seed.id] = 1;
    for (const t of order) {
      if (allow[t.id]) continue;
      let ok = true;
      for (const m of members) if (t.cross[m.id] || m.cross[t.id]) { ok = false; break; }
      if (ok) { allow[t.id] = 1; members.push(t); }
    }
    for (const m of members) done[m.id] = 1;
    phases.push({ allow, members, green: SIGNAL_GREEN });
  }
  return phases;
}
function rank(t) { return t.kind === 'S' ? 0 : t.kind === 'L' ? 1 : 2; }
