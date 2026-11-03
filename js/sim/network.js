// 런타임 도로망: 지도 데이터를 차로·교차로 구조로 바꾼다. DOM에 의존하지 않는다.
// 좌표 단위 km, 우측통행. 차로 0번이 중앙선 쪽.

export const LANE_W = 0.34;
export const MEDIAN = 0.07;
export const MAX_LANES = { x: 5, n: 4, r: 3, s: 3, f: 1 };
export const BASE_LANES = { x: 2, n: 1, r: 1, s: 1, f: 1 };
export const ROAD_SPEED = { x: 1, n: 0.74, r: 0.62, s: 0.5, f: 0.5 };
export const V0 = 5.6; // 고속도로 기준 속도 km/s

export const laneOffset = (i) => MEDIAN + LANE_W * (i + 0.5);

export class Lane {
  constructor(edge, index) {
    this.edge = edge;
    this.index = index;
    this.veh = [];        // 앞차부터 순서대로
    this.lastExit = null; // 교차로에 막 들어간 차. 꼬리가 빠질 때까지 다음 차가 조심한다
    this.pending = 0;     // 이 차로로 들어오기로 허가받은 차들이 차지할 길이
    this.active = false;
    this.conns = new Map();
  }
  get L() { return this.edge.L; }
  tail() { return this.veh.length ? this.veh[this.veh.length - 1] : null; }
  // 맨 뒤 차 꼬리까지의 빈 공간
  free() {
    const t = this.tail();
    return (t ? Math.min(t.s - t.len, this.edge.L) : this.edge.L) - this.pending;
  }
  // 허가받은 차가 닿을 즈음의 빈 공간. 달리는 맨 뒤 차는 그때쯤 더 가 있다.
  // 앞이 막혀 있으면 그만큼 못 가므로, 줄이 있는 차로에 잘못 들어가 교차로를 막는 일은 없다
  freeSoon() {
    const vs = this.veh, n = vs.length;
    if (!n) return this.edge.L - this.pending;
    const t = vs[n - 1];
    const room = n > 1 ? vs[n - 2].s - vs[n - 2].len - t.s - 0.32 : this.edge.L - t.s - 3;
    return Math.min(t.s - t.len + Math.min(t.v * 0.7, Math.max(0, room)), this.edge.L) - this.pending;
  }
}

