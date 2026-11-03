// 지도·트럭·교차로 캔버스 렌더링. 지도 바탕은 캐시하고, 움직이는 것만 매 프레임 그린다.
import { laneOffset, LANE_W, MEDIAN, ROAD_SPEED } from '../sim/network.js';
import { GOODS, TRUCKS, fmtWon, TIER_WEIGHT } from '../game/defs.js';
import { sprite, setSpriteReadyCallback } from './art.js';

export const PALETTES = {
  day: {
    sea: '#a4d4e8', shallow: 'rgba(255,255,255,0.28)', foreign: '#dcdcd2', foreignLine: '#c4c5ba', north: '#d3d4c8',
    land: '#cfe3a6', terrain: ['#dde8ae', '#ece6a8', '#e8d396', '#d4b283'], coast: '#5f8fa3',
    shadow: 'rgba(70,60,20,0.16)', border: 'rgba(84,92,70,0.42)', fog: 'rgba(235,236,226,0.72)',
    river: '#7dbad8', lake: '#88c2de', label: '#3a4438', labelHalo: 'rgba(255,255,255,0.75)', seaLabel: '#4a8199',
    xCase: '#7a4a18', xFill: '#ffd76a', nCase: '#6b6f66', nFill: '#fffef6', rFill: '#f4efd8', closed: 'rgba(92,98,84,0.34)',
    asphalt: '#50575c', asphaltCase: '#2f3438', laneMark: 'rgba(255,255,255,0.85)', center: '#f6c02e',
    grass: '#6ea65c', project: '#7c3fd1', ferry: '#17618a', ferryOff: 'rgba(23,97,138,0.25)',
  },
  night: {
    sea: '#0c1a2b', shallow: 'rgba(120,180,220,0.08)', foreign: '#141d26', foreignLine: '#1e2a35', north: '#161f27',
    land: '#1b2a2c', terrain: ['#203230', '#263a33', '#2d4136', '#374a3c'], coast: '#34607d',
    shadow: 'rgba(0,0,0,0.3)', border: 'rgba(150,180,170,0.28)', fog: 'rgba(12,20,28,0.68)',
    river: '#23506e', lake: '#1d4562', label: '#b9c7c4', labelHalo: 'rgba(10,18,24,0.75)', seaLabel: '#4f7c98',
    xCase: '#0d1418', xFill: '#d9a441', nCase: '#0d1418', nFill: '#7f8f96', rFill: '#6a7a80', closed: 'rgba(120,140,140,0.22)',
    asphalt: '#2c3338', asphaltCase: '#12171a', laneMark: 'rgba(255,255,255,0.65)', center: '#d9a441',
    grass: '#2c5c3f', project: '#b48cff', ferry: '#5aa9d6', ferryOff: 'rgba(90,169,214,0.2)',
  },
};

const FONT = '"Gothic A1", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
const KM_CLOSE = 0.075;   // 이보다 가까우면 실제 도로처럼 그린다
const KM_TRUCK = 0.11;    // 이보다 가까우면 트럭을 자세히 그린다
const KM_MID = 0.42;
const SITE_RING = { raw: '#3f9a45', fact: '#f08a24', port: '#0b4ea2', city: '#0b6b4f' };

