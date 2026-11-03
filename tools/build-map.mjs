// 지도 데이터 전체 빌드: .cache/raw/* → data/korea.json
// 사용법: node tools/build-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { project, dist, polyLength, simplify, simplifyRing, chaikin, chaikinRing, gaussianSmooth, ringArea, pointInRing, nearestOnPolyline, clipRingToBox, flat, round1, round2, unproject } from './lib/geo.mjs';
import { Grid, extractGraph, RoadGraph } from './lib/skeleton.mjs';
import { decodePng } from './lib/png.mjs';
import { REGIONS, SITES, FERRIES, PROJECTS, SEA_LABELS } from './sites-data.mjs';

const RAW = path.resolve('.cache/raw');
const readRaw = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
const log = (...a) => console.log(...a);

const BOX = { x0: -330, y0: -330, x1: 400, y1: 350 };

// ── 행정구역 ────────────────────────────────────────────────
function decodeTopo(topo) {
  const key = Object.keys(topo.objects)[0];
  const tf = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    const pts = arc.map((p) => {
      if (tf) {
        x += p[0]; y += p[1];
        return project(x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]);
      }
      return project(p[0], p[1]);
    });
    return pts;
  });
  return { key, arcs, geoms: topo.objects[key].geometries };
}

function buildProvinces() {
  const { arcs, geoms } = decodeTopo(readRaw('geo/skorea-provinces-2018-topo.json'));
  // 호(arc) 단위로 단순화해야 도 경계에 틈이 안 생긴다
  const inland = (a) => a.length > 1 && dist(a[0], a[a.length - 1]) > 0;
  const shared = new Map();
  for (const g of geoms) for (const poly of (g.type === 'Polygon' ? [g.arcs] : g.arcs)) for (const r of poly) for (const i of r) { const k = i >= 0 ? i : ~i; shared.set(k, (shared.get(k) || 0) + 1); }
  // 두 시도가 함께 쓰는 호는 내륙 경계이므로 크게 다듬고, 해안선은 모양을 유지한다
  const simple = arcs.map((a, i) => (shared.get(i) >= 2 && inland(a) ? simplify(gaussianSmooth(a, 1.6, 0.3), 0.15) : simplify(a, 0.12)));
  const raw = arcs;
  const ringOf = (idx, src) => {
    const out = [];
    for (const i of idx) {
      const a = i >= 0 ? src[i] : src[~i].slice().reverse();
      for (let k = out.length ? 1 : 0; k < a.length; k++) out.push(a[k]);
    }
    if (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
    return out;
  };
  const provinces = [];
  for (const g of geoms) {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    const rings = [], fullRings = [];
    for (const poly of polys) {
      poly.forEach((r, ri) => {
        const ring = ringOf(r, simple);
        const full = ringOf(r, raw);
        const area = ringArea(full);
        if (ri === 0) fullRings.push(full);
        if (area < 0.35) return;
        rings.push(ring);
      });
    }
    provinces.push({ name: g.properties.name, code: g.properties.code, rings, fullRings });
  }
  log('provinces', provinces.map((p) => `${p.name}:${p.rings.length}/${p.rings.reduce((s, r) => s + r.length, 0)}`).join(' '));
  return provinces;
}

function provinceRegion(name) {
  return REGIONS.findIndex((r) => r.provinces.includes(name));
}

function regionOfPoint(provinces, x, y) {
  for (const p of provinces) {
    for (const r of p.fullRings) if (pointInRing(x, y, r)) return provinceRegion(p.name);
  }
  // 해상 교량 등 경계 밖: 가장 가까운 시도
  let best = -1, bd = Infinity;
  for (const p of provinces) {
    for (const r of p.fullRings) {
      for (let i = 0; i < r.length; i += 6) {
        const d = Math.abs(r[i][0] - x) + Math.abs(r[i][1] - y);
        if (d < bd) { bd = d; best = provinceRegion(p.name); }
      }
    }
  }
  return best;
}

// ── 주변 국가 (북한·일본·중국 일부) ─────────────────────────
function buildOthers() {
  const ne = readRaw('geo/ne_10m_admin_0_countries.geojson');
  const out = { north: [], foreign: [], southFill: [] };
  for (const f of ne.features) {
    const name = f.properties.ADMIN;
    const bucket = name === 'North Korea' ? 'north' : name === 'South Korea' ? 'southFill' : ['Japan', 'China', 'Russia'].includes(name) ? 'foreign' : null;
    if (!bucket) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const ring = poly[0].map((p) => project(p[0], p[1]));
      const clipped = clipRingToBox(ring, BOX.x0 - 40, BOX.y0 - 160, BOX.x1 + 80, BOX.y1 + 60);
      if (clipped.length < 3 || ringArea(clipped) < 2) continue;
      out[bucket].push(flat(simplifyRing(clipped, bucket === 'foreign' ? 1.6 : 0.8), round1));
    }
  }
  log('others', out.north.length, out.foreign.length, out.southFill.length);
  return out;
}