export class Edge {
  constructor(id, road, rev) {
    this.id = id;
    this.road = road;
    this.rev = rev;
    this.from = rev ? road.b : road.a;
    this.to = rev ? road.a : road.b;
    this.lanes = [];
    this.trim0 = 0;
    this.trim1 = 0;
    this.L = road.len;
    this.turns = new Map();   // 다음 Edge id → Turn
    this.sign = 0;            // 0 없음, 1 양보, 2 정지
    // 통계
    this.cong = 0;            // 0~1 혼잡도
    this.count = 0;
    this.flow = 0;
    this.path2d = null;
    this.geomVersion = 0;
  }
  get speed() { return V0 * ROAD_SPEED[this.road.kind]; }
  syncLanes() {
    while (this.lanes.length < this.road.lanes) this.lanes.push(new Lane(this, this.lanes.length));
  }
  // 진행 방향 s 지점의 좌표. out[0..3] = x, y, tx, ty
  sample(s, offset, out, hintObj) {
    const r = this.road;
    const d = this.rev ? r.len - (this.trim0 + s) : this.trim0 + s;
    const cum = r.cum, pts = r.pts;
    let i = hintObj ? hintObj.seg | 0 : 0;
    const last = cum.length - 2;
    if (i > last) i = last;
    if (cum[i] > d || cum[i + 1] < d) {
      // 근처를 먼저 보고, 멀면 이진 탐색
      if (i < last && cum[i + 1] <= d && cum[i + 2] >= d) i++;
      else if (i > 0 && cum[i - 1] <= d && cum[i] >= d) i--;
      else {
        let lo = 0, hi = last;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (cum[m + 1] < d) lo = m + 1; else hi = m;
        }
        i = lo;
      }
    }
    if (hintObj) hintObj.seg = i;
    const x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], y1 = pts[i * 2 + 3];
    const segLen = cum[i + 1] - cum[i];
    const t = segLen > 0 ? (d - cum[i]) / segLen : 0;
    let tx = segLen > 0 ? (x1 - x0) / segLen : 1, ty = segLen > 0 ? (y1 - y0) / segLen : 0;
    if (this.rev) { tx = -tx; ty = -ty; }
    out[0] = x0 + (x1 - x0) * t - ty * offset;
    out[1] = y0 + (y1 - y0) * t + tx * offset;
    out[2] = tx;
    out[3] = ty;
    return out;
  }
  // 차로 중앙을 따라가는 좌표열 (렌더링용)
  lanePolyline(offset) {
    const r = this.road;
    const out = [];
    const tmp = [0, 0, 0, 0];
    const s0 = this.trim0, s1 = this.trim0 + this.L;
    const dists = [];
    if (!this.rev) {
      dists.push(s0);
      for (let i = 1; i < r.cum.length - 1; i++) if (r.cum[i] > s0 && r.cum[i] < s1) dists.push(r.cum[i]);
      dists.push(s1);
    } else {
      dists.push(s0);
      for (let i = r.cum.length - 2; i >= 1; i--) { const d = r.len - r.cum[i]; if (d > s0 && d < s1) dists.push(d); }
      dists.push(s1);
    }
    for (const d of dists) {
      this.sample(d - this.trim0, offset, tmp);
      out.push(tmp[0], tmp[1]);
    }
    return out;
  }
}

export class Road {
  constructor(id, d) {
    this.id = id;
    this.a = d.a;
    this.b = d.b;
    this.kind = d.k;
    this.name = d.n || '';
    this.ref = d.ref || '';
    this.region = d.r;
    this.lock = d.lock || null;
    this.ferry = d.ferry || null;
    this.stage = d.stage ?? 0;
    this.lanes = BASE_LANES[d.k];
    this.built = !d.lock;
    this.pts = Float64Array.from(d.p);
    const n = this.pts.length / 2;
    this.cum = new Float64Array(n);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = this.pts[i * 2], y = this.pts[i * 2 + 1];
      if (i > 0) this.cum[i] = this.cum[i - 1] + Math.hypot(x - this.pts[i * 2 - 2], y - this.pts[i * 2 - 1]);
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    this.len = this.cum[n - 1];
    this.bb = [x0, y0, x1, y1];
    this.open = false;
    this.fwd = null;
    this.bwd = null;
  }
  // 노드 쪽에서 바라본 도로 방향 단위벡터
  dirAt(nodeId, dist = 1.6) {
    const pts = this.pts, cum = this.cum, n = cum.length;
    let px, py, qx, qy;
    if (nodeId === this.a) {
      px = pts[0]; py = pts[1];
      let i = 1;
      while (i < n - 1 && cum[i] < dist) i++;
      qx = pts[i * 2]; qy = pts[i * 2 + 1];
    } else {
      px = pts[n * 2 - 2]; py = pts[n * 2 - 1];
      let i = n - 2;
      while (i > 0 && this.len - cum[i] < dist) i--;
      qx = pts[i * 2]; qy = pts[i * 2 + 1];
    }
    const dx = qx - px, dy = qy - py, l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }
}

// 교차로 안의 한 움직임 (들어오는 Edge → 나가는 Edge)
export class Turn {
  constructor(node, id, from, to, kind, angle) {
    this.node = node;
    this.id = id;
    this.from = from;
    this.to = to;
    this.kind = kind;   // L, S, R
    this.angle = angle;
    this.cross = null;  // 교차 충돌 Uint8Array
    this.merge = null;  // 합류 충돌 Uint8Array
    this.flow = 0;
    this.laneLo = 0;
    this.laneHi = 0;
  }
}

