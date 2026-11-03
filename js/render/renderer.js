// 지도·트럭·교차로 캔버스 렌더링. 지도 바탕은 캐시하고, 움직이는 것만 매 프레임 그린다.
// 그림은 지하철 노선도처럼 납작하게: 크림색 땅, 파란 물, 화물 색 선, 흰 도형 거점.
import { LANE_W, MEDIAN, laneOffset } from '../sim/network.js';
import { GOODS } from '../game/defs.js';
import { SHAPES, siteShape } from './art.js';

export const PALETTES = {
  day: {
    sea: '#aed2ec', foreign: '#ebe5d5', land: '#f6f1e3', locked: '#ece6d6', border: 'rgba(90,80,60,0.09)',
    river: '#aed2ec', lake: '#aed2ec', urban: '#efe8d6',
    label: '#8a8476', labelStrong: '#55514a', halo: 'rgba(246,241,227,0.92)', seaLabel: '#7aa6c8',
    xRoad: '#cdc6b4', nRoad: '#dad4c4', rRoad: '#e3ddce', closed: '#e3ddcd', plan: '#8e6fc9', ferry: '#7aa6c8', ferryOff: 'rgba(122,166,200,0.35)',
    laneMark: 'rgba(255,255,255,0.9)', center: '#b3ac9a', grass: '#d5e6c8',
    ink: '#2a2a28', station: '#ffffff', core: '#fbf8ef', mute: '#b9b3a3', crowd: 'rgba(42,42,40,0.3)',
  },
  night: {
    sea: '#141d26', foreign: '#1d242b', land: '#262b30', locked: '#20252a', border: 'rgba(255,255,255,0.05)',
    river: '#141d26', lake: '#141d26', urban: '#2d3237',
    label: '#8d8f8c', labelStrong: '#cfcdc6', halo: 'rgba(38,43,48,0.92)', seaLabel: '#4f7390',
    xRoad: '#4a4f54', nRoad: '#3d4247', rRoad: '#363b40', closed: '#2f3439', plan: '#a98be0', ferry: '#4f7390', ferryOff: 'rgba(79,115,144,0.35)',
    laneMark: 'rgba(255,255,255,0.45)', center: '#6a6f73', grass: '#33483a',
    ink: '#f1eee6', station: '#262b30', core: '#262b30', mute: '#6d6a62', crowd: 'rgba(241,238,230,0.26)',
  },
};

const FONT = '"Helvetica Neue", Helvetica, Arial, "Gothic A1", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
const ACCENT = '#3f7fb8';
const RED = '#d9412b';
const ORANGE = '#e08a1e';
const KM_CLOSE = 0.075;   // 이보다 가까우면 실제 도로처럼 차로를 그린다
const KM_TRUCK = 0.05;    // 이보다 가까우면 트럭을 자세히 그린다
const KM_MID = 0.42;      // 이보다 멀면 트럭을 점으로 그린다
const EASE_W = 9;         // 표시 위치가 실제 위치를 따라가는 빠르기. 낮을수록 출발과 정지가 느긋하다
const GOODS_ORDER = Object.keys(GOODS);
const NODE_TOOLS = new Set(['yield', 'stop', 'signal', 'roundabout', 'interchange', 'remove']);

function ringPath(path, flat) {
  path.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
  path.closePath();
}
function linePath(path, flat) {
  path.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
}
function shapePath(ctx, shape, x, y, r) {
  ctx.beginPath();
  if (shape === 'circle') { ctx.arc(x, y, r, 0, Math.PI * 2); return; }
  const pts = SHAPES[shape];
  ctx.moveTo(x + pts[0][0] * r, y + pts[0][1] * r);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(x + pts[i][0] * r, y + pts[i][1] * r);
  ctx.closePath();
}

// ── 카메라 ─────────────────────────────────────────────
export class Camera {
  constructor() {
    this.cx = 0; this.cy = 0; this.k = 0.5;
    this.W = 800; this.H = 600;
    this.anim = null;
    this.pad = { l: 0, r: 0, t: 0, b: 0 };
    this.moving = 0;
  }
  sx(x) { return (x - this.cx) / this.k + this.W / 2; }
  sy(y) { return (y - this.cy) / this.k + this.H / 2; }
  wx(sx) { return (sx - this.W / 2) * this.k + this.cx; }
  wy(sy) { return (sy - this.H / 2) * this.k + this.cy; }
  clampK(k) { return Math.max(0.018, Math.min(1.6, k)); }
  zoomAt(sx, sy, factor) {
    this.anim = null;
    const wx = this.wx(sx), wy = this.wy(sy);
    this.k = this.clampK(this.k * factor);
    this.cx = wx - (sx - this.W / 2) * this.k;
    this.cy = wy - (sy - this.H / 2) * this.k;
    this.clampCenter();
    this.moving = 0.18;
  }
  panBy(dx, dy) {
    this.anim = null;
    this.cx -= dx * this.k;
    this.cy -= dy * this.k;
    this.clampCenter();
    this.moving = 0.12;
  }
  clampCenter() {
    this.cx = Math.max(-340, Math.min(420, this.cx));
    this.cy = Math.max(-360, Math.min(370, this.cy));
  }
  // 화면에 가려지는 부분을 뺀 영역에 범위를 맞춘다
  fitBox(x0, y0, x1, y1, duration = 0.9, margin = 1.12) {
    const availW = Math.max(120, this.W - this.pad.l - this.pad.r);
    const availH = Math.max(120, this.H - this.pad.t - this.pad.b);
    const k = this.clampK(Math.max((x1 - x0) / availW, (y1 - y0) / availH) * margin);
    const shiftX = ((this.pad.r - this.pad.l) / 2) * k;
    const shiftY = ((this.pad.b - this.pad.t) / 2) * k;
    this.flyTo((x0 + x1) / 2 + shiftX, (y0 + y1) / 2 + shiftY, k, duration);
  }
  flyTo(x, y, k, duration = 0.7) {
    if (duration <= 0) { this.cx = x; this.cy = y; this.k = this.clampK(k); return; }
    this.anim = { t: 0, d: duration, x0: this.cx, y0: this.cy, k0: this.k, x1: x, y1: y, k1: this.clampK(k) };
  }
  // 패널을 피해 한 점을 보여준다
  focus(x, y, k = this.k, duration = 0.6) {
    const kk = this.clampK(k);
    this.flyTo(x + ((this.pad.r - this.pad.l) / 2) * kk, y + ((this.pad.b - this.pad.t) / 2) * kk, kk, duration);
  }
  update(dt) {
    if (this.moving > 0) this.moving -= dt;
    const a = this.anim;
    if (!a) return;
    a.t += dt;
    const u = Math.min(1, a.t / a.d);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    this.cx = a.x0 + (a.x1 - a.x0) * e;
    this.cy = a.y0 + (a.y1 - a.y0) * e;
    this.k = Math.exp(Math.log(a.k0) + (Math.log(a.k1) - Math.log(a.k0)) * e);
    this.moving = 0.1;
    if (u >= 1) this.anim = null;
  }
}