// ── 지형 등고선 ─────────────────────────────────────────────
function buildTerrain() {
  const Z = 8, TX0 = 216, TY0 = 96, TN = 7, S = 256;
  const W = TN * S, H = TN * S;
  const elev = new Float32Array(W * H);
  for (let ty = 0; ty < TN; ty++) {
    for (let tx = 0; tx < TN; tx++) {
      const file = path.join(RAW, 'terrain', `${Z}_${TX0 + tx}_${TY0 + ty}.png`);
      const png = decodePng(fs.readFileSync(file));
      const ch = png.channels;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const i = (y * S + x) * ch;
          elev[(ty * S + y) * W + tx * S + x] = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
        }
      }
    }
  }
  // 2배 축소 + 박스 블러로 부드럽게
  const F = 2, w = Math.floor(W / F), h = Math.floor(H / F);
  let g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < F; dy++) for (let dx = 0; dx < F; dx++) s += elev[(y * F + dy) * W + x * F + dx];
      g[y * w + x] = s / (F * F);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * w + x + dx];
        b[y * w + x] = s / 9;
      }
    }
    g = b;
  }
  const lon = (x) => ((TX0 + ((x + 0.5) * F) / S) / 2 ** Z) * 360 - 180;
  const lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (TY0 + ((y + 0.5) * F) / S)) / 2 ** Z))) * 180) / Math.PI;
  const lons = Float64Array.from({ length: w }, (_, i) => lon(i));
  const lats = Float64Array.from({ length: h }, (_, i) => lat(i));
  // 휴전선 북쪽은 지형을 그리지 않는다
  const northRow = lats.findIndex((v) => v < 38.85);
  const southRow = lats.findIndex((v) => v < 33.05);
  const levels = [{ z: 120, minA: 22 }, { z: 320, minA: 14 }, { z: 620, minA: 10 }, { z: 1000, minA: 6 }];
  const layers = [];
  for (const { z, minA } of levels) {
    const rings = marchingSquares(g, w, h, z, northRow, southRow > 0 ? southRow : h - 1, (x, y) => project(lons[0] + ((lons[w - 1] - lons[0]) * x) / (w - 1), latInterp(lats, y)));
    const kept = [];
    let n = 0;
    for (const r of rings) {
      if (ringArea(r) < minA) continue;
      const s = chaikinRing(simplifyRing(r, 0.55), 1);
      kept.push(flat(s, round1));
      n += s.length;
    }
    layers.push({ z, rings: kept });
    log('terrain', z, 'rings', kept.length, 'pts', n);
  }
  return layers;
}
function latInterp(lats, y) {
  const i = Math.max(0, Math.min(lats.length - 2, Math.floor(y)));
  return lats[i] + (lats[i + 1] - lats[i]) * (y - i);
}

// 값 z 이상 영역의 경계를 닫힌 고리로 추출
function marchingSquares(g, w, h, z, y0, y1, toXY) {
  const val = (x, y) => (x <= 0 || x >= w - 1 || y <= y0 || y >= y1 ? -1e4 : g[y * w + x]);
  const pointOn = new Map();
  const keyH = (x, y) => (y * w + x) * 2;
  const keyV = (x, y) => (y * w + x) * 2 + 1;
  const coordH = (x, y) => { const a = val(x, y), b = val(x + 1, y); return toXY(x + (z - a) / (b - a), y); };
  const coordV = (x, y) => { const a = val(x, y), b = val(x, y + 1); return toXY(x, y + (z - a) / (b - a)); };
  const link = new Map();
  const addSeg = (a, ca, b, cb) => {
    if (!pointOn.has(a)) pointOn.set(a, ca());
    if (!pointOn.has(b)) pointOn.set(b, cb());
    if (!link.has(a)) link.set(a, []);
    if (!link.has(b)) link.set(b, []);
    link.get(a).push(b);
    link.get(b).push(a);
  };
  for (let y = Math.max(0, y0 - 1); y < Math.min(h - 1, y1 + 1); y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = val(x, y) >= z, b = val(x + 1, y) >= z, c = val(x + 1, y + 1) >= z, d = val(x, y + 1) >= z;
      const code = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = [keyH(x, y), () => coordH(x, y)], B = [keyH(x, y + 1), () => coordH(x, y + 1)];
      const L = [keyV(x, y), () => coordV(x, y)], R = [keyV(x + 1, y), () => coordV(x + 1, y)];
      const seg = (p, q) => addSeg(p[0], p[1], q[0], q[1]);
      switch (code) {
        case 1: case 14: seg(L, B); break;
        case 2: case 13: seg(B, R); break;
        case 3: case 12: seg(L, R); break;
        case 4: case 11: seg(T, R); break;
        case 6: case 9: seg(T, B); break;
        case 7: case 8: seg(L, T); break;
        case 5: seg(L, T); seg(B, R); break;
        case 10: seg(L, B); seg(T, R); break;
        default: break;
      }
    }
  }
  const rings = [];
  const seen = new Set();
  for (const start of link.keys()) {
    if (seen.has(start)) continue;
    const ring = [];
    let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      ring.push(pointOn.get(cur));
      const nx = link.get(cur);
      const next = nx[0] !== prev ? nx[0] : nx[1];
      prev = cur;
      cur = next;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// ── 강과 호수 ───────────────────────────────────────────────
function chainPolylines(lines) {
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  let pool = lines.map((l) => l.slice());
  let merged = true;
  while (merged) {
    merged = false;
    const ends = new Map();
    pool.forEach((l, i) => {
      for (const k of [key(l[0]), key(l[l.length - 1])]) {
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k).push(i);
      }
    });
    const used = new Set();
    const next = [];
    pool.forEach((l, i) => {
      if (used.has(i)) return;
      used.add(i);
      let cur = l;
      for (let grow = true; grow;) {
        grow = false;
        const tail = ends.get(key(cur[cur.length - 1])) || [];
        for (const j of tail) {
          if (used.has(j)) continue;
          const o = pool[j];
          if (key(o[0]) === key(cur[cur.length - 1])) cur = cur.concat(o.slice(1));
          else if (key(o[o.length - 1]) === key(cur[cur.length - 1])) cur = cur.concat(o.slice(0, -1).reverse());
          else continue;
          used.add(j); grow = true; merged = true;
          break;
        }
      }
      next.push(cur);
    });
    pool = next;
  }
  return pool;
}

