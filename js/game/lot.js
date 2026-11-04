// 거점마다 딸린 주차장. 진입로가 끝나는 곳에서 곧게 이어지는 통로 양옆으로 칸이 늘어선다.
// 트럭은 칸으로 들어가 멈추고, 일이 끝나면 후진으로 빠져나와 앞으로 달려 나간다.
// 좌표는 통로 방향 u, 오른쪽 w로 잡는다. 칸 수는 쓸 만큼 늘어난다.
// 통로 방향은 도로와 다른 거점, 바다를 가장 적게 덮는 쪽으로 고른다.
// 안에서는 앞차 몸통을 보고 따라가고, 후진이나 통로를 가로지르는 트럭은 갈 길이 빈 뒤에야 들어선다.
// 먼저 들어선 트럭이 갈 길은 다른 트럭이 비켜 준다.
import { Polyline, bezier, laneOffset } from '../sim/network.js';

export const STALL_W = 0.62;   // 칸 너비 km
export const STALL_D = 1.95;   // 칸 깊이
export const AISLE = 1.0;      // 통로 절반 너비
export const LOT_U0 = 1.3;     // 거점에서 첫 칸까지
export const EXIT_PREFIX = 0.8; // 후진을 마친 자리 뒤로 남겨 두는 여유
const CAP_START = 8;
const CAP_STEP = 4;
const CAP_MAX = 24;
const NECK = 0.8;              // 진입로 끝에서 통로로 돌아 들어가는 곳까지
const TAIL = 1.1;              // 마지막 칸 뒤로 남겨 두는 후진 여유
const ANGLES = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5].map((q) => (q * Math.PI) / 8);
const RESERVE = 2.2;           // 주차장을 놓지 않은 옆 거점 둘레로 비워 두는 거리
const CLEAR = 0.42;            // 앞머리와 다른 트럭 몸통 사이에 두는 거리
const CLEAR_PASS = 0.26;       // 맞은편 차로로 스쳐 지날 때의 거리
const LOOK_STEP = 0.3;         // 앞길을 살피는 간격
const P = [0, 0, 0, 0];

// 통로가 꺾인 만큼 진입로 앞쪽에서 통로를 시작한다. 드나드는 곡선이 서로 엇갈리지 않고 넉넉하게 돈다
const neckShift = (a) => (Math.abs(a) > Math.PI / 2 ? 1.3 : Math.abs(Math.sin(a)));

// 경로 위 s의 위치를 P에 남긴다. 경로 시작 전은 처음 방향으로 늘여 잡는다
function pointAt(seg, s) {
  seg.sample(Math.max(0, s), P);
  if (s < 0) {
    P[0] += P[2] * s;
    P[1] += P[3] * s;
  }
}

// 점과 선분 사이 거리가 c보다 가까운가
function near(x, y, ax, ay, bx, by, c) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - x, ey = ay + dy * t - y;
  return ex * ex + ey * ey < c * c;
}

function inRings(rings, x, y) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
    }
  }
  return inside;
}

