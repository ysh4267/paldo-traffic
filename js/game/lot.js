// 거점마다 딸린 주차장. 진입로가 끝나는 곳에서 곧게 이어지는 통로 양옆으로 칸이 늘어선다.
// 트럭은 칸으로 들어가 멈추고, 일이 끝나면 후진으로 빠져나와 앞으로 달려 나간다.
// 좌표는 통로 방향 u, 오른쪽 w로 잡는다. 칸 수는 쓸 만큼 늘어난다.
// 통로 방향은 도로와 다른 거점, 바다를 가장 적게 덮는 쪽으로 고른다.
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
    add(o.x, o.y, 0.6);
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

export class Lot {
  constructor(site, game) {
    const e = site.spurIn;
    const p = e.sample(e.L, 0, [0, 0, 0, 0]);
    this.x = p[0];
    this.y = p[1];
    this.lx = p[2];    // 진입로 끝의 방향
    this.ly = p[3];
    const obs = obstacles(game, site, p[0], p[1]);
    let best = Infinity, pick = null;
    for (const a of ANGLES) {
      const c = Math.cos(a), s = Math.sin(a);
      this.tx = p[2] * c - p[3] * s;
      this.ty = p[2] * s + p[3] * c;
      this.nx = -this.ty;
      this.ny = this.tx;
      const fit = this.fit(obs);
      // 칸이 아예 없는 쪽은 마지막에, 처음 16칸이 나오는지가 가장 중요하고, 그 뒤로는 조금씩만 따진다
      const lost = (fit.free ? 0 : 1000) + Math.max(0, 16 - fit.free) * 8 + (CAP_MAX - Math.max(fit.free, 16)) * 0.5;
      const score = overlapScore(game, site, p[0], p[1], this.tx, this.ty, Math.min(8, fit.cap / 2)) + Math.abs(a) * 2 + lost;
      if (score < best) { best = score; pick = { tx: this.tx, ty: this.ty, ...fit }; }
    }
    this.tx = pick.tx;
    this.ty = pick.ty;
    this.nx = -this.ty;
    this.ny = this.tx;
    this.maxCap = pick.cap;
    this.blocked = pick.blocked;
    this.cap = Math.min(CAP_START, this.maxCap);
    this.stalls = new Array(this.cap).fill(null);
    this.used = 0;
    this.paths = new Map();
  }
  // 지금 방향으로 낼 수 있는 칸. 통로를 막는 것 앞에서 끝내 트럭이 도로를 평면으로 건너지 않게 하고,
  // 바닥 위로 지나가는 칸만 비운다
  fit(obs) {
    const blocked = new Array(CAP_MAX).fill(false);
    let limit = Infinity;
    for (let i = 0; i < obs.length; i += 3) {
      const dx = obs[i] - this.x, dy = obs[i + 1] - this.y, half = obs[i + 2];
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

  // 가까운 칸부터 내준다. 꽉 차면 넓히고, 더 못 넓히면 -1
  take(v) {
    for (;;) {
      for (let i = 0; i < this.cap; i++) {
        if (this.stalls[i] || this.blocked[i]) continue;
        this.stalls[i] = v;
        this.used++;
        return i;
      }
      if (this.cap >= this.maxCap) return -1;
      const next = Math.min(this.maxCap, this.cap + CAP_STEP);
      while (this.cap < next) { this.stalls.push(null); this.cap++; }
    }
  }
  release(i) {
    if (this.stalls[i]) { this.stalls[i] = null; this.used--; }
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
  pathIn(i, laneIndex) {
    return this.cached(`i${i}:${laneIndex}`, () => {
      const { u, side } = this.stallPos(i);
      const wl = laneOffset(laneIndex);
      const wS = side * AISLE;
      const ut = Math.max(NECK, u - Math.abs(wS - wl));
      const start = [this.x - this.ly * wl, this.y + this.lx * wl];
      const a = this.at(ut, wl), b = this.at(u, wS), c = this.at(u, side * (AISLE + STALL_D - 0.12));
      return [...this.curve(start, this.lx, this.ly, a, this.tx, this.ty), ...this.curve(a, this.tx, this.ty, b, this.nx * side, this.ny * side).slice(2), ...c];
    });
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
      const end = [this.x + this.ly * off, this.y - this.lx * off];
      return [...this.at(ux + EXIT_PREFIX, we), ...this.curve(e, -this.tx, -this.ty, end, -this.lx, -this.ly)];
    });
  }
}
