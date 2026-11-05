// 런타임 도로망: 지도 데이터를 차로·교차로 구조로 바꾼다. DOM에 의존하지 않는다.
// 좌표 단위 km, 우측통행. 차로 0번이 중앙선 쪽.

export const LANE_W = 0.34;
export const MEDIAN = 0.07;
export const MAX_LANES = { x: 5, n: 4, r: 3, s: 3, f: 1 };
export const BASE_LANES = { x: 2, n: 1, r: 1, s: 1, f: 1 };
export const ROAD_SPEED = { x: 1, n: 0.74, r: 0.62, s: 0.5, f: 0.5 };
export const V0 = 5.6; // 고속도로 기준 속도 km/s
const OMEGA = 2.4;       // 트럭이 도는 모습이 어색하지 않은 가장 빠른 방향 변화 rad/s
const TURN_WINDOW = 1;   // 방향 변화를 재는 구간 km
const V_FLOOR = 0.8;     // 아무리 급해도 이 속도까지만 줄인다 km/s
const V_KEEP = 6;        // 이보다 빠르게 지날 수 있는 곳은 급커브로 치지 않는다
const ROUND_MAX_R = 3.5; // 도로 꼭짓점을 둥글릴 때의 가장 큰 반경 km
const TURN_R = 0.6;      // 트럭이 도는 가장 작은 반경 km. 교차로 곡선이 이보다 많이 급하면 크게 돌아 나온다
const R_JUNCTION = 1.5;  // 세 갈래 이상 교차로의 가장 작은 반경 km. 더 좁으면 꺾는 트럭이 제자리를 한 바퀴 돌아 나온다

const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// 좌표열의 급커브 구간 [{s0, s1, v}]. 1km 안에서 방향이 많이 바뀔수록 v가 낮다
export function findCorners(pts) {
  const n = pts.length / 2;
  const out = [];
  if (n < 3) return out;
  const cum = new Float64Array(n), turn = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  for (let i = 1; i < n - 1; i++) {
    const a0 = Math.atan2(pts[i * 2 + 1] - pts[i * 2 - 1], pts[i * 2] - pts[i * 2 - 2]);
    const a1 = Math.atan2(pts[i * 2 + 3] - pts[i * 2 + 1], pts[i * 2 + 2] - pts[i * 2]);
    turn[i] = wrapAngle(a1 - a0);
  }
  let lo = 1, hi = 1, sum = 0, cur = null;
  for (let i = 1; i < n - 1; i++) {
    while (hi < n - 1 && cum[hi] <= cum[i] + TURN_WINDOW / 2) sum += turn[hi++];
    while (lo < n - 1 && cum[lo] < cum[i] - TURN_WINDOW / 2) sum -= turn[lo++];
    const span = Math.min(cum[n - 1], cum[i] + TURN_WINDOW / 2) - Math.max(0, cum[i] - TURN_WINDOW / 2);
    const v = Math.max(V_FLOOR, (OMEGA * span) / Math.max(Math.abs(sum), 1e-3));
    if (v >= V_KEEP) continue;
    if (cur && cum[i] - cur.s1 < 0.3) {
      cur.s1 = cum[i];
      if (v < cur.v) cur.v = v;
    } else {
      cur = { s0: cum[i], s1: cum[i], v };
      out.push(cur);
    }
  }
  return out;
}