function buildWater() {
  const rivers = readRaw('osm_rivers.json').elements;
  const byName = new Map();
  for (const w of rivers) {
    if (!w.geometry) continue;
    const pts = w.geometry.map((g) => project(g.lon, g.lat));
    if (!byName.has(w.tags.name)) byName.set(w.tags.name, []);
    byName.get(w.tags.name).push(pts);
  }
  const major = new Set(['한강', '남한강', '북한강', '낙동강', '금강', '섬진강', '영산강', '임진강']);
  const outR = [];
  let n = 0;
  for (const [name, lines] of byName) {
    for (const l of chainPolylines(lines)) {
      if (polyLength(l) < 4) continue;
      const s = simplify(gaussianSmooth(l, major.has(name) ? 1.6 : 2.2), 0.12);
      outR.push({ m: major.has(name) ? 1 : 0, p: flat(s, round1) });
      n += s.length;
    }
  }
  log('rivers', outR.length, 'pts', n);

  const lakes = readRaw('osm_lakes.json').elements;
  const outL = [];
  const addRing = (r) => {
    if (ringArea(r) < 1.2) return;
    outL.push(flat(simplifyRing(r, 0.14), round2));
  };
  for (const e of lakes) {
    if (e.type === 'way' && e.geometry) addRing(e.geometry.map((g) => project(g.lon, g.lat)).slice(0, -1));
    else if (e.members) {
      const outer = e.members.filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry.map((g) => project(g.lon, g.lat)));
      for (const l of chainPolylines(outer)) if (dist(l[0], l[l.length - 1]) < 0.2) addRing(l.slice(0, -1));
    }
  }
  log('lakes', outL.length);
  return { rivers: outR, lakes: outL };
}

// ── 도로 그래프 ─────────────────────────────────────────────
function loadWays(file, classes) {
  const out = {};
  for (const c of classes) out[c] = [];
  for (const w of readRaw(file).elements) {
    if (!w.geometry || w.geometry.length < 2) continue;
    const c = w.tags.highway;
    if (!out[c]) continue;
    out[c].push({
      pts: w.geometry.map((g) => project(g.lon, g.lat)),
      name: w.tags.name || '', ref: w.tags.ref || '',
      keys: [`${w.geometry[0].lat.toFixed(6)},${w.geometry[0].lon.toFixed(6)}`, `${w.geometry[w.geometry.length - 1].lat.toFixed(6)},${w.geometry[w.geometry.length - 1].lon.toFixed(6)}`],
      allKeys: c === 'motorway_link' ? null : w.geometry.map((g) => `${g.lat.toFixed(6)},${g.lon.toFixed(6)}`),
    });
  }
  return out;
}

function skeletonize(lines, { cell = 0.4, dilate = 2, holes, deadEnd, contract }, kind) {
  const grid = new Grid(BOX.x0, BOX.y0, BOX.x1, BOX.y1, cell);
  for (const l of lines) grid.stampPolyline(l.pts);
  grid.dilate(dilate);
  grid.fillHoles(holes);
  grid.thin();
  const g = extractGraph(grid, { kind });
  g.removeLoops(8);
  g.mergeDegree2();
  g.pruneDeadEnds(deadEnd);
  g.contractShort(contract);
  g.mergeDegree2();
  g.pruneDeadEnds(deadEnd);
  g.dedupeParallel();
  g.mergeDegree2();
  return g;
}

function absorb(target, src, nodeFilter = () => true) {
  const map = new Map();
  for (const n of src.nodes.values()) if (nodeFilter(n)) map.set(n.id, target.addNode(n.x, n.y));
  for (const e of src.edges.values()) if (map.has(e.a) && map.has(e.b)) target.addEdge(map.get(e.a), map.get(e.b), e.pts, { kind: e.kind });
}

function edgeBB(e) {
  if (e.bb && e.bbLen === e.pts.length) return e.bb;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of e.pts) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  e.bb = [x0, y0, x1, y1];
  e.bbLen = e.pts.length;
  return e.bb;
}

function nearestEdge(g, p, maxD, test = null) {
  let best = null;
  for (const e of g.edges.values()) {
    if (test && !test(e)) continue;
    const [x0, y0, x1, y1] = edgeBB(e);
    if (p[0] < x0 - maxD || p[0] > x1 + maxD || p[1] < y0 - maxD || p[1] > y1 + maxD) continue;
    const r = nearestOnPolyline(p, e.pts);
    if (r.d < maxD && (!best || r.d < best.d)) best = { ...r, edge: e };
  }
  return best;
}

function nodeAt(g, hit, snap = 2.5) {
  const e = hit.edge;
  const len = polyLength(e.pts);
  if (hit.along < snap) return e.a;
  if (len - hit.along < snap) return e.b;
  return g.splitEdgeAt(e.id, hit.seg, hit.t, hit.pt);
}

function clusterPoints(pts, radius) {
  const clusters = [];
  for (const p of pts) {
    let c = clusters.find((q) => dist(q.c, p) < radius);
    if (!c) { clusters.push({ c: p.slice(), n: 1 }); continue; }
    c.c = [(c.c[0] * c.n + p[0]) / (c.n + 1), (c.c[1] * c.n + p[1]) / (c.n + 1)];
    c.n++;
  }
  return clusters.map((q) => q.c);
}

function linkExpressways(g, ways) {
  const trunkKeys = new Set();
  for (const t of ways.trunk) for (const k of t.allKeys) trunkKeys.add(k);
  const motKeys = new Set();
  for (const m of ways.motorway) for (const k of m.allKeys) motKeys.add(k);
  const linkEnds = new Map();
  for (const l of ways.motorway_link) for (const k of l.keys) linkEnds.set(k, (linkEnds.get(k) || 0) + 1);
  const pts = [];
  for (const rec of [...ways.motorway_link, ...ways.motorway]) {
    const ends = [[rec.keys[0], rec.pts[0]], [rec.keys[1], rec.pts[rec.pts.length - 1]]];
    for (const [k, p] of ends) if (trunkKeys.has(k)) pts.push(p);
  }
  for (const l of ways.motorway_link) {
    const ends = [[l.keys[0], l.pts[0]], [l.keys[1], l.pts[l.pts.length - 1]]];
    for (const [k, p] of ends) if (!motKeys.has(k) && linkEnds.get(k) === 1) pts.push(p);
  }
  const clusters = clusterPoints(pts, 3);
  let linked = 0;
  for (const p of clusters) {
    const hm = nearestEdge(g, p, 3.5, (e) => e.kind === 'x');
    const ht = nearestEdge(g, p, 2.5, (e) => e.kind === 'n');
    if (!hm || !ht || dist(hm.pt, ht.pt) > 5) continue;
    const a = nodeAt(g, hm);
    const b = nodeAt(g, nearestEdge(g, p, 2.6, (e) => e.kind === 'n'));
    if (a === b) continue;
    const A = g.nodes.get(a), B = g.nodes.get(b);
    if ([...A.edges].some((eid) => g.other(g.edges.get(eid), a) === b)) continue;
    g.addEdge(a, b, [[A.x, A.y], [B.x, B.y]], { kind: 'r' });
    linked++;
  }
  log('linked interchanges', linked, 'of', clusters.length);
}

