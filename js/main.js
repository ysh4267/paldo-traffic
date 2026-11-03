// 부팅, 게임 루프, 입력 처리, 저장
import { Game } from './game/game.js';
import { Renderer } from './render/renderer.js';
import { UI } from './ui/ui.js';
import { Sound } from './ui/audio.js';
import { fmtWon } from './game/defs.js';

const SAVE_KEY = 'paldo-traffic-save-v1';
const SETTINGS_KEY = 'paldo-traffic-settings';
const STEP = 1 / 60;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 저장소를 못 쓰는 환경 */ } },
};

class App {
  constructor(data) {
    this.data = data;
    this.sound = new Sound();
    this.speed = 1;
    this.lastSpeed = 1;
    this.acc = 0;
    this.last = performance.now();
    this.uiT = 0;
    this.saveT = 0;
    this.miniT = 0;
    this.started = false;
    this.hiddenAt = 0;
    this.pointers = new Map();
    this.canvas = document.getElementById('map');
    this.mini = document.getElementById('minimap');
    this.loadSettings();
    const raw = store.get(SAVE_KEY);
    let save = null;
    if (raw) { try { save = JSON.parse(raw); } catch { save = null; } }
    this.boot(save);
    this.bindInput();
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('beforeunload', () => this.save());
    requestAnimationFrame((t) => this.loop(t));
  }

  boot(save) {
    if (save) {
      this.game = Game.restore(this.data, save);
    } else {
      this.game = new Game(this.data);
    }
    if (this.renderer) {
      this.renderer.game = this.game;
      this.renderer.baseDirty = true;
    } else {
      this.renderer = new Renderer(this.canvas, this.game);
      if (this.settings.pal) this.renderer.setPalette(this.settings.pal);
    }
    this.ui = new UI(this);
    this.onResize();
    this.applyCameraPadding();
    this.fitToStage(0);
    this.ui.renderAll();
    if (save) {
      this.started = true;
      const away = (Date.now() - (save.t || Date.now())) / 1000;
      if (away > 90 && this.game.income > 0) {
        const res = this.game.applyOffline(away);
        this.ui.openModal('offline', res);
      }
    } else {
      this.ui.openModal('welcome');
      this.fitBoxAll(0);
    }
    this.game.events.length = 0;
    this.drawMiniBase();
    this.drawMini();
  }

  startFresh() {
    this.started = true;
    this.game.flags.tutorial = true;
    this.fitToStage(1.4);
    this.save();
  }

  resetGame() {
    this.noSave = true;
    store.del(SAVE_KEY);
    window.location.reload();
  }

  importSave(text) {
    try {
      const json = decodeURIComponent(escape(atob(text)));
      const parsed = JSON.parse(json);
      if (!parsed || parsed.v === undefined || !Array.isArray(parsed.pts)) throw new Error('형식 오류');
      this.noSave = true;
      store.set(SAVE_KEY, JSON.stringify(parsed));
      window.location.reload();
    } catch {
      this.ui.toast('warn', '저장 코드를 읽을 수 없습니다', '코드 전체를 빠짐없이 붙여넣었는지 확인하세요');
    }
  }

  save() {
    if (!this.started || !this.game || this.noSave) return;
    store.set(SAVE_KEY, JSON.stringify(this.game.serialize()));
  }

  loadSettings() {
    this.settings = {};
    try { this.settings = JSON.parse(store.get(SETTINGS_KEY)) || {}; } catch { this.settings = {}; }
    if (this.settings.vol !== undefined) this.sound.volume = this.settings.vol;
  }
  saveSettings() {
    store.set(SETTINGS_KEY, JSON.stringify({ vol: this.sound.volume, pal: this.renderer.palName }));
  }

  setSpeed(v) {
    if (v !== 0) this.lastSpeed = v;
    this.speed = v;
    this.ui.renderTop();
  }

  notifyBought() { /* 튜토리얼 등에서 확장 */ }

