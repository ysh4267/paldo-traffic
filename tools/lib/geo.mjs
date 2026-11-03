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