// 이 방향으로 놓았을 때 주차장이 얼마나 다른 것을 덮는가
function overlapScore(game, site, x, y, tx, ty, cols) {
  if (!cols) return 0;
  const nx = -ty, ny = tx;
  const endU = LOT_U0 + cols * STALL_W + TAIL, W = AISLE + STALL_D;
  const inside = (px, py) => {
    const dx = px - x, dy = py - y;
    const u = dx * tx + dy * ty, w = dx * nx + dy * ny;
    return u > LOT_U0 - 0.4 && u < endU + 0.4 && Math.abs(w) < W + 0.4;
  };
  let score = 0;
  const R = endU + W;
  for (const r of game.net.roads) {
    if (r === site.spurIn.road) continue;
    if (r.bb[2] < x - R || r.bb[0] > x + R || r.bb[3] < y - R || r.bb[1] > y + R) continue;
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const n = Math.max(1, Math.ceil(Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) / 0.8));
      for (let q = 0; q <= n; q++) {
        if (inside(p[i] + ((p[i + 2] - p[i]) * q) / n, p[i + 1] + ((p[i + 3] - p[i + 1]) * q) / n)) score += r.kind === 'f' ? 0 : 3;
      }
    }
  }
  for (const o of game.sites) {
    if (o !== site && inside(o.x, o.y)) score += 30;
    if (o !== site && o.lot && o.lot.cap) {
      const c = o.lot.at((LOT_U0 + o.lot.endU) / 2, 0);
      if (inside(c[0], c[1])) score += 30;
    }
  }
  // 바다 위로 나가지 않게 한다
  for (const u of [LOT_U0, (LOT_U0 + endU) / 2, endU]) {
    for (const w of [-W, 0, W]) {
      const px = x + tx * u + nx * w, py = y + ty * u + ny * w;
      if (!game.data.provinces.some((q) => inRings(q.rings, px, py))) score += 4;
    }
  }
  return score;
}

// 둘레의 도로와 다른 거점, 이미 있는 주차장을 [x, y, 반폭] 점으로 모은다
function obstacles(game, site, x, y) {
  const W = AISLE + STALL_D;
  const R = LOT_U0 + (CAP_MAX / 2) * STALL_W + TAIL + W + 2;
  const out = [];
  const add = (px, py, half) => { if (Math.hypot(px - x, py - y) < R) out.push(px, py, half); };
  for (const r of game.net.roads) {
    if (r === site.spurIn.road || r.kind === 'f') continue;
    if (r.bb[2] < x - R || r.bb[0] > x + R || r.bb[3] < y - R || r.bb[1] > y + R) continue;
    const half = 0.07 + 0.34 * r.lanes + 0.12;
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const n = Math.max(1, Math.ceil(Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) / 0.3));
      for (let q = 0; q <= n; q++) add(p[i] + ((p[i + 2] - p[i]) * q) / n, p[i + 1] + ((p[i + 3] - p[i + 1]) * q) / n, half);
    }
  }
  for (const o of game.sites) {
    if (o === site) continue;
    // 아직 주차장을 놓지 않은 거점도 입구 자리는 비워 둔다
    add(o.x, o.y, o.lot ? 0.6 : RESERVE);
    const lot = o.lot;
    if (!lot || !lot.maxCap) continue;
    const end = LOT_U0 + (lot.maxCap / 2) * STALL_W + TAIL;
    for (let u = LOT_U0; u <= end; u += 0.6) {
      for (let w = -W; w <= W; w += 0.6) {
        const q = lot.at(u, w);
        add(q[0], q[1], 0.35);
      }
    }
  }
  return out;
}

// 진입로 끝의 위치와 방향에서 낼 수 있는 가장 많은 빈칸. 지도를 만들 때 거점 자리를 고르는 데 쓴다
export function mostStalls(obs, sx, sy, lx, ly) {
  const view = { sx, sy, lx, ly, x: 0, y: 0, tx: 0, ty: 0, nx: 0, ny: 0 };
  let most = 0;
  for (const a of ANGLES) {
    const c = Math.cos(a), s = Math.sin(a), shift = neckShift(a);
    view.x = sx + lx * shift;
    view.y = sy + ly * shift;
    view.tx = lx * c - ly * s;
    view.ty = lx * s + ly * c;
    view.nx = -view.ty;
    view.ny = view.tx;
    const f = Lot.prototype.fit.call(view, obs, shift);
    if (f.free > most) most = f.free;
  }
  return most;
}

