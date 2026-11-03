// 지도·트럭·교차로 캔버스 렌더링. 지도 바탕은 캐시하고, 움직이는 것만 매 프레임 그린다.
// 그림은 지하철 노선도처럼 납작하게: 크림색 땅, 파란 물, 화물 색 선, 흰 도형 거점. 트럭만은 위에서 내려다본 실제 차처럼 그린다.
import { LANE_W, MEDIAN } from '../sim/network.js';
import { GOODS } from '../game/defs.js';
import { SHAPES, siteShape } from './art.js';
import { STALL_W, STALL_D, AISLE, LOT_U0 } from '../game/lot.js';

export const PALETTES = {
  day: {
    sea: '#aed2ec', foreign: '#ebe5d5', land: '#f6f1e3', locked: '#ece6d6', border: 'rgba(90,80,60,0.09)',
    river: '#aed2ec', lake: '#aed2ec', urban: '#efe8d6',
    label: '#8a8476', labelStrong: '#55514a', halo: 'rgba(246,241,227,0.92)', seaLabel: '#7aa6c8',
    xRoad: '#cdc6b4', nRoad: '#dad4c4', rRoad: '#e3ddce', closed: '#e3ddcd', plan: '#8e6fc9', ferry: '#7aa6c8', ferryOff: 'rgba(122,166,200,0.35)',
    laneMark: 'rgba(255,255,255,0.9)', center: '#b3ac9a', grass: '#d5e6c8', lot: '#e6e0d0', stallLine: '#fbf8ef',
    bedEmpty: '#a8a397', bedLine: 'rgba(60,55,45,0.28)', tire: '#2f2d29', glass: '#27343d', shadow: 'rgba(50,42,28,0.2)',
    ink: '#2a2a28', station: '#ffffff', core: '#fbf8ef', mute: '#b9b3a3', crowd: 'rgba(42,42,40,0.3)',
  },
  night: {
    sea: '#141d26', foreign: '#1d242b', land: '#262b30', locked: '#20252a', border: 'rgba(255,255,255,0.05)',
    river: '#141d26', lake: '#141d26', urban: '#2d3237',
    label: '#8d8f8c', labelStrong: '#cfcdc6', halo: 'rgba(38,43,48,0.92)', seaLabel: '#4f7390',
    xRoad: '#4a4f54', nRoad: '#3d4247', rRoad: '#363b40', closed: '#2f3439', plan: '#a98be0', ferry: '#4f7390', ferryOff: 'rgba(79,115,144,0.35)',
    laneMark: 'rgba(255,255,255,0.45)', center: '#6a6f73', grass: '#33483a', lot: '#32373c', stallLine: '#50555a',
    bedEmpty: '#6f7276', bedLine: 'rgba(0,0,0,0.3)', tire: '#101214', glass: '#9fb6c4', shadow: 'rgba(0,0,0,0.35)',
    ink: '#f1eee6', station: '#262b30', core: '#262b30', mute: '#6d6a62', crowd: 'rgba(241,238,230,0.26)',
  },
};

const FONT = '"Helvetica Neue", Helvetica, Arial, "Gothic A1", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
const ACCENT = '#3f7fb8';
const RED = '#d9412b';
const ORANGE = '#e08a1e';
const KM_CLOSE = 0.09;    // 이보다 가까우면 실제 도로처럼 차로를 그린다
const KM_TRUCK = 0.07;    // 이보다 가까우면 트럭을 자세히 그린다
const KM_MID = 0.42;      // 이보다 멀면 트럭을 점으로 그린다
const EASE_W = 9;         // 표시 위치가 실제 위치를 따라가는 빠르기. 낮을수록 출발과 정지가 느긋하다
const GOODS_ORDER = Object.keys(GOODS);
// 위에서 본 트럭의 치수(km). fo: 앞범퍼에서 앞바퀴까지, wb: 앞뒤 바퀴 사이, cab: 운전석 길이, wb2: 트레일러 연결부에서 뒷바퀴까지
const TRUCK_GEO = {
  hauler: { fo: 0.09, wb: 0.42, cab: 0.26 },
  cargo: { fo: 0.11, wb: 0.6, cab: 0.3 },
  express: { fo: 0.11, wb: 0.58, cab: 0.3 },
  trailer: { fo: 0.1, wb: 0.34, cab: 0.4, wb2: 0.98 },
};
const NODE_TOOLS = new Set(['yield', 'stop', 'signal', 'roundabout', 'interchange', 'remove']);
const KM_LOT = 0.3;       // 이보다 가까우면 주차장을 그린다

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
const CAB_COLOR = {};
for (const id of GOODS_ORDER) CAB_COLOR[GOODS[id].color] = shade(GOODS[id].color, -0.26);