// 좌표열 하나로 된 경로
export class Polyline {
  constructor(pts) {
    this.pts = pts;              // [x,y,...]
    const n = pts.length / 2;
    this.cum = new Float64Array(n);
    for (let i = 1; i < n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    this.len = Math.max(0.2, this.cum[n - 1]);
  }
  sample(s, out) {
    const cum = this.cum, pts = this.pts, n = cum.length;
    let lo = 0, hi = n - 2;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cum[m + 1] < s) lo = m + 1; else hi = m;
    }
    const seg = cum[lo + 1] - cum[lo];
    const t = seg > 0 ? Math.min(1, Math.max(0, (s - cum[lo]) / seg)) : 0;
    const dx = pts[lo * 2 + 2] - pts[lo * 2], dy = pts[lo * 2 + 3] - pts[lo * 2 + 1];
    const l = Math.hypot(dx, dy) || 1;
    out[0] = pts[lo * 2] + dx * t;
    out[1] = pts[lo * 2 + 1] + dy * t;
    out[2] = dx / l;
    out[3] = dy / l;
    return out;
  }
}

// 두 차로를 잇는 교차로 내부 경로
export class Conn extends Polyline {
  constructor(fromLane, toLane, pts) {
    super(pts);
    this.fromLane = fromLane;
    this.toLane = toLane;
    this.veh = [];
    this.active = false;
    this.ringS0 = 0;  // 회전교차로 구간 시작 s
    this.ringS1 = 0;  // 회전교차로 구간 끝 s
    this.ringP0 = 0;  // 진입 지점의 원주 좌표
    this.ring = null;
  }
}

export class Node {
  constructor(id, d) {
    this.id = id;
    this.x = d.x;
    this.y = d.y;
    this.name = d.name;
    this.region = d.r;
    this.terminal = !!d.t;
    this.roads = [];
    this.inE = [];
    this.outE = [];
    this.turns = [];
    this.R = 0.6;
    this.control = 'auto';  // auto | signal | roundabout | interchange
    this.ringLanes = 1;
    this.major = new Set(); // 기본 우선 도로 (들어오는 Edge id)
    this.active = [];       // 교차로 사용 허가를 받은 차들
    this.req = [];
    this.site = null;
    // 신호
    this.allow = null;
    this.phaseT = 0;
    this.clearT = 0;
    // 회전교차로
    this.ring = null;
    // 통계
    this.waiting = 0;
    this.waitSum = 0;
    this.flowCount = 0;
    this.flow = 0;
    this.stuckT = 0;
  }
  get degree() { return this.roads.length; }
}

export class Network {
  constructor(data) {
    this.nodes = data.nodes.map((d, i) => new Node(i, d));
    this.roads = data.roads.map((d, i) => new Road(i, d));
    this.edges = [];
    for (const r of this.roads) {
      const f = new Edge(this.edges.length, r, false); this.edges.push(f);
      const b = new Edge(this.edges.length, r, true); this.edges.push(b);
      r.fwd = f; r.bwd = b;
      f.syncLanes(); b.syncLanes();
      const A = this.nodes[r.a], B = this.nodes[r.b];
      A.roads.push(r); B.roads.push(r);
      A.outE.push(f); B.inE.push(f);
      B.outE.push(b); A.inE.push(b);
    }
    for (const n of this.nodes) {
      this.computeGeometry(n);
      this.computeDefaultPriority(n);
    }
    for (const n of this.nodes) this.buildTurns(n);
    this.version = 1;
  }