export class Lot {
  constructor(site, game) {
    const e = site.spurIn;
    const p = e.sample(e.L, 0, [0, 0, 0, 0]);
    this.sx = p[0];    // 진입로 끝
    this.sy = p[1];
    this.lx = p[2];    // 진입로 끝의 방향
    this.ly = p[3];
    const obs = obstacles(game, site, p[0], p[1]);
    let best = Infinity, pick = null;
    for (const a of ANGLES) {
      const c = Math.cos(a), s = Math.sin(a);
      const shift = neckShift(a);
      this.x = p[0] + p[2] * shift;   // 통로가 시작되는 곳
      this.y = p[1] + p[3] * shift;
      this.tx = p[2] * c - p[3] * s;
      this.ty = p[2] * s + p[3] * c;
      this.nx = -this.ty;
      this.ny = this.tx;
      const fit = this.fit(obs, shift);
      // 칸이 아예 없는 쪽은 마지막에, 처음 16칸이 나오는지가 가장 중요하고, 그 뒤로는 조금씩만 따진다
      const lost = (fit.free ? 0 : 1000) + Math.max(0, 16 - fit.free) * 8 + (CAP_MAX - Math.max(fit.free, 16)) * 0.5;
      const score = overlapScore(game, site, this.x, this.y, this.tx, this.ty, Math.min(8, fit.cap / 2)) + Math.abs(a) * 2 + lost;
      if (score < best) { best = score; pick = { x: this.x, y: this.y, tx: this.tx, ty: this.ty, ...fit }; }
    }
    this.x = pick.x;
    this.y = pick.y;
    this.tx = pick.tx;
    this.ty = pick.ty;
    this.nx = -this.ty;
    this.ny = this.tx;
    this.maxCap = pick.cap;
    this.freeMax = pick.free;
    this.blocked = pick.blocked;
    this.cap = Math.min(CAP_START, this.maxCap);
    this.stalls = new Array(this.cap).fill(null);
    this.used = 0;
    this.paths = new Map();
    this.active = [];   // 지금 칸 밖에 나와 움직이거나 줄을 선 트럭
    this.waiting = 0;   // 일을 마치고 칸에서 나갈 차례를 기다리는 트럭
    this.lead = null;   // 마지막으로 살핀 앞길을 막은 트럭
    this.leadV = 0;     // 그 트럭의 속도
  }
  // 지금 방향으로 낼 수 있는 칸. 통로를 막는 것 앞에서 끝내 트럭이 도로를 평면으로 건너지 않게 하고,
  // 바닥 위로 지나가는 칸만 비운다
  fit(obs, shift) {
    const blocked = new Array(CAP_MAX).fill(false);
    let limit = Infinity;
    for (let i = 0; i < obs.length; i += 3) {
      const dx = obs[i] - this.x, dy = obs[i + 1] - this.y, half = obs[i + 2];
      if (shift > 0) {
        // 진입로 끝에서 통로 시작까지 다른 것이 있으면 이 방향은 못 쓴다
        const a = (obs[i] - this.sx) * this.lx + (obs[i + 1] - this.sy) * this.ly;
        const b = (obs[i + 1] - this.sy) * this.lx - (obs[i] - this.sx) * this.ly;
        if (a > 0 && a < shift + half && Math.abs(b) < 0.8 + half) return { cap: 0, free: 0, blocked };
      }
      const u = dx * this.tx + dy * this.ty, w = dx * this.nx + dy * this.ny;
      const aw = Math.abs(w);
      // 거점 뒤나 거점이 붙어 있는 도로는 막는 것이 아니다
      if (u > half && aw < AISLE + half && u - half < limit) limit = u - half;
      if (aw < AISLE - half || aw > AISLE + STALL_D + half) continue;
      const col = Math.floor((u - LOT_U0 + half) / STALL_W);
      const col2 = Math.floor((u - LOT_U0 - half) / STALL_W);
      for (let c = Math.max(0, col2); c <= col && c < CAP_MAX / 2; c++) blocked[c * 2 + (w > 0 ? 0 : 1)] = true;
    }
    const cols = Math.floor((limit - LOT_U0 - TAIL) / STALL_W);
    let cap = Math.max(0, Math.min(CAP_MAX, cols * 2));
    // 끝쪽이 모두 막힌 줄은 바닥도 깔지 않는다
    while (cap > 0 && blocked[cap - 1] && blocked[cap - 2]) cap -= 2;
    let free = 0;
    for (let i = 0; i < cap; i++) if (!blocked[i]) free++;
    return { cap, free, blocked };
  }
  at(u, w) { return [this.x + this.tx * u + this.nx * w, this.y + this.ty * u + this.ny * w]; }
  stallPos(i) {
    return { u: LOT_U0 + (Math.floor(i / 2) + 0.5) * STALL_W, side: i % 2 === 0 ? 1 : -1 };
  }
  get endU() { return LOT_U0 + Math.ceil(this.cap / 2) * STALL_W + TAIL; }