// primary 그래프로 g의 끊긴 끝점을 다른 도로까지 이어준다
function dijkstraFrom(gp, startNode, maxLen, visit) {
  const distTo = new Map([[startNode, 0]]);
  const prev = new Map();
  const heap = [[0, startNode]];
  while (heap.length) {
    heap.sort((a, b) => a[0] - b[0]);
    const [d, u] = heap.shift();
    if (d > distTo.get(u) || d > maxLen) continue;
    if (visit(u, d)) return { end: u, prev, d };
    for (const eid of gp.nodes.get(u).edges) {
      const e = gp.edges.get(eid);
      const v = gp.other(e, u);
      const nd = d + e.len;
      if (nd < (distTo.get(v) ?? Infinity)) { distTo.set(v, nd); prev.set(v, [u, eid]); heap.push([nd, v]); }
    }
  }
  return null;
}

function graphDistance(g, a, b, limit) {
  const distTo = new Map([[a, 0]]);
  const heap = [[0, a]];
  while (heap.length) {
    heap.sort((p, q) => p[0] - q[0]);
    const [d, u] = heap.shift();
    if (u === b) return d;
    if (d > limit || d > distTo.get(u)) continue;
    for (const eid of g.nodes.get(u).edges) {
      const e = g.edges.get(eid);
      const v = g.other(e, u);
      const nd = d + e.len;
      if (nd < (distTo.get(v) ?? Infinity)) { distTo.set(v, nd); heap.push([nd, v]); }
    }
  }
  return Infinity;
}

// 시작 노드에서 primary 길을 따라 g에 닿는 첫 지점까지 경로를 찾아 g에 이어 붙인다
function spliceViaPrimary(g, gp, fromPoint, fromNode, { maxLen = 45, needDetour = true } = {}) {
  const h0 = nearestEdge(gp, fromPoint, 3.5);
  if (!h0) return null;
  const start = nodeAt(gp, h0, 0.8);
  const startD = dist(fromPoint, [gp.nodes.get(start).x, gp.nodes.get(start).y]);
  let foundHit = null;
  const res = dijkstraFrom(gp, start, maxLen, (u, d) => {
    if (d < 3) return false;
    const n = gp.nodes.get(u);
    const hit = nearestEdge(g, [n.x, n.y], 1.6, (e) => fromNode == null || (e.a !== fromNode && e.b !== fromNode));
    if (!hit) return false;
    if (needDetour && fromNode != null) {
      // 기존 길로 금방 닿는 곳이면 새 길이 필요 없다
      const nearA = dist(hit.pt, [g.nodes.get(hit.edge.a).x, g.nodes.get(hit.edge.a).y]) < dist(hit.pt, [g.nodes.get(hit.edge.b).x, g.nodes.get(hit.edge.b).y]) ? hit.edge.a : hit.edge.b;
      const gd = graphDistance(g, fromNode, nearA, d * 1.7 + 12);
      if (gd < d * 1.7 + 8) return false;
    }
    foundHit = hit;
    return true;
  });
  if (!res) return null;
  // 경로 좌표 조립
  const seq = [];
  for (let u = res.end; u !== start;) {
    const [p, eid] = res.prev.get(u);
    seq.push([p, eid, u]);
    u = p;
  }
  seq.reverse();
  let pts = [];
  for (const [p, eid] of seq) {
    const e = gp.edges.get(eid);
    const part = gp.ptsFrom(e, p);
    pts = pts.length ? pts.concat(part.slice(1)) : part.slice();
  }
  const target = nodeAt(g, foundHit, 2.5);
  const T = g.nodes.get(target);
  pts.push([T.x, T.y]);
  let startId = fromNode;
  if (startId == null) startId = g.addNode(pts[0][0], pts[0][1]);
  else {
    const S = g.nodes.get(startId);
    pts.unshift([S.x, S.y]);
  }
  if (startId === target) return null;
  g.addEdge(startId, target, pts, { kind: 'n', viaPrimary: true });
  return { startId, target, startD, len: polyLength(pts) };
}