function ringPath(path, flat) {
  path.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
  path.closePath();
}
function linePath(path, flat) {
  path.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
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
  // 화면에 가려지는 패널을 뺀 영역에 범위를 맞춘다
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
    this.highlightRoute = null;
    this.tool = 'select';
    this.time = 0;
    this.cityCache = new Map();
    this.decorCache = new Map();
    this.pings = [];
    this.tutorTarget = null;
    this.lastCongDraw = 0;
    this.buildPaths(game.data);
    this.tmp = [0, 0, 0, 0];
    this.frameMs = 0;
    setSpriteReadyCallback(() => { this.baseDirty = true; });
  }

  setPalette(name) {
    this.palName = name;
    this.pal = PALETTES[name];
    this.baseDirty = true;
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
    P.terrain = data.terrain.map((t) => {
      const path = new Path2D();
      for (const r of t.rings) ringPath(path, r);
      return path;
    });
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

    // 얕은 바다 띠
    b.strokeStyle = pal.shallow;
    b.lineWidth = 15 * px;
    b.stroke(P.land);
    b.stroke(P.foreign);
    b.lineWidth = 7 * px;
    b.stroke(P.land);
    b.stroke(P.foreign);

    // 주변 국가
    b.fillStyle = pal.foreign;
    b.fill(P.foreign);
    b.strokeStyle = pal.foreignLine;
    b.lineWidth = 0.8 * px;
    b.stroke(P.foreign);
    b.fillStyle = pal.north;
    b.fill(P.north);
    b.stroke(P.north);
    b.fillStyle = pal.land;
    b.fill(P.southFill);

    // 남한 땅과 고도층
    b.fill(P.land);
    b.save();
    b.clip(P.land);
    const shX = 0.9 * px, shY = 1.1 * px;
    P.terrain.forEach((path, i) => {
      b.save();
      b.translate(shX, shY);
      b.fillStyle = pal.shadow;
      b.fill(path, 'evenodd');
      b.restore();
      b.fillStyle = pal.terrain[i];
      b.fill(path, 'evenodd');
    });
    b.restore();

    // 물
    b.strokeStyle = pal.river;
    b.lineWidth = Math.max(0.42, 1.5 * px);
    b.stroke(P.riverMajor);
    b.lineWidth = Math.max(0.24, 0.9 * px);
    b.stroke(P.riverMinor);
    b.fillStyle = pal.lake;
    b.fill(P.lakes);

    // 해안선과 시도 경계
    b.strokeStyle = pal.coast;
    b.lineWidth = 0.9 * px;
    b.stroke(P.land);
    b.setLineDash([5 * px, 3.5 * px]);
    b.strokeStyle = pal.border;
    b.lineWidth = 1 * px;
    for (const p of P.provinces) b.stroke(p.path);
    b.setLineDash([]);

    // 잠긴 권역 안개
    b.fillStyle = pal.fog;
    for (const p of P.provinces) if (p.region > game.stage) b.fill(p.path);

    // 독도·울릉도는 어떤 축척에서도 보이게
    this.drawDokdo(b, px);

    this.drawGround(b, k);
    this.drawRoadsOnBase(b, px, k);
    this.drawBaseLabels(b, px, k, ox, oy, s);
    this.baseDirty = false;
    this.baseMs = performance.now() - t0;
  }

  drawDokdo(b, px) {
    const d = this.game.data.dokdo, u = this.game.data.ulleung;
    b.fillStyle = this.game.regions[2].unlocked ? this.pal.terrain[2] : this.pal.foreign;
    b.strokeStyle = this.pal.coast;
    b.lineWidth = 0.8 * px;
    for (const [x, y, r] of [[d.x - 0.22, d.y + 0.02, 0.2], [d.x + 0.22, d.y - 0.04, 0.24]]) {
      b.beginPath();
      b.arc(x, y, Math.max(r, 1.6 * px), 0, Math.PI * 2);
      b.fill();
      b.stroke();
    }
    void u;
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
      b.setLineDash([6 * px, 5 * px]);
      b.strokeStyle = r.open ? pal.ferry : pal.ferryOff;
      b.lineWidth = (r.open ? 1.5 : 1) * px;
      b.stroke(this.roadPath(r));
      b.setLineDash([]);
    }
    // 잠긴 길
    b.strokeStyle = pal.closed;
    for (const r of closed) {
      b.lineWidth = (r.kind === 'x' ? 1.3 : 0.8) * px;
      b.stroke(this.roadPath(r));
    }
    // 건설 가능한 프로젝트
    b.setLineDash([3 * px, 4 * px]);
    b.strokeStyle = pal.project;
    b.lineWidth = 1.8 * px;
    for (const r of plans) b.stroke(this.roadPath(r));
    b.setLineDash([]);

    const width = (r) => 2 * (MEDIAN + LANE_W * r.lanes);
    const minPx = { x: 2.6, n: 1.5, r: 1.3, s: 1.3 };
    // 윤곽
    for (const r of open) {
      const w = Math.max(width(r), minPx[r.kind] * px);
      b.lineWidth = w + 1.3 * px;
      b.strokeStyle = close ? pal.asphaltCase : (r.kind === 'x' ? pal.xCase : pal.nCase);
      b.stroke(this.roadPath(r));
    }
    const nodesHere = net.nodes.filter((n) => !n.terminal && n.inE.length > 1 && this.nodeInView(n) && this.nodeOpen(n));
    if (k < 0.2) {
      for (const n of nodesHere) {
        b.lineWidth = this.junctionWidth(n) + 1.3 * px;
        b.strokeStyle = close ? pal.asphaltCase : pal.nCase;
        b.stroke(this.junctionPath(n));
      }
    }
    // 포장
    for (const r of open) {
      const w = Math.max(width(r), minPx[r.kind] * px);
      b.lineWidth = w;
      b.strokeStyle = close ? pal.asphalt : (r.kind === 'x' ? pal.xFill : r.kind === 'n' ? pal.nFill : pal.rFill);
      b.stroke(this.roadPath(r));
    }
    if (k < 0.2) {
      for (const n of nodesHere) {
        b.lineWidth = this.junctionWidth(n);
        b.strokeStyle = close ? pal.asphalt : pal.nFill;
        b.stroke(this.junctionPath(n));
      }
    }
    // 눌러볼 수 있는 교차로 표시
    if (k < 0.34 && !close) {
      for (const n of nodesHere) {
        if (n.control !== 'auto') continue;
        b.fillStyle = '#ffffff';
        b.strokeStyle = 'rgba(40,50,50,0.75)';
        b.lineWidth = 1.1 * px;
        b.beginPath();
        b.arc(n.x, n.y, 2.9 * px, 0, Math.PI * 2);
        b.fill();
        b.stroke();
      }
    }
    if (close) {
      // 차선
      for (const r of open) this.drawLaneMarks(b, r, px);
      for (const n of net.nodes) {
        if (!this.nodeInView(n) || !this.nodeOpen(n)) continue;
        if (n.control === 'roundabout') this.drawRoundaboutBase(b, n, px);
        if (n.control === 'interchange') this.drawInterchangeBase(b, n, px);
      }
    } else {
      // 중간 축척에서도 회전교차로·입체교차로 형태를 살짝 보여준다
      for (const n of net.nodes) {
        if (n.control === 'auto' || n.control === 'signal' || !this.nodeInView(n)) continue;
        if (n.control === 'roundabout') this.drawRoundaboutBase(b, n, px);
        else this.drawInterchangeBase(b, n, px);
      }
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
    // 중앙선 (겹선)
    b.strokeStyle = pal.center;
    b.lineWidth = Math.max(0.03, 1 * px);
    const center = [r.fwd.lanePolyline(MEDIAN * 0.55), r.bwd.lanePolyline(MEDIAN * 0.55)];
    for (const flat of center) {
      const p = new Path2D();
      linePath(p, flat);
      b.stroke(p);
    }
    if (r.lanes < 2) return;
    b.strokeStyle = pal.laneMark;
    b.lineWidth = Math.max(0.025, 0.8 * px);
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
    const close = this.cam.k < KM_CLOSE;
    const ringW = LANE_W * n.ringLanes + 0.18;
    b.lineWidth = Math.max(ringW + 1.2 * px, 3 * px);
    b.strokeStyle = close ? pal.asphaltCase : pal.nCase;
    b.beginPath(); b.arc(n.x, n.y, R, 0, Math.PI * 2); b.stroke();
    b.lineWidth = Math.max(ringW, 2 * px);
    b.strokeStyle = close ? pal.asphalt : pal.nFill;
    b.beginPath(); b.arc(n.x, n.y, R, 0, Math.PI * 2); b.stroke();
    b.fillStyle = pal.grass;
    b.beginPath(); b.arc(n.x, n.y, Math.max(R - ringW / 2 - 0.05, 1.2 * px), 0, Math.PI * 2); b.fill();
    if (close) {
      b.fillStyle = '#4c8a43';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.beginPath();
        b.arc(n.x + Math.cos(a) * R * 0.45, n.y + Math.sin(a) * R * 0.45, R * 0.13, 0, Math.PI * 2);
        b.fill();
      }
    }
  }

  drawInterchangeBase(b, n, px) {
    const pal = this.pal;
    const close = this.cam.k < KM_CLOSE;
    const r = n.R * 0.62;
    const out = n.R * 0.95;
    const rot = n.roads.length ? Math.atan2(n.roads[0].dirAt(n.id)[1], n.roads[0].dirAt(n.id)[0]) : 0;
    b.lineWidth = Math.max(0.22, 2.2 * px);
    b.strokeStyle = close ? pal.asphaltCase : pal.xCase;
    for (let i = 0; i < 4; i++) {
      const a = rot + Math.PI / 4 + (i * Math.PI) / 2;
      b.beginPath();
      b.arc(n.x + Math.cos(a) * out, n.y + Math.sin(a) * out, r, 0, Math.PI * 2);
      b.stroke();
    }
    b.lineWidth = Math.max(0.15, 1.3 * px);
    b.strokeStyle = close ? pal.asphalt : pal.xFill;
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
    b.font = `600 ${15 * dpr}px ${FONT}`;
    b.fillStyle = pal.seaLabel;
    for (const m of data.seas) {
      const txt = [...m.n].join('  ');
      b.fillText(txt, toX(m.x), toY(m.y));
    }
    // 독도·울릉도
    const label = (txt, x, y, font, dy) => {
      b.font = font;
      b.lineWidth = 3 * dpr;
      b.strokeStyle = pal.labelHalo;
      b.strokeText(txt, toX(x), toY(y) + dy * dpr);
      b.fillStyle = pal.label;
      b.fillText(txt, toX(x), toY(y) + dy * dpr);
    };
    label('독도', data.dokdo.x, data.dokdo.y, `700 ${12 * dpr}px ${FONT}`, -11);
    label('울릉도', data.ulleung.x, data.ulleung.y, `600 ${11 * dpr}px ${FONT}`, -11);

    // 지명: 축척에 따라 단계별로
    const boxes = [];
    const taken = (x0, y0, x1, y1) => {
      for (const q of boxes) if (x0 < q[2] && x1 > q[0] && y0 < q[3] && y1 > q[1]) return true;
      return false;
    };
    const siteNames = new Set(game.sites.filter((q) => q.available && q.isCity).map((q) => q.name));
    const maxRank = k > 0.75 ? 0 : k > 0.3 ? 1 : 2;
    const list = data.labels.filter((l) => l.rank <= maxRank && !siteNames.has(l.n)).sort((p, q) => p.rank - q.rank);
    const bw = this.base.width, bh = this.base.height;
    for (const l of list) {
      const x = toX(l.x), y = toY(l.y);
      if (x < 0 || y < 0 || x > bw || y > bh) continue;
      const size = (l.rank === 0 ? 12.5 : l.rank === 1 ? 11 : 10) * dpr;
      const w = l.n.length * size * 0.98;
      const h = size * 1.3;
      if (taken(x - w / 2, y - h / 2, x + w / 2, y + h / 2)) continue;
      boxes.push([x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
      b.font = `${l.rank === 0 ? 700 : 500} ${size}px ${FONT}`;
      b.lineWidth = 2.6 * dpr;
      b.strokeStyle = pal.labelHalo;
      b.strokeText(l.n, x, y);
      b.fillStyle = pal.label;
      b.globalAlpha = l.rank === 2 ? 0.75 : 0.9;
      b.fillText(l.n, x, y);
      b.globalAlpha = 1;
    }
  }

  // ── 매 프레임 ──────────────────────────────────────
  frame(dt) {
    const t0 = performance.now();
    this.time += dt;
    const cam = this.cam;
    cam.update(dt);
    const ctx = this.ctx, dpr = this.dpr;
    const view = this.baseView;

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
    this.drawTrucks(ctx, s, ox, oy);
    this.drawJunctionMarks(ctx, s, ox, oy);
    this.drawFerries(ctx, s, ox, oy);

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

  drawCongestion(ctx) {
    const cam = this.cam, net = this.game.net, k = cam.k;
    const close = k < KM_CLOSE;
    for (const e of net.edges) {
      if (e.road.kind === 'f' || !e.road.open) continue;
      if (e.count === 0 && e.cong < 0.05) continue;
      if (!this.roadInView(e.road, -this.margin)) continue;
      const c = e.cong;
      let color;
      if (c > 0.62) color = close ? 'rgba(226,44,30,0.5)' : '#e22c1e';
      else if (c > 0.3) color = close ? 'rgba(245,158,28,0.42)' : '#f59e1c';
      else if (k < 0.2) continue;
      else color = '#27a55f';
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(LANE_W * e.road.lanes, (e.road.kind === 'x' ? 1.7 : 1.3) * k);
      ctx.stroke(this.edgePath(e));
    }
  }

  drawRouteHighlight(ctx) {
    const list = this.highlightRoutes;
    if (!list || !list.length) return;
    const k = this.cam.k;
    const off = -((this.time * 26) % 18) * k;
    ctx.setLineDash([9 * k, 9 * k]);
    ctx.lineDashOffset = off;
    for (const h of list) {
      const r = h.route;
      if (!r.pathTo) continue;
      const color = GOODS[r.goods].color;
      ctx.strokeStyle = color;
      ctx.lineWidth = (h.strong ? 3.4 : 1.9) * k;
      ctx.globalAlpha = h.strong ? 1 : 0.65;
      for (const e of r.pathTo) {
        if (e.road.kind === 'f') { ctx.stroke(this.roadPath(e.road)); continue; }
        ctx.stroke(this.edgePath(e));
      }
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  truckColor(v) {
    return v.goods ? GOODS[v.goods].color : '#5d6870';
  }

  drawTrucks(ctx, s, ox, oy) {
    const cam = this.cam, k = cam.k, game = this.game, traffic = game.traffic;
    const tmp = this.tmp;
    const halfW = (cam.W / 2 + 30) * k, halfH = (cam.H / 2 + 30) * k;
    const minX = cam.cx - halfW, maxX = cam.cx + halfW, minY = cam.cy - halfH, maxY = cam.cy + halfH;
    const detail = k < KM_TRUCK;
    const far = k > KM_MID;
    const buckets = new Map();
    const emit = (v, x, y, tx, ty) => {
      if (x < minX || x > maxX || y < minY || y > maxY) return;
      if (detail) { this.drawTruckDetail(ctx, v, x, y, tx, ty, k); return; }
      const col = this.truckColor(v);
      let arr = buckets.get(col);
      if (!arr) { arr = []; buckets.set(col, arr); }
      arr.push(x, y, tx, ty, v.len);
    };
    // 차로 위
    for (const lane of traffic.activeLanes) {
      const e = lane.edge;
      const r = e.road;
      if (r.bb[2] < minX || r.bb[0] > maxX || r.bb[3] < minY || r.bb[1] > maxY) continue;
      const off = laneOffset(lane.index);
      const vs = lane.veh;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        e.sample(v.s, off, tmp, v.seg);
        emit(v, tmp[0], tmp[1], tmp[2], tmp[3]);
      }
    }
    // 교차로 안
    for (const c of traffic.activeConns) {
      const vs = c.veh;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        c.sample(v.s, tmp);
        emit(v, tmp[0], tmp[1], tmp[2], tmp[3]);
      }
    }
    // 축약 표현
    for (const [col, arr] of buckets) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 5) {
        const x = arr[i], y = arr[i + 1], tx = arr[i + 2], ty = arr[i + 3], len = arr[i + 4];
        if (far) {
          const d = 2.6 * k;
          ctx.rect(x - d / 2, y - d / 2, d, d);
        } else {
          const l = Math.max(len, 3.2 * k), w = Math.max(0.22, 2.1 * k) / 2;
          const nx = -ty * w, ny = tx * w;
          ctx.moveTo(x + nx, y + ny);
          ctx.lineTo(x - nx, y - ny);
          ctx.lineTo(x - tx * l - nx, y - ty * l - ny);
          ctx.lineTo(x - tx * l + nx, y - ty * l + ny);
          ctx.closePath();
        }
      }
      ctx.fill();
    }
  }

  drawTruckDetail(ctx, v, x, y, tx, ty, k) {
    const m = v.model;
    // 먼 축척에서도 트럭이 잘 보이도록 최소 크기를 둔다
    const inflate = Math.max(1, (3.4 * k) / m.width);
    const L = m.len * Math.min(inflate, 1.5), W = m.width * inflate;
    ctx.save();
    ctx.transform(tx, ty, -ty, tx, x, y);
    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-L + 0.03, -W / 2 + 0.04, L, W);
    const cabL = Math.min(0.26, L * 0.28);
    const boxCol = v.goods ? GOODS[v.goods].color : '#c7cdd2';
    // 적재함
    ctx.fillStyle = boxCol;
    ctx.fillRect(-L, -W / 2, L - cabL - 0.03, W);
    if (m.id === 'trailer') {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(-L, -W / 2, L - cabL - 0.03, W * 0.14);
    }
    if (m.id === 'express') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-L * 0.8, -W / 2, L * 0.25, W);
    }
    if (!v.goods) {
      // 빈 적재함 표시
      ctx.strokeStyle = 'rgba(40,46,50,0.55)';
      ctx.lineWidth = 0.02;
      ctx.strokeRect(-L + 0.03, -W / 2 + 0.03, L - cabL - 0.09, W - 0.06);
    }
    // 운전석
    const cabCol = m.id === 'hauler' ? '#1f6fd1' : m.id === 'cargo' ? '#17a673' : m.id === 'trailer' ? '#d9402f' : '#00857a';
    ctx.fillStyle = cabCol;
    ctx.fillRect(-cabL, -W / 2, cabL, W);
    ctx.fillStyle = '#d6edf5';
    ctx.fillRect(-cabL * 0.42, -W / 2 + 0.025, cabL * 0.32, W - 0.05);
    // 제동등
    if (v.v < 0.4) {
      ctx.fillStyle = '#ff3b30';
      ctx.fillRect(-L - 0.01, -W / 2, 0.035, 0.05);
      ctx.fillRect(-L - 0.01, W / 2 - 0.05, 0.035, 0.05);
    }
    ctx.restore();
    void k;
  }

  drawFerries(ctx) {
    const game = this.game, k = this.cam.k;
    const tmp = this.tmp;
    for (const fy of game.traffic.ferries) {
      if (!fy.road.open) continue;
      const e = fy.road.fwd;
      const pos = Math.max(0.01, Math.min(fy.len - 0.01, fy.pos));
      e.sample(pos, 0, tmp);
      const dir = fy.dir;
      const tx = tmp[2] * dir, ty = tmp[3] * dir;
      const L = Math.max(2.4, 15 * k), W = Math.max(0.8, 6 * k);
      ctx.save();
      ctx.transform(tx, ty, -ty, tx, tmp[0], tmp[1]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#17618a';
      ctx.lineWidth = 1 * k;
      ctx.beginPath();
      ctx.moveTo(L / 2, 0);
      ctx.lineTo(L / 4, -W / 2);
      ctx.lineTo(-L / 2, -W / 2);
      ctx.lineTo(-L / 2, W / 2);
      ctx.lineTo(L / 4, W / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#17618a';
      const load = fy.cargo.length / fy.cap;
      ctx.fillRect(-L * 0.42, -W * 0.28, L * 0.62 * load, W * 0.56);
      ctx.restore();
    }
  }

  signalColor(n, e) {
    if (!n.allow) return '#e8402f';
    const list = e.turnList || [];
    if (n.clearT > 0) {
      for (const t of list) if (n.prevAllow[t.id] && t.kind !== 'R') return '#f6b01e';
      return '#e8402f';
    }
    for (const t of list) if (n.allow[t.id] && t.kind !== 'R') return '#27c46b';
    return '#e8402f';
  }

  drawJunctionMarks(ctx, s, ox, oy) {
    const cam = this.cam, k = cam.k, net = this.game.net;
    const tmp = this.tmp;
    const close = k < KM_CLOSE;
    const midClose = k < 0.3;
    const nodes = net.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.terminal || !this.nodeInView(n, -this.margin + 30)) continue;
      if (!this.nodeOpen(n)) continue;
      // 정체 경고
      if (n.waiting >= 6) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 5 + i);
        const R = Math.max(n.R, 5 * k) + (3 + Math.min(10, n.waiting * 0.28) + pulse * 2.5) * k;
        ctx.strokeStyle = n.stuckT > 30 ? '#b0120a' : '#e22c1e';
        ctx.globalAlpha = 0.35 + pulse * 0.4;
        ctx.lineWidth = 2.2 * k;
        ctx.beginPath(); ctx.arc(n.x, n.y, R, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
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
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.moveTo(px + nx * half, py + ny * half);
          ctx.lineTo(px - nx * half, py - ny * half);
          ctx.stroke();
          const sx = px + nx * (half + 0.2), sy = py + ny * (half + 0.2);
          if (n.control === 'signal') {
            const col = this.signalColor(n, e);
            this.drawSignalHead(ctx, sx - tx * 0.1, sy - ty * 0.1, tx, ty, col);
          } else if (n.control === 'auto' && e.sign) {
            this.drawWorldSprite(ctx, e.sign === 1 ? 't_yield' : 't_stop', sx - tx * 0.3, sy - ty * 0.3, 0.72, k);
          } else if (n.control === 'auto' && !e.sign && n.major.size && !n.inE.some((q) => q.sign > 0) && !n.major.has(e.id)) {
            this.drawWorldSprite(ctx, 't_yield', sx - tx * 0.3, sy - ty * 0.3, 0.5, k);
          }
        }
      } else if (midClose) {
        this.drawNodeIcon(ctx, n, k, 15);
      } else if (n.control !== 'auto' || n.inE.some((e) => e.sign > 0)) {
        this.drawNodeIcon(ctx, n, k, 11);
      }
    }
  }

  drawNodeIcon(ctx, n, k, size) {
    if (n.control === 'signal') {
      const w = size * k, h = size * 0.42 * k;
      ctx.fillStyle = '#23282c';
      ctx.fillRect(n.x - w / 2, n.y - h / 2, w, h);
      ctx.fillStyle = n.clearT > 0 ? '#f6b01e' : '#27c46b';
      ctx.beginPath();
      ctx.arc(n.x, n.y, h * 0.34, 0, Math.PI * 2);
      ctx.fill();
    } else if (n.control === 'auto' && n.inE.some((e) => e.sign > 0)) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#d9352b';
      ctx.lineWidth = 1.6 * k;
      const r = size * 0.36 * k;
      ctx.beginPath();
      ctx.moveTo(n.x - r, n.y - r * 0.7);
      ctx.lineTo(n.x + r, n.y - r * 0.7);
      ctx.lineTo(n.x, n.y + r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  drawSignalHead(ctx, x, y, tx, ty, col) {
    const W = 0.34, H = 0.12;
    ctx.save();
    ctx.transform(tx, ty, -ty, tx, x, y);
    ctx.fillStyle = '#1c2023';
    ctx.fillRect(-H / 2, -W / 2, H, W);
    ctx.fillStyle = col;
    ctx.beginPath();
    const off = col === '#27c46b' ? W * 0.28 : col === '#f6b01e' ? 0 : -W * 0.28;
    ctx.arc(0, off, H * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawWorldSprite(ctx, name, x, y, sizeKm, k) {
    const px = Math.max(10, sizeKm / k);
    const img = sprite(name, Math.min(96, Math.ceil(px * this.dpr)));
    if (!img) return;
    const w = px * k;
    ctx.drawImage(img, x - w / 2, y - w / 2, w, w);
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
        ctx.lineWidth = 3;
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
        const n = sel.node;
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
        void n;
      }
      ctx.globalAlpha = 1;
    };
    mark(this.selection, '#0b6b4f', 0.95);
    mark(this.hover, this.toolColor || '#f6b01e', 0.9);
  }

  // ── 거점 ───────────────────────────────────────────
  siteBadgeSize(s) {
    const k = this.cam.k;
    if (k > 0.62) return s.isCity ? 3.6 + Math.min(3, Math.sqrt(s.pop) / 7) : 3;
    const base = s.isCity ? 15 : 13.5;
    const f = k > 0.42 ? 0.68 : k > 0.22 ? 0.86 : k > 0.1 ? 1 : k > 0.05 ? 1.2 : 1.42;
    return base * f;
  }

  drawSites(ctx) {
    const game = this.game, cam = this.cam, k = cam.k;
    const labelBoxes = [];
    const order = game.sites.filter((s) => s.region <= game.stage || s.available).sort((a, b) => (a.isCity === b.isCity ? a.y - b.y : a.isCity ? -1 : 1));
    for (const s of order) {
      const x = cam.sx(s.x), y = cam.sy(s.y);
      if (x < -60 || y < -60 || x > cam.W + 60 || y > cam.H + 60) continue;
      if (!s.available) {
        if (s.stage > game.stage || k > 0.62) continue;
        // 곧 열릴 거점
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.strokeStyle = 'rgba(60,70,60,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(3, this.siteBadgeSize(s) * 0.42), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        continue;
      }
      const r = this.siteBadgeSize(s);
      this.drawBadge(ctx, s, x, y, r);
      if (k < 0.24 || (s.isCity && (k < 0.6 || s.pop > 90)) || this.selection?.site === s || this.hover?.site === s || this.tutorTarget === s) {
        this.drawSiteLabel(ctx, s, x, y, r, labelBoxes);
      }
      // 작은 트럭 대기 표시
      if (k < 0.3 && s.yard.length > 1) {
        ctx.font = `800 ${10.5}px ${FONT}`;
        const t = `${s.yard.length}`;
        const w = ctx.measureText(t).width + 8;
        ctx.fillStyle = '#23282c';
        this.roundRect(ctx, x + r * 0.55, y - r - 4, w, 15, 7);
        ctx.fill();
        ctx.fillStyle = '#f6b01e';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t, x + r * 0.55 + w / 2, y - r + 3.5);
      }
    }
    if (this.tutorTarget) {
      const s = this.tutorTarget;
      const x = cam.sx(s.x), y = cam.sy(s.y);
      const pulse = (this.time * 1.3) % 1;
      ctx.strokeStyle = '#f6b01e';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 1 - pulse;
      ctx.beginPath();
      ctx.arc(x, y, 18 + pulse * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawBadge(ctx, s, x, y, r) {
    const game = this.game;
    const sel = this.selection?.site === s;
    const ringCol = s.isCity ? SITE_RING.city : s.kind === 'port' ? SITE_RING.port : s.inputs ? SITE_RING.fact : SITE_RING.raw;
    if (r < 6) {
      // 전국 축척: 점으로 표시
      ctx.fillStyle = s.isCity ? '#ffffff' : ringCol;
      ctx.strokeStyle = s.isCity ? '#0b4f3a' : 'rgba(255,255,255,0.9)';
      ctx.lineWidth = s.isCity ? 1.7 : 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (sel) {
        ctx.strokeStyle = '#0b6b4f';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }
    // 그림자
    ctx.fillStyle = 'rgba(30,40,30,0.24)';
    ctx.beginPath();
    ctx.arc(x + 0.8, y + 1.4, r + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ringCol;
    ctx.lineWidth = Math.max(1.4, r * 0.15);
    ctx.stroke();
    // 재고 게이지
    if (s.produces && r >= 8) {
      const frac = s.stock / game.siteCap(s);
      ctx.strokeStyle = 'rgba(0,0,0,0.14)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r + 3.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = frac > 0.85 ? '#e22c1e' : frac > 0.5 ? '#f59e1c' : '#27a55f';
      ctx.beginPath();
      ctx.arc(x, y, r + 3.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.01, frac));
      ctx.stroke();
    }
    if (sel) {
      ctx.strokeStyle = '#0b6b4f';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (r >= 6) {
      const img = sprite(s.isCity && s.kind !== 'dokdo' ? 'city' : s.kind, Math.ceil(r * 2 * this.dpr));
      if (img) {
        const sz = r * 1.42;
        ctx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz);
      }
    }
  }

  drawSiteLabel(ctx, s, x, y, r, boxes) {
    const city = s.isCity;
    const size = city ? (this.cam.k > 0.42 ? 11.5 : 13) : 11;
    ctx.font = `${city ? 800 : 700} ${size}px ${FONT}`;
    const text = s.name;
    const w = ctx.measureText(text).width;
    const h = size + 6;
    const lx = x - w / 2 - 5, ly = y + r + (s.produces ? 6 : 3);
    const box = [lx, ly, lx + w + 10, ly + h];
    for (const q of boxes) if (box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]) { if (this.selection?.site !== s && this.hover?.site !== s) return; }
    boxes.push(box);
    if (city) {
      ctx.fillStyle = '#0b6b4f';
      this.roundRect(ctx, lx, ly, w + 10, h, 3.5);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      this.roundRect(ctx, lx + 1, ly + 1, w + 8, h - 2, 2.5);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, ly + h / 2 + 0.5);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeText(text, x, ly + h / 2);
      ctx.fillStyle = '#20282c';
      ctx.fillText(text, x, ly + h / 2);
    }
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

  // 도시 건물과 거점 풍경은 도로 아래에 깔린다 (월드 좌표)
  drawGround(b, k) {
    const game = this.game;
    if (k >= 0.34) return;
    for (const s of game.sites) {
      if (!s.available) continue;
      if (!this.nodeInView(game.net.nodes[s.node], 120)) continue;
      if (s.isCity && s.kind === 'city') {
        const scale = Math.min(1.5, Math.max(0.5, 0.11 / k));
        const key = `${s.id}:${s.cityStage}`;
        let spr = this.cityCache.get(key);
        if (!spr) { spr = makeCitySprite(s); this.cityCache.set(key, spr); }
        const w = (spr.width / 2) * scale * k, h = (spr.height / 2) * scale * k;
        b.drawImage(spr, s.x - w / 2, s.y - h * 0.62, w, h);
      } else if (!s.isCity && k < 0.2) {
        let spr = this.decorCache.get(s.id);
        if (!spr) { spr = makeSiteDecor(s); this.decorCache.set(s.id, spr); }
        const scale = Math.min(1.6, 0.08 / k);
        const w = (spr.width / 2) * scale * k, h = (spr.height / 2) * scale * k;
        b.drawImage(spr, s.x - w / 2, s.y - h / 2, w, h);
      }
    }
  }

  drawPings(ctx, dt) {
    const cam = this.cam;
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t += dt;
      if (p.t > 1.4) { this.pings.splice(i, 1); continue; }
      const u = p.t / 1.4;
      ctx.strokeStyle = p.color || '#0b6b4f';
      ctx.globalAlpha = 1 - u;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cam.sx(p.x), cam.sy(p.y), 8 + u * 42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ping(x, y, color) { this.pings.push({ x, y, color, t: 0 }); }

  drawFloats(ctx) {
    const cam = this.cam, game = this.game;
    if (cam.k > 0.55) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 12.5px ${FONT}`;
    ctx.lineWidth = 3;
    for (const f of game.floats) {
      const x = cam.sx(f.x), y = cam.sy(f.y) - 22 - f.t * 26;
      if (x < 0 || y < 0 || x > cam.W || y > cam.H) continue;
      ctx.globalAlpha = Math.min(1, 1.6 - f.t);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.tag === 'ontime' ? '#0b7a45' : f.tag === 'late' || f.overflow ? '#c6281c' : '#23282c';
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
        const r = this.siteBadgeSize(s) + 6;
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
        const r = Math.max(n.R / cam.k, 13);
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
        if (!r.open || (r.kind === 'f' && tool !== 'select')) continue;
        if (wx < r.bb[0] - tol || wx > r.bb[2] + tol || wy < r.bb[1] - tol || wy > r.bb[3] + tol) continue;
        const pts = r.pts;
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const d = segDist(wx, wy, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
          const dd = d - (MEDIAN + LANE_W * r.lanes);
          if (dd < bd) { bd = dd; best = r; }
        }
      }
      if (best) return { type: 'road', road: best };
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

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 도시 건물 군락. stage 0 마을 ~ 5 초고층
function makeCitySprite(s) {
  const W = 340, H = 300;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = hash(s.id);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const st = s.cityStage;
  const popF = Math.min(1.5, 0.75 + Math.sqrt(s.pop) / 16);
  const count = Math.round((14 + st * 12) * popF);
  const list = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.6);
    const px = W / 2 + Math.cos(a) * rr * 140;
    const py = H * 0.68 + Math.sin(a) * rr * 72;
    const central = 1 - rr;
    let type = 0;
    const roll = rnd() + central * 0.55 + st * 0.11;
    if (st >= 1 && roll > 0.9) type = 1;
    if (st >= 2 && roll > 1.06) type = 2;
    if (st >= 3 && roll > 1.22) type = 3;
    if (st >= 4 && roll > 1.34) type = 4;
    list.push({ x: px, y: py, type, central });
  }
  // 시가지 바닥
  const groundR = 150 * (0.72 + st * 0.07);
  const grd = g.createRadialGradient(W / 2, H * 0.68, 8, W / 2, H * 0.68, groundR);
  grd.addColorStop(0, 'rgba(120,118,104,0.55)');
  grd.addColorStop(0.65, 'rgba(150,146,126,0.32)');
  grd.addColorStop(1, 'rgba(150,146,126,0)');
  g.fillStyle = grd;
  g.save();
  g.translate(W / 2, H * 0.68);
  g.scale(1, 0.55);
  g.translate(-W / 2, -H * 0.68);
  g.beginPath();
  g.arc(W / 2, H * 0.68, groundR, 0, Math.PI * 2);
  g.fill();
  g.restore();
  list.sort((p, q) => p.y - q.y);
  for (const b of list) {
    if (b.type === 0) drawHouse(g, b.x, b.y, rnd);
    else if (b.type === 1) drawBox(g, b.x, b.y, 13 + rnd() * 5, 12 + rnd() * 10, ['#e7d8bd', '#d7c4a4', '#bfa987'][Math.floor(rnd() * 3)], 3, rnd);
    else if (b.type === 2) drawBox(g, b.x, b.y, 22 + rnd() * 6, 34 + rnd() * 22, ['#f1eee6', '#e4e8ea', '#dfd9cc'][Math.floor(rnd() * 3)], 6, rnd);
    else if (b.type === 3) drawBox(g, b.x, b.y, 16 + rnd() * 6, 60 + rnd() * 40, ['#b6cfe0', '#9dbdd4', '#c6d6df'][Math.floor(rnd() * 3)], 9, rnd);
    else drawBox(g, b.x, b.y, 17 + rnd() * 8, 96 + rnd() * 70, ['#5f8fb5', '#4a7ba3', '#7ca6c4'][Math.floor(rnd() * 3)], 14, rnd);
  }
  return c;
}

// 거점 종류별 풍경 스프라이트
function makeSiteDecor(s) {
  const W = 260, H = 200;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = hash(s.id + 'decor');
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cx = W / 2, cy = H / 2;
  const spot = (minR = 34, maxR = 118) => {
    const a = rnd() * Math.PI * 2;
    const rr = minR + rnd() * (maxR - minR);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.72];
  };
  const tree = (x, y, r, col, trunk = '#6b4423') => {
    g.fillStyle = 'rgba(20,40,20,0.2)';
    g.beginPath(); g.ellipse(x + r * 0.5, y + r * 0.4, r, r * 0.55, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = trunk;
    g.fillRect(x - r * 0.16, y - r * 0.2, r * 0.32, r * 0.75);
    g.fillStyle = col;
    g.beginPath(); g.arc(x, y - r * 0.5, r, 0, Math.PI * 2); g.fill();
  };
  const pine = (x, y, r, col) => {
    g.fillStyle = 'rgba(20,40,20,0.2)';
    g.beginPath(); g.ellipse(x + r * 0.4, y + 1, r * 0.9, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.moveTo(x, y - r * 2.4); g.lineTo(x + r, y); g.lineTo(x - r, y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.beginPath(); g.moveTo(x, y - r * 2.4); g.lineTo(x, y); g.lineTo(x - r, y); g.closePath(); g.fill();
  };
  const shed = (x, y, w, h, col, roof) => {
    g.fillStyle = 'rgba(20,30,20,0.22)';
    g.fillRect(x + 3, y + 3, w, h);
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
    g.fillStyle = roof;
    g.fillRect(x, y, w, h * 0.35);
  };
  const stack = (x, y, r, h, col) => {
    g.fillStyle = col;
    g.fillRect(x - r, y - h, r * 2, h);
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath(); g.ellipse(x, y - h, r, r * 0.45, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.beginPath(); g.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI); g.fill();
  };
  const k = s.kind;
  if (k === 'orchard') {
    const col = s.def.g === 'fruit' && s.id.includes('tangerine') ? '#e8902a' : '#d9402f';
    for (let row = -3; row <= 3; row++) {
      for (let c2 = -4; c2 <= 4; c2++) {
        if (Math.hypot(c2 * 0.8, row) < 1.4) continue;
        const x = cx + c2 * 27 + (row % 2) * 8, y = cy + row * 24;
        tree(x, y, 8.5, '#3f8f45');
        g.fillStyle = col;
        for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x - 5 + rnd() * 10, y - 8 + rnd() * 8, 1.8, 0, Math.PI * 2); g.fill(); }
      }
    }
  } else if (k === 'field') {
    const cols = ['#e3c652', '#cdd65f', '#d9b844', '#b9cf58'];
    for (let i = -2; i <= 1; i++) {
      for (let j = -2; j <= 1; j++) {
        const x = cx + i * 58 + 3, y = cy + j * 46 + 3;
        if (Math.hypot(x + 26 - cx, y + 20 - cy) < 30) continue;
        g.fillStyle = cols[Math.floor(rnd() * cols.length)];
        g.fillRect(x, y, 52, 40);
        g.strokeStyle = 'rgba(120,100,30,0.35)';
        g.lineWidth = 1.2;
        for (let q = 6; q < 40; q += 7) { g.beginPath(); g.moveTo(x + 1, y + q); g.lineTo(x + 51, y + q); g.stroke(); }
      }
    }
  } else if (k === 'forest') {
    const list = [];
    for (let i = 0; i < 46; i++) list.push(spot(30, 122));
    list.sort((p, q) => p[1] - q[1]);
    for (const [x, y] of list) pine(x, y, 7 + rnd() * 4, rnd() < 0.5 ? '#2c7a3f' : '#1f6634');
  } else if (k === 'quarry') {
    g.fillStyle = '#b9bcb6';
    g.beginPath(); g.ellipse(cx, cy, 118, 82, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#a2a69f';
    g.beginPath(); g.ellipse(cx, cy, 88, 60, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8b8f89';
    g.beginPath(); g.ellipse(cx, cy, 60, 40, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 14; i++) {
      const [x, y] = spot(46, 100);
      g.fillStyle = rnd() < 0.5 ? '#d7d9d3' : '#74786f';
      g.beginPath(); g.arc(x, y, 3 + rnd() * 4, 0, Math.PI * 2); g.fill();
    }
  } else if (k === 'sea' || k === 'salt') {
    if (k === 'salt') {
      for (let i = -3; i <= 2; i++) {
        for (let j = -2; j <= 1; j++) {
          const x = cx + i * 40 + 1, y = cy + j * 34 + 1;
          if (Math.hypot(x + 18 - cx, y + 14 - cy) < 28) continue;
          g.fillStyle = rnd() < 0.5 ? '#bfe6f2' : '#d9f1f7';
          g.fillRect(x, y, 36, 28);
          if (rnd() < 0.4) { g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x + 8, y + 22); g.lineTo(x + 18, y + 8); g.lineTo(x + 28, y + 22); g.closePath(); g.fill(); }
        }
      }
    } else {
      g.fillStyle = '#7fb9d3';
      g.fillRect(cx + 22, cy - 12, 96, 8);
      g.fillRect(cx + 22, cy + 20, 86, 8);
      for (let i = 0; i < 7; i++) {
        const x = cx + 36 + rnd() * 78, y = cy - 42 + rnd() * 96;
        g.fillStyle = rnd() < 0.5 ? '#d9402f' : '#1f6fd1';
        g.beginPath(); g.moveTo(x - 11, y); g.lineTo(x + 11, y); g.lineTo(x + 7, y + 6); g.lineTo(x - 7, y + 6); g.closePath(); g.fill();
        g.fillStyle = '#fff';
        g.fillRect(x - 3, y - 5, 6, 5);
      }
      for (let i = 0; i < 5; i++) shed(cx - 100 + rnd() * 70, cy - 56 + i * 24, 26, 15, '#e7dfca', '#3f6fb5');
    }
  } else if (k === 'port') {
    g.fillStyle = '#9aa3a8';
    g.fillRect(cx - 120, cy - 74, 240, 148);
    const cols = ['#d9402f', '#1f6fd1', '#f08a24', '#17a673', '#f6b01e', '#8e5bc2'];
    for (let i = 0; i < 44; i++) {
      const col = i % 11, row = Math.floor(i / 11);
      const x = cx - 112 + col * 20, y = cy - 66 + row * 16;
      if (Math.hypot(x + 8 - cx, y + 5 - cy) < 32) continue;
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.fillRect(x, y, 17, 10);
      g.fillStyle = 'rgba(0,0,0,0.14)';
      g.fillRect(x, y + 7, 17, 3);
    }
    for (let i = 0; i < 4; i++) {
      const x = cx - 96 + i * 62, y = cy + 66;
      g.fillStyle = '#0b4ea2';
      g.fillRect(x, y - 36, 5, 36);
      g.fillRect(x + 24, y - 36, 5, 36);
      g.fillRect(x - 10, y - 40, 50, 5);
    }
  } else if (k === 'shipyard') {
    g.fillStyle = '#9aa3a8';
    g.fillRect(cx - 124, cy - 70, 248, 140);
    for (let i = 0; i < 2; i++) {
      const y = cy - 52 + i * 84;
      g.fillStyle = '#1f5fa8';
      g.beginPath(); g.moveTo(cx - 110, y); g.lineTo(cx - 34, y); g.lineTo(cx - 34, y + 22); g.lineTo(cx - 102, y + 22); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(cx + 34, y); g.lineTo(cx + 110, y); g.lineTo(cx + 102, y + 22); g.lineTo(cx + 34, y + 22); g.closePath(); g.fill();
      g.fillStyle = '#d9402f';
      g.fillRect(cx - 108, y + 18, 72, 4);
      g.fillRect(cx + 36, y + 18, 70, 4);
    }
    g.fillStyle = '#f6b01e';
    g.fillRect(cx - 124, cy - 8, 248, 6);
  } else {
    // 공장 지대
    const roofs = { foodplant: '#f08a24', sawmill: '#94633a', furniture: '#b5651d', cementplant: '#7f8c96', steelmill: '#3f566b', chemplant: '#8e5bc2', partsplant: '#3f6fb5', appliance: '#17a673', carplant: '#d43f5e', fab: '#00857a' };
    const roof = roofs[k] || '#7f8c96';
    g.fillStyle = 'rgba(120,120,110,0.42)';
    g.fillRect(cx - 108, cy - 68, 216, 136);
    const spots = [[-98, -60], [-36, -60], [30, -60], [-98, -14], [46, -14], [-98, 30], [-36, 34], [30, 30]];
    for (const [dx, dy] of spots) {
      const w = 46 + rnd() * 18, h = 26 + rnd() * 8;
      shed(cx + dx, cy + dy, w, h, '#e4e1d6', roof);
    }
    if (k === 'steelmill' || k === 'cementplant' || k === 'chemplant') {
      for (let i = 0; i < 4; i++) stack(cx - 60 + i * 40, cy + 66, 8, 40 + rnd() * 26, k === 'chemplant' ? '#a57bd6' : k === 'steelmill' ? '#4c6277' : '#a9b3ba');
    }
    if (k === 'sawmill') {
      for (let i = 0; i < 16; i++) {
        const [x, y] = spot(50, 110);
        g.fillStyle = '#94633a';
        g.fillRect(x - 12, y - 3, 24, 6);
        g.fillStyle = '#d9ae79';
        g.beginPath(); g.arc(x + 12, y, 3, 0, Math.PI * 2); g.fill();
      }
    }
    if (k === 'carplant') {
      const cols = ['#d43f5e', '#ffffff', '#23282c', '#1f6fd1'];
      for (let i = 0; i < 30; i++) {
        g.fillStyle = cols[Math.floor(rnd() * cols.length)];
        g.fillRect(cx - 102 + (i % 15) * 14, cy + 58 + Math.floor(i / 15) * 9, 11, 6);
      }
    }
  }
  return c;
}

function drawHouse(g, x, y, rnd) {
  const w = 9 + rnd() * 4, h = 6 + rnd() * 2;
  const roofs = ['#c8553d', '#b5482f', '#3f6fb5', '#2f7a68'];
  const roof = roofs[Math.floor(rnd() * roofs.length)];
  g.fillStyle = '#f2e9d8';
  g.fillRect(x - w / 2, y - h, w, h);
  g.fillStyle = '#d9cdb6';
  g.fillRect(x + w / 2, y - h, 3, h);
  g.fillStyle = roof;
  g.beginPath();
  g.moveTo(x - w / 2 - 1.5, y - h);
  g.lineTo(x, y - h - 5.5);
  g.lineTo(x + w / 2 + 1.5, y - h);
  g.closePath();
  g.fill();
}

function drawBox(g, x, y, w, h, color, rows, rnd) {
  const d = w * 0.42;
  // 그림자
  g.fillStyle = 'rgba(30,40,30,0.18)';
  g.beginPath();
  g.moveTo(x - w / 2, y);
  g.lineTo(x + w / 2 + d, y);
  g.lineTo(x + w / 2 + d + h * 0.2, y + h * 0.1);
  g.lineTo(x - w / 2 + h * 0.2, y + h * 0.1);
  g.closePath();
  g.fill();
  // 측면
  g.fillStyle = shade(color, -0.22);
  g.beginPath();
  g.moveTo(x + w / 2, y);
  g.lineTo(x + w / 2 + d, y - d * 0.5);
  g.lineTo(x + w / 2 + d, y - h - d * 0.5);
  g.lineTo(x + w / 2, y - h);
  g.closePath();
  g.fill();
  // 정면
  g.fillStyle = color;
  g.fillRect(x - w / 2, y - h, w, h);
  // 옥상
  g.fillStyle = shade(color, 0.12);
  g.beginPath();
  g.moveTo(x - w / 2, y - h);
  g.lineTo(x - w / 2 + d, y - h - d * 0.5);
  g.lineTo(x + w / 2 + d, y - h - d * 0.5);
  g.lineTo(x + w / 2, y - h);
  g.closePath();
  g.fill();
  // 창문
  g.fillStyle = 'rgba(40,70,100,0.42)';
  const cols = Math.max(2, Math.floor(w / 6));
  for (let r = 0; r < rows; r++) {
    const wy = y - h + 3 + (r * (h - 5)) / rows;
    for (let i = 0; i < cols; i++) {
      if (rnd() < 0.12) continue;
      g.fillRect(x - w / 2 + 2 + (i * (w - 3)) / cols, wy, Math.max(1.6, (w - 3) / cols - 1.5), Math.max(1.4, (h - 5) / rows - 1.5));
    }
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

void ROAD_SPEED; void TRUCKS; void fmtWon; void TIER_WEIGHT;