  // 교차로 반경을 정하고 도로 끝을 잘라낸다
  computeGeometry(n) {
    const rs = n.roads.filter((r) => r.kind !== 'f');
    if (n.terminal || rs.length <= 1) n.R = n.terminal ? 0.3 : 0.5;
    else {
      const width = (r) => 2 * (MEDIAN + LANE_W * r.lanes);
      let maxW = 0;
      for (const r of rs) maxW = Math.max(maxW, width(r));
      let R = Math.max(0.75, 0.35 + maxW * 0.72);
      // 사잇각이 좁으면 벌어지는 지점까지 물러난다
      const dirs = rs.map((r) => {
        const d = r.dirAt(n.id);
        return { a: Math.atan2(d[1], d[0]), w: width(r) };
      }).sort((p, q) => p.a - q.a);
      for (let i = 0; i < dirs.length; i++) {
        const p = dirs[i], q = dirs[(i + 1) % dirs.length];
        let da = q.a - p.a;
        if (da <= 0) da += Math.PI * 2;
        if (da < 2.2) R = Math.max(R, Math.min(2.1, ((p.w + q.w) / 2) / (2 * Math.sin(da / 2))));
      }
      if (n.control === 'roundabout') R = Math.max(R, this.ringRadius(n) + 1.15);
      n.R = R;
    }
    for (const r of rs) this.applyTrim(r);
  }

  ringRadius(n) {
    let maxW = 0;
    for (const r of n.roads) if (r.kind !== 'f') maxW = Math.max(maxW, 2 * (MEDIAN + LANE_W * r.lanes));
    return Math.max(1.7, maxW * 0.9) + (n.ringLanes - 1) * LANE_W * 0.5;
  }

  applyTrim(r) {
    const A = this.nodes[r.a], B = this.nodes[r.b];
    const maxTrim = r.len * 0.34;
    const ta = Math.min(A.R, maxTrim), tb = Math.min(B.R, maxTrim);
    const fwd = r.fwd, bwd = r.bwd;
    fwd.trim0 = ta; fwd.trim1 = tb; fwd.L = r.len - ta - tb;
    bwd.trim0 = tb; bwd.trim1 = ta; bwd.L = r.len - ta - tb;
    for (const e of [fwd, bwd]) {
      e.geomVersion++;
      e.path2d = null;
      for (const lane of e.lanes) lane.conns.clear();
    }
  }

  // 고속도로 위 교차로는 기본적으로 고속도로 직진축이 우선
  computeDefaultPriority(n) {
    n.major.clear();
    if (n.terminal) return;
    const xIn = n.inE.filter((e) => e.road.kind === 'x');
    if (xIn.length >= 2) {
      // 가장 곧게 이어지는 고속도로 쌍을 찾는다
      let best = null, bestDot = -0.2;
      for (let i = 0; i < xIn.length; i++) {
        for (let j = i + 1; j < xIn.length; j++) {
          const a = xIn[i].road.dirAt(n.id), b = xIn[j].road.dirAt(n.id);
          const dot = -(a[0] * b[0] + a[1] * b[1]);
          if (dot > bestDot) { bestDot = dot; best = [xIn[i], xIn[j]]; }
        }
      }
      if (best) for (const e of best) n.major.add(e.id);
    }
  }