  // 들어오는 차로 쪽 줄부터 가까운 순서로 내준다. 맞은편 줄은 나가는 차로를 가로질러야 해서 나중에 쓴다.
  // 꽉 차면 넓히고, 더 못 넓히면 -1
  take(v) {
    for (;;) {
      for (let side = 0; side < 2; side++) {
        for (let i = side; i < this.cap; i += 2) {
          if (this.stalls[i] || this.blocked[i]) continue;
          this.stalls[i] = v;
          this.used++;
          return i;
        }
      }
      if (this.cap >= this.maxCap) return -1;
      const next = Math.min(this.maxCap, this.cap + CAP_STEP);
      while (this.cap < next) { this.stalls.push(null); this.cap++; }
    }
  }
  release(i) {
    if (this.stalls[i]) { this.stalls[i] = null; this.used--; }
  }
  canTake() { return this.used < this.freeMax; }
  // 차로 끝에서 입구로 들어설 수 있는 속도. 앞서 들어간 트럭 꽁무니가 입구에 남아 있으면 0
  entrySpeed(v, vMax) {
    let out = vMax;
    for (let i = 0; i < this.active.length; i++) {
      const o = this.active[i];
      if (o.lot.phase !== 'in') continue;
      const d = o.lot.s - o.len - CLEAR;
      if (d <= 0) return 0;
      const q = Math.sqrt(o.v * o.v + 2 * v.brake * d);
      if (q < out) out = q;
    }
    return out;
  }

  cached(key, build) {
    let p = this.paths.get(key);
    if (!p) { p = new Polyline(build()); this.paths.set(key, p); }
    return p;
  }
  curve(a, t0x, t0y, b, t1x, t1y) {
    return bezier(a[0], a[1], t0x, t0y, b[0], b[1], t1x, t1y, 8);
  }
  // 차로 끝에서 칸 안쪽까지. 경로 위 거리가 곧 앞머리 위치다
  // commitS: 통로에서 칸 쪽으로 꺾기 시작하는 곳
  pathIn(i, laneIndex) {
    const key = `i${i}:${laneIndex}`;
    let path = this.paths.get(key);
    if (path) return path;
    const { u, side } = this.stallPos(i);
    const wl = laneOffset(laneIndex);
    const wS = side * AISLE;
    const ut = Math.max(NECK, u - Math.abs(wS - wl));
    const start = [this.sx - this.ly * wl, this.sy + this.lx * wl];
    const a = this.at(ut, wl), b = this.at(u, wS), c = this.at(u, side * (AISLE + STALL_D - 0.12));
    // 모든 트럭이 같은 곡선으로 통로에 들어선 뒤, 자기 칸 앞에서 꺾는다
    const first = this.curve(start, this.lx, this.ly, this.at(NECK, wl), this.tx, this.ty);
    const turn = this.curve(a, this.tx, this.ty, b, this.nx * side, this.ny * side);
    path = new Polyline([...first, ...(ut > NECK ? turn : turn.slice(2)), ...c]);
    path.commitS = new Polyline(first).len + (ut - NECK);
    this.paths.set(key, path);
    return path;
  }
  // 칸에서 통로까지 후진. 경로 위 거리가 곧 꽁무니 위치다
  pathBack(i) {
    return this.cached(`b${i}`, () => {
      const { u, side } = this.stallPos(i);
      const we = -laneOffset(0);
      const wS = side * AISLE;
      const x = this.at(u + Math.abs(wS - we), we);
      const s = this.at(u, wS);
      return [...this.at(u, side * (AISLE + STALL_D - 0.12)), ...this.curve(s, -this.nx * side, -this.ny * side, x, this.tx, this.ty)];
    });
  }
  // 후진을 마친 자리에서 진입로까지 앞으로
  pathOut(i) {
    return this.cached(`o${i}`, () => {
      const { u, side } = this.stallPos(i);
      const we = -laneOffset(0);
      const ux = u + Math.abs(side * AISLE - we);
      const e = this.at(NECK, we);
      const off = -we;
      const end = [this.sx + this.ly * off, this.sy - this.lx * off];
      return [...this.at(ux + EXIT_PREFIX, we), ...this.curve(e, -this.tx, -this.ty, end, -this.lx, -this.ly)];
    });
  }