function buildRoads(provinces) {
  const ways = loadWays('osm_major_roads.json', ['motorway', 'motorway_link', 'trunk']);
  const prim = loadWays('osm_primary.json', ['primary']).primary;
  log('ways', ways.motorway.length, ways.motorway_link.length, ways.trunk.length, prim.length);

  const gm = skeletonize([...ways.motorway, ...ways.motorway_link], { holes: 9, deadEnd: 4, contract: 4 }, 'x');
  const gt = skeletonize(ways.trunk, { holes: 4, deadEnd: 6, contract: 5 }, 'n');
  const gp = skeletonize(prim, { holes: 3, deadEnd: 2.5, contract: 2 }, 'n');
  const km = (x) => Math.round([...x.edges.values()].reduce((s, e) => s + e.len, 0));
  log('motorway', gm.nodes.size, gm.edges.size, km(gm) + 'km', '| trunk', gt.nodes.size, gt.edges.size, km(gt) + 'km', '| primary', gp.nodes.size, gp.edges.size, km(gp) + 'km');

  const g = new RoadGraph();
  absorb(g, gm);
  absorb(g, gt);
  linkExpressways(g, ways);

  // 제주도는 큰길 등급이 없어 지방도까지 포함해 별도로 골격화한다
  const onJeju = (n) => n.y > 250;
  const jeju = readRaw('osm_jeju.json').elements.filter((w) => w.geometry).map((w) => ({ pts: w.geometry.map((p) => project(p.lon, p.lat)), name: w.tags.name || '', ref: w.tags.ref || '' }));
  const gj = skeletonize(jeju, { holes: 3, deadEnd: 3.5, contract: 4 }, 'n');
  absorb(g, gj);
  ways.trunk.push(...jeju.map((w) => ({ ...w, keys: [], allKeys: [] })));
  log('jeju', gj.nodes.size, gj.edges.size, km(gj) + 'km');

  // 끊긴 국도 끝점을 primary로 잇기
  let filled = 0;
  for (let pass = 0; pass < 3; pass++) {
    const deadEnds = [...g.nodes.values()].filter((n) => n.edges.size === 1 && !onJeju(n));
    for (const n of deadEnds) {
      if (!g.nodes.has(n.id) || n.edges.size !== 1) continue;
      const r = spliceViaPrimary(g, gp, [n.x, n.y], n.id, { maxLen: 42 });
      if (r) filled++;
    }
  }
  log('dead ends filled via primary', filled);

  // 고립된 조각 정리
  for (let guard = 0; guard < 200; guard++) {
    const c = g.components();
    const size = new Map();
    for (const e of g.edges.values()) size.set(c.get(e.a), (size.get(c.get(e.a)) || 0) + e.len);
    const main = [...size.entries()].sort((p, q) => q[1] - p[1])[0][0];
    let acted = false;
    for (const [cid, sz] of size) {
      if (cid === main) continue;
      const nodes = [...g.nodes.values()].filter((n) => c.get(n.id) === cid);
      if (nodes.some(onJeju)) continue;
      let best = null;
      for (const n of nodes) {
        const hit = nearestEdge(g, [n.x, n.y], 9, (e) => c.get(e.a) !== cid);
        if (hit && (!best || hit.d < best.d)) best = { ...hit, node: n };
      }
      if (best) {
        const m = nodeAt(g, best, 2);
        const M = g.nodes.get(m);
        g.addEdge(best.node.id, m, [[best.node.x, best.node.y], [M.x, M.y]], { kind: 'r' });
      } else {
        log('drop isolated', Math.round(sz) + 'km', nodes[0].x.toFixed(0), nodes[0].y.toFixed(0));
        for (const n of nodes) g.removeNode(n.id);
      }
      acted = true;
      break;
    }
    if (!acted) break;
  }

  g.mergeDegree2();
  g.contractShort(5.5);
  g.mergeDegree2();
  g.pruneDeadEnds(6);
  g.dedupeParallel();
  g.mergeDegree2();
  return { g, ways, prim, gp };
}

// ── 이름 붙이기 ─────────────────────────────────────────────
function normJct(name) {
  let s = name.replace(/\s*\(.*\)\s*/g, '').trim();
  if (/휴게소|졸음|쉼터|하이패스|주차|영업소|요금소|TG|톨게이트|터널|대교/.test(s)) return null;
  s = s.replace(/\s*(분기점|JCT|JC)$/i, 'JC').replace(/\s*(나들목|IC)$/i, 'IC').replace(/\s+교차로$/, '교차로');
  if (!/(JC|IC|교차로)$/.test(s)) s += 'IC';
  return s.replace(/\s+/g, '');
}