// 도로 꼭짓점을 둥글게 편다. 되돌아가는 짧은 가시는 먼저 없앤다
function roundCorners(flat) {
  const p = [];
  for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]);
  const angleAt = (i) => wrapAngle(Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]) - Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (let i = 1; i < p.length - 1; i++) {
    if (Math.abs(angleAt(i)) > 2 && Math.min(dist(p[i], p[i - 1]), dist(p[i], p[i + 1])) < 1) {
      p.splice(i, 1);
      i = 0;
    }
  }
  const out = [p[0][0], p[0][1]];
  for (let i = 1; i < p.length - 1; i++) {
    const th = Math.abs(angleAt(i));
    if (th < 0.15) { out.push(p[i][0], p[i][1]); continue; }
    const la = dist(p[i], p[i - 1]), lb = dist(p[i], p[i + 1]);
    const T = Math.min(la * 0.42, lb * 0.42, ROUND_MAX_R * Math.tan(th / 2));
    const ax = p[i][0] + ((p[i - 1][0] - p[i][0]) / la) * T, ay = p[i][1] + ((p[i - 1][1] - p[i][1]) / la) * T;
    const bx = p[i][0] + ((p[i + 1][0] - p[i][0]) / lb) * T, by = p[i][1] + ((p[i + 1][1] - p[i][1]) / lb) * T;
    const m = Math.ceil(th / 0.22) + 1;
    for (let j = 0; j <= m; j++) {
      const t = j / m, u = 1 - t;
      out.push(u * u * ax + 2 * u * t * p[i][0] + t * t * bx, u * u * ay + 2 * u * t * p[i][1] + t * t * by);
    }
  }
  const e = p[p.length - 1];
  out.push(e[0], e[1]);
  return out;
}

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
  // 앞이 막혀 있으면 그만큼 못 가므로, 줄이 있는 차로에 잘못 들어가 교차로를 막는 일은 없다.
  // 혼자 있는 차는 정지선 앞에서 설 수도 있어 조심한다. 다만 앞길을 허가받았거나 거점으로 굴러 들어가는 차는 서지 않는다.
  // 이걸 안 보면 트럭 한 대 길이밖에 안 되는 짧은 구간에는 한 번에 한 대만 들어간다
  freeSoon() {
    const vs = this.veh, n = vs.length;
    if (!n) return this.edge.L - this.pending;
    const t = vs[n - 1];
    const room = n > 1 ? vs[n - 2].s - vs[n - 2].len - t.s - 0.32 : t.granted || t.rolling ? Infinity : this.edge.L - t.s - 3;
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
    this.jam = 0;             // 혼잡도의 느린 평균. 신호 한 번 기다린 것과 정말 막힌 것을 가른다
    this.held = 0;            // 서 있는 트럭 수의 느린 평균
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
    // 꼭짓점에서 차로가 끊겨 튀지 않도록 양 끝 법선 사이를 잇는다
    const nrm = r.nrm;
    let nx = nrm[i * 2] + (nrm[i * 2 + 2] - nrm[i * 2]) * t, ny = nrm[i * 2 + 1] + (nrm[i * 2 + 3] - nrm[i * 2 + 1]) * t;
    if (this.rev) { tx = -tx; ty = -ty; nx = -nx; ny = -ny; }
    out[0] = x0 + (x1 - x0) * t + nx * offset;
    out[1] = y0 + (y1 - y0) * t + ny * offset;
    out[2] = tx;
    out[3] = ty;
    return out;
  }
  // 이 방향으로 달릴 때 만나는 급커브. s는 차로 위 거리
  cornerList() {
    if (this.cornerVer === this.geomVersion && this.corners) return this.corners;
    const r = this.road, out = [];
    for (const c of r.corners) {
      const s0 = this.rev ? r.len - c.s1 - this.trim0 : c.s0 - this.trim0;
      const s1 = this.rev ? r.len - c.s0 - this.trim0 : c.s1 - this.trim0;
      if (s1 > 0 && s0 < this.L) out.push({ s0: Math.max(0, s0), s1: Math.min(this.L, s1), v: c.v });
    }
    if (this.rev) out.reverse();
    this.corners = out;
    this.cornerVer = this.geomVersion;
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
    this.parent = d.parent ?? null; // 거점 입구를 내느라 갈라져 나온 도로라면 원래 도로 번호
    this.ferry = d.ferry || null;
    this.stage = d.stage ?? 0;
    this.lanes = BASE_LANES[d.k];
    this.built = !d.lock;
    this.pts = Float64Array.from(d.k === 'f' ? d.p : roundCorners(d.p));
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
    this.nrm = this.vertexNormals();
    this.corners = d.k === 'f' ? [] : findCorners(this.pts);
    this.open = false;
    this.fwd = null;
    this.bwd = null;
  }
  // 꼭짓점의 왼쪽 법선. 꺾인 만큼 길게 해 차로 폭을 유지한다
  vertexNormals() {
    const pts = this.pts, n = pts.length / 2;
    const out = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let ux = pts[i * 2] - pts[a * 2], uy = pts[i * 2 + 1] - pts[a * 2 + 1];
      let wx = pts[b * 2] - pts[i * 2], wy = pts[b * 2 + 1] - pts[i * 2 + 1];
      const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
      if (lu > 0) { ux /= lu; uy /= lu; } else { ux = wx / (lw || 1); uy = wy / (lw || 1); }
      if (lw > 0) { wx /= lw; wy /= lw; } else { wx = ux; wy = uy; }
      let nx = -uy - wy, ny = ux + wx;
      const l = Math.hypot(nx, ny);
      if (l < 0.1) { nx = -wy; ny = wx; } else {
        nx /= l; ny /= l;
        const f = Math.min(1.5, 1 / Math.max(0.5, nx * -uy + ny * ux));
        nx *= f; ny *= f;
      }
      out[i * 2] = nx;
      out[i * 2 + 1] = ny;
    }
    return out;
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
  // 급커브 구간. 트럭은 들어가기 전에 이 속도로 줄인다
  get corners() { return this.cornerCache || (this.cornerCache = findCorners(this.pts)); }
  // 이 경로를 어색하지 않게 지날 수 있는 가장 빠른 속도
  get vMax() {
    let v = Infinity;
    for (const c of this.corners) if (c.v < v) v = c.v;
    return v;
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

// 지도를 만들 때 겹치는 길을 합치면서 고속도로 일부가 국도나, 아직 안 지은 다른 고속도로로 남은 곳이 있다.
// 그대로 두면 왕복 4차로가 2차로로 좁아지거나 건설 전까지 아예 끊기므로, 같은 이름 고속도로의 서로 다른 조각을
// 그런 길 한두 조각이 곧게 잇는 곳을 그 고속도로로 올린다. 이 고속도로 자체가 공사로 잠겨 있으면 아직 없는 길이니 잇지 않는다
const GAP_MAX_KM = 18;
const GAP_MAX_BEND = 1.3;
export function bridgeHighwayGaps(nodes, roads) {
  const lengthOf = (d) => {
    let sum = 0;
    for (let i = 2; i < d.p.length; i += 2) sum += Math.hypot(d.p[i] - d.p[i - 2], d.p[i + 1] - d.p[i - 1]);
    return sum;
  };
  const touching = new Map(); // 노드 → 이름 → 닿아 있는 고속도로
  for (const d of roads) {
    if (d.k !== 'x') continue;
    for (const id of [d.a, d.b]) {
      if (!touching.has(id)) touching.set(id, new Map());
      const byName = touching.get(id);
      if (!byName.has(d.n)) byName.set(d.n, []);
      byName.get(d.n).push(d);
    }
  }
  // 그 이름의 고속도로가 여기서 끝나면 그 조각을 돌려준다
  const endOf = (id, name) => {
    const list = touching.get(id)?.get(name);
    return list && list.length === 1 && !list[0].lock ? list[0] : null;
  };
  // 이름별로 이어진 조각을 묶는다. 같은 조각의 끝끼리 이으면 나란히 달리는 길을 고속도로로 잘못 올리게 된다
  const parent = new Map();
  const find = (k) => {
    if (!parent.has(k)) parent.set(k, k);
    while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); }
    return k;
  };
  const piece = (name, id) => find(`${name}:${id}`);
  for (const d of roads) if (d.k === 'x') parent.set(piece(d.n, d.a), piece(d.n, d.b));
  const national = new Map();
  roads.forEach((d, i) => {
    if (d.k !== 'n' && !(d.k === 'x' && d.lock)) return;
    for (const [u, v] of [[d.a, d.b], [d.b, d.a]]) {
      if (!national.has(u)) national.set(u, []);
      national.get(u).push([v, i]);
    }
  });
  const gaps = [];
  for (const [id, byName] of touching) {
    for (const name of byName.keys()) {
      const from = endOf(id, name);
      if (!from) continue;
      const walk = (u, km, path) => {
        for (const [v, i] of national.get(u) || []) {
          if (path.includes(i) || roads[i].n === name) continue;
          const total = km + lengthOf(roads[i]);
          if (total > GAP_MAX_KM) continue;
          const next = [...path, i];
          if (endOf(v, name)) {
            const straight = Math.hypot(nodes[id].x - nodes[v].x, nodes[id].y - nodes[v].y);
            if (v !== id && total <= straight * GAP_MAX_BEND) gaps.push({ a: id, b: v, km: total, name, ref: from.ref, roads: next });
          } else if (next.length < 2 && !touching.get(v)?.has(name)) walk(v, total, next);
        }
      };
      walk(id, 0, []);
    }
  }
  // 끝 하나는 한 번만 잇는다. 짧은 틈부터
  gaps.sort((p, q) => p.km - q.km);
  const used = new Set();
  const out = roads.slice();
  for (const g of gaps) {
    const ka = `${g.name}:${g.a}`, kb = `${g.name}:${g.b}`;
    if (used.has(ka) || used.has(kb) || piece(g.name, g.a) === piece(g.name, g.b)) continue;
    used.add(ka);
    used.add(kb);
    parent.set(piece(g.name, g.a), piece(g.name, g.b));
    for (const i of g.roads) out[i] = { ...roads[i], k: 'x', n: g.name, ref: g.ref, lock: null };
  }
  return out;
}