  enter(v) {
    if (v.lot.active) return;
    v.lot.active = true;
    this.active.push(v);
    this.updateBody(v);
  }
  leave(v) {
    const L = v.lot;
    L.active = false;
    L.go = false;
    L.rest = null;
    const i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
  }
  // 몸통의 양 끝. a가 가는 쪽 끝이다
  updateBody(v) {
    const L = v.lot;
    pointAt(L.seg, L.s);
    L.ax = P[0];
    L.ay = P[1];
    pointAt(L.seg, L.s - v.len);
    L.bx = P[0];
    L.by = P[1];
  }
  // (x, y)가 다른 트럭 몸통이나 먼저 들어선 트럭이 갈 길에 닿으면 그 트럭을 돌려준다. (hx, hy)는 내 진행 방향
  hit(me, x, y, hx, hy) {
    const list = this.active;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === me) continue;
      const L = o.lot;
      const dx = L.ax - L.bx, dy = L.ay - L.by;
      const facing = dx * hx + dy * hy < -0.5 * Math.hypot(dx, dy);
      if (near(x, y, L.bx, L.by, L.ax, L.ay, facing ? CLEAR_PASS : CLEAR)) return o;
      // 같은 통로로 들어오는 트럭끼리는 앞차 몸통만 본다. 서로 찜한 길을 보면 앞뒤로 물려 영원히 기다린다
      const r = L.phase === 'in' && me.lot.phase === 'in' ? null : L.rest;
      if (!r) continue;
      for (let j = L.restI * 2; j < r.length; j += 2) {
        const ex = r[j] - x, ey = r[j + 1] - y;
        if (ex * ex + ey * ey < CLEAR * CLEAR) return o;
      }
    }
    return null;
  }
  // 앞길 dist 안에서 처음 막히는 곳까지의 거리. 막는 것이 없으면 Infinity. 막는 트럭은 lead에, 그 속도는 leadV에 남긴다
  scan(v, dist) {
    this.lead = null;
    this.leadV = 0;
    if (this.active.length < 2 || dist <= 0) return Infinity;
    const L = v.lot, seg = L.seg, s0 = L.s;
    let prev = 0;
    for (let d = LOOK_STEP; ; d += LOOK_STEP) {
      const q = Math.min(d, dist);
      pointAt(seg, s0 + q);
      let who = this.hit(v, P[0], P[1], P[2], P[3]);
      if (who) {
        // 간격이 살피는 간격만큼 덜컥거리지 않게 좁힌다
        let lo = prev, hi = q;
        for (let k = 0; k < 3; k++) {
          const m = (lo + hi) / 2;
          pointAt(seg, s0 + m);
          const w = this.hit(v, P[0], P[1], P[2], P[3]);
          if (w) { hi = m; who = w; } else lo = m;
        }
        pointAt(seg, s0 + hi);
        this.lead = who;
        const O = who.lot;
        const dx = O.ax - O.bx, dy = O.ay - O.by;
        const l = Math.hypot(dx, dy);
        const dot = l > 0 ? (dx * P[2] + dy * P[3]) / l : 0;
        this.leadV = dot > 0.5 && O.phase !== 'exit' ? who.v * dot : 0;
        return lo;
      }
      if (q >= dist) return Infinity;
      prev = q;
    }
  }
  // 앞으로 지날 점들이 다른 트럭과 닿지 않는가. 마주 달려오는 트럭은 설 수 있는 곳까지 차지한 것으로 본다
  isClear(me, pts) {
    const list = this.active;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === me) continue;
      const L = o.lot;
      let fx = L.ax, fy = L.ay;
      if (o.v > 0.05 && !L.go && L.phase !== me.lot.phase) {
        L.seg.sample(L.s + (o.v * o.v) / (2 * o.brake) + 0.3, P);
        fx = P[0];
        fy = P[1];
      }
      const r = L.phase === 'in' && me.lot.phase === 'in' ? null : L.rest;
      for (let j = 0; j < pts.length; j += 2) {
        const x = pts[j], y = pts[j + 1];
        if (near(x, y, L.bx, L.by, L.ax, L.ay, CLEAR) || near(x, y, L.ax, L.ay, fx, fy, CLEAR)) return false;
        if (!r) continue;
        for (let q = L.restI * 2; q < r.length; q += 2) {
          const ex = r[q] - x, ey = r[q + 1] - y;
          if (ex * ex + ey * ey < CLEAR * CLEAR) return false;
        }
      }
    }
    return true;
  }
  // 경로 seg의 s0부터 끝까지 찍은 점들
  pointsOn(seg, s0, s1, out) {
    for (let s = s0; ; s += LOOK_STEP) {
      seg.sample(Math.min(s, s1), P);
      out.push(P[0], P[1]);
      if (s >= s1) return out;
    }
  }
  // 이제부터 이 길은 이 트럭 것이다. 다른 트럭이 비켜 주므로 더 살피지 않고 간다
  commit(v, pts, s0, n0) {
    const L = v.lot;
    L.go = true;
    L.rest = pts;
    L.restI = 0;
    L.restS0 = s0;
    L.restN = n0;
  }
  // 칸에 든 트럭이 후진을 시작해도 되는가. 후진을 마치고 설 자리까지 비어 있어야 한다
  tryBack(v) {
    const L = v.lot;
    const pts = this.pointsOn(L.seg, L.s, L.seg.len, []);
    const n0 = pts.length / 2;
    this.pointsOn(this.pathOut(L.stall), EXIT_PREFIX, EXIT_PREFIX + v.len + 0.1, pts);
    if (!this.isClear(v, pts)) return false;
    this.commit(v, pts, L.s, n0);
    this.waiting--;
    this.enter(v);
    return true;
  }
  // 통로를 달리던 트럭이 칸 쪽으로 꺾어도 되는가. force면 비어 있지 않아도 들어선다
  // 꺾은 뒤의 길이 비었는지만 보고, 꺾을 곳까지 남은 통로도 함께 찜해 둔다
  tryTurn(v, force) {
    const L = v.lot, seg = L.seg;
    const turnS = Math.max(L.s, seg.commitS);
    const pts = this.pointsOn(seg, turnS, seg.len, []);
    if (!force && !this.isClear(v, pts)) return false;
    const all = turnS > L.s ? this.pointsOn(seg, L.s, seg.len, []) : pts;
    this.commit(v, all, L.s, all.length / 2);
    return true;
  }
  // 지나온 길은 내어 준다
  passRest(v) {
    const L = v.lot;
    if (!L.rest) return;
    while (L.restI < L.restN && L.restS0 + (L.restI + 1) * LOOK_STEP < L.s) L.restI++;
  }
}