  buildTurns(n) {
    n.turns = [];
    for (const e of n.inE) e.turns.clear();
    if (n.terminal && n.inE.length <= 1) return;
    const usable = n.roads;
    const armOrder = usable.map((r) => {
      const d = r.dirAt(n.id);
      return { r, a: Math.atan2(d[1], d[0]), d };
    }).sort((p, q) => p.a - q.a);
    const armPos = new Map();
    armOrder.forEach((arm, i) => armPos.set(arm.r.id, i));
    const pos = (e, isIn) => armPos.get(e.road.id) * 2 + (isIn ? 0 : 1);

    for (const ein of n.inE) {
      const dIn = ein.road.dirAt(n.id);
      const heading = [-dIn[0], -dIn[1]];
      const list = [];
      for (const eout of n.outE) {
        if (eout.road === ein.road) continue;
        const dOut = eout.road.dirAt(n.id);
        const cross = heading[0] * dOut[1] - heading[1] * dOut[0];
        const dot = heading[0] * dOut[0] + heading[1] * dOut[1];
        const angle = Math.atan2(cross, dot);
        const kind = Math.abs(angle) < 0.7 ? 'S' : angle > 0 ? 'R' : 'L';
        const t = new Turn(n, n.turns.length, ein, eout, kind, angle);
        n.turns.push(t);
        ein.turns.set(eout.id, t);
        list.push(t);
      }
      list.sort((p, q) => p.angle - q.angle); // 왼쪽 → 오른쪽
      ein.turnList = list;
      this.assignTurnLanes(ein);
    }
    // 충돌표
    const T = n.turns.length;
    const size = T;
    for (const t of n.turns) { t.cross = new Uint8Array(size); t.merge = new Uint8Array(size); }
    for (let i = 0; i < T; i++) {
      const a = n.turns[i];
      const a1 = pos(a.from, true), a2 = pos(a.to, false);
      for (let j = i + 1; j < T; j++) {
        const b = n.turns[j];
        if (a.from === b.from) continue;
        if (a.to === b.to) { a.merge[j] = 1; b.merge[i] = 1; continue; }
        const b1 = pos(b.from, true), b2 = pos(b.to, false);
        const between = (x, p, q) => (p < q ? x > p && x < q : x > p || x < q);
        if (between(b1, a1, a2) !== between(b2, a1, a2)) { a.cross[j] = 1; b.cross[i] = 1; }
      }
    }
  }

  assignTurnLanes(ein) {
    const list = ein.turnList;
    if (!list) return;
    const n = ein.road.lanes, m = list.length;
    list.forEach((t, k) => {
      t.laneLo = Math.floor((k * n) / m);
      t.laneHi = Math.max(t.laneLo, Math.ceil(((k + 1) * n) / m) - 1);
    });
  }

  // 차로가 늘어난 도로 반영
  setLanes(road, lanes) {
    road.lanes = lanes;
    road.fwd.syncLanes();
    road.bwd.syncLanes();
    for (const nid of [road.a, road.b]) {
      const n = this.nodes[nid];
      this.computeGeometry(n);
      if (n.turns.length) for (const e of n.inE) this.assignTurnLanes(e);
    }
    this.version++;
  }

  // 교차로 내부 경로
  getConn(fromLane, toLane, ringIdx = 0) {
    const key = toLane.edge.id * 8 + toLane.index + (ringIdx ? 0.5 : 0);
    let c = fromLane.conns.get(key);
    if (c) return c;
    const node = this.nodes[fromLane.edge.to];
    const p0 = fromLane.edge.sample(fromLane.edge.L, laneOffset(fromLane.index), [0, 0, 0, 0]);
    const p1 = toLane.edge.sample(0, laneOffset(toLane.index), [0, 0, 0, 0]);
    if (node.control === 'roundabout') c = this.ringConn(node, fromLane, toLane, p0, p1, ringIdx);
    else {
      const pts = bezier(p0[0], p0[1], p0[2], p0[3], p1[0], p1[1], p1[2], p1[3], 9);
      c = new Conn(fromLane, toLane, pts);
    }
    fromLane.conns.set(key, c);
    return c;
  }