function buildPlaces() {
  const clean = (n) => n.replace(/(특별자치시|특별시|광역시|특별자치도|시|군)$/, '');
  const out = [];
  const seen = new Set();
  for (const p of readRaw('osm_places.json').elements) {
    const t = p.tags;
    if (t.place !== 'city' && t.place !== 'county') continue;
    const name = clean(t.name || '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const [x, y] = project(p.lon, p.lat);
    const pop = Number(t.population) || 0;
    out.push({ name, x, y, pop, county: t.place === 'county' });
  }
  return out;
}

function nameGraph(g, places, ways) {
  const jct = [];
  for (const j of readRaw('osm_junctions.json').elements) {
    const nm = j.tags && j.tags.name ? normJct(j.tags.name) : null;
    if (!nm) continue;
    const [x, y] = project(j.lon, j.lat);
    jct.push({ x, y, nm, jc: /JC$/.test(nm) });
  }
  // 간선 이름 투표용 격자
  const cellSize = 2;
  const hash = new Map();
  const add = (x, y, rec) => {
    const k = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(rec);
  };
  for (const [cls, list] of [['x', ways.motorway], ['n', ways.trunk]]) {
    for (const w of list) {
      if (!w.name && !w.ref) continue;
      const rec = { name: w.name, ref: w.ref, cls };
      const L = polyLength(w.pts);
      const step = Math.max(1, Math.floor(w.pts.length / Math.max(1, L)));
      for (let i = 0; i < w.pts.length; i += step) add(w.pts[i][0], w.pts[i][1], rec);
    }
  }
  const vote = (e) => {
    const names = new Map(), refs = new Map();
    const n = e.pts.length;
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 24))) {
      const [x, y] = e.pts[i];
      const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const list = hash.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const r of list) {
          if (r.cls !== e.kind) continue;
          if (r.name) names.set(r.name, (names.get(r.name) || 0) + 1);
          if (r.ref) refs.set(r.ref, (refs.get(r.ref) || 0) + 1);
        }
      }
    }
    const top = (m) => [...m.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] || '';
    return { name: top(names), ref: top(refs) };
  };
  for (const e of g.edges.values()) {
    if (e.kind === 'x' || e.kind === 'n') {
      const v = vote(e);
      e.rname = v.name;
      e.ref = (v.ref || '').split(';')[0];
    }
    if (e.kind === 'n' && !e.rname) e.rname = e.ref ? `국도 ${e.ref}호선` : '';
    if (e.kind === 'n' && e.ref && /^\d+$/.test(e.ref)) e.rname = `국도 ${e.ref}호선`;
  }
  const nearestPlace = (x, y) => {
    let best = null, bd = Infinity;
    for (const p of places) {
      const d = Math.hypot(p.x - x, p.y - y) * (p.county ? 1.2 : 1);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const used = new Map();
  for (const n of g.nodes.values()) {
    const inc = [...n.edges].map((id) => g.edges.get(id));
    const xNames = new Set(inc.filter((e) => e.kind === 'x').map((e) => e.rname));
    let nm = null;
    if (xNames.size || inc.some((e) => e.kind === 'r')) {
      let best = null, bd = 4;
      const wantJc = xNames.size >= 2;
      for (const j of jct) {
        let d = Math.hypot(j.x - n.x, j.y - n.y);
        if (wantJc && j.jc) d *= 0.5;
        if (!wantJc && j.jc) d *= 1.3;
        if (d < bd) { bd = d; best = j; }
      }
      if (best) nm = best.nm;
    }
    if (!nm) {
      const p = nearestPlace(n.x, n.y);
      const refs = [...new Set(inc.map((e) => e.ref).filter((r) => r && /^\d+$/.test(r)))].sort((a, b) => a - b);
      nm = `${p ? p.name : ''} ${refs.length ? refs.join('·') + '번 ' : ''}교차로`.trim();
    }
    const c = (used.get(nm) || 0) + 1;
    used.set(nm, c);
    n.name = c > 1 ? `${nm} ${c}` : nm;
  }
}

// ── 메인 ───────────────────────────────────────────────────
const t0 = Date.now();
const provinces = buildProvinces();
const others = buildOthers();
const terrain = buildTerrain();
const water = buildWater();
const places = buildPlaces();
const { g, ways, gp } = buildRoads(provinces);

// 거점 연결
const terminals = new Map();
function ensureTerminal(point, key, island) {
  const k = key || `${point.lat},${point.lon}`;
  if (terminals.has(k)) return terminals.get(k);
  const [x, y] = project(point.lon, point.lat);
  const id = g.addNode(x, y, { terminal: true, keepNode: true });
  if (!island) {
    const hit = nearestEdge(g, [x, y], 30, (e) => e.kind !== 'f' && (y > 250 ? e.pts[0][1] > 250 : e.pts[0][1] <= 250));
    if (hit) {
      const m = nodeAt(g, hit, 3.5);
      const M = g.nodes.get(m);
      g.addEdge(id, m, [[x, y], [M.x, M.y]], { kind: 'r' });
    }
  }
  terminals.set(k, id);
  return id;
}

const islandTerminals = {};
for (const f of FERRIES) {
  const a = ensureTerminal(f.from, f.fromIsland ? `isl_${f.fromIsland}` : null, !!f.fromIsland);
  const b = ensureTerminal(f.to, f.toIsland ? `isl_${f.toIsland}` : null, !!f.toIsland);
  if (f.fromIsland) islandTerminals[f.fromIsland] = a;
  if (f.toIsland) islandTerminals[f.toIsland] = b;
  const A = g.nodes.get(a), B = g.nodes.get(b);
  const pts = [[A.x, A.y], ...f.via.map(([la, lo]) => project(lo, la)), [B.x, B.y]];
  g.addEdge(a, b, chaikin(pts, 3), { kind: 'f', ferryId: f.id, rname: f.name, stage: f.stage });
}

const SPUR_MIN = 2.6;
const siteOut = [];
let farSpurs = 0;
for (const s of SITES) {
  let [x, y] = project(s.lon, s.lat);
  const region = REGIONS.findIndex((r) => r.id === s.r);
  let attach = null;
  let spur = null;
  if (s.island) {
    attach = islandTerminals[s.island];
    const T = g.nodes.get(attach);
    const d = Math.hypot(x - T.x, y - T.y);
    if (d < SPUR_MIN) {
      const ang = s.island === 'dokdo' ? -0.6 : -2.2;
      x = T.x + Math.cos(ang) * SPUR_MIN; y = T.y + Math.sin(ang) * SPUR_MIN;
    }
    spur = [[T.x, T.y], [x, y]];
  } else {
    const onIsland = y > 250;
    const test = (e) => e.kind !== 'f' && e.kind !== 's' && (onIsland ? e.pts[0][1] > 250 : e.pts[0][1] <= 250);
    let hit = nearestEdge(g, [x, y], 60, test);
    if (hit.d > 6) {
      // 큰길이 멀면 지방도(primary)를 따라 연결
      const r = spliceViaPrimary(g, gp, [x, y], null, { maxLen: Math.max(30, hit.d * 2.2), needDetour: false });
      if (r) hit = nearestEdge(g, [x, y], 60, test);
      if (hit.d > 8) farSpurs++;
    }
    if (hit.d < SPUR_MIN) {
      const dx = x - hit.pt[0], dy = y - hit.pt[1];
      let nx = dx, ny = dy;
      const d = Math.hypot(nx, ny);
      if (d < 0.2) {
        const a = hit.edge.pts[hit.seg], b = hit.edge.pts[hit.seg + 1];
        nx = -(b[1] - a[1]); ny = b[0] - a[0];
      }
      const l = Math.hypot(nx, ny) || 1;
      x = hit.pt[0] + (nx / l) * SPUR_MIN;
      y = hit.pt[1] + (ny / l) * SPUR_MIN;
    }
    attach = nodeAt(g, hit, 3.5);
    const A = g.nodes.get(attach);
    spur = [[A.x, A.y], [x, y]];
  }
  const id = g.addNode(x, y, { terminal: true, keepNode: true, siteId: s.id });
  g.addEdge(attach, id, spur, { kind: 's', siteId: s.id });
  siteOut.push({ ...s, region, node: id, x, y });
}
log('sites', siteOut.length, 'far spurs', farSpurs);

// 곡선 다듬기: 산길의 잔굴곡을 지우고 큰 흐름만 남긴다 (거점 지선·뱃길 제외)
const SMOOTH_SIGMA = { x: 2.6, n: 3.6 };
for (const e of g.edges.values()) {
  if (e.kind === 'x' || e.kind === 'n') e.pts = simplify(gaussianSmooth(e.pts, SMOOTH_SIGMA[e.kind]), 0.07);
  e.len = polyLength(e.pts);
}
// 스플라이싱 후 양끝이 노드 좌표와 어긋나지 않게 고정
for (const e of g.edges.values()) {
  const A = g.nodes.get(e.a), B = g.nodes.get(e.b);
  e.pts[0] = [A.x, A.y];
  e.pts[e.pts.length - 1] = [B.x, B.y];
  e.len = polyLength(e.pts);
}

nameGraph(g, places, ways);

// 권역
for (const n of g.nodes.values()) {
  const site = n.siteId ? siteOut.find((s) => s.id === n.siteId) : null;
  n.region = site ? site.region : regionOfPoint(provinces, n.x, n.y);
}
for (const e of g.edges.values()) {
  const mid = e.pts[Math.floor(e.pts.length / 2)];
  e.region = e.kind === 's' ? g.nodes.get(e.b).region : regionOfPoint(provinces, mid[0], mid[1]);
}

// 건설 프로젝트(잠긴 도로) 표시
const projStats = [];
for (const p of PROJECTS) {
  let km = 0, n = 0;
  const names = new Set();
  let box = null;
  if (p.box) {
    const [a, b] = [project(p.box[1], p.box[0]), project(p.box[3], p.box[2])];
    box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }
  for (const e of g.edges.values()) {
    if (e.kind === 's' || e.kind === 'f' || e.kind === 'r' || e.lock) continue;
    let hit = false;
    if (p.names && p.names.includes(e.rname)) hit = true;
    if (box && (!p.onlyKind || p.onlyKind === e.kind)) {
      const m = e.pts[Math.floor(e.pts.length / 2)];
      if (m[0] >= box[0] && m[0] <= box[2] && m[1] >= box[1] && m[1] <= box[3]) hit = true;
    }
    if (hit) { e.lock = p.id; km += e.len; n++; names.add(e.rname); }
  }
  projStats.push({ id: p.id, name: p.name, n, km: Math.round(km), names: [...names].join(',') });
}
log('projects', JSON.stringify(projStats));

// 잠금 상태에서도 모든 거점이 연결되는지 점검
{
  const seen = new Set();
  const start = siteOut.find((s) => s.id === 'c_cheongju').node;
  const st = [start];
  seen.add(start);
  while (st.length) {
    const u = st.pop();
    for (const eid of g.nodes.get(u).edges) {
      const e = g.edges.get(eid);
      if (e.lock) continue;
      const v = g.other(e, u);
      if (!seen.has(v)) { seen.add(v); st.push(v); }
    }
  }
  const bad = siteOut.filter((s) => !seen.has(s.node));
  log('unreachable sites with projects locked:', bad.map((s) => s.name).join(', ') || 'none');
  // 프로젝트 없이는 닿지 않는 거점이 있으면, 가장 짧은 경로의 잠금을 풀어 항상 연결되게 한다
  for (const s of bad) {
    if (seen.has(s.node)) continue;
    const prev = new Map([[s.node, null]]);
    const queue = [[0, s.node]];
    let reached = null;
    while (queue.length) {
      queue.sort((p, q) => p[0] - q[0]);
      const [d, u] = queue.shift();
      if (seen.has(u)) { reached = u; break; }
      for (const eid of g.nodes.get(u).edges) {
        const e = g.edges.get(eid);
        const v = g.other(e, u);
        if (prev.has(v)) continue;
        prev.set(v, [u, e]);
        queue.push([d + (e.lock ? e.len : e.len * 0.05), v]);
      }
    }
    const unlocked = [];
    for (let u = reached; u !== s.node && u != null;) {
      const [p, e] = prev.get(u);
      if (e.lock) { unlocked.push(`${e.lock}:${Math.round(e.len)}km`); delete e.lock; }
      u = p;
    }
    log('  repair', s.name, unlocked.join(' '));
    const st2 = [s.node];
    seen.add(s.node);
    while (st2.length) {
      const u = st2.pop();
      for (const eid of g.nodes.get(u).edges) {
        const e = g.edges.get(eid);
        if (e.lock) continue;
        const v = g.other(e, u);
        if (!seen.has(v)) { seen.add(v); st2.push(v); }
      }
    }
  }
  const lockKm = {};
  for (const e of g.edges.values()) if (e.lock) lockKm[e.lock] = (lockKm[e.lock] || 0) + Math.round(e.len);
  log('locked km after repair', JSON.stringify(lockKm));
}

// 내보내기
const nodeIndex = new Map();
const nodesOut = [];
for (const n of g.nodes.values()) {
  nodeIndex.set(n.id, nodesOut.length);
  nodesOut.push({ x: round2(n.x), y: round2(n.y), name: n.name, r: n.region, ...(n.terminal ? { t: 1 } : {}) });
}
const roadsOut = [];
for (const e of g.edges.values()) {
  roadsOut.push({
    a: nodeIndex.get(e.a), b: nodeIndex.get(e.b), k: e.kind, r: e.region,
    ...(e.rname ? { n: e.rname } : {}), ...(e.ref ? { ref: e.ref } : {}),
    ...(e.lock ? { lock: e.lock } : {}), ...(e.ferryId ? { ferry: e.ferryId, stage: e.stage } : {}),
    p: flat(e.pts, round2),
  });
}
const placeLabels = places.map((p) => ({
  n: p.name, x: round1(p.x), y: round1(p.y), rank: p.pop >= 900000 ? 0 : p.county ? 2 : 1,
}));
const seaLabels = SEA_LABELS.map((s) => {
  const [x, y] = project(s.lon, s.lat);
  return { n: s.name, x: round1(x), y: round1(y) };
});
const [dx, dy] = project(131.8645, 37.2415);
const [ux, uy] = project(130.86, 37.5);

const out = {
  meta: {
    title: '팔도 트래픽 지도 데이터',
    license: '도로·강·호수·지명 © OpenStreetMap contributors (ODbL), 행정구역 KOSTAT(southkorea-maps), 해안선 Natural Earth, 지형 Mapzen/Terrain Tiles',
    built: new Date().toISOString().slice(0, 10),
  },
  regions: REGIONS.map(({ id, name, short }) => ({ id, name, short })),
  provinces: provinces.map((p) => ({ n: p.name, r: provinceRegion(p.name), rings: p.rings.map((r) => flat(r, round2)) })),
  north: others.north, foreign: others.foreign, southFill: others.southFill,
  terrain, rivers: water.rivers, lakes: water.lakes,
  nodes: nodesOut, roads: roadsOut,
  sites: siteOut.map((s) => {
    const { lat, lon, node, x, y, r, ...rest } = s;
    return { ...rest, r: s.region, node: nodeIndex.get(node), x: round2(x), y: round2(y), region: undefined };
  }),
  ferries: FERRIES.map(({ id, name, stage }) => ({ id, name, stage })),
  projects: PROJECTS.map(({ id, name, kind, stage, desc }) => ({ id, name, kind, stage, desc })),
  labels: placeLabels, seas: seaLabels,
  dokdo: { x: round2(dx), y: round2(dy) }, ulleung: { x: round2(ux), y: round2(uy) },
};

fs.mkdirSync('data', { recursive: true });
const json = JSON.stringify(out);
fs.writeFileSync('data/korea.json', json);

const total = roadsOut.reduce((s, r) => s + polyLength(r.p.reduce((acc, v, i, arr) => (i % 2 ? acc : acc.concat([[v, arr[i + 1]]])), [])), 0);
const deg = {};
for (const n of g.nodes.values()) deg[n.edges.size] = (deg[n.edges.size] || 0) + 1;
log('final nodes', nodesOut.length, 'roads', roadsOut.length, Math.round(total) + 'km', 'degrees', JSON.stringify(deg), 'components', new Set(g.components().values()).size);
log('sizes KB', {
  total: Math.round(json.length / 1024),
  provinces: Math.round(JSON.stringify(out.provinces).length / 1024),
  others: Math.round((JSON.stringify(out.north).length + JSON.stringify(out.foreign).length + JSON.stringify(out.southFill).length) / 1024),
  terrain: Math.round(JSON.stringify(out.terrain).length / 1024),
  water: Math.round((JSON.stringify(out.rivers).length + JSON.stringify(out.lakes).length) / 1024),
  roads: Math.round(JSON.stringify(out.roads).length / 1024),
  nodes: Math.round(JSON.stringify(out.nodes).length / 1024),
});
const xKm = new Map();
for (const e of g.edges.values()) if (e.kind === 'x') xKm.set(e.rname, (xKm.get(e.rname) || 0) + e.len);
log('expressways', [...xKm.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${Math.round(v)}`).join(' '));
log('sample nodes', nodesOut.filter((n) => /JC$/.test(n.name)).slice(0, 25).map((n) => n.name).join(' '));
log('done', Date.now() - t0, 'ms');

// 미리보기
{
  let s = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#bcd"><svg xmlns="http://www.w3.org/2000/svg" viewBox="${BOX.x0} ${BOX.y0} ${BOX.x1 - BOX.x0} ${BOX.y1 - BOX.y0}" width="100%" height="100%" style="height:100vh">`;
  const poly = (f, fill, extra = '') => `<polygon points="${pts2(f)}" fill="${fill}" ${extra}/>`;
  const pts2 = (f) => { let o = ''; for (let i = 0; i < f.length; i += 2) o += `${f[i]},${f[i + 1]} `; return o; };
  for (const r of out.foreign) s += poly(r, '#ccc');
  for (const r of out.north) s += poly(r, '#c8c6be');
  for (const r of out.southFill) s += poly(r, '#efe9da');
  for (const p of out.provinces) for (const r of p.rings) s += poly(r, '#f3eee0', 'stroke="#aaa" stroke-width="0.15"');
  const tc = ['#e6e6c8', '#d8dcb4', '#c8d0a2', '#b8c492'];
  out.terrain.forEach((t, i) => { for (const r of t.rings) s += `<polygon points="${pts2(r)}" fill="${tc[i]}" fill-opacity="0.8"/>`; });
  for (const l of out.lakes) s += poly(l, '#8fc3e0');
  for (const r of out.rivers) s += `<polyline fill="none" stroke="#8fc3e0" stroke-width="${r.m ? 0.45 : 0.25}" points="${pts2(r.p)}"/>`;
  for (const r of out.roads) {
    const col = r.lock ? '#a0f' : r.k === 'x' ? '#d33' : r.k === 'n' ? '#39c' : r.k === 'f' ? '#06c' : r.k === 's' ? '#555' : '#2a2';
    s += `<polyline fill="none" stroke="${col}" stroke-width="${r.k === 'x' ? 0.8 : 0.45}" ${r.k === 'f' ? 'stroke-dasharray="2 2"' : ''} points="${pts2(r.p)}"/>`;
  }
  for (const st of out.sites) s += `<circle cx="${st.x}" cy="${st.y}" r="${st.k === 'city' ? 1.8 : 1.1}" fill="${st.k === 'city' ? '#111' : '#e80'}"/>`;
  s += '</svg></body>';
  fs.writeFileSync('.cache/preview-map.html', s);
}