export class Network {
  constructor(data) {
    this.nodes = data.nodes.map((d, i) => new Node(i, d));
    this.roads = bridgeHighwayGaps(data.nodes, data.roads).map((d, i) => new Road(i, d));
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
      let R = Math.max(rs.length >= 3 ? R_JUNCTION : 0.75, 0.35 + maxW * 0.72);
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
      let pts = bezier(p0[0], p0[1], p0[2], p0[3], p1[0], p1[1], p1[2], p1[3], 14, true);
      // 곡선 하나로 돌기엔 너무 좁으면 바깥으로 크게 돌아 나온다
      if (p0[2] * p1[2] + p0[3] * p1[3] < 0.1 && tightestOnLine(pts) < TURN_R * 0.75) pts = wideTurn(p0, p1, TURN_R) || pts;
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

// 좌표열에서 가장 급한 곳의 반경
function tightestOnLine(p) {
  let best = Infinity;
  for (let i = 2; i + 3 < p.length; i += 2) {
    const d = Math.abs(wrapAngle(Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]) - Math.atan2(p[i + 1] - p[i - 1], p[i] - p[i - 2])));
    if (d < 1e-4) continue;
    best = Math.min(best, (Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])) / 2 / d);
  }
  return best;
}

// 시작(p0)과 끝(p1)의 위치와 방향을 지키면서 반경 R보다 급하게 돌지 않는 가장 짧은 길 (Dubins 경로).
// 원호 L, R과 직선 S를 이어 만든다. 터무니없이 돌아가면 null
function wideTurn(p0, p1, R) {
  const TAU = Math.PI * 2;
  const mod = (a) => a - TAU * Math.floor(a / TAU);
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const D = Math.hypot(dx, dy) / R;
  const phi = Math.atan2(dy, dx);
  const a = mod(Math.atan2(p0[3], p0[2]) - phi), b = mod(Math.atan2(p1[3], p1[2]) - phi);
  const sa = Math.sin(a), sb = Math.sin(b), ca = Math.cos(a), cb = Math.cos(b), cab = Math.cos(a - b);
  const words = [];
  let q2 = 2 + D * D - 2 * cab + 2 * D * (sa - sb);
  if (q2 >= 0) { const m = Math.atan2(cb - ca, D + sa - sb); words.push(['LSL', mod(m - a), Math.sqrt(q2), mod(b - m)]); }
  q2 = 2 + D * D - 2 * cab + 2 * D * (sb - sa);
  if (q2 >= 0) { const m = Math.atan2(ca - cb, D - sa + sb); words.push(['RSR', mod(a - m), Math.sqrt(q2), mod(m - b)]); }
  q2 = -2 + D * D + 2 * cab + 2 * D * (sa + sb);
  if (q2 >= 0) { const q = Math.sqrt(q2), m = Math.atan2(-ca - cb, D + sa + sb) - Math.atan2(-2, q); words.push(['LSR', mod(m - a), q, mod(m - b)]); }
  q2 = -2 + D * D + 2 * cab - 2 * D * (sa + sb);
  if (q2 >= 0) { const q = Math.sqrt(q2), m = Math.atan2(ca + cb, D - sa - sb) - Math.atan2(2, q); words.push(['RSL', mod(a - m), q, mod(b - m)]); }
  let c = (6 - D * D + 2 * cab + 2 * D * (sa - sb)) / 8;
  if (Math.abs(c) <= 1) {
    const q = mod(TAU - Math.acos(c)), t = mod(a - Math.atan2(ca - cb, D - sa + sb) + q / 2);
    words.push(['RLR', t, q, mod(a - b - t + q)]);
  }
  c = (6 - D * D + 2 * cab + 2 * D * (sb - sa)) / 8;
  if (Math.abs(c) <= 1) {
    const q = mod(TAU - Math.acos(c)), t = mod(-a + Math.atan2(cb - ca, D + sa - sb) + q / 2);
    words.push(['LRL', t, q, mod(b - a - t + q)]);
  }
  let best = null, bestLen = Infinity;
  for (const w of words) {
    const len = w[1] + w[2] + w[3];
    if (len < bestLen) { bestLen = len; best = w; }
  }
  if (!best || bestLen * R > 9) return null;
  // 원호와 직선을 차례로 따라가며 찍는다
  let x = p0[0], y = p0[1], h = Math.atan2(p0[3], p0[2]);
  const pts = [x, y];
  for (let i = 0; i < 3; i++) {
    const kind = best[0][i], len = best[i + 1];
    if (len < 1e-6) continue;
    if (kind === 'S') {
      x += Math.cos(h) * len * R;
      y += Math.sin(h) * len * R;
      pts.push(x, y);
      continue;
    }
    const sign = kind === 'L' ? 1 : -1;
    const m = Math.max(1, Math.ceil(len / 0.2));
    const cx = x - Math.sin(h) * R * sign, cy = y + Math.cos(h) * R * sign;
    for (let j = 1; j <= m; j++) {
      const q = h + (sign * len * j) / m;
      pts.push(cx + Math.sin(q) * R * sign, cy - Math.cos(q) * R * sign);
    }
    h += sign * len;
    x = pts[pts.length - 2];
    y = pts[pts.length - 1];
  }
  pts[pts.length - 2] = p1[0];
  pts[pts.length - 1] = p1[1];
  return pts;
}