function ringPath(path, flat) {
  path.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
  path.closePath();
}
function linePath(path, flat) {
  path.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
}
// 폴리라인의 앞을 a, 뒤를 b만큼 잘라 낸다
function trimLine(pts, len, a, b) {
  if (a + b > len * 0.8) {
    const f = (len * 0.8) / (a + b);
    a *= f;
    b *= f;
  }
  const out = [];
  const end = len - b;
  let d = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l > 0 && d + l > a && d < end) {
      if (!out.length) {
        const t = Math.max(0, (a - d) / l);
        out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      }
      const t = Math.min(1, (end - d) / l);
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
    d += l;
  }
  return out;
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
    this.lotVer = -1;
    this.buildPaths(game.data);
    this.tmp = [0, 0, 0, 0];
    this.tmp2 = [0, 0, 0, 0];
    this.tmp3 = [0, 0, 0, 0];
    this.lastDt = 0.016;
    this.hoverKey = null;
    this.hoverT = 1;
    this.prevHover = null;
    this.prevHoverT = 1;
    this.selKey = null;
    this.selT = 1;
    this.hlT = 1;
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
    this.drawLots(b, px, k);
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

  // 주차장 바닥과 칸 선
  drawLots(b, px, k) {
    if (k >= KM_LOT) return;
    const game = this.game, pal = this.pal;
    const W = AISLE + STALL_D;
    b.lineJoin = 'round';
    for (const s of game.sites) {
      const lot = s.lot;
      if (!lot || !lot.cap || !this.nodeInView(game.net.nodes[s.node], 120)) continue;
      const end = lot.endU;
      const a = lot.at(LOT_U0 - 0.1, -W), c = lot.at(LOT_U0 - 0.1, W), d = lot.at(end, W), e = lot.at(end, -W);
      b.fillStyle = pal.lot;
      b.strokeStyle = pal.lot;
      b.lineWidth = 0.3;
      b.beginPath();
      b.moveTo(a[0], a[1]); b.lineTo(c[0], c[1]); b.lineTo(d[0], d[1]); b.lineTo(e[0], e[1]);
      b.closePath();
      b.fill();
      b.stroke();
      // 진입로에서 주차장까지 이어지는 길목
      const g0 = lot.at(0, -0.8), g1 = lot.at(0, 0.8), g2 = lot.at(LOT_U0, 0.8), g3 = lot.at(LOT_U0, -0.8);
      b.beginPath();
      b.moveTo(g0[0], g0[1]); b.lineTo(g1[0], g1[1]); b.lineTo(g2[0], g2[1]); b.lineTo(g3[0], g3[1]);
      b.closePath();
      b.fill();
      b.beginPath();
      b.arc(lot.x, lot.y, 0.95, 0, Math.PI * 2);
      b.fill();
      if (k < 0.2) {
        b.strokeStyle = pal.stallLine;
        b.lineWidth = Math.max(0.04, 1 * px);
        b.lineCap = 'butt';
        b.beginPath();
        for (let i = 0; i < lot.cap; i++) {
          if (lot.blocked[i]) continue;
          const { u, side } = lot.stallPos(i);
          for (const e2 of [-0.5, 0.5]) {
            const p = lot.at(u + e2 * STALL_W, side * AISLE), q = lot.at(u + e2 * STALL_W, side * W);
            b.moveTo(p[0], p[1]);
            b.lineTo(q[0], q[1]);
          }
        }
        b.stroke();
        b.lineCap = 'round';
      }
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
      // 뒷바퀴가 안쪽으로 파고드는 것과 트레일러가 도는 폭까지 덮도록 넓게 칠한다
      b.lineWidth = Math.max(LANE_W * 2.2, 2.4 * px);
      for (const n of nodesHere) {
        const col = close || n.roads.some((q) => q.kind === 'x') ? pal.xRoad : pal.nRoad;
        b.strokeStyle = col;
        b.stroke(this.junctionPath(n));
        if (n.inE.length >= 3) {
          b.fillStyle = col;
          b.beginPath();
          b.arc(n.x, n.y, Math.min(n.R, this.junctionWidth(n) * 0.62), 0, Math.PI * 2);
          b.fill();
        }
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
    // 트럭이 묻히지 않도록 선은 가늘게 긋는다
    const w = (k > KM_MID ? 1.3 : 1.8) * px;
    b.lineWidth = w;
    for (const [road, m] of byRoad) {
      if (!this.roadInView(road)) continue;
      let list = [...m.keys()];
      const most = 3;
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

  // 교차로 포장: 트럭이 지나는 회전 궤적을 그대로 칠한다
  junctionPath(n) {
    const net = this.game.net, ver = net.version;
    if (n.jPath && n.jPathV === ver) return n.jPath;
    const p = new Path2D();
    for (const e of n.inE) {
      if (e.road.kind === 'f' || !e.road.open) continue;
      for (const t of e.turnList || []) {
        if (t.to.road.kind === 'f' || !t.to.road.open) continue;
        const hi = Math.min(t.laneHi, e.lanes.length - 1);
        for (let a = Math.min(t.laneLo, hi); a <= hi; a++) {
          for (const tl of t.to.lanes) {
            linePath(p, net.getConn(e.lanes[a], tl).pts);
          }
        }
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
    this.lastDt = dt;
    const cam = this.cam;
    if (!this.canvas.width || !this.canvas.height || !this.base.width || !this.base.height) return;
    cam.update(dt);
    const ctx = this.ctx, dpr = this.dpr;
    const view = this.baseView;
    if (this.routeVer !== this.game.routeVer || this.lotVer !== this.game.lotVer) {
      this.routeVer = this.game.routeVer;
      this.lotVer = this.game.lotVer;
      this.baseDirty = true;
    }

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
    const K = 1 - Math.exp(-this.lastDt * 12);
    for (const h of list) {
      const r = h.route;
      if (!r.pathTo) continue;
      const want = h.strong ? 1 : 0.62;
      r.hlF = (r.hlF || 0) + (want - (r.hlF || 0)) * K;
      ctx.strokeStyle = GOODS[r.goods].color;
      ctx.lineWidth = (2.6 + 3 * r.hlF) * k;
      ctx.globalAlpha = Math.min(1, 0.25 + r.hlF);
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
    const cam = this.cam, k = cam.k, game = this.game, traffic = game.traffic, pal = this.pal;
    const front = this.tmp;
    const halfW = (cam.W / 2 + 30) * k, halfH = (cam.H / 2 + 30) * k;
    const minX = cam.cx - halfW, maxX = cam.cx + halfW, minY = cam.cy - halfH, maxY = cam.cy + halfH;
    const detail = k < KM_TRUCK;
    const far = k > KM_MID;
    const inView = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
    if (far) {
      // 전국 축척: 동그란 점
      const dots = new Map();
      const dot = (v) => {
        traffic.pose(v, front);
        if (!inView(front[0], front[1])) return;
        const c = GOODS[v.route.goods].color;
        let a = dots.get(c);
        if (!a) { a = []; dots.set(c, a); }
        a.push(front[0], front[1]);
      };
      for (const lane of traffic.activeLanes) for (const v of lane.veh) dot(v);
      for (const c of traffic.activeConns) for (const v of c.veh) dot(v);
      ctx.lineCap = 'round';
      ctx.lineWidth = 3 * k;
      for (const [c, a] of dots) {
        ctx.strokeStyle = c;
        ctx.beginPath();
        for (let i = 0; i < a.length; i += 2) { ctx.moveTo(a[i], a[i + 1]); ctx.lineTo(a[i] + 0.01, a[i + 1]); }
        ctx.stroke();
      }
      return;
    }
    // 중간 축척은 같은 색끼리 묶어 한 번에 그린다
    const beds = new Map(), cabs = new Map();
    const push = (map, color, w, x0, y0, x1, y1) => {
      const key = color + w.toFixed(3);
      let q = map.get(key);
      if (!q) { q = { color, w, a: [] }; map.set(key, q); }
      q.a.push(x0, y0, x1, y1);
    };
    const emit = (v, f) => {
      const g = TRUCK_GEO[v.model.id];
      const color = GOODS[v.route.goods].color;
      const L = v.lot;
      const roadZ = detail ? 1 : Math.max(1, (8.5 * k) / v.len);
      const z = roadZ + (1 - roadZ) * f;
      const lag = this.easeLag(v);
      let seg, p, reverse = false;
      if (!L) {
        seg = v.lane || v.conn;
        p = v.s - lag - g.fo * z;
      } else if (L.phase === 'back') {
        // 후진: 맨 뒤 바퀴가 길을 따라가고 앞쪽은 끌려온다
        seg = L.seg;
        p = L.s - lag - v.len + g.fo + g.wb + (g.wb2 || 0);
        reverse = true;
      } else {
        seg = L.seg;
        p = L.s - lag - g.fo * z;
      }
      traffic.poseOn(v, seg, p, front, !L && v.lane ? v.seg : undefined);
      if (!inView(front[0], front[1])) return;
      this.stepAxles(v, g, z, front[0], front[1], reverse, seg, p);
      if (detail) { this.drawTruckTop(ctx, v, g, z, color); return; }
      // 앞바퀴와 뒷바퀴로 몸체 방향을 정한다
      const roadW = Math.max(v.model.width, (3.4 + Math.min(1, v.model.cap * 0.06)) * k);
      const w = L ? roadW + (Math.min(roadW, STALL_W * 0.72) - roadW) * f : roadW;
      let ux = v.a0x - v.a1x, uy = v.a0y - v.a1y;
      let l = Math.hypot(ux, uy) || 1;
      ux /= l; uy /= l;
      const fx = v.a0x + ux * g.fo * z, fy = v.a0y + uy * g.fo * z;
      const bedColor = v.goods ? color : pal.bedEmpty;
      if (g.wb2) {
        let vx = v.a1x - v.a2x, vy = v.a1y - v.a2y;
        l = Math.hypot(vx, vy) || 1;
        vx /= l; vy /= l;
        const ro = (v.len - g.fo - g.wb - g.wb2) * z;
        push(beds, bedColor, w, v.a1x + vx * 0.1 * z, v.a1y + vy * 0.1 * z, v.a2x - vx * ro, v.a2y - vy * ro);
        push(cabs, CAB_COLOR[color], w, fx, fy, v.a1x, v.a1y);
      } else {
        const ro = (v.len - g.fo - g.wb) * z;
        const cx = fx - ux * g.cab * z, cy = fy - uy * g.cab * z;
        const gap = Math.min(0.03 * z, 0.5 * k);
        push(beds, bedColor, w, cx - ux * gap, cy - uy * gap, v.a1x - ux * ro, v.a1y - uy * ro);
        push(cabs, CAB_COLOR[color], w, fx, fy, cx, cy);
      }
    };
    for (const lane of traffic.activeLanes) {
      const r = lane.edge.road;
      if (r.bb[2] < minX || r.bb[0] > maxX || r.bb[3] < minY || r.bb[1] > maxY) continue;
      const vs = lane.veh;
      for (let i = 0; i < vs.length; i++) emit(vs[i], 0);
    }
    for (const c of traffic.activeConns) {
      const vs = c.veh;
      for (let i = 0; i < vs.length; i++) emit(vs[i], 0);
    }
    // 주차장 안: 칸에 가까워질수록 도로에서 키워 그린 크기가 실제 크기로 돌아온다
    if (k < KM_LOT) {
      const pad = 12;
      for (const v of game.lotVehicles) {
        const L = v.lot, s = L.site;
        if (s.x < minX - pad || s.x > maxX + pad || s.y < minY - pad || s.y > maxY + pad) continue;
        let f = 1;
        if (L.phase === 'in') f = Math.max(0, Math.min(1, L.s / L.seg.len));
        else if (L.phase === 'out' || L.phase === 'exit') f = 1 - Math.max(0, Math.min(1, L.s / L.seg.len));
        emit(v, f);
      }
    }
    ctx.lineCap = 'butt';
    for (const map of [beds, cabs]) {
      for (const q of map.values()) {
        ctx.strokeStyle = q.color;
        ctx.lineWidth = q.w;
        ctx.beginPath();
        const a = q.a;
        for (let i = 0; i < a.length; i += 4) { ctx.moveTo(a[i], a[i + 1]); ctx.lineTo(a[i + 2], a[i + 3]); }
        ctx.stroke();
      }
    }
    ctx.lineCap = 'round';
  }

  // 앞바퀴가 길을 따라가면 뒷바퀴는 끌려온다 (후진이면 거꾸로). 그래서 회전 중심이 뒷바퀴 쪽에 생기고
  // 커브에서 뒷바퀴가 안쪽으로 파고들며, 트레일러는 연결부에서 꺾인다.
  stepAxles(v, g, z, lx, ly, reverse, seg, p) {
    const t = this.game.time;
    const dt = t - v.aT;
    const wb = g.wb * z, wb2 = (g.wb2 || 0) * z;
    if (v.aT === undefined || !(dt >= 0) || dt > 0.5) {
      // 처음 보이거나 오래 안 그린 트럭은 길 위에 곧게 놓는다
      const q = this.tmp3, traffic = this.game.traffic;
      if (reverse) {
        v.a2x = lx; v.a2y = ly;
        v.a1x = lx; v.a1y = ly;
        traffic.poseOn(v, seg, p - wb2, q);
        if (g.wb2) { v.a1x = q[0]; v.a1y = q[1]; }
        traffic.poseOn(v, seg, p - wb2 - wb, q);
        v.a0x = q[0]; v.a0y = q[1];
      } else {
        v.a0x = lx; v.a0y = ly;
        traffic.poseOn(v, seg, p - wb, q);
        v.a1x = q[0]; v.a1y = q[1];
        if (g.wb2) { traffic.poseOn(v, seg, p - wb - wb2, q); v.a2x = q[0]; v.a2y = q[1]; }
      }
      v.aT = t;
      v.aRev = reverse;
      v.aErrX = 0; v.aErrY = 0;
      v.steer = 0;
      return;
    }
    v.aT = t;
    // 끄는 쪽이 바뀌는 순간 튀지 않도록 차이를 서서히 없앤다
    if (reverse !== v.aRev) {
      const lead = reverse ? (g.wb2 ? [v.a2x, v.a2y] : [v.a1x, v.a1y]) : [v.a0x, v.a0y];
      v.aErrX = lead[0] - lx;
      v.aErrY = lead[1] - ly;
      v.aRev = reverse;
    }
    if (v.aErrX || v.aErrY) {
      const d = Math.exp(-dt / 0.22);
      v.aErrX *= d; v.aErrY *= d;
      if (Math.abs(v.aErrX) + Math.abs(v.aErrY) < 0.001) { v.aErrX = 0; v.aErrY = 0; }
      lx += v.aErrX; ly += v.aErrY;
    }
    const px = v.a0x, py = v.a0y;
    const tow = (ax, ay, bx, by, dist, out) => {
      const dx = bx - ax, dy = by - ay;
      const l = Math.hypot(dx, dy) || 1;
      out[0] = ax + (dx / l) * dist;
      out[1] = ay + (dy / l) * dist;
    };
    const q = this.tmp3;
    if (!reverse) {
      v.a0x = lx; v.a0y = ly;
      tow(v.a0x, v.a0y, v.a1x, v.a1y, wb, q);
      v.a1x = q[0]; v.a1y = q[1];
      if (g.wb2) { tow(v.a1x, v.a1y, v.a2x, v.a2y, wb2, q); v.a2x = q[0]; v.a2y = q[1]; }
    } else if (g.wb2) {
      v.a2x = lx; v.a2y = ly;
      tow(v.a2x, v.a2y, v.a1x, v.a1y, wb2, q);
      v.a1x = q[0]; v.a1y = q[1];
      tow(v.a1x, v.a1y, v.a0x, v.a0y, wb, q);
      v.a0x = q[0]; v.a0y = q[1];
    } else {
      v.a1x = lx; v.a1y = ly;
      tow(v.a1x, v.a1y, v.a0x, v.a0y, wb, q);
      v.a0x = q[0]; v.a0y = q[1];
    }
    // 앞바퀴가 움직인 방향과 차 방향의 차이가 곧 조향각이다
    const mx = v.a0x - px, my = v.a0y - py;
    if (mx * mx + my * my > 1e-6) {
      const hx = v.a0x - v.a1x, hy = v.a0y - v.a1y;
      let d = Math.atan2(hx * my - hy * mx, hx * mx + hy * my);
      if (reverse) d = d > 0 ? d - Math.PI : d + Math.PI;
      d = Math.max(-0.6, Math.min(0.6, d));
      v.steer += (d - (v.steer || 0)) * 0.25;
    }
  }

  // 위에서 내려다본 트럭 한 대
  drawTruckTop(ctx, v, g, z, color) {
    const pal = this.pal, k = this.cam.k, m = v.model;
    const W = Math.max(m.width, 3.6 * k);
    const cabColor = CAB_COLOR[color];
    const loaded = !!v.goods;
    let ux = v.a0x - v.a1x, uy = v.a0y - v.a1y;
    let l = Math.hypot(ux, uy) || 1;
    ux /= l; uy /= l;
    const box = (x, y, w, h, rad) => { this.roundRect(ctx, x, y, w, h, Math.min(rad, Math.abs(w) / 2, Math.abs(h) / 2)); };
    // 바퀴 한 쌍. x는 차체 앞뒤 위치, a는 조향각
    const wheels = (x, a) => {
      const tw = W * 0.2, tl = Math.min(0.13, W * 0.5);
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(x, (side * W) / 2);
        if (a) ctx.rotate(a);
        ctx.fillRect(-tl / 2, -tw / 2, tl, tw);
        ctx.restore();
      }
    };
    // 적재함. 실으면 화물 색 짐이 덮이고 비면 바닥 판자가 보인다
    const bed = (L) => {
      box(0, -W / 2, L, W, W * 0.1);
      ctx.fillStyle = loaded ? color : pal.bedEmpty;
      ctx.fill();
      const px = 1 / this.dpr * k * 1.2;
      ctx.fillStyle = pal.bedLine;
      if (loaded) {
        // 짐을 덮은 천의 주름
        const step = Math.max(L / 9, 2.4 * k);
        for (let x = step; x < L - step * 0.5; x += step) ctx.fillRect(x, -W / 2, px, W);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(0, -W * 0.16, L, W * 0.32);
      } else {
        const step = Math.max(W * 0.28, 1.8 * k);
        for (let y = -W / 2 + step; y < W / 2 - step * 0.4; y += step) ctx.fillRect(0, y, L, px);
        ctx.strokeStyle = cabColor;
        ctx.lineWidth = Math.min(W * 0.1, 1.1 * k);
        box(0, -W / 2, L, W, W * 0.1);
        ctx.stroke();
      }
    };
    const cab = (L) => {
      box(0, -W / 2, L, W, W * 0.24);
      ctx.fillStyle = cabColor;
      ctx.fill();
      // 앞유리와 지붕
      const gl = L * 0.3;
      ctx.fillStyle = pal.glass;
      box(L * 0.56, -W * 0.38, gl, W * 0.76, W * 0.08);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.fillRect(L * 0.1, -W * 0.3, L * 0.38, W * 0.6);
      // 사이드미러
      ctx.fillStyle = cabColor;
      const mw = W * 0.13;
      ctx.fillRect(L * 0.6, -W / 2 - mw, L * 0.08, mw);
      ctx.fillRect(L * 0.6, W / 2, L * 0.08, mw);
    };
    const lights = (rearX, braking, backing) => {
      if (!braking && !backing) return;
      ctx.fillStyle = backing ? '#fff6d8' : '#e8402f';
      const s = W * 0.2;
      ctx.fillRect(rearX - s * 0.25, -W / 2 + s * 0.2, s * 0.5, s);
      ctx.fillRect(rearX - s * 0.25, W / 2 - s * 1.2, s * 0.5, s);
    };
    const shadowOff = Math.min(0.035, 1.4 * k);
    const backing = v.lot && v.lot.phase === 'back';
    const braking = v.lot ? v.lot.phase === 'in' && v.a < -0.6 : v.a < -0.6 || v.v < 0.05;
    if (g.wb2) {
      // 트랙터 + 트레일러: 연결부에서 꺾인다
      let vx = v.a1x - v.a2x, vy = v.a1y - v.a2y;
      l = Math.hypot(vx, vy) || 1;
      vx /= l; vy /= l;
      const ro = (v.len - g.fo - g.wb - g.wb2) * z;
      const tL = g.wb2 * z + ro + 0.1 * z;
      const rx = v.a2x - vx * ro, ry = v.a2y - vy * ro;
      const fx = v.a0x + ux * g.fo * z, fy = v.a0y + uy * g.fo * z;
      const tractorL = (g.fo + g.wb + 0.06) * z;
      const tx0 = fx - ux * tractorL, ty0 = fy - uy * tractorL;
      // 그림자
      ctx.fillStyle = pal.shadow;
      ctx.save(); ctx.transform(vx, vy, -vy, vx, rx + shadowOff, ry + shadowOff); box(0, -W / 2, tL, W, W * 0.1); ctx.fill(); ctx.restore();
      ctx.save(); ctx.transform(ux, uy, -uy, ux, tx0 + shadowOff, ty0 + shadowOff); box(0, -W / 2, tractorL, W, W * 0.2); ctx.fill(); ctx.restore();
      // 트랙터 뒤판과 바퀴
      ctx.save();
      ctx.transform(ux, uy, -uy, ux, tx0, ty0);
      ctx.fillStyle = pal.tire;
      wheels(tractorL - g.fo * z, v.steer || 0);
      wheels(0.06 * z, 0);
      ctx.fillRect(0, -W * 0.34, tractorL - g.cab * z, W * 0.68);
      ctx.save(); ctx.translate(tractorL - g.cab * z, 0); cab(g.cab * z); ctx.restore();
      ctx.restore();
      // 트레일러
      ctx.save();
      ctx.transform(vx, vy, -vy, vx, rx, ry);
      ctx.fillStyle = pal.tire;
      wheels(ro, 0);
      wheels(ro + Math.min(0.16, W * 0.6), 0);
      bed(tL);
      lights(0, braking, backing);
      ctx.restore();
      return;
    }
    const ro = (v.len - g.fo - g.wb) * z;
    const L = v.len * z;
    const rx = v.a1x - ux * ro, ry = v.a1y - uy * ro;
    ctx.fillStyle = pal.shadow;
    ctx.save(); ctx.transform(ux, uy, -uy, ux, rx + shadowOff, ry + shadowOff); box(0, -W / 2, L, W, W * 0.2); ctx.fill(); ctx.restore();
    ctx.save();
    ctx.transform(ux, uy, -uy, ux, rx, ry);
    ctx.fillStyle = pal.tire;
    wheels(ro, 0);
    wheels(L - g.fo * z, v.steer || 0);
    const cabL = g.cab * z, gap = Math.min(0.025 * z, W * 0.12);
    bed(L - cabL - gap);
    ctx.fillStyle = pal.tire;
    ctx.fillRect(L - cabL - gap, -W * 0.3, gap, W * 0.6);
    ctx.save(); ctx.translate(L - cabL, 0); cab(cabL); ctx.restore();
    lights(0, braking, backing);
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
  markKey(sel) {
    if (!sel) return null;
    if (sel.type === 'node') return `n${sel.node.id}`;
    if (sel.type === 'road') return `r${sel.road.id}`;
    if (sel.type === 'approach') return `a${sel.edge.id}`;
    return null;
  }
  // 교차로를 고를 때 두르는 고리의 반지름 (화면 픽셀)
  nodeRing(n) { return Math.max(n.R / this.cam.k + 5, 11); }
  // 도로 강조는 양 끝 교차로의 고리 바깥에서 끊는다. 교차로와 도로가 서로 겹치면 어디까지가 도로인지 알아보기 힘들다
  roadMarkPath(r) {
    const nodes = this.game.net.nodes, k = this.cam.k;
    const cut = (n) => (n.terminal || n.inE.length < 2 ? 0 : (this.nodeRing(n) + 4) * k);
    const pts = trimLine(r.pts, r.len, cut(nodes[r.a]), cut(nodes[r.b]));
    const p = new Path2D();
    if (pts.length >= 4) linePath(p, pts);
    return p;
  }
  drawMark(ctx, sel, color, a) {
    const cam = this.cam;
    if (!sel || a <= 0.01) return;
    const e = 1 - (1 - a) * (1 - a);
    ctx.globalAlpha = e * 0.92;
    if (sel.type === 'node') {
      const n = sel.node;
      const r = this.nodeRing(n) * (0.78 + 0.22 * e);
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
      ctx.lineWidth = Math.max(2 * (MEDIAN + LANE_W * sel.road.lanes) + 2 * cam.k, 5 * cam.k) * (0.7 + 0.3 * e);
      ctx.lineCap = 'butt';
      ctx.stroke(this.roadMarkPath(sel.road));
      ctx.lineCap = 'round';
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    } else if (sel.type === 'approach') {
      const q = sel.edge;
      const tmp = [0, 0, 0, 0];
      q.sample(Math.max(0, q.L - Math.max(1.8, 26 * cam.k)), MEDIAN + (LANE_W * q.road.lanes) / 2, tmp);
      const x0 = cam.sx(tmp[0]), y0 = cam.sy(tmp[1]);
      q.sample(q.L, MEDIAN + (LANE_W * q.road.lanes) / 2, tmp);
      const x1 = cam.sx(tmp[0]), y1 = cam.sy(tmp[1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const ang = Math.atan2(y1 - y0, x1 - x0);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x1 + Math.cos(ang) * 8, y1 + Math.sin(ang) * 8);
      ctx.lineTo(x1 + Math.cos(ang + 2.4) * 8, y1 + Math.sin(ang + 2.4) * 8);
      ctx.lineTo(x1 + Math.cos(ang - 2.4) * 8, y1 + Math.sin(ang - 2.4) * 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  drawHoverAndSelection(ctx) {
    const dt = this.lastDt;
    const FADE = 0.13;
    // 올린 대상이 바뀌면 새것은 서서히 나타나고 먼저 것은 서서히 사라진다
    const hk = this.markKey(this.hover);
    if (hk !== this.hoverKey) {
      if (this.hoverKey && this.lastHover) { this.prevHover = this.lastHover; this.prevHoverT = 1; }
      this.hoverKey = hk;
      this.hoverT = 0;
    }
    if (hk) this.lastHover = this.hover;
    this.hoverT = Math.min(1, this.hoverT + dt / FADE);
    if (this.prevHover) {
      this.prevHoverT -= dt / FADE;
      this.drawMark(ctx, this.prevHover, this.toolColor, this.prevHoverT);
      if (this.prevHoverT <= 0) this.prevHover = null;
    }
    const sk = this.markKey(this.selection);
    if (sk !== this.selKey) { this.selKey = sk; this.selT = 0; }
    this.selT = Math.min(1, this.selT + dt / FADE);
    this.drawMark(ctx, this.selection, ACCENT, this.selT);
    this.drawMark(ctx, this.hover, this.toolColor, this.hoverT);
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
      // 올리거나 고르면 도형이 부드럽게 커진다
      const want = this.hover?.site === s ? 1 : this.selection?.site === s ? 0.7 : 0;
      s.hoverF = (s.hoverF || 0) + (want - (s.hoverF || 0)) * (1 - Math.exp(-this.lastDt * 16));
      const r = this.siteBadgeSize(s) * (1 + 0.16 * s.hoverF);
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
    const ringF = this.selection?.site === s ? 1 : 0;
    s.ringF = (s.ringF || 0) + (ringF - (s.ringF || 0)) * (1 - Math.exp(-this.lastDt * 14));
    if (s.ringF > 0.02) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2.6;
      ctx.globalAlpha = s.ringF;
      ctx.beginPath();
      ctx.arc(x, y, (r * 1.5 + 4) * (0.7 + 0.3 * s.ringF), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
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
    // 주차장에 못 들어간 트럭 수
    if (k < KM_LOT) {
      let hidden = 0;
      for (const v of s.yard) if (!v.lot) hidden++;
      for (const v of s.unloadQ) if (!v.lot) hidden++;
      if (hidden) {
        ctx.font = `600 11px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = pal.halo;
        const t = `+${hidden}대`;
        ctx.strokeText(t, x + r * 1.25 + 3, y + r + 4);
        ctx.fillStyle = pal.labelStrong;
        ctx.fillText(t, x + r * 1.25 + 3, y + r + 4);
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
