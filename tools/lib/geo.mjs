// 데이터 가공용 기하 유틸. 좌표계: 동경 127.8도·북위 36도 기준 km 평면 (x 동쪽, y 남쪽)
export const LON0 = 127.8;
export const LAT0 = 36.0;
const KX = 111.32 * Math.cos((36.5 * Math.PI) / 180);
const KY = 110.95;

export const project = (lon, lat) => [(lon - LON0) * KX, (LAT0 - lat) * KY];
export const unproject = (x, y) => [x / KX + LON0, LAT0 - y / KY];

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polyLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

export function ringArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Douglas-Peucker. 양 끝점은 항상 유지
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bestD = tol;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j]);
      if (d > bestD) { bestD = d; best = k; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function simplifyRing(ring, tol) {
  if (ring.length < 8) return ring.slice();
  // 고리를 가장 먼 두 점으로 나눠 단순화한 뒤 잇는다
  let far = 0, farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = dist(ring[0], ring[i]);
    if (d > farD) { farD = d; far = i; }
  }
  const a = simplify(ring.slice(0, far + 1), tol);
  const b = simplify(ring.slice(far).concat([ring[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

// 코너를 둥글게 만드는 Chaikin 세분. 양 끝점 유지
export function chaikin(pts, iter = 1) {
  let cur = pts;
  for (let it = 0; it < iter; it++) {
    if (cur.length < 3) return cur;
    const out = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const p = cur[i], q = cur[i + 1];
      if (i > 0) out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      if (i < cur.length - 2) out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

// 호 길이 기준으로 일정 간격 재표본화
export function resample(pts, step) {
  const L = polyLength(pts);
  const n = Math.max(2, Math.ceil(L / step));
  const ds = L / n;
  const out = [pts[0].slice()];
  let seg = 0, acc = 0;
  for (let i = 1; i < n; i++) {
    const target = i * ds;
    while (seg < pts.length - 2 && acc + dist(pts[seg], pts[seg + 1]) < target) {
      acc += dist(pts[seg], pts[seg + 1]);
      seg++;
    }
    const l = dist(pts[seg], pts[seg + 1]) || 1;
    const t = Math.min(1, (target - acc) / l);
    out.push([pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t]);
  }
  out.push(pts[pts.length - 1].slice());
  return { pts: out, ds };
}

// 가우시안 평활: 양 끝점은 고정하고, 파장이 짧은 굴곡만 지운다
export function gaussianSmooth(pts, sigmaKm, step = 0.4) {
  const L = polyLength(pts);
  if (L < 1) return pts;
  const sigma = Math.min(sigmaKm, L / 4.5);
  const { pts: rs, ds } = resample(pts, step);
  const n = rs.length;
  const radius = Math.max(1, Math.round((sigma * 3) / ds));
  const w = [];
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-((k * ds) ** 2) / (2 * sigma * sigma));
    w.push(v);
    sum += v;
  }
  // 끝점 기준 점대칭으로 연장하면 끝점과 접선이 유지된다
  const at = (i) => {
    if (i < 0) return [2 * rs[0][0] - rs[-i][0], 2 * rs[0][1] - rs[-i][1]];
    if (i >= n) { const j = 2 * (n - 1) - i; return [2 * rs[n - 1][0] - rs[j][0], 2 * rs[n - 1][1] - rs[j][1]]; }
    return rs[i];
  };
  const out = [rs[0].slice()];
  for (let i = 1; i < n - 1; i++) {
    let x = 0, y = 0;
    for (let k = -radius; k <= radius; k++) {
      const ii = Math.max(-(n - 1), Math.min(2 * (n - 1), i + k));
      const q = at(ii);
      const v = w[k + radius];
      x += q[0] * v;
      y += q[1] * v;
    }
    out.push([x / sum, y / sum]);
  }
  out.push(rs[n - 1].slice());
  return out;
}

export function chaikinRing(ring, iter = 1) {
  let cur = ring;
  for (let it = 0; it < iter; it++) {
    const out = [];
    for (let i = 0, n = cur.length; i < n; i++) {
      const p = cur[i], q = cur[(i + 1) % n];
      out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    cur = out;
  }
  return cur;
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 폴리라인에서 p에 가장 가까운 지점: { d, seg, t, pt, along }
export function nearestOnPolyline(p, pts) {
  let best = { d: Infinity, seg: 0, t: 0, pt: pts[0], along: 0 };
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * dx, a[1] + t * dy];
    const d = dist(p, q);
    const l = Math.sqrt(l2);
    if (d < best.d) best = { d, seg: i, t, pt: q, along: acc + t * l };
    acc += l;
  }
  return best;
}

// 사각형 범위로 다각형 고리를 자른다 (Sutherland-Hodgman)
export function clipRingToBox(ring, x0, y0, x1, y1) {
  const clip = (pts, inside, inter) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(inter(a, b));
    }
    return out;
  };
  let r = ring;
  const lerpX = (x) => (a, b) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const lerpY = (y) => (a, b) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  r = clip(r, (p) => p[0] >= x0, lerpX(x0)); if (!r.length) return r;
  r = clip(r, (p) => p[0] <= x1, lerpX(x1)); if (!r.length) return r;
  r = clip(r, (p) => p[1] >= y0, lerpY(y0)); if (!r.length) return r;
  r = clip(r, (p) => p[1] <= y1, lerpY(y1));
  return r;
}

export const round2 = (v) => Math.round(v * 100) / 100;
export const round1 = (v) => Math.round(v * 10) / 10;
export const flat = (pts, r = round2) => {
  const out = new Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) { out[i * 2] = r(pts[i][0]); out[i * 2 + 1] = r(pts[i][1]); }
  return out;
};