// 곡선에서 가장 급한 곳의 반경
function tightestRadius(x0, y0, c1x, c1y, c2x, c2y, x1, y1) {
  let best = Infinity;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, u = 1 - t;
    const dx = 3 * (u * u * (c1x - x0) + 2 * u * t * (c2x - c1x) + t * t * (x1 - c2x));
    const dy = 3 * (u * u * (c1y - y0) + 2 * u * t * (c2y - c1y) + t * t * (y1 - c2y));
    const ddx = 6 * (u * (c2x - 2 * c1x + x0) + t * (x1 - 2 * c2x + c1x));
    const ddy = 6 * (u * (c2y - 2 * c1y + y0) + t * (y1 - 2 * c2y + c1y));
    const speed = Math.hypot(dx, dy);
    const cross = Math.abs(dx * ddy - dy * ddx);
    if (cross > 1e-9 && speed > 1e-6) best = Math.min(best, (speed * speed * speed) / cross);
    else if (speed <= 1e-6) best = 0;
  }
  return best;
}
const HANDLE = [0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1, 1.25, 1.5, 2];

// gentle: 많이 돌아야 하면 가장 급한 곳이 가장 완만해지는 손잡이 길이를 찾는다
export function bezier(x0, y0, tx0, ty0, x1, y1, tx1, ty1, n, gentle = false) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  let k0 = Math.min(d * 0.42, 2.2), k1 = k0;
  if (gentle && tx0 * tx1 + ty0 * ty1 < 0.4) {
    let best = -Infinity;
    for (const a of HANDLE) {
      for (const b of HANDLE) {
        const r = tightestRadius(x0, y0, x0 + tx0 * a * d, y0 + ty0 * a * d, x1 - tx1 * b * d, y1 - ty1 * b * d, x1, y1);
        // 비슷하면 짧은 쪽이 낫다
        const score = r - (a + b) * d * 0.02;
        if (score > best) { best = score; k0 = a * d; k1 = b * d; }
      }
    }
  }
  const c1x = x0 + tx0 * k0, c1y = y0 + ty0 * k0;
  const c2x = x1 - tx1 * k1, c2y = y1 - ty1 * k1;
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