  // ── 화면 ───────────────────────────────────────────
  onResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
    this.applyCameraPadding();
  }

  applyCameraPadding() {
    const narrow = window.innerWidth < 760;
    const cam = this.renderer.cam;
    if (narrow) cam.pad = { l: 8, r: 8, t: 124, b: 120 };
    else cam.pad = { l: 74, r: 362, t: 106, b: 60 };
  }

  regionBox(maxIndex) {
    const g = this.game;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of g.net.nodes) {
      if (n.region > maxIndex || n.region < 0) continue;
      if (n.x > 280 || n.y > 240) continue; // 섬은 범위 계산에서 뺀다
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
    }
    return [x0, y0, x1, y1];
  }

  fitToStage(duration = 1) {
    const g = this.game;
    let box;
    if (g.stage === 0) {
      // 시작은 지금 열린 거점 주변만
      const sites = g.sites.filter((s) => s.available);
      box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const s of sites) { box[0] = Math.min(box[0], s.x); box[1] = Math.min(box[1], s.y); box[2] = Math.max(box[2], s.x); box[3] = Math.max(box[3], s.y); }
      const pad = 16;
      box = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
    } else {
      box = this.regionBox(g.stage);
    }
    if (g.stage >= 5) {
      // 제주까지 포함
      const jeju = g.sites.filter((s) => s.region === 5);
      for (const s of jeju) { box[3] = Math.max(box[3], s.y + 10); }
    }
    this.renderer.cam.fitBox(box[0], box[1], box[2], box[3], duration, 1.08);
  }

  fitBoxAll(duration) {
    this.renderer.cam.fitBox(-210, -270, 240, 330, duration, 1.02);
  }

  // ── 입력 ───────────────────────────────────────────
  bindInput() {
    const c = this.canvas;
    const cam = () => this.renderer.cam;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100) * 0.18);
      cam().zoomAt(e.clientX, e.clientY, f);
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      this.sound.unlock();
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button, type: e.pointerType });
      if (this.pointers.size === 2) this.pinch = null;
      this.painted = new Set();
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) { this.onHover(e.clientX, e.clientY); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) p.moved = true;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (this.pinch) {
          cam().zoomAt(mx, my, this.pinch.d / d);
          cam().panBy(mx - this.pinch.mx, my - this.pinch.my);
        }
        this.pinch = { d, mx, my };
        return;
      }
      if (!p.moved) return;
      const tool = this.ui.tool;
      // 차로 도구는 드래그로 칠한다 (오른쪽 버튼은 언제나 지도 이동)
      if (tool === 'lane' && p.button === 0 && p.type === 'mouse') {
        const hit = this.renderer.pick(e.clientX, e.clientY, tool);
        if (hit && hit.road && !this.painted.has(hit.road)) { this.painted.add(hit.road); this.ui.applyAt(hit); }
        this.renderer.hover = hit;
        return;
      }
      c.classList.add('dragging');
      cam().panBy(dx, dy);
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      c.classList.remove('dragging');
      if (this.pointers.size === 0 && !p.moved && p.button === 0) {
        const hit = this.renderer.pick(e.clientX, e.clientY, this.ui.tool);
        if (!this.painted.size) this.ui.applyAt(hit);
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); c.classList.remove('dragging'); });
    c.addEventListener('pointerleave', () => { this.renderer.hover = null; });

    // 패널에서 누르는 동안 갱신을 멈춰 클릭을 보호한다
    const insp = document.getElementById('inspector');
    insp.addEventListener('pointerdown', () => { this.ui.pressing = true; });
    window.addEventListener('pointerup', () => { this.ui.pressing = false; });
    document.getElementById('ui').addEventListener('pointerdown', () => this.sound.unlock());

    // 미니맵
    const jump = (e) => {
      const rc = this.mini.getBoundingClientRect();
      const m = this.miniMap;
      const x = (e.clientX - rc.left) / m.s + m.x0;
      const y = (e.clientY - rc.top) / m.s + m.y0;
      cam().focus(x, y);
    };
    this.mini.addEventListener('pointerdown', jump);
  }

  onHover(x, y) {
    const r = this.renderer, ui = this.ui;
    const hit = r.pick(x, y, ui.tool);
    r.hover = hit;
    if (ui.tool !== 'select') ui.updateHint(hit);
    this.canvas.style.cursor = hit && ui.tool === 'select' ? 'pointer' : '';
  }

  // ── 미니맵 ─────────────────────────────────────────
  drawMiniBase() {
    const W = 150, H = 172;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const m = this.mini;
    m.width = W * dpr;
    m.height = H * dpr;
    const x0 = -215, y0 = -275, x1 = 305, y1 = 325;
    const s = Math.min(W / (x1 - x0), H / (y1 - y0));
    this.miniMap = { x0, y0, s, dpr };
    const base = document.createElement('canvas');
    base.width = m.width; base.height = m.height;
    const b = base.getContext('2d');
    b.scale(dpr, dpr);
    b.fillStyle = '#c7e3ef';
    b.fillRect(0, 0, W, H);
    b.setTransform(s * dpr, 0, 0, s * dpr, -x0 * s * dpr, -y0 * s * dpr);
    const P = this.renderer.P;
    b.fillStyle = '#dcdcd2';
    b.fill(P.north);
    for (const p of P.provinces) {
      b.fillStyle = p.region <= this.game.stage ? '#7fb56a' : '#eceee4';
      b.fill(p.path);
    }
    b.strokeStyle = 'rgba(40,60,40,.35)';
    b.lineWidth = 0.9;
    b.stroke(P.land);
    // 독도
    const d = this.game.data.dokdo;
    b.fillStyle = '#7fb56a';
    b.beginPath(); b.arc(d.x, d.y, 3.2, 0, Math.PI * 2); b.fill();
    const u = this.game.data.ulleung;
    b.beginPath(); b.arc(u.x, u.y, 3.2, 0, Math.PI * 2); b.fill();
    this.miniBase = base;
    this.miniStage = this.game.stage;
  }

  drawMini() {
    if (this.miniStage !== this.game.stage) this.drawMiniBase();
    const ctx = this.mini.getContext('2d');
    const { x0, y0, s, dpr } = this.miniMap;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.miniBase, 0, 0);
    ctx.setTransform(s * dpr, 0, 0, s * dpr, -x0 * s * dpr, -y0 * s * dpr);
    // 정체 지점
    for (const j of this.game.jams.slice(0, 6)) {
      ctx.fillStyle = '#e22c1e';
      ctx.beginPath();
      ctx.arc(j.node.x, j.node.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const cam = this.renderer.cam;
    const hw = (cam.W / 2) * cam.k, hh = (cam.H / 2) * cam.k;
    ctx.strokeStyle = '#0b4ea2';
    ctx.lineWidth = 2.2 / s / dpr * dpr;
    ctx.strokeRect(cam.cx - hw, cam.cy - hh, hw * 2, hh * 2);
  }

  // ── 이벤트 ─────────────────────────────────────────
  handleEvents() {
    const g = this.game, ui = this.ui, r = this.renderer;
    while (g.events.length) {
      const e = g.events.shift();
      if (e.type === 'region') {
        r.baseDirty = true;
        this.sound.fanfare();
        ui.showBanner('신규 권역 개통', `${e.region.short} 방면`, e.region.index === 5 ? '뱃길이 열렸습니다. 항구에서 카페리로 제주까지 갑니다.' : `${e.region.name}이 열렸습니다. 새 거점이 차례로 문을 엽니다.`);
        this.fitToStage(1.8);
        ui.toast('star', `${e.region.name} 개통`, '납품 목표가 새로 시작됩니다');
        ui.renderDock();
        this.save();
      } else if (e.type === 'site') {
        r.baseDirty = true;
        r.ping(e.site.x, e.site.y, '#0b6b4f');
        const icon = e.site.isCity && e.site.kind !== 'dokdo' ? 'city' : e.site.kind;
        ui.toast(icon, `새 거점: ${e.site.name}`, e.site.produces ? '눌러서 트럭을 배치하세요' : '새 납품처가 열렸습니다', () => ui.goSite(e.site));
      } else if (e.type === 'city') {
        r.ping(e.site.x, e.site.y, '#f6b01e');
        r.baseDirty = true;
        if (e.stage >= 2) ui.toast('city', `${e.site.name}이(가) 성장했습니다`, `납품 운임 +${e.stage * 8}%`, () => ui.goSite(e.site));
      } else if (e.type === 'tech') {
        ui.toast(e.tech.icon, `${e.tech.name} 연구 완료`);
        ui.renderDock();
      } else if (e.type === 'project') {
        r.baseDirty = true;
        ui.showBanner('도로 개통', e.project.name, e.project.desc, true);
        ui.toast('build', `${e.project.name} 개통`, '트럭이 새 길을 이용합니다');
      } else if (e.type === 'first') {
        ui.toast('won', '첫 운임을 받았습니다', '돈이 모이면 트럭을 더 사세요');
      } else if (e.type === 'alldone') {
        this.sound.fanfare();
        ui.openModal('alldone');
      } else if (e.type === 'boom') {
        ui.toast('star', `붐 ${e.level + 1}단계`, `전국 운임 +${e.level * 15}%`);
      } else if (e.type === 'rescue') {
        ui.toast('truck', '정부 지원 트럭 한 대를 받았습니다', '자금이 바닥나도 다시 시작할 수 있습니다');
      }
    }
  }

  // ── 루프 ───────────────────────────────────────────
  loop(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const g = this.game;

    const running = this.started && (!this.ui.modalName || this.ui.modalName === 'build' || this.ui.modalName === 'research');
    if (running && this.speed > 0) {
      this.acc += dt * this.speed;
      let steps = 0;
      const maxSteps = 8 * 8;
      const budgetStart = performance.now();
      while (this.acc >= STEP && steps < maxSteps) {
        g.tick(STEP);
        this.acc -= STEP;
        steps++;
        if ((steps & 7) === 0 && performance.now() - budgetStart > 14) { this.acc = 0; break; }
      }
      if (this.acc > STEP * 8) this.acc = 0;
    }
    this.handleEvents();
    this.renderer.frame(dt);

    this.uiT += dt;
    if (this.uiT >= 0.2) {
      this.uiT = 0;
      this.ui.lastMoving = g.movingStats();
      this.ui.tick();
    }
    this.miniT += dt;
    if (this.miniT >= 0.25) {
      this.miniT = 0;
      this.drawMini();
    }
    this.ui.vmsTick(dt);
    this.saveT += dt;
    if (this.saveT >= 20) { this.saveT = 0; this.save(); }
    requestAnimationFrame((q) => this.loop(q));
  }

  onVisibility() {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      this.save();
    } else if (this.hiddenAt) {
      const away = (Date.now() - this.hiddenAt) / 1000;
      this.hiddenAt = 0;
      this.last = performance.now();
      if (away > 90 && this.started && this.game.income > 0) {
        const res = this.game.applyOffline(away);
        this.ui.openModal('offline', res);
      }
    }
  }
}

async function main() {
  try {
    const res = await fetch('data/korea.json');
    if (!res.ok) throw new Error(`지도 데이터를 받지 못했습니다 (${res.status})`);
    const data = await res.json();
    try { await document.fonts.load('700 14px "Gothic A1"'); await document.fonts.load('16px "Do Hyeon"'); await document.fonts.load('20px "Black Han Sans"'); } catch { /* 글꼴이 없어도 진행 */ }
    window.app = new App(data);
    document.getElementById('boot').classList.add('gone');
    void fmtWon;
  } catch (err) {
    console.error(err);
    const boot = document.getElementById('boot');
    boot.innerHTML = `<p>게임을 불러오지 못했습니다</p><p style="font-size:14px;opacity:.85">${String(err.message || err)}</p>`;
  }
}
main();
