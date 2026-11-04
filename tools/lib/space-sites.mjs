// 거점을 교차로에서 떼어 놓는다.
// 큰 교차로에 바로 붙은 거점은 옆길로 옮겨 따로 입구를 내고, 입구 교차로는 옆 교차로와 벌어지도록 길을 따라 민다.
// 진입로는 넓어진 도로에 파묻히지 않을 만큼 늘리고, 트럭이 크게 돌지 않아도 되는 쪽으로 낸다.
// 주차장 칸이 넉넉히 나오는 자리를 고른다.
// 번호는 그대로 두고 새 도로와 교차로는 맨 뒤에 붙이므로 예전 저장이 그대로 맞는다.
import { mostStalls } from '../../js/game/lot.js';

export const MAP_VERSION = 2;
const ARM_GOAL = 8;       // 입구 교차로와 옆 교차로 사이의 목표 간격 km
const ARM_MIN = 10;       // 이보다 짧은 옆길에는 새 입구를 내지 않는다 km
const SPUR_GOAL = { x: 8.5, n: 7, r: 7 }; // 진입로 목표 길이. 도로를 끝까지 넓혀도 진입로가 교차로에 먹히지 않는 길이다
const SPUR_SHORTEST = 3;
const SEP_GOOD = 88;      // 진입로와 옆길이 이만큼은 벌어져야 트럭이 빙 돌지 않는다 (도)
const NEAR_A = 3.2;       // 입구 교차로에서 이 안쪽은 옆길과 가까워도 된다 km
const ROAD_CLEAR = 2.6;   // 다른 도로와 떨어질 거리 km
const SITE_CLEAR = 6;     // 다른 거점과 떨어질 거리 km
const LOT_GOAL = 16;      // 주차장에 나왔으면 하는 빈칸
const LOT_WEIGHT = 2;     // 빈칸 하나가 모자랄 때 깎는 점수
const TIGHT_COST = 6;     // 다른 도로에 가깝게 지날 때 깎는 점수. 주차장 칸이 크게 늘 때만 그렇게 한다
const LAST_CLEAR = 1;     // 달리 자리가 없을 때만 쓰는 간격 km
const NEAR_LAST = 1.2;    // 그때 입구 교차로에서 이 안쪽은 도로에 붙어도 된다 km
const SPUR_EXTRA = 3;     // 주차장 자리를 찾아 진입로를 목표보다 더 늘려도 되는 길이 km
const LANES = { x: 2, n: 1, r: 1, s: 1 };
const halfOf = (k) => 0.07 + 0.34 * LANES[k] + 0.12; // 주차장이 비켜야 하는 도로 반폭
const R2 = (v) => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const toPts = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
const toFlat = (pts) => pts.flatMap((p) => [R2(p[0]), R2(p[1])]);
const lenOf = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; };
// 길이 s에서 둘로 나눈다
function cutAt(pts, s) {
  let left = s;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (left <= d || i === pts.length - 1) {
      const t = d > 0 ? Math.min(1, left / d) : 0;
      const q = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      const a = pts.slice(0, i);
      if (dist(a[a.length - 1], q) > 0.02) a.push(q);
      const b = pts.slice(i);
      if (dist(b[0], q) > 0.02) b.unshift(q);
      return [a, b, q];
    }
    left -= d;
  }
  return [pts, pts, pts[pts.length - 1]];
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

// 새 입구를 냈는데 거점 자리를 못 찾으면 진입로가 다른 길을 가로지른다.
// 그런 거점은 입구를 내지 않고 처음부터 다시 놓는다
export function spaceSites(data, log = () => {}) {
  const start = JSON.stringify(data);
  const noSplit = new Set();
  for (let round = 0; ; round++) {
    const copy = JSON.parse(start);
    const { stats, stuck } = placeSites(copy, noSplit);
    if (stuck.length && round < 6) {
      for (const id of stuck) noSplit.add(id);
      continue;
    }
    Object.assign(data, copy);
    data.meta.mapVersion = MAP_VERSION;
    log(`입구를 민 교차로 ${stats.slid}곳, 새 입구 ${stats.split}곳, 옮긴 거점 ${stats.moved}곳, 그대로 ${stats.kept}곳${noSplit.size ? `, 입구를 내지 않은 거점 ${[...noSplit].join(' ')}` : ''}`);
    return stats;
  }
}

