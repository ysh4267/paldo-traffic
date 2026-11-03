// 실제 도로 선형을 격자에 찍고 골격선을 뽑아, 왕복 분리 도로를 하나의 중심선 그래프로 합친다
import { dist, polyLength } from './geo.mjs';

export class Grid {
  constructor(x0, y0, x1, y1, cell) {
    this.x0 = x0; this.y0 = y0; this.cell = cell;
    this.W = Math.ceil((x1 - x0) / cell) + 2;
    this.H = Math.ceil((y1 - y0) / cell) + 2;
    this.d = new Uint8Array(this.W * this.H);
  }
  idx(x, y) {
    return Math.floor((y - this.y0) / this.cell) * this.W + Math.floor((x - this.x0) / this.cell);
  }
  stampPolyline(pts) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const n = Math.ceil(dist(a, b) / (this.cell * 0.5)) + 1;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const j = this.idx(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        if (j >= 0 && j < this.d.length) this.d[j] = 1;
      }
    }
  }
  dilate(r) {
    const { W, H, d } = this;
    const out = new Uint8Array(d.length);
    const off = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r * 0.5) off.push([dx, dy]);
    for (let y = r; y < H - r; y++) {
      for (let x = r; x < W - r; x++) {
        if (!d[y * W + x]) continue;
        for (const [dx, dy] of off) out[(y + dy) * W + x + dx] = 1;
      }
    }
    this.d = out;
  }
  // 도로로 둘러싸인 작은 빈 공간(인터체인지 고리, 짧은 분리 구간)을 메운다
  fillHoles(maxAreaKm2) {
    const { W, H, d, cell } = this;
    const seen = new Uint8Array(d.length);
    const maxCells = maxAreaKm2 / (cell * cell);
    const stack = [];
    for (let i = 0; i < d.length; i++) {
      if (d[i] || seen[i]) continue;
      const comp = [];
      let touches = false;
      stack.length = 0;
      stack.push(i);
      seen[i] = 1;
      while (stack.length) {
        const p = stack.pop();
        comp.push(p);
        const x = p % W, y = (p - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches = true;
        if (x > 0 && !d[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
        if (x < W - 1 && !d[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
        if (y > 0 && !d[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
        if (y < H - 1 && !d[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
      }
      if (!touches && comp.length <= maxCells) for (const p of comp) d[p] = 1;
    }
  }
  thin() {
    const { W, H, d } = this;
    let active = [];
    for (let i = 0; i < d.length; i++) if (d[i]) {
      const x = i % W, y = (i - x) / W;
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) active.push(i); else d[i] = 0;
    }
    const n8 = (p) => [d[p - W], d[p - W + 1], d[p + 1], d[p + W + 1], d[p + W], d[p + W - 1], d[p - 1], d[p - W - 1]];
    for (let changed = true; changed;) {
      changed = false;
      for (const step of [0, 1]) {
        const del = [];
        for (const p of active) {
          if (!d[p]) continue;
          const n = n8(p);
          let b = 0, a = 0;
          for (let i = 0; i < 8; i++) { b += n[i]; if (!n[i] && n[(i + 1) % 8]) a++; }
          if (b < 2 || b > 6 || a !== 1) continue;
          const [N, , E, , S, , Wv] = n;
          if (step === 0 ? (N && E && S) || (E && S && Wv) : (N && E && Wv) || (N && S && Wv)) continue;
          del.push(p);
        }
        if (del.length) changed = true;
        for (const p of del) d[p] = 0;
      }
      active = active.filter((p) => d[p]);
    }
    // 계단 모서리 제거: 이웃이 정확히 둘이고 그 둘이 서로 대각선으로 맞닿으면 필요 없는 픽셀
    for (let pass = 0; pass < 2; pass++) {
      for (const p of active) {
        if (!d[p]) continue;
        const n = n8(p);
        const c = n.reduce((s, v) => s + v, 0);
        if (c !== 2) continue;
        if ((n[0] && n[2]) || (n[2] && n[4]) || (n[4] && n[6]) || (n[6] && n[0])) d[p] = 0;
      }
    }
  }
  // 대각선 이웃 중 인접 상하좌우를 통해 이어지는 것은 제외한 실질 이웃
  effective(p) {
    const { W, d } = this;
    const ring = [p - W, p - W + 1, p + 1, p + W + 1, p + W, p + W - 1, p - 1, p - W - 1];
    const out = [];
    for (let i = 0; i < 8; i++) {
      if (!d[ring[i]]) continue;
      if (i % 2 === 1 && (d[ring[(i + 7) % 8]] || d[ring[(i + 1) % 8]])) continue;
      out.push(ring[i]);
    }
    return out;
  }
  center(p) {
    const x = p % this.W, y = (p - x) / this.W;
    return [this.x0 + (x + 0.5) * this.cell, this.y0 + (y + 0.5) * this.cell];
  }
}

// 그래프: 노드와 폴리라인 간선. 정리 연산을 함께 제공한다
export class RoadGraph {
  constructor() { this.nodes = new Map(); this.edges = new Map(); this.nextN = 1; this.nextE = 1; }
  addNode(x, y, props = {}) {
    const id = this.nextN++;
    this.nodes.set(id, { id, x, y, edges: new Set(), ...props });
    return id;
  }
  addEdge(a, b, pts, props = {}) {
    const id = this.nextE++;
    const e = { id, a, b, pts, len: polyLength(pts), ...props };
    this.edges.set(id, e);
    this.nodes.get(a).edges.add(id);
    this.nodes.get(b).edges.add(id);
    return id;
  }
  removeEdge(id) {
    const e = this.edges.get(id);
    if (!e) return;
    this.nodes.get(e.a).edges.delete(id);
    this.nodes.get(e.b).edges.delete(id);
    this.edges.delete(id);
  }
  removeNode(id) {
    for (const e of [...this.nodes.get(id).edges]) this.removeEdge(e);
    this.nodes.delete(id);
  }
  other(e, n) { return e.a === n ? e.b : e.a; }
  // n에서 시작하도록 방향을 맞춘 좌표열
  ptsFrom(e, n) { return e.a === n ? e.pts : e.pts.slice().reverse(); }

  // 차수 2 노드를 없애 간선을 잇는다
  mergeDegree2(keep = () => false) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of [...this.nodes.values()]) {
        if (!this.nodes.has(n.id) || n.edges.size !== 2 || keep(n)) continue;
        const [e1Id, e2Id] = [...n.edges];
        const e1 = this.edges.get(e1Id), e2 = this.edges.get(e2Id);
        if (!e1 || !e2) continue;
        const a = this.other(e1, n.id), b = this.other(e2, n.id);
        if (a === n.id || b === n.id) continue;
        // 고리가 되면 그대로 둔다
        if (a === b) continue;
        const p1 = this.ptsFrom(e1, a);
        const p2 = this.ptsFrom(e2, n.id);
        const merged = p1.concat(p2.slice(1));
        const props = pickProps(e1.len >= e2.len ? e1 : e2);
        this.removeEdge(e1Id); this.removeEdge(e2Id);
        this.nodes.delete(n.id);
        this.addEdge(a, b, merged, props);
        changed = true;
      }
    }
  }
  pruneDeadEnds(minLen, keep = () => false) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of [...this.nodes.values()]) {
        if (!this.nodes.has(n.id) || keep(n)) continue;
        if (n.edges.size === 0) { this.nodes.delete(n.id); continue; }
        if (n.edges.size !== 1) continue;
        const e = this.edges.get([...n.edges][0]);
        if (e.len < minLen) { this.removeEdge(e.id); this.nodes.delete(n.id); changed = true; }
      }
      if (changed) this.mergeDegree2(keep);
    }
  }
  removeLoops(minLoop = 12) {
    for (const e of [...this.edges.values()]) if (e.a === e.b && e.len < minLoop) this.removeEdge(e.id);
  }
  // 짧은 간선을 수축해 한 노드로 합친다
  contractShort(minLen, keep = () => false) {
    const queue = () => [...this.edges.values()].filter((e) => e.len < minLen && e.a !== e.b).sort((p, q) => p.len - q.len);
    for (let guard = 0; guard < 100000; guard++) {
      const list = queue();
      if (!list.length) break;
      const e = list.find((c) => !(keep(this.nodes.get(c.a)) && keep(this.nodes.get(c.b))));
      if (!e) break;
      this.contractEdge(e.id, keep);
    }
    this.removeLoops();
  }
  contractEdge(id, keep = () => false) {
    const e = this.edges.get(id);
    const A = this.nodes.get(e.a), B = this.nodes.get(e.b);
    const wa = keep(A) ? 1e6 : Math.max(1, A.edges.size), wb = keep(B) ? 1e6 : Math.max(1, B.edges.size);
    const x = (A.x * wa + B.x * wb) / (wa + wb), y = (A.y * wa + B.y * wb) / (wa + wb);
    this.removeEdge(id);
    for (const eid of [...B.edges]) {
      const f = this.edges.get(eid);
      if (f.a === B.id) f.a = A.id;
      if (f.b === B.id) f.b = A.id;
      A.edges.add(eid);
    }
    this.nodes.delete(B.id);
    if (B.name && !A.name) A.name = B.name;
    A.x = x; A.y = y;
    for (const eid of A.edges) {
      const f = this.edges.get(eid);
      if (f.a === A.id) f.pts = [[x, y], ...f.pts.slice(1)];
      if (f.b === A.id) f.pts = [...f.pts.slice(0, -1), [x, y]];
      f.len = polyLength(f.pts);
    }
  }
  // 같은 두 노드를 잇는 간선이 여럿이면 하나만 남긴다
  dedupeParallel(ratio = 1.6) {
    const seen = new Map();
    const order = [...this.edges.values()].sort((p, q) => p.len - q.len);
    for (const e of order) {
      const k = e.a < e.b ? `${e.a}_${e.b}` : `${e.b}_${e.a}`;
      if (!seen.has(k)) { seen.set(k, e); continue; }
      const first = seen.get(k);
      if (e.len < first.len * ratio) this.removeEdge(e.id);
      else {
        // 충분히 다른 경로면 가운데 노드를 넣어 평행 간선을 없앤다
        const mid = Math.floor(e.pts.length / 2);
        if (mid < 1 || mid >= e.pts.length - 1) { this.removeEdge(e.id); continue; }
        this.splitEdgeAtIndex(e.id, mid);
      }
    }
  }
  splitEdgeAtIndex(id, idx) {
    const e = this.edges.get(id);
    const p = e.pts[idx];
    const m = this.addNode(p[0], p[1]);
    const props = pickProps(e);
    const p1 = e.pts.slice(0, idx + 1), p2 = e.pts.slice(idx);
    const { a, b } = e;
    this.removeEdge(id);
    this.addEdge(a, m, p1, props);
    this.addEdge(m, b, p2, props);
    return m;
  }
  // 간선 위 임의 지점에서 쪼개 새 노드를 만든다
  splitEdgeAt(id, seg, t, pt) {
    const e = this.edges.get(id);
    const m = this.addNode(pt[0], pt[1]);
    const props = pickProps(e);
    const p1 = e.pts.slice(0, seg + 1).concat([pt]);
    const p2 = [pt].concat(e.pts.slice(seg + 1));
    const { a, b } = e;
    this.removeEdge(id);
    this.addEdge(a, m, p1, props);
    this.addEdge(m, b, p2, props);
    return m;
  }
  components() {
    const comp = new Map();
    let c = 0;
    for (const n of this.nodes.values()) {
      if (comp.has(n.id)) continue;
      c++;
      const st = [n.id];
      comp.set(n.id, c);
      while (st.length) {
        const u = st.pop();
        for (const eid of this.nodes.get(u).edges) {
          const v = this.other(this.edges.get(eid), u);
          if (!comp.has(v)) { comp.set(v, c); st.push(v); }
        }
      }
    }
    return comp;
  }
}

function pickProps(e) {
  const { id, a, b, pts, len, ...rest } = e;
  return rest;
}

// 골격 격자에서 그래프 추출
export function extractGraph(grid, edgeProps = {}) {
  const g = new RoadGraph();
  const { d } = grid;
  const isNodePx = new Int32Array(d.length); // 0 = 아님, 그 외 = 노드 id
  const pixels = [];
  for (let i = 0; i < d.length; i++) if (d[i]) pixels.push(i);

  // 분기/끝 픽셀을 묶어 노드로
  const special = new Set();
  for (const p of pixels) {
    const deg = grid.effective(p).length;
    if (deg !== 2) special.add(p);
  }
  const W = grid.W;
  const seenS = new Set();
  for (const p of special) {
    if (seenS.has(p)) continue;
    const cluster = [];
    const st = [p];
    seenS.add(p);
    while (st.length) {
      const u = st.pop();
      cluster.push(u);
      for (const v of [u - W, u - W + 1, u + 1, u + W + 1, u + W, u + W - 1, u - 1, u - W - 1]) {
        if (special.has(v) && !seenS.has(v)) { seenS.add(v); st.push(v); }
      }
    }
    let sx = 0, sy = 0;
    for (const u of cluster) { const c = grid.center(u); sx += c[0]; sy += c[1]; }
    const id = g.addNode(sx / cluster.length, sy / cluster.length);
    for (const u of cluster) isNodePx[u] = id;
  }

  // 노드에서 출발해 경로 픽셀을 따라 걷는다
  const visited = new Uint8Array(d.length);
  const neighbors8 = (u) => [u - W, u + 1, u + W, u - 1, u - W + 1, u + W + 1, u + W - 1, u - W - 1];
  for (const p of special) {
    const startNode = isNodePx[p];
    for (const q0 of neighbors8(p)) {
      if (!d[q0] || isNodePx[q0] || visited[q0]) continue;
      const nodeC = g.nodes.get(startNode);
      const pts = [[nodeC.x, nodeC.y], grid.center(q0)];
      visited[q0] = 1;
      let cur = q0;
      let endNode = 0;
      for (;;) {
        let next = -1;
        const neigh = neighbors8(cur);
        // 먼저 다른 노드 도착 여부 확인
        for (const r of neigh) {
          if (d[r] && isNodePx[r] && (isNodePx[r] !== startNode || pts.length > 6)) { endNode = isNodePx[r]; break; }
        }
        if (endNode) break;
        for (const r of neigh) {
          if (d[r] && !isNodePx[r] && !visited[r]) { next = r; break; }
        }
        if (next < 0) break;
        visited[next] = 1;
        pts.push(grid.center(next));
        cur = next;
      }
      if (!endNode) {
        const c = grid.center(cur);
        endNode = g.addNode(c[0], c[1]);
      } else {
        const nc = g.nodes.get(endNode);
        pts.push([nc.x, nc.y]);
      }
      g.addEdge(startNode, endNode, pts, edgeProps);
    }
  }
  return g;
}