  ringConn(node, fromLane, toLane, p0, p1, ringIdx) {
    const R = this.ringRadius(node) - ringIdx * LANE_W;
    const cx = node.x, cy = node.y;
    const angIn = Math.atan2(p0[1] - cy, p0[0] - cx);
    const angOut = Math.atan2(p1[1] - cy, p1[0] - cx);
    let th0 = angIn - 0.26;
    let th1 = angOut + 0.26;
    while (th1 >= th0 - 0.15) th1 -= Math.PI * 2;
    const ptOn = (th) => [cx + Math.cos(th) * R, cy + Math.sin(th) * R];
    // 진행 방향은 각도 감소 (위에서 볼 때 반시계)
    const tanOn = (th) => [Math.sin(th), -Math.cos(th)];
    const a = ptOn(th0), ta = tanOn(th0);
    const b = ptOn(th1), tb = tanOn(th1);
    const entry = bezier(p0[0], p0[1], p0[2], p0[3], a[0], a[1], ta[0], ta[1], 5);
    const arc = [];
    const steps = Math.max(3, Math.ceil(Math.abs(th1 - th0) / 0.22));
    for (let i = 1; i < steps; i++) {
      const th = th0 + ((th1 - th0) * i) / steps;
      const q = ptOn(th);
      arc.push(q[0], q[1]);
    }
    const exit = bezier(b[0], b[1], tb[0], tb[1], p1[0], p1[1], p1[2], p1[3], 5);
    const pts = entry.concat(arc, exit);
    const c = new Conn(fromLane, toLane, pts);
    let entryLen = 0;
    for (let i = 2; i < entry.length; i += 2) entryLen += Math.hypot(entry[i] - entry[i - 2], entry[i + 1] - entry[i - 1]);
    const arcLen = Math.abs(th1 - th0) * R;
    c.ringS0 = entryLen;
    c.ringS1 = entryLen + arcLen;
    const TAU = Math.PI * 2;
    c.ringP0 = (((-th0 % TAU) + TAU) % TAU) * R;
    c.ring = ringIdx;
    c.ringC = TAU * R;
    return c;
  }

  nodeOfSite(site) { return this.nodes[site.node]; }
}

export function bezier(x0, y0, tx0, ty0, x1, y1, tx1, ty1, n) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const k = Math.min(d * 0.42, 2.2);
  const c1x = x0 + tx0 * k, c1y = y0 + ty0 * k;
  const c2x = x1 - tx1 * k, c2y = y1 - ty1 * k;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    pts.push(a * x0 + b * c1x + c * c2x + e * x1, a * y0 + b * c1y + c * c2y + e * y1);
  }
  return pts;
}

// 이진 힙 기반 최단 경로. 상태는 Edge (유턴 금지)
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const { k, v } = this;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const { k, v } = this;
    const topV = v[0];
    const lastK = k.pop(), lastV = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c];
        i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return topV;
  }
}

export const SHIP_SPEED = 2.6;

export function edgeCost(e, net, opts) {
  const r = e.road;
  if (r.kind === 'f') return r.len / SHIP_SPEED + 10;
  let c = e.L / e.speed;
  const n = net.nodes[e.to];
  if (n.control === 'signal') c += 1.0;
  else if (n.control === 'roundabout') c += 0.7;
  else if (n.control === 'auto' && !n.major.has(e.id) && n.inE.length > 1) c += 0.7;
  if (opts && opts.congestion) {
    c *= 1 + e.cong * 3.5;
    c += n.waiting * 0.06;
  }
  return c;
}

// start Edge에서 출발하는 최단 시간 트리. 결과: cost[edge], prev[edge]
export function shortestTree(net, startEdge, opts) {
  const N = net.edges.length;
  const cost = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new Heap();
  cost[startEdge.id] = edgeCost(startEdge, net, opts);
  heap.push(cost[startEdge.id], startEdge.id);
  while (heap.size) {
    const eid = heap.pop();
    const e = net.edges[eid];
    const base = cost[eid];
    const toNode = net.nodes[e.to];
    if (toNode.site && toNode.terminal) continue;
    for (const o of toNode.outE) {
      if (!o.road.open || o.road === e.road) continue;
      const nc = base + edgeCost(o, net, opts);
      if (nc < cost[o.id]) {
        cost[o.id] = nc;
        prev[o.id] = eid;
        heap.push(nc, o.id);
      }
    }
  }
  return { cost, prev };
}

export function extractPath(net, tree, targetEdge) {
  if (!isFinite(tree.cost[targetEdge.id])) return null;
  const out = [];
  for (let e = targetEdge.id; e !== -1; e = tree.prev[e]) out.push(net.edges[e]);
  out.reverse();
  return out;
}

export function pathLength(path) {
  let s = 0;
  for (const e of path) s += e.road.len;
  return s;
}