// ── 렌더러 ─────────────────────────────────────────────
export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.game = game;
    this.cam = new Camera();
    this.base = document.createElement('canvas');
    this.bctx = this.base.getContext('2d', { alpha: false });
    this.baseView = null;
    this.baseDirty = true;
    this.palName = 'day';
    this.pal = PALETTES.day;
    this.dpr = 1;
    this.selection = null;  // { type, ... }
    this.hover = null;
    this.highlightRoutes = null;
    this.tool = 'select';
    this.toolColor = ACCENT;
    this.time = 0;
    this.pings = [];
    this.tutorTarget = null;
    this.routeVer = -1;
    this.buildPaths(game.data);
    this.tmp = [0, 0, 0, 0];
    this.tmp2 = [0, 0, 0, 0];
    this.frameMs = 0;
    document.documentElement.dataset.theme = 'day';
  }

  setPalette(name) {
    this.palName = name;
    this.pal = PALETTES[name];
    this.baseDirty = true;
    document.documentElement.dataset.theme = name;
  }

  buildPaths(data) {
    const P = {};
    P.foreign = new Path2D();
    for (const r of data.foreign) ringPath(P.foreign, r);
    P.north = new Path2D();
    for (const r of data.north) ringPath(P.north, r);
    P.southFill = new Path2D();
    for (const r of data.southFill) ringPath(P.southFill, r);
    P.land = new Path2D();
    P.provinces = data.provinces.map((p) => {
      const path = new Path2D();
      for (const r of p.rings) { ringPath(path, r); ringPath(P.land, r); }
      return { path, region: p.r, name: p.n };
    });
    // 권역별 대표 위치: 가장 큰 고리의 무게중심
    P.regionCenter = {};
    const bestArea = {};
    for (const p of data.provinces) {
      for (const r of p.rings) {
        let a = 0, cx = 0, cy = 0;
        for (let i = 0, n = r.length / 2; i < n; i++) {
          const j = (i + 1) % n;
          const f = r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
          a += f;
          cx += (r[i * 2] + r[j * 2]) * f;
          cy += (r[i * 2 + 1] + r[j * 2 + 1]) * f;
        }
        const area = Math.abs(a / 2);
        if (a !== 0 && area > (bestArea[p.r] || 0)) {
          bestArea[p.r] = area;
          P.regionCenter[p.r] = [cx / (3 * a), cy / (3 * a)];
        }
      }
    }
    P.lakes = new Path2D();
    for (const l of data.lakes) ringPath(P.lakes, l);
    P.riverMajor = new Path2D();
    P.riverMinor = new Path2D();
    for (const r of data.rivers) linePath(r.m ? P.riverMajor : P.riverMinor, r.p);
    this.P = P;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cam.W = w;
    this.cam.H = h;
    this.margin = Math.round(Math.max(w, h) * 0.18);
    this.base.width = Math.round((w + this.margin * 2) * dpr);
    this.base.height = Math.round((h + this.margin * 2) * dpr);
    this.baseDirty = true;
  }

  // ── 지도 바탕 ──────────────────────────────────────
  renderBase() {
    const t0 = performance.now();
    const b = this.bctx, cam = this.cam, pal = this.pal, P = this.P, game = this.game;
    const k = cam.k, dpr = this.dpr, s = dpr / k;
    const bw = this.base.width, bh = this.base.height;
    const px = k; // 화면 1px의 월드 길이
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.fillStyle = pal.sea;
    b.fillRect(0, 0, bw, bh);
    const ox = bw / 2 - cam.cx * s, oy = bh / 2 - cam.cy * s;
    b.setTransform(s, 0, 0, s, ox, oy);
    b.lineJoin = 'round';
    b.lineCap = 'round';
    this.baseView = { cx: cam.cx, cy: cam.cy, k };

    // 주변 국가와 땅
    b.fillStyle = pal.foreign;
    b.fill(P.foreign);
    b.fill(P.north);
    b.fillStyle = pal.land;
    b.fill(P.southFill);
    b.fill(P.land);

    // 잠긴 권역은 한 톤 어둡게
    b.fillStyle = pal.locked;
    for (const p of P.provinces) if (p.region > game.stage) b.fill(p.path);

    // 물
    b.strokeStyle = pal.river;
    b.lineWidth = Math.max(0.5, 2.4 * px);
    b.stroke(P.riverMajor);
    if (k < 0.34) {
      b.lineWidth = Math.max(0.28, 1.3 * px);
      b.stroke(P.riverMinor);
    }
    b.fillStyle = pal.lake;
    b.fill(P.lakes);

    // 시도 경계는 있는 듯 없는 듯
    b.strokeStyle = pal.border;
    b.lineWidth = 1 * px;
    for (const p of P.provinces) b.stroke(p.path);

    // 독도·울릉도는 어떤 축척에서도 보이게
    this.drawDokdo(b, px);
    this.lockedLabels = k > 0.2;

    this.drawUrban(b, k);
    this.drawRoadsOnBase(b, px, k);
    this.drawRouteLines(b, px, k);
    this.drawBaseLabels(b, px, k, ox, oy, s);
    this.baseDirty = false;
    this.baseMs = performance.now() - t0;
  }

  drawDokdo(b, px) {
    const d = this.game.data.dokdo;
    b.fillStyle = this.pal.land;
    for (const [x, y, r] of [[d.x - 0.22, d.y + 0.02, 0.2], [d.x + 0.22, d.y - 0.04, 0.24]]) {
      b.beginPath();
      b.arc(x, y, Math.max(r, 1.6 * px), 0, Math.PI * 2);
      b.fill();
    }
  }

  // 도시는 그림 대신 옅은 원으로. 자랄수록 넓어진다
  drawUrban(b, k) {
    if (k >= 0.34) return;
    const game = this.game;
    b.fillStyle = this.pal.urban;
    for (const s of game.sites) {
      if (!s.available || s.kind !== 'city') continue;
      if (!this.nodeInView(game.net.nodes[s.node], 120)) continue;
      const R = (1.4 + Math.sqrt(s.pop) * 0.42) * (1 + s.cityStage * 0.16);
      b.beginPath();
      b.arc(s.x, s.y, R, 0, Math.PI * 2);
      b.fill();
    }
  }

  roadInView(r, m = 0) {
    const cam = this.cam;
    const halfW = (cam.W / 2 + this.margin + m) * cam.k, halfH = (cam.H / 2 + this.margin + m) * cam.k;
    return !(r.bb[2] < cam.cx - halfW || r.bb[0] > cam.cx + halfW || r.bb[3] < cam.cy - halfH || r.bb[1] > cam.cy + halfH);
  }

  roadPath(r) {
    if (r.path && r.pathV === 1) return r.path;
    const p = new Path2D();
    linePath(p, r.pts);
    r.path = p;
    r.pathV = 1;
    return p;
  }

  drawRoadsOnBase(b, px, k) {
    const game = this.game, net = game.net, pal = this.pal;
    const close = k < KM_CLOSE;
    const open = [], closed = [], plans = [];
    for (const r of net.roads) {
      if (!this.roadInView(r)) continue;
      if (r.kind === 'f') continue;
      if (r.kind === 's' && !r.open) continue;
      if (r.open) open.push(r);
      else if (r.lock && !r.built && r.region <= game.stage) plans.push(r);
      else closed.push(r);
    }
    // 뱃길
    for (const r of net.roads) {
      if (r.kind !== 'f') continue;
      b.setLineDash([5 * px, 6 * px]);
      b.strokeStyle = r.open ? pal.ferry : pal.ferryOff;
      b.lineWidth = 1.6 * px;
      b.stroke(this.roadPath(r));
      b.setLineDash([]);
    }
    // 잠긴 길
    b.strokeStyle = pal.closed;
    for (const r of closed) {
      b.lineWidth = (r.kind === 'x' ? 1.4 : 0.9) * px;
      b.stroke(this.roadPath(r));
    }
    // 건설할 수 있는 도로는 터널처럼 점선으로
    b.setLineDash([4 * px, 4.5 * px]);
    b.strokeStyle = pal.plan;
    b.lineWidth = 1.9 * px;
    for (const r of plans) b.stroke(this.roadPath(r));
    b.setLineDash([]);

    const f = k > 0.62 ? 0.55 : k > 0.42 ? 0.72 : 1;
    const minPx = { x: 4 * f, n: 2.6 * f, r: 2 * f, s: 2 * f };
    const width = (r) => Math.max(2 * (MEDIAN + LANE_W * r.lanes), minPx[r.kind] * px);
    const color = (kind) => (close || kind === 'x' ? pal.xRoad : kind === 'n' ? pal.nRoad : pal.rRoad);
    // 약한 길을 먼저 깔고 고속도로를 위에 올린다
    for (const kind of ['s', 'r', 'n', 'x']) {
      b.strokeStyle = color(kind);
      for (const r of open) {
        if (r.kind !== kind) continue;
        b.lineWidth = width(r);
        b.stroke(this.roadPath(r));
      }
    }
    const nodesHere = net.nodes.filter((n) => !n.terminal && n.inE.length > 1 && this.nodeInView(n) && this.nodeOpen(n));
    if (k < 0.2) {
      for (const n of nodesHere) {
        b.lineWidth = this.junctionWidth(n);
        b.strokeStyle = n.roads.some((r) => r.kind === 'x') ? pal.xRoad : color('n');
        b.stroke(this.junctionPath(n));
      }
    }
    // 교차로를 고를 때만 눌러볼 자리를 찍어 준다
    if (!close && (NODE_TOOLS.has(this.tool) || k < 0.12)) {
      for (const n of nodesHere) {
        if (n.control !== 'auto') continue;
        b.fillStyle = pal.station;
        b.strokeStyle = pal.mute;
        b.lineWidth = 1.2 * px;
        b.beginPath();
        b.arc(n.x, n.y, 2.6 * px, 0, Math.PI * 2);
        b.fill();
        b.stroke();
      }
    }
    if (close) for (const r of open) this.drawLaneMarks(b, r, px);
    for (const n of net.nodes) {
      if (!this.nodeInView(n) || !this.nodeOpen(n)) continue;
      if (n.control === 'roundabout') this.drawRoundaboutBase(b, n, px);
      if (n.control === 'interchange' && close) this.drawInterchangeBase(b, n, px);
    }
  }

  // 트럭이 다니는 곳에 화물 색 선을 긋는다. 한 도로를 여러 화물이 쓰면 나란히 세운다
  drawRouteLines(b, px, k) {
    if (k < KM_CLOSE) return;
    const byRoad = new Map();
    const add = (edge, route) => {
      const road = edge.road;
      if (road.kind === 'f' || !road.open) return;
      let m = byRoad.get(road);
      if (!m) { m = new Map(); byRoad.set(road, m); }
      m.set(route.goods, (m.get(route.goods) || 0) + route.trucks.length);
    };
    for (const route of this.game.routes.values()) {
      if (!route.trucks.length || !route.valid) continue;
      for (const e of route.pathTo) add(e, route);
      for (const e of route.pathBack) add(e, route);
    }
    const w = (k > KM_MID ? 1.3 : k > 0.2 ? 2.6 : 3.6) * px;
    b.lineWidth = w;
    for (const [road, m] of byRoad) {
      if (!this.roadInView(road)) continue;
      let list = [...m.keys()];
      const most = k > KM_MID ? 3 : 4;
      if (list.length > most) list = list.sort((p, q) => m.get(q) - m.get(p)).slice(0, most);
      list.sort((p, q) => GOODS_ORDER.indexOf(p) - GOODS_ORDER.indexOf(q));
      // 도로 방향과 상관없이 줄 순서가 같도록 서쪽에서 동쪽으로 본다
      const pts = road.pts;
      const flip = pts[pts.length - 2] < pts[0] ? -1 : 1;
      list.forEach((goods, i) => {
        const d = (i - (list.length - 1) / 2) * w * flip;
        b.strokeStyle = GOODS[goods].color;
        b.beginPath();
        const n = pts.length / 2;
        for (let j = 0; j < n; j++) {
          const a = Math.max(0, j - 1), c = Math.min(n - 1, j + 1);
          const dx = pts[c * 2] - pts[a * 2], dy = pts[c * 2 + 1] - pts[a * 2 + 1];
          const l = Math.hypot(dx, dy) || 1;
          const x = pts[j * 2] - (dy / l) * d, y = pts[j * 2 + 1] + (dx / l) * d;
          if (j === 0) b.moveTo(x, y); else b.lineTo(x, y);
        }
        b.stroke();
      });
    }
  }

  nodeOpen(n) {
    for (const r of n.roads) if (r.open && r.kind !== 'f') return true;
    return false;
  }

  junctionWidth(n) {
    let w = 0;
    for (const r of n.roads) if (r.kind !== 'f' && r.open) w = Math.max(w, 2 * (MEDIAN + LANE_W * r.lanes));
    return w * 0.9;
  }

  // 교차로 포장: 각 진입로 끝을 곡선으로 서로 잇는다
  junctionPath(n) {
    const ver = this.game.net.version;
    if (n.jPath && n.jPathV === ver) return n.jPath;
    const p = new Path2D();
    const arms = [];
    for (const r of n.roads) {
      if (r.kind === 'f') continue;
      const e = r.a === n.id ? r.fwd : r.bwd;
      const s = e.sample(0, 0, [0, 0, 0, 0]);
      arms.push([s[0], s[1]]);
    }
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        p.moveTo(arms[i][0], arms[i][1]);
        p.quadraticCurveTo(n.x, n.y, arms[j][0], arms[j][1]);
      }
    }
    n.jPath = p;
    n.jPathV = ver;
    return p;
  }

  nodeInView(n, m = 0) {
    const cam = this.cam;
    const halfW = (cam.W / 2 + this.margin + m) * cam.k, halfH = (cam.H / 2 + this.margin + m) * cam.k;
    return Math.abs(n.x - cam.cx) < halfW && Math.abs(n.y - cam.cy) < halfH;
  }

  drawLaneMarks(b, r, px) {
    const pal = this.pal;
    b.strokeStyle = pal.center;
    b.lineWidth = Math.max(0.03, 1 * px);
    b.stroke(this.roadPath(r));
    if (r.lanes < 2) return;
    b.strokeStyle = pal.laneMark;
    b.lineWidth = Math.max(0.025, 0.9 * px);
    b.setLineDash([0.32, 0.42]);
    for (const e of [r.fwd, r.bwd]) {
      for (let i = 1; i < r.lanes; i++) {
        const flat = e.lanePolyline(MEDIAN + LANE_W * i);
        const p = new Path2D();
        linePath(p, flat);
        b.stroke(p);
      }
    }
    b.setLineDash([]);
  }

  drawRoundaboutBase(b, n, px) {
    const pal = this.pal;
    const R = this.game.net.ringRadius(n);
    const ringW = LANE_W * n.ringLanes + 0.18;
    b.lineWidth = Math.max(ringW, 2.4 * px);
    b.strokeStyle = pal.xRoad;
    b.beginPath(); b.arc(n.x, n.y, R, 0, Math.PI * 2); b.stroke();
    b.fillStyle = pal.grass;
    b.beginPath(); b.arc(n.x, n.y, Math.max(R - ringW / 2 - 0.05, 1.2 * px), 0, Math.PI * 2); b.fill();
  }

  drawInterchangeBase(b, n, px) {
    const pal = this.pal;
    const r = n.R * 0.62;
    const out = n.R * 0.95;
    const rot = n.roads.length ? Math.atan2(n.roads[0].dirAt(n.id)[1], n.roads[0].dirAt(n.id)[0]) : 0;
    b.lineWidth = Math.max(0.15, 1.6 * px);
    b.strokeStyle = pal.xRoad;
    for (let i = 0; i < 4; i++) {
      const a = rot + Math.PI / 4 + (i * Math.PI) / 2;
      b.beginPath();
      b.arc(n.x + Math.cos(a) * out, n.y + Math.sin(a) * out, r, 0, Math.PI * 2);
      b.stroke();
    }
  }

  drawBaseLabels(b, px, k, ox, oy, s) {
    const game = this.game, data = game.data, pal = this.pal;
    b.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = this.dpr;
    b.textAlign = 'center';
    b.textBaseline = 'middle';
    const toX = (x) => x * s + ox, toY = (y) => y * s + oy;
    // 바다 이름
    b.font = `500 ${14 * dpr}px ${FONT}`;
    b.fillStyle = pal.seaLabel;
    for (const m of data.seas) {
      const txt = [...m.n].join('   ');
      b.fillText(txt, toX(m.x), toY(m.y));
    }
    const label = (txt, x, y, font, dy, color = pal.label) => {
      b.font = font;
      b.lineWidth = 3 * dpr;
      b.strokeStyle = pal.halo;
      b.strokeText(txt, toX(x), toY(y) + dy * dpr);
      b.fillStyle = color;
      b.fillText(txt, toX(x), toY(y) + dy * dpr);
    };
    label('독도', data.dokdo.x, data.dokdo.y, `600 ${11.5 * dpr}px ${FONT}`, -11);
    label('울릉도', data.ulleung.x, data.ulleung.y, `500 ${11 * dpr}px ${FONT}`, -11);

    // 지명: 축척에 따라 단계별로
    const boxes = [];
    const taken = (x0, y0, x1, y1) => {
      for (const q of boxes) if (x0 < q[2] && x1 > q[0] && y0 < q[3] && y1 > q[1]) return true;
      return false;
    };

    // 아직 열리지 않은 권역 이름
    if (this.lockedLabels) {
      for (const reg of game.regions) {
        if (reg.unlocked || !this.P.regionCenter[reg.index]) continue;
        const c = this.P.regionCenter[reg.index];
        const lw = reg.short.length * 16 * dpr, lh = 20 * dpr;
        boxes.push([toX(c[0]) - lw / 2, toY(c[1]) - lh / 2, toX(c[0]) + lw / 2, toY(c[1]) + lh / 2]);
        label(reg.short, c[0], c[1], `600 ${14 * dpr}px ${FONT}`, 0);
      }
    }

    const siteNames = new Set(game.sites.filter((q) => q.available && q.isCity).map((q) => q.name));
    const maxRank = k > 0.3 ? -1 : k > 0.12 ? 0 : k > 0.07 ? 1 : 2;
    const list = data.labels.filter((l) => l.rank <= maxRank && !siteNames.has(l.n)).sort((p, q) => p.rank - q.rank);
    const bw = this.base.width, bh = this.base.height;
    for (const l of list) {
      const x = toX(l.x), y = toY(l.y);
      if (x < 0 || y < 0 || x > bw || y > bh) continue;
      const size = (l.rank === 0 ? 11.5 : 10.5) * dpr;
      const w = l.n.length * size * 0.98;
      const h = size * 1.3;
      if (taken(x - w / 2, y - h / 2, x + w / 2, y + h / 2)) continue;
      boxes.push([x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
      b.font = `500 ${size}px ${FONT}`;
      b.lineWidth = 2.6 * dpr;
      b.strokeStyle = pal.halo;
      b.strokeText(l.n, x, y);
      b.fillStyle = pal.label;
      b.fillText(l.n, x, y);
    }
  }

  // ── 매 프레임 ──────────────────────────────────────
  frame(dt) {
    const t0 = performance.now();
    this.time += dt;
    const cam = this.cam;
    if (!this.canvas.width || !this.canvas.height || !this.base.width || !this.base.height) return;
    cam.update(dt);
    const ctx = this.ctx, dpr = this.dpr;
    const view = this.baseView;
    if (this.routeVer !== this.game.routeVer) { this.routeVer = this.game.routeVer; this.baseDirty = true; }

    const ratio = view ? cam.k / view.k : 0;
    const needRebuild = this.baseDirty || !view || (cam.moving <= 0 && Math.abs(ratio - 1) > 0.001)
      || Math.abs(cam.cx - view.cx) / view.k > this.margin * 0.9 || Math.abs(cam.cy - view.cy) / view.k > this.margin * 0.9
      || ratio > 1.8 || ratio < 0.55;
    if (needRebuild) this.renderBase();

    // 바탕 복사 (이동·확대 중에는 늘려서 쓴다)
    const v = this.baseView;
    const scale = v.k / cam.k;
    const bwCss = this.base.width / dpr, bhCss = this.base.height / dpr;
    const dx = (v.cx - cam.cx) / cam.k + cam.W / 2 - (bwCss / 2) * scale;
    const dy = (v.cy - cam.cy) / cam.k + cam.H / 2 - (bhCss / 2) * scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = this.pal.sea;
    if (scale < 1 || Math.abs(scale - 1) > 0.001) ctx.fillRect(0, 0, cam.W, cam.H);
    ctx.drawImage(this.base, dx, dy, bwCss * scale, bhCss * scale);

    // 월드 좌표 그리기
    const s = dpr / cam.k;
    const ox = (cam.W / 2) * dpr - cam.cx * s, oy = (cam.H / 2) * dpr - cam.cy * s;
    ctx.setTransform(s, 0, 0, s, ox, oy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.drawCongestion(ctx);
    this.drawRouteHighlight(ctx);
    this.drawTrucks(ctx);
    this.drawJunctionMarks(ctx);
    this.drawFerries(ctx);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawHoverAndSelection(ctx);
    this.drawSites(ctx);
    this.drawPings(ctx, dt);
    this.drawFloats(ctx);
    this.frameMs += (performance.now() - t0 - this.frameMs) * 0.1;
  }

  edgePath(e) {
    if (e.path2d && e.pathV === e.geomVersion && e.pathLanes === e.road.lanes) return e.path2d;
    const p = new Path2D();
    linePath(p, e.lanePolyline(MEDIAN + (LANE_W * e.road.lanes) / 2));
    e.path2d = p;
    e.pathV = e.geomVersion;
    e.pathLanes = e.road.lanes;
    return p;
  }

  // 막히는 방향에만 얇은 경고선을 긋는다
  drawCongestion(ctx) {
    const cam = this.cam, net = this.game.net, k = cam.k;
    ctx.lineCap = 'butt';
    for (const e of net.edges) {
      if (e.road.kind === 'f' || !e.road.open) continue;
      const c = e.cong;
      if (c <= 0.3) continue;
      if (!this.roadInView(e.road, -this.margin)) continue;
      ctx.strokeStyle = c > 0.62 ? RED : ORANGE;
      ctx.globalAlpha = k < KM_CLOSE ? 0.3 : 1;
      ctx.lineWidth = Math.max(LANE_W * e.road.lanes * (k < KM_CLOSE ? 1 : 0.5), (c > 0.62 ? 2.2 : 1.6) * k);
      ctx.stroke(this.edgePath(e));
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
  }

  drawRouteHighlight(ctx) {
    const list = this.highlightRoutes;
    if (!list || !list.length) return;
    const k = this.cam.k;
    for (const h of list) {
      const r = h.route;
      if (!r.pathTo) continue;
      ctx.strokeStyle = GOODS[r.goods].color;
      ctx.lineWidth = (h.strong ? 5.5 : 4) * k;
      ctx.globalAlpha = h.strong ? 1 : 0.85;
      ctx.stroke(this.routePath(r));
    }
    ctx.globalAlpha = 1;
  }

  routePath(r) {
    const ver = this.game.net.version;
    if (r.linePath && r.linePathFor === r.pathTo && r.linePathV === ver) return r.linePath;
    const p = new Path2D();
    const net = this.game.net;
    let started = false;
    for (const e of r.pathTo) {
      const flat = e.road.kind === 'f' ? (e.rev ? reversed(e.road.pts) : e.road.pts) : e.lanePolyline(MEDIAN + (LANE_W * e.road.lanes) / 2);
      if (!started) { p.moveTo(flat[0], flat[1]); started = true; } else {
        const n = net.nodes[e.from];
        p.quadraticCurveTo(n.x, n.y, flat[0], flat[1]);
      }
      for (let i = 2; i < flat.length; i += 2) p.lineTo(flat[i], flat[i + 1]);
    }
    r.linePath = p;
    r.linePathFor = r.pathTo;
    r.linePathV = ver;
    return p;
  }

  // 화면에 그리는 위치가 실제 위치를 스프링처럼 따라간다. 시뮬레이션은 그대로 두고
  // 출발과 정지의 급한 변화만 부드럽게 만든다. 돌려주는 값은 실제 위치보다 뒤처진 거리
  easeLag(v) {
    const t = this.game.time;
    const dt = t - v.dT;
    v.dT = t;
    if (v.dOdo == null || !(dt >= 0) || dt > 1) { v.dOdo = v.odo; v.dV = v.v; return 0; }
    if (dt > 0) {
      const d = v.dOdo - v.odo;
      const c = v.dV + EASE_W * d;
      const e = Math.exp(-EASE_W * dt);
      v.dOdo = v.odo + (d + c * dt) * e;
      v.dV = (v.dV - EASE_W * c * dt) * e;
    }
    return Math.max(0, v.odo - v.dOdo);
  }

  drawTrucks(ctx) {
    const cam = this.cam, k = cam.k, traffic = this.game.traffic, pal = this.pal;
    const front = this.tmp, rear = this.tmp2;
    const halfW = (cam.W / 2 + 30) * k, halfH = (cam.H / 2 + 30) * k;
    const minX = cam.cx - halfW, maxX = cam.cx + halfW, minY = cam.cy - halfH, maxY = cam.cy + halfH;
    const detail = k < KM_TRUCK;
    const far = k > KM_MID;
    const buckets = new Map();
    const emit = (v) => {
      const color = GOODS[v.route.goods].color;
      if (far) {
        traffic.pose(v, front);
        if (front[0] < minX || front[0] > maxX || front[1] < minY || front[1] > maxY) return;
        let list = buckets.get(color);
        if (!list) { list = { color, w: 0, full: [], empty: [] }; buckets.set(color, list); }
        list.full.push(front[0], front[1], front[0], front[1]);
        return;
      }
      // 앞뒤 두 점을 모두 도로 위에 올린다. 몸체가 그 사이에 놓이므로 꼬리가 휘둘리지 않는다
      const lag = this.easeLag(v);
      traffic.poseBehind(v, lag, front, v.seg);
      if (front[0] < minX || front[0] > maxX || front[1] < minY || front[1] > maxY) return;
      traffic.poseBehind(v, lag + this.truckLen(v, k), rear, v.segRear);
      body(v, color);
    };
    const body = (v, color) => {
      if (detail) { this.drawTruckDetail(ctx, v, front[0], front[1], rear[0], rear[1], k); return; }
      const key = color + v.model.id;
      let list = buckets.get(key);
      if (!list) {
        list = { color, w: Math.max(v.model.width, (5.4 + Math.min(1.8, v.model.cap * 0.12)) * k), full: [], empty: [] };
        buckets.set(key, list);
      }
      (v.goods ? list.full : list.empty).push(front[0], front[1], rear[0], rear[1]);
    };
    for (const lane of traffic.activeLanes) {
      const r = lane.edge.road;
      if (r.bb[2] < minX || r.bb[0] > maxX || r.bb[3] < minY || r.bb[1] > maxY) continue;
      const vs = lane.veh;
      for (let i = 0; i < vs.length; i++) emit(vs[i]);
    }
    for (const c of traffic.activeConns) {
      const vs = c.veh;
      for (let i = 0; i < vs.length; i++) emit(vs[i]);
    }
    // 상하차 중인 트럭은 사라지지 않고 역에 멈춘 열차처럼 거점 앞에 서 있다
    if (!far) {
      const off = laneOffset(0);
      for (const s of this.game.sites) {
        if (!s.available || !s.spurIn || (!s.loadBays.length && !s.unloadBays.length)) continue;
        if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) continue;
        const e = s.spurIn;
        let back = 0.05;
        for (const list of [s.unloadBays, s.loadBays]) {
          for (const b of list) {
            const v = b.v;
            const len = this.truckLen(v, k);
            e.sample(Math.max(0, e.L - back), off, front);
            e.sample(Math.max(0, e.L - back - len), off, rear);
            body(v, GOODS[v.route.goods].color);
            back += len + 0.15;
          }
        }
      }
    }
    if (far) {
      // 전국 축척: 동그란 점
      ctx.lineCap = 'round';
      ctx.lineWidth = 3.2 * k;
      for (const list of buckets.values()) {
        ctx.strokeStyle = list.color;
        ctx.beginPath();
        const a = list.full;
        for (let i = 0; i < a.length; i += 4) { ctx.moveTo(a[i], a[i + 1]); ctx.lineTo(a[i] + 0.01, a[i + 1]); }
        ctx.stroke();
      }
    } else {
      // 납작한 사각형. 싣고 가면 꽉 채우고, 빈 차는 속을 비운다
      ctx.lineCap = 'butt';
      ctx.strokeStyle = pal.core;
      const rim = 1.1 * k;
      for (const list of buckets.values()) {
        ctx.lineWidth = list.w + rim * 2;
        ctx.beginPath();
        for (const a of [list.full, list.empty]) {
          for (let i = 0; i < a.length; i += 4) {
            const dx = a[i] - a[i + 2], dy = a[i + 1] - a[i + 3];
            const l = Math.hypot(dx, dy) || 1;
            const ux = (dx / l) * rim, uy = (dy / l) * rim;
            ctx.moveTo(a[i] + ux, a[i + 1] + uy);
            ctx.lineTo(a[i + 2] - ux, a[i + 3] - uy);
          }
        }
        ctx.stroke();
      }
      for (const list of buckets.values()) {
        ctx.strokeStyle = list.color;
        ctx.lineWidth = list.w;
        ctx.beginPath();
        for (const a of [list.full, list.empty]) {
          for (let i = 0; i < a.length; i += 4) { ctx.moveTo(a[i], a[i + 1]); ctx.lineTo(a[i + 2], a[i + 3]); }
        }
        ctx.stroke();
      }
      const edge = 1.3 * k;
      ctx.strokeStyle = pal.core;
      for (const list of buckets.values()) {
        const a = list.empty;
        if (!a.length || list.w <= edge * 2) continue;
        ctx.lineWidth = list.w - edge * 2;
        ctx.beginPath();
        for (let i = 0; i < a.length; i += 4) {
          const dx = a[i] - a[i + 2], dy = a[i + 1] - a[i + 3];
          const l = Math.hypot(dx, dy);
          if (l <= edge * 2) continue;
          const ux = (dx / l) * edge, uy = (dy / l) * edge;
          ctx.moveTo(a[i] - ux, a[i + 1] - uy);
          ctx.lineTo(a[i + 2] + ux, a[i + 3] + uy);
        }
        ctx.stroke();
      }
    }
    ctx.lineCap = 'round';
  }

  truckLen(v, k) {
    return Math.max(v.len, (8 + v.len * 3) * k);
  }

  drawTruckDetail(ctx, v, fx, fy, rx, ry, k) {
    const dx = fx - rx, dy = fy - ry;
    const L = Math.hypot(dx, dy);
    const m = v.model;
    const W = Math.max(m.width * 1.1, 4.4 * k);
    if (L < W) return;
    const color = GOODS[v.route.goods].color;
    const cab = Math.min(W * 0.85, L * 0.26);
    const gap = Math.min(0.03, 1 * k);
    const boxL = L - cab - gap;
    const rad = Math.min(W * 0.22, boxL / 2);
    ctx.save();
    ctx.transform(dx / L, dy / L, -dy / L, dx / L, rx, ry);
    this.roundRect(ctx, 0, -W / 2, boxL, W, rad);
    if (v.goods) {
      ctx.fillStyle = color;
      ctx.fill();
      // 실은 만큼 흰 점을 찍는다
      const cap = v.model.cap;
      const slots = cap >= 25 ? 6 : cap >= 8 ? 4 : cap >= 5 ? 3 : 2;
      const pip = Math.min(W * 0.34, (boxL / slots) * 0.56);
      if (pip / k > 1.6) {
        const n = Math.max(1, Math.round((slots * v.cargo) / this.game.truckCap(m)));
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < Math.min(n, slots); i++) {
          const x = ((i + 0.5) / slots) * boxL;
          ctx.fillRect(x - pip / 2, -pip / 2, pip, pip);
        }
      }
    } else {
      ctx.fillStyle = this.pal.core;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.min(W * 0.18, 1.1 * k);
      ctx.stroke();
    }
    this.roundRect(ctx, L - cab, -W / 2, cab, W, Math.min(W * 0.22, cab / 2));
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  drawFerries(ctx) {
    const game = this.game, k = this.cam.k, pal = this.pal;
    const tmp = this.tmp;
    for (const fy of game.traffic.ferries) {
      if (!fy.road.open) continue;
      const e = fy.road.fwd;
      const pos = Math.max(0.01, Math.min(fy.len - 0.01, fy.pos));
      e.sample(pos, 0, tmp);
      const dir = fy.dir;
      const tx = tmp[2] * dir, ty = tmp[3] * dir;
      const L = Math.max(2.4, 14 * k), W = Math.max(0.8, 5.5 * k);
      ctx.save();
      ctx.transform(tx, ty, -ty, tx, tmp[0], tmp[1]);
      this.roundRect(ctx, -L / 2, -W / 2, L, W, W * 0.3);
      ctx.fillStyle = pal.station;
      ctx.fill();
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1.3 * k;
      ctx.stroke();
      ctx.fillStyle = pal.ink;
      const load = fy.cargo.length / fy.cap;
      if (load > 0) ctx.fillRect(-L * 0.42, -W * 0.22, L * 0.84 * load, W * 0.44);
      ctx.restore();
    }
  }

  signalColor(n, e) {
    if (!n.allow) return RED;
    const list = e.turnList || [];
    if (n.clearT > 0) {
      for (const t of list) if (n.prevAllow[t.id] && t.kind !== 'R') return '#e6a81e';
      return RED;
    }
    for (const t of list) if (n.allow[t.id] && t.kind !== 'R') return '#2c9a58';
    return RED;
  }

  drawJunctionMarks(ctx) {
    const cam = this.cam, k = cam.k, net = this.game.net, pal = this.pal;
    const tmp = this.tmp;
    const close = k < KM_CLOSE;
    const midClose = k < 0.3;
    const nodes = net.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.terminal || !this.nodeInView(n, -this.margin + 30)) continue;
      if (!this.nodeOpen(n)) continue;
      // 정체: 어두운 고리가 생기고, 오래 막힐수록 붉은 호가 찬다
      if (n.waiting >= 6) {
        const R = Math.max(n.R, 6 * k) + (6 + Math.min(12, n.waiting * 0.3)) * k;
        const w = 5 * k;
        ctx.lineCap = 'butt';
        ctx.strokeStyle = pal.crowd;
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.arc(n.x, n.y, R, 0, Math.PI * 2); ctx.stroke();
        const f = Math.min(1, n.stuckT / 40);
        if (f > 0.02) {
          ctx.strokeStyle = RED;
          ctx.beginPath(); ctx.arc(n.x, n.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.stroke();
        }
        ctx.lineCap = 'round';
      }
      if (close) {
        // 정지선과 신호·표지
        for (const e of n.inE) {
          if (!e.road.open || e.road.kind === 'f') continue;
          const lanes = e.road.lanes;
          e.sample(e.L, MEDIAN + (LANE_W * lanes) / 2, tmp);
          const px = tmp[0], py = tmp[1], tx = tmp[2], ty = tmp[3];
          const nx = -ty, ny = tx;
          const half = (LANE_W * lanes) / 2;
          ctx.strokeStyle = pal.laneMark;
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.moveTo(px + nx * half, py + ny * half);
          ctx.lineTo(px - nx * half, py - ny * half);
          ctx.stroke();
          const sx = px + nx * (half + 0.2), sy = py + ny * (half + 0.2);
          if (n.control === 'signal') {
            ctx.beginPath();
            ctx.arc(sx - tx * 0.1, sy - ty * 0.1, Math.max(0.1, 3.4 * k), 0, Math.PI * 2);
            ctx.fillStyle = this.signalColor(n, e);
            ctx.fill();
            ctx.strokeStyle = pal.ink;
            ctx.lineWidth = Math.max(0.03, 1.1 * k);
            ctx.stroke();
          } else if (n.control === 'auto' && e.sign) {
            this.drawSignMark(ctx, e.sign, sx - tx * 0.3, sy - ty * 0.3, Math.max(0.2, 6 * k), k, 1);
          } else if (n.control === 'auto' && !e.sign && n.major.size && !n.inE.some((q) => q.sign > 0) && !n.major.has(e.id)) {
            this.drawSignMark(ctx, 1, sx - tx * 0.3, sy - ty * 0.3, Math.max(0.16, 4.6 * k), k, 0.55);
          }
        }
      } else if (midClose) {
        this.drawNodeIcon(ctx, n, k, 7);
      } else if (k < 0.5 && (n.control !== 'auto' || n.inE.some((e) => e.sign > 0))) {
        this.drawNodeIcon(ctx, n, k, 5.5);
      }
    }
  }

  drawSignMark(ctx, sign, x, y, r, k, alpha) {
    const pal = this.pal;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    if (sign === 1) {
      ctx.moveTo(x - r, y - r * 0.72);
      ctx.lineTo(x + r, y - r * 0.72);
      ctx.lineTo(x, y + r);
      ctx.closePath();
      ctx.fillStyle = pal.station;
      ctx.fill();
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1.6 * k;
      ctx.stroke();
    } else {
      const q = r * 0.42;
      ctx.moveTo(x - q, y - r); ctx.lineTo(x + q, y - r); ctx.lineTo(x + r, y - q); ctx.lineTo(x + r, y + q);
      ctx.lineTo(x + q, y + r); ctx.lineTo(x - q, y + r); ctx.lineTo(x - r, y + q); ctx.lineTo(x - r, y - q);
      ctx.closePath();
      ctx.fillStyle = pal.ink;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 교차로 시설은 작은 도형으로 표시한다
  drawNodeIcon(ctx, n, k, size) {
    const pal = this.pal;
    const r = size * k;
    if (n.control === 'interchange') {
      const d = r * 1.1;
      ctx.beginPath();
      ctx.moveTo(n.x, n.y - d); ctx.lineTo(n.x + d, n.y); ctx.lineTo(n.x, n.y + d); ctx.lineTo(n.x - d, n.y);
      ctx.closePath();
      ctx.fillStyle = pal.station;
      ctx.fill();
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1.7 * k;
      ctx.stroke();
      ctx.lineWidth = 1.3 * k;
      ctx.beginPath();
      ctx.moveTo(n.x - d * 0.42, n.y - d * 0.42); ctx.lineTo(n.x + d * 0.42, n.y + d * 0.42);
      ctx.moveTo(n.x + d * 0.42, n.y - d * 0.42); ctx.lineTo(n.x - d * 0.42, n.y + d * 0.42);
      ctx.stroke();
    } else if (n.control === 'signal') {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 0.86, 0, Math.PI * 2);
      ctx.fillStyle = pal.station;
      ctx.fill();
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1.7 * k;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = n.clearT > 0 ? '#e6a81e' : '#2c9a58';
      ctx.fill();
    } else if (n.control === 'auto' && n.inE.some((e) => e.sign > 0)) {
      this.drawSignMark(ctx, n.inE.some((e) => e.sign === 2) ? 2 : 1, n.x, n.y, r * 0.8, k, 1);
    }
  }

  // ── 호버·선택 (화면 좌표) ───────────────────────────
  drawHoverAndSelection(ctx) {
    const cam = this.cam;
    const mark = (sel, color, alpha) => {
      if (!sel) return;
      ctx.globalAlpha = alpha;
      if (sel.type === 'node') {
        const n = sel.node;
        const r = Math.max(n.R / cam.k + 5, 11);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(cam.sx(n.x), cam.sy(n.y), r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (sel.type === 'road') {
        const s = this.dpr / cam.k;
        const ox = (cam.W / 2) * this.dpr - cam.cx * s, oy = (cam.H / 2) * this.dpr - cam.cy * s;
        ctx.setTransform(s, 0, 0, s, ox, oy);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2 * (MEDIAN + LANE_W * sel.road.lanes) + 2 * cam.k, 5 * cam.k);
        ctx.stroke(this.roadPath(sel.road));
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      } else if (sel.type === 'approach') {
        const e = sel.edge;
        const tmp = [0, 0, 0, 0];
        e.sample(Math.max(0, e.L - Math.max(1.8, 26 * cam.k)), MEDIAN + (LANE_W * e.road.lanes) / 2, tmp);
        const x0 = cam.sx(tmp[0]), y0 = cam.sy(tmp[1]);
        e.sample(e.L, MEDIAN + (LANE_W * e.road.lanes) / 2, tmp);
        const x1 = cam.sx(tmp[0]), y1 = cam.sy(tmp[1]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        const a = Math.atan2(y1 - y0, x1 - x0);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x1 + Math.cos(a) * 8, y1 + Math.sin(a) * 8);
        ctx.lineTo(x1 + Math.cos(a + 2.4) * 8, y1 + Math.sin(a + 2.4) * 8);
        ctx.lineTo(x1 + Math.cos(a - 2.4) * 8, y1 + Math.sin(a - 2.4) * 8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    mark(this.selection, ACCENT, 0.95);
    mark(this.hover, this.toolColor, 0.85);
  }

  // ── 거점 ───────────────────────────────────────────
  siteBadgeSize(s) {
    const k = this.cam.k;
    if (k > 0.62) return s.isCity ? 3.6 + Math.min(2.4, Math.sqrt(s.pop) / 8) : 2.8;
    const f = k > 0.42 ? 0.62 : k > 0.22 ? 0.82 : k > 0.1 ? 1 : k > 0.05 ? 1.15 : 1.3;
    const base = s.isCity ? 9.5 + Math.min(3.5, Math.sqrt(s.pop) / 7) + s.cityStage * 0.45 : 9.5;
    return base * f;
  }

  drawSites(ctx) {
    const game = this.game, cam = this.cam, k = cam.k, pal = this.pal;
    const labelBoxes = [];
    const order = game.sites.filter((s) => s.region <= game.stage || s.available).sort((a, b) => (a.isCity === b.isCity ? a.y - b.y : a.isCity ? -1 : 1));
    for (const s of order) {
      const x = cam.sx(s.x), y = cam.sy(s.y);
      if (x < -60 || y < -60 || x > cam.W + 60 || y > cam.H + 60) continue;
      if (!s.available) {
        if (s.stage > game.stage || k > 0.62) continue;
        // 곧 열릴 거점
        shapePath(ctx, siteShape(s), x, y, Math.max(2.6, this.siteBadgeSize(s) * 0.5));
        ctx.strokeStyle = pal.mute;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        continue;
      }
      const r = this.siteBadgeSize(s);
      this.drawStation(ctx, s, x, y, r);
      if (k < 0.24 || (s.isCity && (k < 0.6 || s.pop > 90)) || this.selection?.site === s || this.hover?.site === s || this.tutorTarget === s) {
        this.drawSiteLabel(ctx, s, x, y, r, labelBoxes);
      }
    }
    if (this.tutorTarget) {
      const s = this.tutorTarget;
      const x = cam.sx(s.x), y = cam.sy(s.y);
      const pulse = (this.time * 1.1) % 1;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2.6;
      ctx.globalAlpha = 1 - pulse;
      ctx.beginPath();
      ctx.arc(x, y, 14 + pulse * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // 미니메트로의 역처럼 흰 도형 + 굵은 테두리. 화물은 옆에 작은 점으로 쌓인다
  drawStation(ctx, s, x, y, r) {
    const game = this.game, pal = this.pal, k = this.cam.k;
    const shape = siteShape(s);
    const frac = s.produces ? s.stock / game.siteCap(s) : 0;
    // 창고가 차면 어두운 부채꼴이 자라난다
    if (frac > 0.75 && r >= 4) {
      const f = Math.min(1, (frac - 0.75) / 0.24);
      const R = r * 2.1 + 3;
      ctx.fillStyle = pal.crowd;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
      ctx.closePath();
      ctx.fill();
    }
    const idle = s.inputs && s.inBuf.some((v) => v < 0.05) && s.stock < 1;
    if (this.selection?.site === s) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.5 + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    shapePath(ctx, shape, x, y, r);
    ctx.fillStyle = pal.station;
    ctx.fill();
    ctx.strokeStyle = idle ? pal.mute : pal.ink;
    ctx.lineWidth = Math.max(1.4, r * 0.3);
    ctx.lineJoin = 'round';
    ctx.stroke();
    if (r < 4) return;
    // 도시가 크게 자라면 고리가 하나 더 생긴다
    if (s.kind === 'city' && s.cityStage >= 3) {
      ctx.lineWidth = Math.max(1.2, r * 0.18);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (s.goods) {
      ctx.fillStyle = GOODS[s.goods].color;
      ctx.beginPath();
      ctx.arc(x, y + (shape === 'triangle' ? r * 0.16 : 0), r * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }
    if (k > KM_MID) return;
    // 쌓인 화물
    if (s.produces && frac > 0.02) {
      const p = Math.max(2.6, r * 0.42), gap = p * 0.42;
      const n = Math.min(12, Math.ceil(frac * 12));
      const x0 = x + r * 1.25 + 3;
      ctx.fillStyle = GOODS[s.goods].color;
      for (let i = 0; i < n; i++) {
        const c = i % 6, row = i < 6 ? 0 : 1;
        ctx.fillRect(x0 + c * (p + gap), y - p - gap / 2 + row * (p + gap), p, p);
      }
    }
    // 화물을 기다리는 트럭은 그 아래에 빈 사각형으로 줄을 선다
    if (s.yard.length && s.produces) {
      const p = Math.max(2.6, r * 0.42), gap = p * 0.42;
      const w = p * 1.7, hh = p * 0.95;
      const x0 = x + r * 1.25 + 3, y0 = y + p + gap * 2.2;
      ctx.fillStyle = pal.core;
      ctx.strokeStyle = GOODS[s.goods].color;
      ctx.lineWidth = 1.1;
      const n = Math.min(5, s.yard.length);
      for (let i = 0; i < n; i++) {
        ctx.fillRect(x0 + i * (w + gap), y0, w, hh);
        ctx.strokeRect(x0 + i * (w + gap), y0, w, hh);
      }
    }
    // 모자란 원료는 빈 동그라미로 알려 준다
    if (s.inputs) {
      const cap = game.inputCap(s);
      let i = 0;
      for (let q = 0; q < s.inputs.length; q++) {
        if (s.inBuf[q] > cap * 0.05) continue;
        const px = x - r * 1.25 - 5 - i * (r * 0.85 + 2);
        ctx.strokeStyle = GOODS[s.inputs[q][0]].color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(px, y, Math.max(2.4, r * 0.34), 0, Math.PI * 2);
        ctx.stroke();
        i++;
      }
    }
  }

  drawSiteLabel(ctx, s, x, y, r, boxes) {
    const city = s.isCity, pal = this.pal;
    const size = city ? 13 : 11;
    ctx.font = `${city ? 700 : 500} ${size}px ${FONT}`;
    const text = s.name;
    const w = ctx.measureText(text).width;
    const h = size + 4;
    const lx = x - w / 2, ly = y + r * 1.3 + 3;
    const box = [lx, ly, lx + w, ly + h];
    for (const q of boxes) if (box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]) { if (this.selection?.site !== s && this.hover?.site !== s) return; }
    boxes.push(box);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = pal.halo;
    ctx.strokeText(text, x, ly + h / 2);
    ctx.fillStyle = city ? pal.ink : pal.labelStrong;
    ctx.fillText(text, x, ly + h / 2);
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  drawPings(ctx, dt) {
    const cam = this.cam;
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t += dt;
      if (p.t > 1.2) { this.pings.splice(i, 1); continue; }
      const u = p.t / 1.2;
      ctx.strokeStyle = p.color || ACCENT;
      ctx.globalAlpha = 1 - u;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(cam.sx(p.x), cam.sy(p.y), 8 + u * 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ping(x, y, color) { this.pings.push({ x, y, color, t: 0 }); }

  // 떠오르는 금액은 트럭이 적을 때와 고른 거점에서만 보여 준다
  drawFloats(ctx) {
    const cam = this.cam, game = this.game, pal = this.pal;
    if (cam.k > 0.55) return;
    const few = game.truckCount <= 24;
    const site = this.selection?.site;
    if (!few && !site) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 12px ${FONT}`;
    ctx.lineWidth = 3;
    for (const f of game.floats) {
      if (!few && (f.x !== site.x || f.y !== site.y)) continue;
      const x = cam.sx(f.x), y = cam.sy(f.y) - 20 - f.t * 22;
      if (x < 0 || y < 0 || x > cam.W || y > cam.H) continue;
      ctx.globalAlpha = Math.min(1, 1.6 - f.t);
      ctx.strokeStyle = pal.halo;
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.tag === 'late' || f.overflow ? RED : pal.ink;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ── 클릭 판정 ──────────────────────────────────────
  pick(sx, sy, tool = 'select') {
    const cam = this.cam, game = this.game, net = game.net;
    const wantSite = tool === 'select';
    const wantNode = tool !== 'lane';
    const wantRoad = tool === 'select' || tool === 'lane';
    if (wantSite) {
      let best = null, bd = Infinity;
      for (const s of game.sites) {
        if (!s.available) continue;
        const r = this.siteBadgeSize(s) * 1.25 + 6;
        const d = Math.hypot(cam.sx(s.x) - sx, cam.sy(s.y) - sy);
        if (d < r && d < bd) { bd = d; best = s; }
      }
      if (best) return { type: 'site', site: best };
    }
    if (wantNode) {
      let best = null, bd = Infinity;
      for (const n of net.nodes) {
        if (n.terminal || n.inE.length < 2 || !this.nodeOpen(n)) continue;
        const d = Math.hypot(cam.sx(n.x) - sx, cam.sy(n.y) - sy);
        const signTool = tool === 'yield' || tool === 'stop';
        const r = signTool ? Math.max((n.R * 2.2) / cam.k, 26) : Math.max(n.R / cam.k, 13);
        if (d < r && d < bd) { bd = d; best = n; }
      }
      if (best) {
        if ((tool === 'yield' || tool === 'stop') && best.control === 'auto') {
          const e = this.nearestApproach(best, cam.wx(sx), cam.wy(sy));
          if (e) return { type: 'approach', node: best, edge: e };
        }
        return { type: 'node', node: best };
      }
    }
    if (wantRoad) {
      const wx = cam.wx(sx), wy = cam.wy(sy);
      const tol = 7 * cam.k;
      let best = null, bd = tol;
      for (const r of net.roads) {
        const planned = tool === 'select' && r.lock && !r.built && r.region <= game.stage;
        if ((!r.open && !planned) || (r.kind === 'f' && tool !== 'select')) continue;
        if (wx < r.bb[0] - tol || wx > r.bb[2] + tol || wy < r.bb[1] - tol || wy > r.bb[3] + tol) continue;
        const pts = r.pts;
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const d = segDist(wx, wy, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
          const dd = d - (MEDIAN + LANE_W * r.lanes);
          if (dd < bd) { bd = dd; best = r; }
        }
      }
      if (best) {
        if (best.lock && !best.built) return { type: 'project', project: game.projById.get(best.lock) };
        return { type: 'road', road: best };
      }
    }
    return null;
  }

  nearestApproach(node, wx, wy) {
    let best = null, bd = -2;
    const dx = wx - node.x, dy = wy - node.y;
    const l = Math.hypot(dx, dy) || 1;
    for (const e of node.inE) {
      if (e.road.kind === 'f' || !e.road.open) continue;
      const d = e.road.dirAt(node.id);
      const dot = (d[0] * dx + d[1] * dy) / l;
      if (dot > bd) { bd = dot; best = e; }
    }
    return best;
  }
}

function reversed(flat) {
  const out = new Array(flat.length);
  for (let i = 0; i < flat.length; i += 2) {
    out[i] = flat[flat.length - 2 - i];
    out[i + 1] = flat[flat.length - 1 - i];
  }
  return out;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