function placeSites(data, noSplit) {
  const { nodes, roads, sites } = data;
  const at = new Map();
  const link = (id, r) => { if (!at.has(id)) at.set(id, new Set()); at.get(id).add(r); };
  roads.forEach((r) => { link(r.a, r); link(r.b, r); });
  const other = (r, id) => (r.a === id ? r.b : r.a);
  // 노드 id에서 시작하는 방향으로 편 좌표열
  const from = (r, id) => { const p = toPts(r.p); return r.a === id ? p : p.reverse(); };
  const setFrom = (r, id, pts) => { r.p = toFlat(r.a === id ? pts : pts.slice().reverse()); };
  const spurOf = (s) => roads.find((q) => q.k === 's' && (q.a === s.node || q.b === s.node));
  const attachOf = (s) => { const q = spurOf(s); return q ? other(q, s.node) : null; };
  const isMain = (r) => r.k !== 's' && r.k !== 'f';
  const movable = (s) => !s.island && !!spurOf(s) && !nodes[attachOf(s)].t;
  const stats = { slid: 0, split: 0, moved: 0, kept: 0 };

  // ── 입구 교차로를 옆 교차로에서 떼기 ──────────────────
  const slid = new Set();
  const splitFor = new Set();
  const stuck = [];
  for (const s of sites) {
    if (!movable(s)) continue;
    const A = attachOf(s);
    const arms = [...at.get(A)].filter((r) => r.k !== 's');
    if (arms.some((r) => r.k === 'f' || r.lock)) continue;
    if (arms.length === 2 && !slid.has(A)) {
      // 지나는 길 하나에 거점만 붙은 교차로는 길을 따라 민다
      const [r1, r2] = arms;
      const p1 = from(r1, A), p2 = from(r2, A);
      const L1 = lenOf(p1), L2 = lenOf(p2);
      slid.add(A);
      if (Math.min(L1, L2) >= ARM_GOAL) continue;
      const total = L1 + L2;
      let want = total / 2;
      if (total >= ARM_GOAL * 2) want = L1 < ARM_GOAL ? ARM_GOAL : total - ARM_GOAL;
      if (Math.abs(want - L1) < 0.5) continue;
      const whole = p1.slice().reverse().concat(p2.slice(1));
      const [a, b, q] = cutAt(whole, want);
      nodes[A].x = R2(q[0]);
      nodes[A].y = R2(q[1]);
      a[a.length - 1] = [nodes[A].x, nodes[A].y];
      b[0] = [nodes[A].x, nodes[A].y];
      setFrom(r1, A, a.slice().reverse());
      setFrom(r2, A, b);
      stats.slid++;
    } else if (arms.length >= 3 && !noSplit.has(s.id)) {
      // 갈래가 많은 교차로에 붙은 거점은 긴 옆길로 옮겨 따로 입구를 낸다. 거점 쪽으로 난 길을 먼저 고른다
      const O = [s.x, s.y], N = [nodes[A].x, nodes[A].y];
      const toO = Math.hypot(O[0] - N[0], O[1] - N[1]) || 1;
      let best = null, bestScore = -Infinity;
      for (const r of arms) {
        if (r.k !== 'x' && r.k !== 'n') continue;
        if (nodes[other(r, A)].t) continue;
        // 거점보다 늦게 열리는 도로에 입구를 내면 그 권역이 열릴 때까지 거점이 끊긴다
        if (r.r > (s.stage ?? s.r)) continue;
        const pts = from(r, A), L = lenOf(pts);
        if (L < ARM_MIN) continue;
        const [, , q] = cutAt(pts, Math.min(L / 2, ARM_GOAL));
        const dot = ((q[0] - N[0]) * (O[0] - N[0]) + (q[1] - N[1]) * (O[1] - N[1])) / (toO * (dist(q, N) || 1));
        const score = dot * 6 + Math.min(L, 30) * 0.2 - (r.k === 'x' ? 2 : 0);
        if (score > bestScore) { bestScore = score; best = r; }
      }
      if (!best) continue;
      const pts = from(best, A), L = lenOf(pts);
      const [near, far, q] = cutAt(pts, Math.min(L / 2, ARM_GOAL));
      const T = nodes.length;
      nodes.push({ x: R2(q[0]), y: R2(q[1]), name: `${s.name} 입구`, r: best.r });
      near[near.length - 1] = [nodes[T].x, nodes[T].y];
      far[0] = [nodes[T].x, nodes[T].y];
      const B = other(best, A);
      // 원래 도로는 큰 교차로 쪽에 남겨 그 교차로의 표지와 차로가 그대로 맞게 한다
      const rest = { a: T, b: B, k: best.k, r: best.r, parent: roads.indexOf(best), p: toFlat(far) };
      if (best.n) rest.n = best.n;
      if (best.ref) rest.ref = best.ref;
      roads.push(rest);
      at.get(B).delete(best);
      link(B, rest);
      link(T, rest);
      if (best.a === A) best.b = T; else best.a = T;
      link(T, best);
      setFrom(best, A, near);
      // 진입로를 새 입구로 옮긴다
      const spur = spurOf(s);
      at.get(A).delete(spur);
      if (spur.a === A) spur.a = T; else spur.b = T;
      link(T, spur);
      splitFor.add(s.id);
      stats.split++;
    }
  }

  // ── 진입로 놓기 ───────────────────────────────────────
  const onLand = (x, y) => data.provinces.some((q) => inRings(q.rings, x, y));
  // 큰 도로의 점을 격자에 넣어 가까운 것을 빨리 찾는다
  const CELL = 6;
  const grid = new Map();
  const keyOf = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  for (const r of roads) {
    if (!isMain(r)) continue;
    const pts = toPts(r.p);
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]), n = Math.max(1, Math.ceil(d / 0.8));
      for (let q = 0; q <= n; q++) {
        const x = pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * q) / n, y = pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * q) / n;
        const k = keyOf(x, y);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([x, y, r]);
      }
    }
  }
  const nearRoad = (x, y, each) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of grid.get(`${cx + i},${cy + j}`) || []) each(q);
  };
  const segDist = (px, py, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
    return Math.hypot(a[0] + dx * t - px, a[1] + dy * t - py);
  };
  const wrap = (a) => { while (a <= -Math.PI) a += Math.PI * 2; while (a > Math.PI) a -= Math.PI * 2; return a; };
  // 곧은 진입로가 입구 교차로에 닿지 않은 큰 도로를 가로지르는가
  const crossesRoad = (A, N, E) => {
    const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    for (const r of roads) {
      if (!isMain(r) || r.a === A || r.b === A) continue;
      const pts = toPts(r.p);
      for (let i = 1; i < pts.length; i++) {
        const d1 = side(pts[i - 1], pts[i], N), d2 = side(pts[i - 1], pts[i], E), d3 = side(N, E, pts[i - 1]), d4 = side(N, E, pts[i]);
        if ((d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0)) return true;
      }
    }
    return false;
  };

  // 주차장 칸을 어림할 도로의 점들
  const FINE = 8;
  const fine = new Map();
  for (const r of roads) {
    if (!isMain(r)) continue;
    const half = halfOf(r.k), pts = toPts(r.p);
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]), n = Math.max(1, Math.ceil(d / 0.4));
      for (let q = 0; q <= n; q++) {
        const x = pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * q) / n, y = pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * q) / n;
        const k = `${Math.floor(x / FINE)},${Math.floor(y / FINE)}`;
        if (!fine.has(k)) fine.set(k, []);
        fine.get(k).push(x, y, half);
      }
    }
  }
  // 거점 하나가 볼 만한 범위의 도로, 다른 진입로, 다른 거점
  const aroundOf = (s, N, reach) => {
    const out = [];
    const span = Math.ceil(reach / FINE), cx = Math.floor(N[0] / FINE), cy = Math.floor(N[1] / FINE);
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        const list = fine.get(`${cx + i},${cy + j}`);
        if (!list) continue;
        for (let q = 0; q < list.length; q += 3) if (Math.hypot(list[q] - N[0], list[q + 1] - N[1]) < reach) out.push(list[q], list[q + 1], list[q + 2]);
      }
    }
    for (const o of sites) {
      if (o === s) continue;
      if (Math.hypot(o.x - N[0], o.y - N[1]) < reach) out.push(o.x, o.y, 0.6);
      const sp = spurOf(o);
      if (!sp) continue;
      const a = nodes[attachOf(o)], d = Math.hypot(o.x - a.x, o.y - a.y), n = Math.max(1, Math.ceil(d / 0.4));
      for (let q = 0; q <= n; q++) {
        const x = a.x + ((o.x - a.x) * q) / n, y = a.y + ((o.y - a.y) * q) / n;
        if (Math.hypot(x - N[0], y - N[1]) < reach) out.push(x, y, halfOf('s'));
      }
    }
    return out;
  };
  const stallsAt = (around, E, ux, uy) => {
    const obs = [];
    for (let i = 0; i < around.length; i += 3) {
      if (Math.abs(around[i] - E[0]) < 16.5 && Math.abs(around[i + 1] - E[1]) < 16.5) obs.push(around[i], around[i + 1], around[i + 2]);
    }
    return mostStalls(obs, E[0], E[1], ux, uy);
  };
  const origin = new Map(sites.map((s) => [s, [s.x, s.y]]));

  const order = sites.filter(movable).map((s) => ({ s, deg: at.get(attachOf(s)).size })).sort((p, q) => q.deg - p.deg);
  // 다른 거점이 자리를 잡은 뒤 칸이 모자라는 곳을 한 번 더 놓는다
  for (let pass = 0; pass < 2; pass++) for (const { s } of order) {
    const spur = spurOf(s);
    const A = attachOf(s), N = [nodes[A].x, nodes[A].y], O = origin.get(s);
    const peers = [...at.get(A)].filter((r) => r !== spur);
    const arms = peers.map((r) => {
      const pts = from(r, A);
      let i = 1;
      let run = dist(pts[0], pts[1]);
      while (i < pts.length - 1 && run < 2) { i++; run += dist(pts[i - 1], pts[i]); }
      return Math.atan2(pts[i][1] - N[1], pts[i][0] - N[0]);
    }).sort((a, b) => a - b);
    const mainKind = peers.some((r) => r.k === 'x') ? 'x' : 'n';
    const goal = SPUR_GOAL[mainKind];
    const now = [s.x, s.y];
    const oldLen = dist(N, now);
    const oldAng = Math.atan2(now[1] - N[1], now[0] - N[0]);
    const sepOf = (ang) => (arms.length ? Math.min(...arms.map((a) => Math.abs(wrap(a - ang)))) : Math.PI) * (180 / Math.PI);
    const around = aroundOf(s, N, goal + SPUR_EXTRA + 18);
    const oldStalls = stallsAt(around, now, Math.cos(oldAng), Math.sin(oldAng));
    // 이미 충분히 길고 잘 벌어지고 주차장 자리도 있는 진입로는 건드리지 않는다
    if (oldLen >= goal && sepOf(oldAng) >= SEP_GOOD && oldStalls >= LOT_GOAL) { if (!pass) stats.kept++; continue; }
    if (pass && oldStalls >= LOT_GOAL) continue;
    const angles = [oldAng];
    if (arms.length) {
      arms.forEach((a, i) => {
        const b = i + 1 < arms.length ? arms[i + 1] : arms[0] + Math.PI * 2;
        const gap = b - a, mid = a + gap / 2;
        angles.push(mid, mid + gap / 6, mid - gap / 6, mid + gap / 3, mid - gap / 3);
      });
    } else for (let q = 0; q < 12; q++) angles.push((q * Math.PI) / 6);
    let best = null, bestScore = Infinity;
    const lengths = [];
    for (let L = goal + SPUR_EXTRA; L >= SPUR_SHORTEST; L -= 0.5) lengths.push(L);
    const others = sites.filter((q) => q !== s);
    const spurs = sites.filter((q) => q !== s && spurOf(q)).map((q) => ({ a: [nodes[attachOf(q)].x, nodes[attachOf(q)].y], b: [q.x, q.y] }));
    const landO = onLand(O[0], O[1]);
    for (const clear of [ROAD_CLEAR, 1.7, LAST_CLEAR]) {
      const last = clear === LAST_CLEAR;
      if (last && best) break;
      for (const ang of angles) {
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const sep = sepOf(ang);
        for (const L of lengths) {
          const E = [N[0] + ux * L, N[1] + uy * L];
          // 다른 거점과 진입로
          if (others.some((q) => Math.hypot(q.x - E[0], q.y - E[1]) < SITE_CLEAR)) continue;
          let ok = true, crowd = 0;
          for (let d = 0.6; d <= L && ok; d += 0.6) {
            const x = N[0] + ux * d, y = N[1] + uy * d;
            nearRoad(x, y, (q) => {
              if (!ok) return;
              const g = Math.hypot(q[0] - x, q[1] - y);
              const peer = q[2].a === A || q[2].b === A;
              if (last ? d >= NEAR_LAST && g < (peer ? 0.6 : clear) : peer ? d >= NEAR_A && g < clear - 0.6 : g < (d < NEAR_A ? 1.1 : clear)) ok = false;
            });
            if (ok && spurs.some((q) => segDist(x, y, q.a, q.b) < 1.4 && d > 2)) ok = false;
          }
          if (!ok || (last && crossesRoad(A, N, E))) continue;
          nearRoad(E[0], E[1], (q) => { if (Math.hypot(q[0] - E[0], q[1] - E[1]) < 6) crowd++; });
          let score = Math.max(0, SEP_GOOD - sep) * 2 + Math.max(0, goal - L) * 3 + Math.max(0, L - goal) * 0.5 + dist(O, E) * 0.3 + crowd * 0.12 + (clear < ROAD_CLEAR ? TIGHT_COST : 0);
          // 육지에 있던 거점은 주차장 자리가 나와도 바다로 옮기지 않는다
          if (!onLand(E[0], E[1])) score += landO ? 200 : 8;
          if (score >= bestScore) continue;
          score += Math.max(0, LOT_GOAL - stallsAt(around, E, ux, uy)) * LOT_WEIGHT;
          if (score < bestScore) { bestScore = score; best = E; }
        }
      }
    }
    if (!best) {
      if (pass) continue;
      // 낼 자리가 없으면 거점은 그대로 두고 진입로만 입구 교차로에 다시 잇는다
      setFrom(spur, A, [N, O]);
      if (splitFor.has(s.id)) stuck.push(s.id);
      stats.kept++;
      continue;
    }
    s.x = R2(best[0]);
    s.y = R2(best[1]);
    nodes[s.node].x = s.x;
    nodes[s.node].y = s.y;
    setFrom(spur, A, [N, [s.x, s.y]]);
    if (!pass) stats.moved++;
  }
  // 움직이지 않은 거점도 입구 교차로가 옮겨 갔으면 다시 잇는다
  for (const s of sites) {
    const spur = spurOf(s);
    if (!spur) continue;
    const A = attachOf(s);
    const pts = from(spur, A);
    pts[0] = [nodes[A].x, nodes[A].y];
    pts[pts.length - 1] = [s.x, s.y];
    setFrom(spur, A, pts);
  }
  return { stats, stuck };
}
