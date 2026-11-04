// 부팅, 게임 루프, 입력 처리, 저장
import { Game } from './game/game.js';
import { Renderer } from './render/renderer.js';
import { UI } from './ui/ui.js';
import { Sound } from './ui/audio.js';
import { josa, fmtWon, fmtTime } from './game/defs.js';
import { iconHtml } from './render/art.js';

const SAVE_KEY = 'paldo-traffic-save-v1';
const SETTINGS_KEY = 'paldo-traffic-settings';
const STEP = 1 / 60;
const LONG_PRESS = 350; // 손가락으로 이만큼(ms) 눌렀다 끌면 범위를 고른다

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
    this.lastFrame = 0;
    this.lastSim = performance.now();
    this.awayBank = 0;
    this.isAway = false;
    this.awayEl = document.getElementById('away');
    this.pointers = new Map();
    this.canvas = document.getElementById('map');
    this.mini = document.getElementById('minimap');
    this.miniBox = document.getElementById('mini');
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
    setInterval(() => this.backgroundTick(), 500);
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
    if (this.game.flags.reborn) {
      const run = this.game.flags.reborn + 1;
      delete this.game.flags.reborn;
      setTimeout(() => this.ui.showBanner('환생', `${run}회차 시작`, '명성 보너스를 안고 충청북도에서 다시 달립니다'), 900);
    }
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

  // 다음 회차를 저장해 두고 그것으로 다시 연다
  rebirth() {
    const next = this.game.rebirthSave();
    if (!next) return;
    if (!store.set(SAVE_KEY, JSON.stringify(next))) {
      this.ui.toast('warn', '저장할 수 없어 환생하지 못했습니다', '브라우저 저장 공간을 확인하세요');
      return;
    }
    this.noSave = true;
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
    if (this.settings.music !== undefined) this.sound.musicVolume = this.settings.music;
    if (this.settings.musicOn !== undefined) this.sound.musicOn = this.settings.musicOn;
  }
  saveSettings() {
    store.set(SETTINGS_KEY, JSON.stringify({ vol: this.sound.volume, music: this.sound.musicVolume, musicOn: this.sound.musicOn, pal: this.renderer.palName, dragPan: !!this.settings.dragPan }));
  }

  setSpeed(v) {
    if (v !== 0) this.lastSpeed = v;
    this.speed = v;
    this.ui.renderTop();
  }

  // ── 화면 ───────────────────────────────────────────
  onResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wasHidden = this.renderer.cam.W < 2 || this.renderer.cam.H < 2;
    this.renderer.resize(window.innerWidth, window.innerHeight, dpr);
    this.applyCameraPadding();
    if (wasHidden && window.innerWidth >= 2 && window.innerHeight >= 2) {
      if (this.started) this.fitToStage(0);
      else this.fitBoxAll(0);
    }
  }

  applyCameraPadding() {
    const narrow = window.innerWidth < 760;
    const cam = this.renderer.cam;
    const card = this.ui && (this.ui.sel || this.ui.listOpen);
    // 좁은 화면에서 목록은 더 크게 열리고, 지도에서 고를 때만 지도를 넓게 내준다
    const share = this.ui && this.ui.listOpen && this.ui.tool !== 'fleet' ? 0.6 : 0.46;
    if (narrow) cam.pad = { l: 8, r: 8, t: 84, b: card ? Math.round(window.innerHeight * share) + 56 : 92 };
    else cam.pad = { l: 16, r: card ? 336 : 16, t: 60, b: 70 };
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
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button, type: e.pointerType, t0: performance.now() });
      if (this.pointers.size === 2) {
        this.pinch = null;
        // 두 손가락이 되면 범위 고르기를 그만두고 지도를 움직인다
        for (const q of this.pointers.values()) { q.boxing = false; q.box = false; }
        if (this.ui.area && !this.ui.area.pending) this.ui.clearArea();
      }
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
      // 처음 움직일 때 범위를 고를지 지도를 옮길지 정한다. 차로는 Shift를 누르면 지나간 도로만 칠한다
      if (p.box === undefined) p.box = this.wantsBox(p, e);
      if (p.box) {
        if (tool === 'lane' && e.shiftKey && p.type === 'mouse' && !p.boxing) {
          const hit = this.renderer.pick(e.clientX, e.clientY, tool);
          if (hit && hit.road && !this.painted.has(hit.road)) { this.painted.add(hit.road); this.ui.applyAt(hit); }
          this.renderer.hover = hit;
          return;
        }
        if (!p.boxing) {
          p.boxing = true;
          p.wx = cam().wx(p.sx);
          p.wy = cam().wy(p.sy);
        }
        this.renderer.hover = null;
        this.ui.dragArea(p.wx, p.wy, cam().wx(e.clientX), cam().wy(e.clientY));
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
      if (p.boxing) {
        this.ui.finishArea();
        return;
      }
      if (this.pointers.size === 0 && !p.moved && p.button === 0) {
        // 범위를 골라 둔 채 누르면 범위만 풀린다
        if (this.ui.area) {
          this.ui.clearArea();
          return;
        }
        const hit = this.renderer.pick(e.clientX, e.clientY, this.ui.tool);
        if (!this.painted.size) this.ui.applyAt(hit, e);
      } else if (this.pointers.size === 0 && !p.moved && p.button === 2) {
        // 우클릭은 범위를 먼저 풀고, 그다음 설치나 여러 거점 선택을 취소한다
        if (this.ui.tool !== 'select') {
          this.sound.click();
          if (this.ui.area) this.ui.clearArea();
          else this.ui.setTool('select');
        } else if (this.ui.listOpen && this.ui.listPicked) {
          this.sound.click();
          this.ui.setList(false);
        }
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p && p.boxing) this.ui.clearArea();
      this.pointers.delete(e.pointerId);
      c.classList.remove('dragging');
    });
    c.addEventListener('pointerleave', () => { this.renderer.hover = null; });

    // 패널에서 누르는 동안 갱신을 멈춰 클릭을 보호한다
    const insp = document.getElementById('inspector');
    insp.addEventListener('pointerdown', () => { this.ui.pressing = true; });
    window.addEventListener('pointerup', () => { this.ui.pressing = false; this.sound.unlock(); });
    window.addEventListener('keydown', () => this.sound.unlock());
    document.getElementById('ui').addEventListener('pointerdown', () => this.sound.unlock());

    // 확대 버튼
    const zoomBtn = (id, icon, fn) => {
      const b = document.getElementById(id);
      b.innerHTML = iconHtml(icon);
      b.onclick = () => { this.sound.click(); fn(); };
    };
    const center = () => [window.innerWidth / 2, window.innerHeight / 2];
    zoomBtn('z-in', 'plus', () => { const [x, y] = center(); cam().zoomAt(x, y, 0.72); });
    zoomBtn('z-out', 'minus', () => { const [x, y] = center(); cam().zoomAt(x, y, 1.38); });
    zoomBtn('z-all', 'home', () => this.fitToStage(0.7));

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

  // 끌었을 때 범위를 고르는지 본다. 차로 도구와 눌러서 고르기는 왼쪽 버튼, 기본 도구는 설정을 따른다.
  // 손가락은 지도를 옮기는 일이 먼저라 길게 눌렀다 끌 때만 고른다
  wantsBox(p, e) {
    const tool = this.ui.tool;
    if (tool === 'lane' || tool === 'fleet') return p.button === 0;
    if (tool !== 'select') return false;
    if (p.type !== 'mouse') return performance.now() - p.t0 > LONG_PRESS;
    if (e.shiftKey) return false;
    return p.button === (this.settings.dragPan ? 2 : 0);
  }

  onHover(x, y) {
    const r = this.renderer, ui = this.ui;
    const hit = r.pick(x, y, ui.tool);
    r.hover = ui.area ? null : hit;
    if (ui.tool !== 'select' && !ui.area) ui.updateHint(hit);
    this.canvas.style.cursor = hit && (ui.tool === 'select' || ui.tool === 'fleet') ? 'pointer' : '';
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
    const pal = this.renderer.pal;
    b.fillStyle = pal.sea;
    b.fillRect(0, 0, W, H);
    b.setTransform(s * dpr, 0, 0, s * dpr, -x0 * s * dpr, -y0 * s * dpr);
    const P = this.renderer.P;
    b.fillStyle = pal.foreign;
    b.fill(P.north);
    for (const p of P.provinces) {
      b.fillStyle = p.region <= this.game.stage ? pal.land : pal.locked;
      b.fill(p.path);
    }
    // 독도
    const d = this.game.data.dokdo;
    b.fillStyle = pal.land;
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
      ctx.fillStyle = '#d9412b';
      ctx.beginPath();
      ctx.arc(j.node.x, j.node.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const cam = this.renderer.cam;
    const hw = (cam.W / 2) * cam.k, hh = (cam.H / 2) * cam.k;
    ctx.strokeStyle = this.renderer.pal.ink;
    ctx.lineWidth = 1.6 / s;
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
        if (g.canRebirth()) ui.toast('star', '환생이 열렸습니다', `지금 환생하면 명성 ${g.fameGain()}. 더 벌수록 늘어납니다`, () => ui.openModal('rebirth'));
        ui.renderDock();
        this.save();
      } else if (e.type === 'site') {
        r.baseDirty = true;
        r.ping(e.site.x, e.site.y);
        const icon = e.site.isCity && e.site.kind !== 'dokdo' ? 'city' : e.site.kind;
        ui.toast(icon, `새 거점: ${e.site.name}`, e.site.produces ? '눌러서 트럭을 배치하세요' : '새 납품처가 열렸습니다', () => ui.goSite(e.site));
      } else if (e.type === 'city') {
        r.ping(e.site.x, e.site.y);
        r.baseDirty = true;
        if (e.stage >= 2) ui.toast('city', `${josa(e.site.name, '이', '가')} 성장했습니다`, `납품가 +${e.stage * 8}%`, () => ui.goSite(e.site));
      } else if (e.type === 'tech') {
        ui.toast(e.tech.icon, `${e.tech.name} 연구 완료`);
        ui.renderDock();
      } else if (e.type === 'project') {
        r.baseDirty = true;
        ui.showBanner('도로 개통', e.project.name, e.project.desc);
        ui.toast(e.project.kind === 'bridge' ? 'bridge' : 'bypass', `${e.project.name} 개통`, '트럭이 새 길을 이용합니다');
      } else if (e.type === 'first') {
        ui.toast('won', '첫 납품 대금을 받았습니다', '돈이 모이면 트럭을 더 사세요');
      } else if (e.type === 'alldone') {
        this.sound.fanfare();
        ui.openModal('alldone');
      } else if (e.type === 'boom') {
        ui.toast('star', `붐 ${e.level + 1}단계`, `전국 납품가 +${e.level * 15}%`);
      } else if (e.type === 'rescue') {
        ui.toast('truck_hauler', '정부 지원 트럭 한 대를 받았습니다', '자금이 바닥나도 다시 시작할 수 있습니다');
      }
    }
  }

  // ── 루프 ───────────────────────────────────────────
  // 시뮬레이션을 realDt초만큼 진행한다
  advance(realDt, budgetMs) {
    const m = this.ui.modalName;
    const running = this.started && (!m || m === 'build' || m === 'research' || m === 'rebirth');
    if (!running || this.speed === 0) return;
    this.acc += realDt * this.speed;
    const start = performance.now();
    let steps = 0;
    while (this.acc >= STEP) {
      this.game.tick(STEP);
      this.acc -= STEP;
      steps++;
      if ((steps & 7) === 0 && performance.now() - start > budgetMs) { this.acc = 0; break; }
    }
  }

  slowUpdates(dt) {
    const g = this.game;
    this.uiT += dt;
    if (this.uiT >= 0.2) {
      this.uiT = 0;
      this.ui.lastMoving = g.movingStats();
      this.ui.tick();
    }
    this.miniT += dt;
    if (this.miniT >= 0.25) {
      this.miniT = 0;
      // 미니맵은 확대해서 전체가 안 보일 때만 꺼낸다
      const show = this.renderer.cam.k < 0.09 && !this.game.flags.tutorial;
      this.miniBox.classList.toggle('show', show);
      if (show) this.drawMini();
    }
    this.saveT += dt;
    if (this.saveT >= 20) { this.saveT = 0; this.save(); }
  }

  loop(t) {
    requestAnimationFrame((q) => this.loop(q));
    const realDt = Math.max(0, (t - this.last) / 1000);
    const dt = Math.min(0.25, realDt);
    this.last = t;
    this.lastFrame = performance.now();
    this.advanceToNow(realDt > 0.1 ? 40 : 14);
    this.settleAway();
    this.handleEvents();
    this.renderer.frame(dt);
    this.ui.frame(dt);
    this.slowUpdates(dt);
    if (this.isAway) this.setAway(false);
  }

  // 렌더 루프와 타이머가 같은 시계를 나눠 쓴다. 게임 시간은 언제나 실제 시간을 따라간다
  advanceToNow(budgetMs) {
    const now = performance.now();
    const gap = (now - this.lastSim) / 1000;
    this.lastSim = now;
    const sim = Math.min(gap, 5);
    this.advance(sim, budgetMs);
    if (gap > sim && this.started) this.awayBank += gap - sim;
    return sim;
  }

  // 창이 가려져 화면 갱신이 멈춰도 트럭은 계속 달린다
  backgroundTick() {
    const now = performance.now();
    if (now - this.lastFrame < 500) return;
    if (this.lastFrame > 0 && now - this.lastFrame > 1500) this.setAway(true);
    const sim = this.advanceToNow(120);
    this.handleEvents();
    this.slowUpdates(sim);
  }

  // 화면이 멈춘 사이 트럭이 움직였으므로 블러로 덮고, 돌아오면 최신 화면 위에서 걷어 낸다
  setAway(on) {
    if (this.noAwayFx || on === this.isAway || !this.started) return;
    this.isAway = on;
    if (on) {
      this.awayEl.classList.add('on');
      this.awayFrom = { t: Date.now(), earned: this.game.totalEarned };
      return;
    }
    // 새로 그린 프레임이 화면에 올라간 뒤에 걷어 낸다
    setTimeout(() => { if (!this.isAway) this.awayEl.classList.remove('on'); }, 60);
    const from = this.awayFrom;
    if (!from) return;
    const seconds = (Date.now() - from.t) / 1000;
    const earned = this.game.totalEarned - from.earned;
    if (seconds >= 10 && earned > 0 && !this.ui.modalName) {
      this.ui.toast('won', `자리 비운 ${fmtTime(seconds)} 동안 ${fmtWon(earned)}`, '트럭은 계속 달리고 있었습니다');
    }
  }

  // 브라우저가 타이머까지 늦춰 못 돌린 시간은 오프라인 수익으로 정산한다
  settleAway() {
    if (this.awayBank < 1) return;
    const res = this.game.applyOffline(this.awayBank);
    this.awayBank = 0;
    if (res.seconds >= 90 && !this.ui.modalName) this.ui.openModal('offline', res);
  }

  onVisibility() {
    this.sound.setHidden(document.hidden);
    if (document.hidden) {
      this.setAway(true);
      this.save();
    } else {
      this.last = performance.now();
      this.settleAway();
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
  } catch (err) {
    console.error(err);
    const boot = document.getElementById('boot');
    boot.innerHTML = `<p>게임을 불러오지 못했습니다</p><p style="font-size:14px;opacity:.85">${String(err.message || err)}</p>`;
  }
}
main();
