// 화면 UI 전체: 돈과 속도, 목표, 도구, 정보 카드, 창, 알림
// 평소에는 돈과 목표만 보이고, 나머지 수치는 문제가 생기거나 직접 열어 볼 때만 나타난다.
import { h, ico, raw, patch } from './dom.js';
import { iconHtml, routeBadge, siteIcon } from '../render/art.js';
import { MUSIC_TRACKS } from './audio.js';
import { GOODS, TRUCKS, TECHS, UPGRADES, SITE_KIND_NAME, fmtWon, fmtKo, fmtTon, fmtTime, josa, PROJECT_COST, LANE_PRICE_PER_KM } from '../game/defs.js';

export const TOOLS = [
  { id: 'select', icon: 't_select', color: '#4a4a46', name: '선택', key: '1', desc: '거점과 교차로, 도로를 눌러 자세히 봅니다.' },
  { id: 'yield', icon: 't_yield', color: '#e0a21c', name: '양보 표지', key: '2', desc: '교차로로 들어오는 방향에 칠하면 그쪽이 양보합니다. 나머지 방향은 멈추지 않고 통과합니다.' },
  { id: 'stop', icon: 't_stop', color: '#d9412b', name: '정지 표지', key: '3', desc: '칠한 방향의 트럭이 반드시 한 번 멈춘 뒤 진입합니다. 흐름을 강하게 조절할 때 씁니다.' },
  { id: 'signal', icon: 't_signal', color: '#2c9a58', name: '신호등', key: '4', tech: 'signal', desc: '방향별로 번갈아 보냅니다. 교통량이 많은 교차로의 처리량이 크게 늘어납니다.' },
  { id: 'roundabout', icon: 't_roundabout', color: '#3f7fb8', name: '회전교차로', key: '5', tech: 'roundabout', desc: '멈추지 않고 합류합니다. 교통량이 중간쯤인 곳에 좋습니다.' },
  { id: 'interchange', icon: 't_interchange', color: '#9a4fc4', name: '입체교차로', key: '6', tech: 'interchange', desc: '교차 흐름을 입체로 분리합니다. 같은 차로로 합류할 때만 양보합니다.' },
  { id: 'lane', icon: 't_lane', color: '#e0752b', name: '차로 추가', key: '7', desc: '도로를 눌러 양방향으로 한 차로씩 늘립니다. 끌어서 범위를 고르면 그 안의 도로를 한 번에 늘립니다. Shift를 누른 채 끌면 지나간 도로만 늘립니다.' },
  { id: 'remove', icon: 't_remove', color: '#8a857a', name: '원상복구', key: '8', desc: '교차로의 표지·신호를 없애 기본 상태로 돌립니다. 설치비는 돌려받지 못합니다.' },
  { id: 'fleet', icon: 't_fleet', color: '#3f7fb8', name: '트럭 일괄', menu: true },
];

const LIST_KINDS = [['all', '전체'], ['raw', '원료'], ['factory', '공장'], ['dest', '납품처']];
const LIST_SORTS = [['region', '권역'], ['state', '상태'], ['name', '이름'], ['trucks', '트럭'], ['income', '수익'], ['stock', '창고']];
// 상태순으로 볼 때 위에서부터 놓는 순서. 급한 것이 먼저다
const LIST_STATES = ['원료 없음', '트럭 없음', '트럭 부족', '화물 부족', '원활', '정상'];
const slotName = (slot) => (slot.length === 1 ? GOODS[slot[0]].name : '농수산물');
const CITY_STAGE_NAME = ['마을', '읍내', '소도시', '중도시', '대도시', '메가시티'];
const CONTROL_NAME = { auto: '비보호 교차로', signal: '신호 교차로', roundabout: '회전교차로', interchange: '입체교차로' };
const KIND_NAME = { x: '고속도로', n: '국도', r: '연결로', s: '진입로', f: '뱃길' };

export class UI {
  constructor(app) {
    this.app = app;
    this.game = app.game;
    this.r = app.renderer;
    this.sound = app.sound;
    this.el = {
      top: document.getElementById('topbar'),
      goal: document.getElementById('goal'),
      dock: document.getElementById('dock'),
      menu: document.getElementById('menu'),
      todo: document.getElementById('todo'),
      insp: document.getElementById('inspector'),
      hint: document.getElementById('toolhint'),
      areabar: document.getElementById('areabar'),
      tip: document.getElementById('tooltip'),
      toasts: document.getElementById('toasts'),
      coach: document.getElementById('coach'),
      banner: document.getElementById('banner'),
      modal: document.getElementById('modal'),
    };
    this.sel = null;
    this.tool = 'select';
    this.area = null;
    this.modelSel = 0;
    this.buyCount = 1;
    this.modalName = null;
    this.modalData = null;
    this.listOpen = false;
    this.listView = { q: '', kind: 'all', problem: false, sort: 'region' };
    this.listOrder = null;
    this.fleetTo = null;
    this.fleetPick = new Set();
    this.bulkNeed = false;
    this.more = false;
    this.showStats = false;
    this.confirmReset = false;
    this.saveText = '';
    this.coachStep = 0;
    this.coachOff = false;
    this.el.goal.onclick = () => this.toggleStats();
    this.sound.onTrack = () => { if (this.modalName === 'settings') this.renderModal(); };
    this.bindTooltips();
    this.bindKeys();
  }

  bindTooltips() {
    const tip = this.el.tip;
    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t || e.pointerType === 'touch') { this.tipFor = null; tip.classList.remove('show'); return; }
      if (t === this.tipFor) return;
      this.tipFor = t;
      tip.textContent = t.getAttribute('data-tip');
      tip.classList.add('show');
      const rc = t.getBoundingClientRect();
      const w = tip.offsetWidth, hh = tip.offsetHeight;
      let x = rc.left + rc.width / 2 - w / 2, y = rc.bottom + 8;
      if (y + hh > window.innerHeight - 8) y = rc.top - hh - 8;
      x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
      if (y < 8) y = 8;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    });
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      const t = TOOLS.find((q) => q.key === e.key);
      if (t) { this.pickTool(t); return; }
      if (e.key === 'Escape') {
        if (this.modalName === 'welcome') return;
        if (this.modalName) this.closeModal();
        else if (this.area) this.clearArea();
        else if (this.tool !== 'select') this.setTool('select');
        else if (this.listOpen) this.setList(false);
        else this.select(null);
      }
      if (e.key === 'Enter' && this.area && this.area.pending && !this.modalName) { e.preventDefault(); this.applyArea(); }
      if (e.key === ' ') { e.preventDefault(); this.app.setSpeed(this.app.speed === 0 ? (this.app.lastSpeed || 1) : 0); }
      if (e.key === 'r' || e.key === 'R') this.openModal('research');
      if (e.key === 'b' || e.key === 'B') this.openModal('build');
      if (e.key === 'l' || e.key === 'L') this.setList(!this.listOpen);
      if (e.key === 't' || e.key === 'T') this.pickTool(TOOLS.find((q) => q.id === 'fleet'));
      if (e.key === 'm' || e.key === 'M') this.setMusic(!this.sound.musicOn);
    });
  }

  // ── 상태 변경 ──────────────────────────────────────
  select(sel) {
    if (sel && this.tool === 'fleet') this.setTool('select');
    this.sel = sel;
    this.r.selection = sel;
    if (sel) this.listOpen = false;
    this.app.applyCameraPadding();
    this.updateHighlights();
    this.renderInspector(true);
    this.renderTop();
    this.el.insp.querySelector('.p-body')?.scrollTo(0, 0);
  }

  setList(open) {
    if (open && this.tool === 'fleet') this.setTool('select');
    this.listOpen = open;
    this.listOrder = null;
    if (open && this.sel) { this.sel = null; this.r.selection = null; this.updateHighlights(); }
    this.app.applyCameraPadding();
    this.renderInspector(true);
    this.renderTop();
  }

  toggleStats() {
    this.showStats = !this.showStats;
    this.sound.click();
    this.renderTop();
  }

  updateHighlights(hovered = null) {
    const list = [];
    const sel = this.sel;
    if (sel && sel.type === 'site') {
      const routes = sel.site.routesOut.filter((q) => q.trucks.length);
      for (const q of (routes.length ? routes : sel.site.routesOut)) list.push({ route: q, strong: q === hovered });
      if (!sel.site.routesOut.length) for (const q of sel.site.routesIn) if (q.trucks.length) list.push({ route: q, strong: false });
    }
    if (hovered && !list.some((q) => q.route === hovered)) list.push({ route: hovered, strong: true });
    this.r.highlightRoutes = list;
  }

  pickTool(t) {
    this.sound.click();
    if (t.tech && !this.game.techs.has(t.tech)) {
      const tech = TECHS.find((q) => q.id === t.tech);
      this.toast('lock', `${josa(t.name, '은', '는')} 아직 쓸 수 없습니다`, this.game.techVisible(tech) ? '연구 창에서 연구하세요' : '권역을 더 개발하면 연구가 열립니다');
      this.sound.deny();
      if (this.game.techVisible(tech)) this.openModal('research');
      return;
    }
    this.setTool(this.tool === t.id ? 'select' : t.id);
  }

  setTool(id) {
    const panel = id === 'fleet' || this.tool === 'fleet';
    this.area = null;
    this.r.area = null;
    this.renderAreaBar();
    this.tool = id;
    this.r.tool = id;
    this.r.hover = null;
    this.r.toolColor = id === 'remove' ? '#d9412b' : '#3f7fb8';
    this.r.baseDirty = true;
    document.getElementById('map').classList.toggle('placing', id !== 'select');
    // 트럭 일괄은 정보 카드 자리를 쓴다. 고른 거점은 닫았다 열어도 남는다
    if (panel) {
      if (id === 'fleet') {
        this.sel = null;
        this.r.selection = null;
        this.listOpen = false;
      }
      this.r.fleetPick = id === 'fleet' ? this.fleetPick : null;
      this.app.applyCameraPadding();
      this.updateHighlights();
      this.renderInspector(true);
      this.renderTop();
    }
    this.renderDock();
    this.updateHint(null);
  }

  // 지도 클릭 처리
  applyAt(hit) {
    const g = this.game, r = this.r;
    const tool = this.tool;
    if (tool === 'select') {
      this.sound.click();
      if (!hit) { this.select(null); return; }
      this.select(hit);
      return;
    }
    if (!hit) return;
    if (tool === 'fleet') {
      this.toggleBulk([hit.site]);
      this.updateHint(hit);
      return;
    }
    let ok = false;
    let msg = null;
    if (tool === 'yield' || tool === 'stop') {
      const sign = tool === 'yield' ? 1 : 2;
      if (hit.type === 'approach') {
        const before = hit.edge.sign;
        if (before === sign) { ok = g.setSign(hit.edge, 0); }
        else if (g.money < g.signPrice(hit.edge, sign)) msg = '자금이 부족합니다';
        else ok = g.setSign(hit.edge, sign);
      } else if (hit.type === 'node' && hit.node.control !== 'auto') msg = '신호·회전·입체 교차로에는 표지를 칠 수 없습니다. 먼저 원상복구 하세요.';
    } else if (tool === 'signal' || tool === 'roundabout' || tool === 'interchange') {
      if (hit.type === 'node') {
        if (hit.node.control === tool) msg = '이미 설치되어 있습니다';
        else if (g.money < g.controlPrice(hit.node, tool)) msg = '자금이 부족합니다';
        else ok = g.setControl(hit.node, tool);
      }
    } else if (tool === 'lane') {
      if (hit.type === 'road') {
        if (!g.canAddLane(hit.road)) msg = '이 도로는 더 넓힐 수 없습니다';
        else if (g.money < g.lanePrice(hit.road)) msg = '자금이 부족합니다';
        else ok = g.addLane(hit.road);
      }
    } else if (tool === 'remove') {
      if (hit.type === 'node') {
        const n = hit.node;
        if (n.control !== 'auto') { ok = g.setControl(n, 'auto'); }
        if (n.inE.some((e) => e.sign)) { for (const e of n.inE) e.sign = 0; ok = true; }
      }
    }
    if (ok) {
      this.sound.place();
      r.baseDirty = true;
      const x = hit.node ? hit.node.x : hit.road ? (hit.road.bb[0] + hit.road.bb[2]) / 2 : 0;
      const y = hit.node ? hit.node.y : hit.road ? (hit.road.bb[1] + hit.road.bb[3]) / 2 : 0;
      r.ping(x, y);
      this.renderInspector(true);
      this.renderTop();
      this.updateHint(hit);
    } else if (msg) {
      this.sound.deny();
      this.toast('warn', msg);
    }
    return ok;
  }

  updateHint(hit) {
    const el = this.el.hint;
    const t = this.tool;
    if (t === 'select') { el.classList.remove('show'); return; }
    const g = this.game;
    const def = TOOLS.find((q) => q.id === t);
    let text = '';
    if (!hit) {
      const help = { yield: '교차로로 들어오는 방향을 누르세요', stop: '교차로로 들어오는 방향을 누르세요', signal: '교차로를 누르세요', roundabout: '교차로를 누르세요', interchange: '교차로를 누르세요', lane: '도로를 누르거나, 끌어서 범위를 고르세요', remove: '되돌릴 교차로를 누르세요', fleet: '거점을 누르거나, 끌어서 범위를 고르세요' };
      patch(el, [h('span', null, `${def.name}: ${help[t]}  ·  `, h('b', null, 'Esc'), ' 또는 ', h('b', null, '우클릭'), ' 취소')]);
      el.classList.add('show');
      return;
    }
    if (t === 'yield' || t === 'stop') {
      if (hit.type === 'approach') {
        const name = hit.edge.road.name || KIND_NAME[hit.edge.road.kind];
        const sign = t === 'yield' ? 1 : 2;
        const remove = hit.edge.sign === sign;
        patch(el, [h('span', null, `${hit.node.name} · ${name} 방향 ${def.name} `, remove ? h('b', null, '제거') : h('b', null, fmtWon(g.signPrice(hit.edge, sign))))]);
      } else text = '이 교차로는 표지를 칠 수 없습니다';
    } else if (t === 'signal' || t === 'roundabout' || t === 'interchange') {
      if (hit.type === 'node') patch(el, [h('span', null, `${hit.node.name} · ${def.name} 설치 `, h('b', null, fmtWon(g.controlPrice(hit.node, t))))]);
    } else if (t === 'lane') {
      if (hit.type === 'road') {
        const rr = hit.road;
        if (g.canAddLane(rr)) patch(el, [h('span', null, `${rr.name || KIND_NAME[rr.kind]} ${Math.round(rr.len)}km · 왕복 ${rr.lanes * 2}→${rr.lanes * 2 + 2}차로 `, h('b', null, fmtWon(g.lanePrice(rr))))]);
        else text = '이 도로는 더 넓힐 수 없습니다';
      }
    } else if (t === 'remove') {
      if (hit.type === 'node') patch(el, [h('span', null, `${hit.node.name} 기본 교차로로 되돌리기`)]);
    } else if (t === 'fleet') {
      patch(el, [h('span', null, `${hit.site.name} `, h('b', null, this.fleetPick.has(hit.site) ? '빼기' : '고르기'))]);
    }
    if (text) patch(el, [h('span', null, text)]);
    el.classList.add('show');
  }

  // ── 범위 차로 추가 ─────────────────────────────────
  // 끄는 동안 사각형 안의 도로를 모아 미리 보여 준다. 막히는 도로가 앞에 온다
  dragArea(x0, y0, x1, y1) {
    if (this.tool === 'fleet') {
      this.dragBulk(x0, y0, x1, y1);
      return;
    }
    const g = this.game;
    const jam = (q) => Math.max(q.fwd.cong, q.bwd.cong);
    const roads = this.r.roadsInBox(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1))
      .filter((q) => g.canAddLane(q))
      .sort((p, q) => jam(q) - jam(p) || g.lanePrice(p) - g.lanePrice(q));
    this.area = { x0, y0, x1, y1, roads, pick: new Set(), total: 0, pending: false, paths: new Map(), pathK: 0 };
    this.r.area = this.area;
    this.planArea();
    this.renderAreaBar();
    const a = this.area;
    const count = a.pick.size < roads.length ? `도로 ${roads.length}개 중 ${a.pick.size}개 ` : `도로 ${roads.length}개 `;
    patch(this.el.hint, [roads.length ? h('span', null, count, h('b', null, fmtWon(a.total))) : h('span', null, '범위 안에 넓힐 도로가 없습니다')]);
    this.el.hint.classList.add('show');
  }
  // 돈이 모자라면 앞에서부터 살 수 있는 만큼만 고른다
  planArea() {
    const a = this.area, g = this.game;
    let left = g.money;
    a.pick.clear();
    a.total = 0;
    for (const q of a.roads) {
      const c = g.lanePrice(q);
      if (c > left) continue;
      left -= c;
      a.total += c;
      a.pick.add(q);
    }
  }
  finishArea() {
    if (!this.area) return;
    if (this.tool === 'fleet') {
      const list = [...this.area.sites];
      this.clearArea();
      if (list.length) this.toggleBulk(list);
      return;
    }
    if (!this.area.roads.length) {
      this.clearArea();
      return;
    }
    this.area.pending = true;
    this.el.hint.classList.remove('show');
    this.renderAreaBar();
  }
  clearArea() {
    this.area = null;
    this.r.area = null;
    this.renderAreaBar();
    this.updateHint(null);
  }
  applyArea() {
    const a = this.area, g = this.game;
    if (!a) return;
    let n = 0, paid = 0;
    for (const q of a.pick) {
      const c = g.lanePrice(q);
      if (g.addLane(q)) {
        n++;
        paid += c;
      }
    }
    this.clearArea();
    if (!n) {
      this.sound.deny();
      return;
    }
    this.sound.place();
    this.r.baseDirty = true;
    this.r.ping((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
    this.toast('t_lane', `도로 ${n}개를 넓혔습니다`, fmtWon(paid));
    this.renderInspector(true);
    this.renderTop();
  }
  renderAreaBar() {
    const el = this.el.areabar, a = this.area;
    if (!a || !a.pending) {
      el.classList.remove('show');
      return;
    }
    const n = a.pick.size, all = a.roads.length;
    patch(el, [
      h('span', { key: 'text' }, n < all ? `도로 ${all}개 중 ${n}개` : `도로 ${n}개`, n < all && h('small', null, ' 자금 부족')),
      h('button', { key: 'ok', class: 'btn buy', disabled: !n, onclick: () => this.applyArea() }, '차로 추가', h('span', { class: 'price' }, fmtWon(a.total))),
      h('button', { key: 'no', class: 'btn', onclick: () => { this.sound.click(); this.clearArea(); } }, '취소'),
    ]);
    el.classList.add('show');
  }

  // ── 렌더 ───────────────────────────────────────────
  renderAll() {
    this.renderTop();
    this.renderDock();
    this.renderGoal();
    this.renderInspector(true);
  }

  tick() {
    this.renderTop();
    this.renderGoal();
    this.renderInspector();
    this.renderCoach();
    if (this.area && this.area.pending) {
      this.planArea();
      this.renderAreaBar();
    }
    if (this.modalName && this.modalName !== 'welcome' && this.modalName !== 'offline' && this.modalName !== 'settings') this.renderModal();
  }

  setMusic(on) {
    this.sound.unlock();
    this.sound.setMusicOn(on);
    this.app.saveSettings();
    this.renderTop();
    if (this.modalName === 'settings') this.renderModal();
  }

  // 돈과 분당 수익만 늘 보인다. 정체와 정시율은 문제가 생겼을 때만 빨갛게 나타난다
  renderTop() {
    const g = this.game, app = this.app;
    const ms = this.lastMoving || { stopped: 0, onRoad: 0 };
    const stoppedShare = ms.onRoad ? ms.stopped / ms.onRoad : 0;
    const speedBtn = (v, label, tip) => h('button', { class: app.speed === v ? 'on' : '', onclick: () => app.setSpeed(v), 'data-tip': tip, 'aria-label': tip, html: label });
    const alerts = [];
    if (ms.onRoad >= 12 && stoppedShare > 0.35) alerts.push(`정체 ${ms.stopped}대`);
    if (g.deliveries >= 30 && g.onTimeRate < 0.75) alerts.push(`정시 ${Math.round(g.onTimeRate * 100)}%`);
    const kids = [
      h('button', { class: `money${this.showStats ? ' on' : ''}`, key: 'money', onclick: () => this.toggleStats(), 'aria-label': '자세한 통계', 'data-tip': '눌러서 자세한 통계 보기' },
        h('strong', null, this.moneyText || fmtWon(g.money)),
        h('small', null, g.income > 0 ? `+${fmtWon(g.income * 60)}/분` : '아직 수익 없음'),
        alerts.length > 0 && h('em', null, alerts.join(' · '))),
      this.showStats && this.statsCard(),
      h('div', { class: 'speed', key: 'speed' },
        speedBtn(0, `<span class="ico">${iconHtml('pause')}</span>`, '일시정지 (스페이스바)'),
        speedBtn(1, '1', '보통 속도'), speedBtn(2, '2', '2배 속도'), speedBtn(4, '4', '4배 속도'), speedBtn(8, '8', '8배 속도')),
    ];
    patch(this.el.top, kids.filter(Boolean));
    this.renderMenu();
    this.renderTodo();
  }

  kv(label, value, key) {
    return h('div', { class: 'kv', key: key || label }, h('span', null, label), h('b', null, value));
  }

  statsCard() {
    const g = this.game;
    const ms = this.lastMoving || { stopped: 0, onRoad: 0 };
    const reg = g.currentRegion;
    const next = g.regions[reg.index + 1];
    return h('div', { class: 'stats', key: 'stats' },
      this.kv(`${reg.short} 납품 실적`, `${fmtKo(reg.pts)} / ${fmtKo(g.regionGoal(reg.index))}`),
      next && this.kv('다음 권역', next.short),
      this.kv('트럭', `${g.truckCount}대`),
      this.kv('도로 위 / 멈춤', `${ms.onRoad}대 / ${ms.stopped}대`),
      this.kv('정시율', `${Math.round(g.onTimeRate * 100)}%`),
      this.kv('배송', `${g.deliveries.toLocaleString('en-US')}회`),
      this.kv('누적 물동량', fmtTon(g.totalTons)),
      this.kv('누적 수익', fmtWon(g.totalEarned)),
      this.kv('운행 시간', fmtTime(g.time)));
  }

  renderMenu() {
    const g = this.game;
    const researchReady = TECHS.some((t) => !g.techs.has(t.id) && g.techVisible(t) && g.money >= t.cost)
      || UPGRADES.some((u) => g.upg[u.id] < u.max && g.money >= g.upgradeCostOf(u.id));
    const buildReady = g.projects.some((p) => g.projectAvailable(p) && g.money >= g.projectPrice(p));
    const btn = (icon, tip, onclick, dot, on) => h('button', { key: icon, class: on ? 'on' : '', onclick, 'data-tip': tip, 'aria-label': tip }, ico(icon), dot && h('i', { class: 'dot' }));
    patch(this.el.menu, [
      btn('research', '연구 (R)', () => this.openModal('research'), researchReady),
      btn('build', '우회도로·대교 건설 (B)', () => this.openModal('build'), buildReady),
      btn('list', '거점 목록 (L)', () => { this.sound.click(); this.setList(!this.listOpen); }, false, this.listOpen),
      g.truckCount >= 3 && btn('t_fleet', '트럭 일괄 (T)\n여러 구역을 골라 트럭을 한 번에 사거나 바꿉니다', () => this.pickTool(TOOLS.find((t) => t.id === 'fleet')), false, this.tool === 'fleet'),
      btn(this.sound.musicOn ? 'sound' : 'mute', this.sound.musicOn ? `배경음 끄기 (M)\n지금 곡: ${this.sound.track.title}` : '배경음 켜기 (M)', () => this.setMusic(!this.sound.musicOn)),
      btn('gear', '설정과 저장', () => this.openModal('settings')),
    ].filter(Boolean));
  }

  // 지금 손대면 좋은 곳을 한 줄씩 알려 준다
  renderTodo() {
    const show = !this.sel && !this.listOpen && this.tool !== 'fleet' && !this.modalName && this.game.flags.tutorial !== true;
    const list = show ? this.advice() : [];
    patch(this.el.todo, list.map((a, i) => h('button', { class: `todo ${a.tone || ''}`, key: `t${i}${a.title}`, onclick: a.go, 'data-tip': a.sub }, h('i'), h('span', null, a.title))));
  }

  renderDock() {
    const g = this.game;
    const kids = TOOLS.filter((t) => !t.menu).map((t) => {
      const locked = t.tech && !g.techs.has(t.tech);
      return h('button', {
        key: t.id,
        class: `tool${this.tool === t.id ? ' on' : ''}${locked ? ' locked' : ''}`,
        style: `--c:${t.color}`,
        onclick: () => this.pickTool(t),
        'data-tip': `${t.name} (${t.key})\n${t.desc}${locked ? '\n연구하면 쓸 수 있습니다.' : ''}`,
        'aria-label': t.name,
      }, ico(t.icon));
    });
    patch(this.el.dock, kids);
  }

  renderGoal() {
    const g = this.game;
    const reg = g.currentRegion;
    const prog = g.progress();
    const goalPts = g.regionGoal(reg.index);
    let kids;
    if (g.flags.allDone) {
      const frac = g.endlessPts / g.endlessGoal();
      kids = [
        h('span', { class: 'route', 'data-tip': `지금 납품가 +${Math.round((g.boomMult() - 1) * 100)}%` }, `붐 ${g.endless + 1}단계`),
        h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(frac * 100).toFixed(1)}%` })),
        h('span', { class: 'pct' }, `${Math.floor(frac * 100)}%`),
      ];
    } else {
      const next = g.regions[reg.index + 1];
      kids = [
        h('span', { class: 'route' }, reg.short),
        h('div', { class: 'track', 'data-tip': `${reg.name}에 납품한 실적 ${fmtKo(reg.pts)} / ${fmtKo(goalPts)}\n${next ? `다 채우면 ${next.short} 개통` : '다 채우면 전국 물류망 완성'}` }, h('div', { class: 'fill', style: `width:${(prog * 100).toFixed(1)}%` })),
        h('span', { class: 'pct' }, `${Math.floor(prog * 100)}%`),
      ];
    }
    patch(this.el.goal, kids);
  }

  // ── 정보 카드 ──────────────────────────────────────
  renderInspector(force = false) {
    if (!force) {
      // 카드 위에서 버튼을 누르는 중에는 갱신을 쉰다
      if (this.pressing) return;
    }
    const sel = this.sel;
    let view = null;
    if (this.tool === 'fleet') view = this.bulkView();
    else if (sel) {
      if (sel.type === 'site') view = this.siteView(sel.site);
      else if (sel.type === 'node' || sel.type === 'approach') view = this.nodeView(sel.node);
      else if (sel.type === 'road') view = this.roadView(sel.road);
      else if (sel.type === 'project') view = this.projectView(sel.project);
    } else if (this.listOpen) view = this.overviewView();
    const el = this.el.insp;
    if (!view) {
      if (!el.hidden && !this.inspClosing) {
        this.inspClosing = true;
        el.classList.add('out');
        setTimeout(() => {
          if (!this.inspClosing) return;
          this.inspClosing = false;
          el.classList.remove('out');
          el.hidden = true;
          patch(el, []);
        }, 150);
      }
      return;
    }
    if (this.inspClosing) { this.inspClosing = false; el.classList.remove('out'); }
    el.hidden = false;
    patch(el, view);
  }

  // 매 프레임: 돈이 숫자를 따라 올라가고 내려간다
  frame(dt) {
    const m = this.game.money;
    if (this.shownMoney === undefined) this.shownMoney = m;
    this.shownMoney += (m - this.shownMoney) * (1 - Math.exp(-dt * 9));
    if (Math.abs(m - this.shownMoney) < Math.abs(m) * 0.0004) this.shownMoney = m;
    const text = fmtWon(this.shownMoney);
    if (text !== this.moneyText) {
      this.moneyText = text;
      const el = this.el.top.querySelector('.money strong');
      if (el) el.textContent = text;
    }
  }

  head(leading, title, sub, onClose) {
    return h('div', { class: 'p-head', key: 'head' },
      leading,
      h('div', { class: 'p-title' }, h('h2', null, title), sub && h('p', null, sub)),
      onClose && h('button', { class: 'p-x', onclick: onClose, 'aria-label': '닫기', 'data-tip': '닫기 (Esc)' }, ico('close')));
  }

  // 자세히 버튼. 눌러야 나머지 수치가 보인다
  moreBtn() {
    return h('button', { class: 'more-btn', key: 'more-btn', onclick: () => { this.more = !this.more; this.renderInspector(true); } }, this.more ? '접기' : '자세히', ico('chevron', this.more ? 'turn-up' : 'turn-down'));
  }

  meter(label, frac, color, tip, key, bad) {
    return h('div', { class: `meter${bad ? ' bad' : ''}`, key, 'data-tip': tip },
      h('span', { class: 'label' }, label),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(Math.min(1, Math.max(0, frac)) * 100).toFixed(1)}%;background:${color}` })));
  }

  // 거점 목록의 수치. 납품처는 들어오는 노선으로 잰다
  siteRoutes(s) { return s.produces ? s.routesOut : s.routesIn; }
  siteTruckCount(s) { return this.siteRoutes(s).reduce((sum, q) => sum + q.trucks.length, 0); }
  siteIncome(s) { return this.siteRoutes(s).reduce((sum, q) => sum + (q.rate || 0), 0) * 60; }
  siteStockFrac(s) { return s.produces ? s.stock / this.game.siteCap(s) : -1; }
  // 상태순 목록에서 같은 상태끼리 줄 세우는 값과, 줄 오른쪽에 보일 글
  stateMeasure(s) {
    const st = this.siteStatus(s).short;
    if (st === '원료 없음') return [s.yard.length, s.inputs.filter((slot, i) => s.inBuf[i] < 0.05).map(slotName).join('·')];
    if (st === '트럭 없음') return [GOODS[s.goods].price, GOODS[s.goods].name];
    if (st === '트럭 부족') return [this.siteStockFrac(s), `창고 ${Math.round(this.siteStockFrac(s) * 100)}%`];
    if (st === '화물 부족') return [s.yard.length, `${s.yard.length}대 대기`];
    const income = this.siteIncome(s);
    return [income, income > 0 ? `${fmtWon(income)}/분` : ''];
  }

  // 조건에 맞는 거점을 고르고 정렬한다
  listSites() {
    const g = this.game, f = this.listView;
    const q = f.q.trim();
    const list = g.sites.filter((s) => {
      if (!s.available) return false;
      if (f.kind === 'raw' && !(s.produces && !s.inputs)) return false;
      if (f.kind === 'factory' && !(s.produces && s.inputs)) return false;
      if (f.kind === 'dest' && s.produces) return false;
      if (f.problem && this.siteStatus(s).tone === 'ok') return false;
      if (!q) return true;
      return `${s.name} ${g.regions[s.region].short} ${SITE_KIND_NAME[s.kind]} ${s.produces ? GOODS[s.goods].name : ''}`.includes(q);
    });
    const by = {
      state: (a, b) => LIST_STATES.indexOf(this.siteStatus(a).short) - LIST_STATES.indexOf(this.siteStatus(b).short) || this.stateMeasure(b)[0] - this.stateMeasure(a)[0],
      name: (a, b) => a.name.localeCompare(b.name, 'ko'),
      trucks: (a, b) => this.siteTruckCount(b) - this.siteTruckCount(a),
      income: (a, b) => this.siteIncome(b) - this.siteIncome(a),
      stock: (a, b) => this.siteStockFrac(b) - this.siteStockFrac(a),
    }[f.sort];
    return by ? list.sort(by) : list;
  }

  listRow(s) {
    const g = this.game, f = this.listView;
    const st = this.siteStatus(s);
    let right = st.tone !== 'ok' ? st.short : '';
    if (f.sort === 'state') right = this.stateMeasure(s)[1];
    if (f.sort === 'trucks') right = `${this.siteTruckCount(s)}대`;
    if (f.sort === 'income') right = `${fmtWon(this.siteIncome(s))}/분`;
    if (f.sort === 'stock') right = s.produces ? `${Math.round(this.siteStockFrac(s) * 100)}%` : '';
    const tip = s.produces ? `${GOODS[s.goods].name} · 트럭 ${this.siteTruckCount(s)}대` : `${SITE_KIND_NAME[s.kind]} · 납품 트럭 ${this.siteTruckCount(s)}대`;
    return h('button', { class: 'list-row', key: s.id, onclick: () => this.goSite(s), 'data-tip': `${tip}${st.tone !== 'ok' ? `\n${st.short}` : ''}` },
      raw(siteIcon(s), 'ico'), h('span', { class: 't' }, s.name), right && h('span', { class: `state ${st.tone === 'ok' ? '' : st.tone}`.trim() }, right));
  }

  // 검색과 필터, 정렬 막대
  listTools() {
    const f = this.listView;
    const set = (k, v) => { f[k] = v; this.sound.click(); this.renderInspector(true); };
    return h('div', { class: 'list-tools', key: 'tools' },
      h('input', {
        class: 'list-search', key: 'q', type: 'search', placeholder: '이름, 권역, 화물로 찾기', value: f.q, 'aria-label': '거점 찾기',
        oninput: (e) => { f.q = e.target.value; this.renderInspector(true); },
        onkeydown: (e) => { if (e.key === 'Escape') { if (f.q) { f.q = ''; this.renderInspector(true); } else e.target.blur(); } },
      }),
      h('div', { class: 'list-line', key: 'kinds' },
        h('div', { class: 'seg' }, LIST_KINDS.map(([id, label]) => h('button', { key: id, class: f.kind === id ? 'on' : '', onclick: () => set('kind', id) }, label))),
        h('button', { key: 'bad', class: `chip${f.problem ? ' on' : ''}`, 'aria-pressed': f.problem ? 'true' : 'false', 'data-tip': '트럭이나 화물, 원료가 모자라 손봐야 할 곳만 봅니다', onclick: () => set('problem', !f.problem) }, '문제만')),
      h('div', { class: 'list-line', key: 'sorts' },
        h('span', { class: 'list-label' }, '정렬'),
        h('div', { class: 'seg' }, LIST_SORTS.map(([id, label]) => h('button', { key: id, class: f.sort === id ? 'on' : '', onclick: () => set('sort', id) }, label)))));
  }

  // 전국 트럭을 더 많이 싣는 차종으로 한꺼번에 바꾼다
  fleetSec() {
    const g = this.game;
    const routes = [...g.routes.values()].filter((q) => q.valid && q.trucks.length);
    const targets = TRUCKS.map((m, i) => i).filter((i) => g.modelUnlocked(i) && routes.some((q) => g.convertibleTrucks(q, i).length));
    if (!targets.length) return null;
    if (!targets.includes(this.fleetTo)) this.fleetTo = targets.reduce((a, b) => (TRUCKS[b].cap > TRUCKS[a].cap ? b : a));
    const to = this.fleetTo;
    const plan = g.planConvert(routes, to);
    return h('div', { class: 'sec', key: 'fleet' },
      this.convertTitle('전국 트럭 전환', plan),
      targets.length > 1 && h('div', { class: 'seg', key: 'to' }, targets.map((i) => h('button', { key: TRUCKS[i].id, class: to === i ? 'on' : '', 'data-tip': `${TRUCKS[i].name}으로 바꿉니다. 적재 ${TRUCKS[i].cap}t`, onclick: () => { this.fleetTo = i; this.sound.click(); this.renderInspector(true); } }, TRUCKS[i].short))),
      this.convertBtn(plan, routes, to));
  }
  convertTitle(title, plan) {
    return h('h3', null, title, plan.n < plan.all && h('span', null, plan.n ? `자금이 모자라 ${plan.all}대 중 ${plan.n}대만` : '자금 부족'));
  }
  convertBtn(plan, routes, to) {
    const names = (set) => [...set].sort((a, b) => a.cap - b.cap).map((t) => t.short).join('·');
    return h('button', {
      class: 'btn up', key: 'go', disabled: !plan.n,
      'data-tip': '더 적게 싣는 트럭을 모두 바꿉니다. 값은 지금 트럭을 팔고(구매가의 50%) 새로 산 것과 같습니다.\n달리는 트럭은 다음 거점에 닿을 때 바뀝니다.',
      onclick: () => this.convertFleet(routes, to),
      ...this.showRoutes(routes),
    }, h('span', null, `${names(plan.n ? plan.some : plan.every)} ${plan.n || plan.all}대 → ${TRUCKS[to].short}`), h('span', { class: 'price' }, fmtWon(plan.n ? plan.cost : plan.full)));
  }
  // 버튼에 마우스를 올리면 영향을 받는 노선을 지도에 보여 준다
  showRoutes(routes) {
    return {
      onmouseenter: () => { this.r.highlightRoutes = routes.map((route) => ({ route, strong: true })); },
      onmouseleave: () => this.updateHighlights(),
    };
  }
  convertFleet(routes, to) {
    let n = 0, paid = 0;
    for (const q of routes) {
      const r = this.game.convertTrucks(q, to);
      n += r.n;
      paid += r.paid;
    }
    this.updateHighlights();
    this.afterConvert(n, paid, to);
  }
  afterConvert(n, paid, to) {
    if (!n) { this.sound.deny(); return; }
    this.sound.buy();
    this.toast('truck_hauler', `트럭 ${n}대를 ${TRUCKS[to].short}으로 바꿉니다`, `${fmtWon(paid)} · 달리는 트럭은 다음 거점에서 바뀝니다`);
    this.renderInspector(true);
    this.renderTop();
  }

  // ── 트럭 일괄 ──────────────────────────────────────
  // 트럭을 둘 수 있는 거점. region을 주면 그 권역만 고른다
  bulkSites(region = null) {
    return this.game.sites.filter((s) => s.available && s.produces && (region === null || s.region === region));
  }
  // 전부 골라져 있으면 빼고, 아니면 모두 더한다
  toggleBulk(list) {
    const drop = list.every((s) => this.fleetPick.has(s));
    for (const s of list) {
      if (drop) this.fleetPick.delete(s);
      else this.fleetPick.add(s);
    }
    this.sound.click();
    this.renderInspector(true);
  }
  // 끄는 동안 범위 안의 거점을 미리 보여 준다. 손을 떼면 toggleBulk로 더하거나 뺀다
  dragBulk(x0, y0, x1, y1) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    const sites = this.bulkSites().filter((s) => s.x >= lx && s.x <= hx && s.y >= ly && s.y <= hy);
    const drop = sites.length > 0 && sites.every((s) => this.fleetPick.has(s));
    this.area = { x0, y0, x1, y1, roads: [], pick: new Set(), total: 0, pending: false, paths: new Map(), pathK: 0, sites: new Set(sites), drop };
    this.r.area = this.area;
    patch(this.el.hint, [sites.length ? h('span', null, `거점 ${sites.length}곳 `, h('b', null, drop ? '빼기' : '더하기')) : h('span', null, '범위 안에 트럭을 둘 거점이 없습니다')]);
    this.el.hint.classList.add('show');
  }
  buyBulk(routes, m, n) {
    const r = this.game.bulkBuy(routes, m, n);
    if (!r.n) { this.sound.deny(); return; }
    this.sound.buy();
    this.toast('truck_hauler', `${TRUCKS[m].short} 트럭 ${r.n}대를 샀습니다`, fmtWon(r.paid));
    this.updateHighlights();
    this.renderInspector(true);
    this.renderTop();
  }
  bulkView() {
    const g = this.game, pick = this.fleetPick;
    const running = [...pick].flatMap((s) => s.routesOut.filter((q) => q.valid && q.trucks.length));
    const trucks = running.reduce((sum, q) => sum + q.trucks.length, 0);
    const zone = (key, label, list) => {
      const n = list.filter((s) => pick.has(s)).length;
      return h('button', { key, class: `chip${n === list.length ? ' on' : n ? ' some' : ''}`, 'aria-pressed': n === list.length ? 'true' : 'false', 'data-tip': `거점 ${list.length}곳`, onclick: () => this.toggleBulk(list) }, label);
    };
    const regions = g.regions.filter((r) => r.unlocked).map((r) => [r, this.bulkSites(r.index)]).filter((q) => q[1].length);
    const body = [h('div', { class: 'sec', key: 'zones' },
      h('h3', null, '구역', pick.size > 0 && h('span', null, `${pick.size}곳`)),
      h('div', { class: 'chips', key: 'zones' }, zone('all', '전국', this.bulkSites()), regions.map(([r, list]) => zone(`r${r.index}`, r.short, list)), pick.size > 0 && h('button', { key: 'clear', class: 'chip', onclick: () => this.toggleBulk([...pick]) }, '선택 해제')),
      h('p', { class: 'status', key: 'help' }, pick.size ? `달리는 노선 ${running.length}개 · 트럭 ${trucks}대` : '지도를 끌어 범위를 고르거나 거점을 누르세요. 여러 번 고르면 더해지고, 고른 곳을 다시 고르면 빠집니다.'))];
    if (pick.size) {
      if (!g.modelUnlocked(this.modelSel)) this.modelSel = 0;
      const m = this.modelSel;
      const seg = this.modelSeg();
      if (seg) body.push(h('div', { class: 'sec', key: 'model' }, h('h3', null, '차종'), seg));
      // 원료가 없어 멈춘 공장에 트럭을 더해도 싣고 갈 것이 없다
      const states = [...pick].map((s) => [s, this.siteStatus(s).short]);
      const stopped = states.filter((q) => q[1] === '원료 없음').length;
      const buySites = states.filter((q) => q[1] !== '원료 없음' && (!this.bulkNeed || q[1] === '트럭 없음' || q[1] === '트럭 부족')).map((q) => q[0]);
      const buyRoutes = buySites.flatMap((s) => g.bulkRoutes(s));
      const count = this.buyCount || 200;
      const plan = g.planBuy(buyRoutes, m, count);
      // 한 대도 못 사면 얼마가 드는지 보여 준다
      const short = plan.n ? plan : g.planBuy(buyRoutes, m, this.buyCount || 1);
      const note = !buyRoutes.length ? '' : !plan.n ? '자금 부족' : !this.buyCount ? `돈이 닿는 만큼 노선 ${buyRoutes.length}개에 고르게` : plan.n < plan.want ? `자금이 모자라 ${plan.want}대 중 ${plan.n}대만` : `노선 ${buyRoutes.length}개에 ${count}대씩`;
      body.push(h('div', { class: 'sec', key: 'buy' },
        h('h3', null, '트럭 사기', h('span', null, note)),
        this.countSeg(),
        h('div', { class: 'chips', key: 'need' }, h('button', { key: 'need', class: `chip${this.bulkNeed ? ' on' : ''}`, 'aria-pressed': this.bulkNeed ? 'true' : 'false', 'data-tip': '창고에 화물이 쌓이거나 아직 트럭이 없는 거점에만 삽니다', onclick: () => { this.bulkNeed = !this.bulkNeed; this.sound.click(); this.renderInspector(true); } }, '트럭 모자란 곳만')),
        buyRoutes.length ? h('button', {
          class: 'btn buy', key: 'go', disabled: !plan.n,
          'data-tip': '달리는 노선마다 더합니다. 트럭이 없는 거점은 가장 잘 버는 노선을 엽니다.\n노선의 트럭이 늘수록 값이 오릅니다.',
          onclick: () => this.buyBulk(buyRoutes, m, count),
          ...this.showRoutes(buyRoutes),
        }, h('span', null, `${TRUCKS[m].short} ${plan.n || short.want}대 사기`), h('span', { class: 'price' }, fmtWon(plan.n ? plan.cost : short.full)))
          : h('p', { class: 'status', key: 'none' }, this.bulkNeed ? '고른 거점 중 트럭이 모자란 곳이 없습니다.' : '트럭을 더할 노선이 없습니다.'),
        stopped > 0 && h('p', { class: 'status', key: 'stop' }, `원료가 없어 멈춘 ${stopped}곳에는 사지 않습니다.`)));
      const conv = g.planConvert(running, m);
      if (running.length) {
        body.push(h('div', { class: 'sec', key: 'conv' },
          this.convertTitle('트럭 바꾸기', conv),
          conv.all ? this.convertBtn(conv, running, m) : h('p', { class: 'status', key: 'none' }, `${TRUCKS[m].short}보다 적게 싣는 트럭이 없습니다.`)));
      }
    }
    return [this.head(ico('t_fleet'), '트럭 일괄', null, () => { this.sound.click(); this.setTool('select'); }), h('div', { class: 'p-body', key: 'bulk' }, body)];
  }

  overviewView() {
    const g = this.game, f = this.listView;
    const filtering = f.q.trim() || f.kind !== 'all' || f.problem;
    // 목록 위에 마우스가 있는 동안은 순서를 고정해 누르려던 줄이 도망가지 않게 한다
    const key = JSON.stringify(f);
    const now = performance.now();
    if (!this.listOrder || key !== this.listKey || (now - this.listT > 4000 && !this.el.insp.matches(':hover'))) {
      this.listOrder = this.listSites();
      this.listStates = new Map(this.listOrder.map((s) => [s, this.siteStatus(s).short]));
      this.listJams = filtering ? [] : g.jams.slice(0, 5);
      this.listKey = key;
      this.listT = now;
    }
    const sites = this.listOrder;
    const tools = this.listTools();
    const jams = this.listJams;
    const body = [];
    if (!filtering) {
      const fleet = this.fleetSec();
      if (fleet) body.push(fleet);
    }
    if (jams.length) {
      body.push(h('div', { class: 'sec', key: 'jam' }, h('h3', null, '막히는 곳'), jams.map((j) => h('button', { class: 'list-row', key: `j${j.node.id}`, onclick: () => this.goNode(j.node) },
        j.site ? raw(siteIcon(j.site), 'ico') : ico('jam'), h('span', { class: 't' }, j.site ? `${j.site.name} 진입로` : j.node.name), h('span', { class: `state ${j.stuck > 30 ? 'bad' : 'warn'}` }, `${j.waiting}대`)))));
    }
    if (!sites.length) body.push(h('p', { class: 'status', key: 'none' }, '조건에 맞는 거점이 없습니다.'));
    else if (f.sort === 'region') {
      const grouped = g.regions.filter((r) => r.unlocked).map((r) => ({ r, list: sites.filter((s) => s.region === r.index) })).filter((q) => q.list.length).reverse();
      for (const { r, list } of grouped) body.push(h('div', { class: 'sec', key: `reg${r.index}` }, h('h3', null, r.short, h('span', null, `${list.length}곳`)), list.map((s) => this.listRow(s))));
    } else if (f.sort === 'state') {
      // 순서를 정할 때의 상태로 묶어, 순서를 고정한 동안 줄이 다른 묶음으로 옮겨 가지 않게 한다
      for (const name of LIST_STATES) {
        const list = sites.filter((s) => this.listStates.get(s) === name);
        if (list.length) body.push(h('div', { class: 'sec', key: `st${name}` }, h('h3', null, name, h('span', null, `${list.length}곳`)), list.map((s) => this.listRow(s))));
      }
    } else {
      body.push(h('div', { class: 'sec', key: 'sorted' }, h('h3', null, `${LIST_SORTS.find((q) => q[0] === f.sort)[1]} 순서`, h('span', null, `${sites.length}곳`)), sites.map((s) => this.listRow(s))));
    }
    return [this.head(ico('list'), '거점 목록', null, () => this.setList(false)), tools, h('div', { class: 'p-body', key: 'body' }, body)];
  }

  advice() {
    const g = this.game;
    const out = [];
    const tech = TECHS.find((t) => !g.techs.has(t.id) && g.techVisible(t) && g.money >= t.cost);
    if (tech) out.push({ title: `${tech.name} 연구 가능`, sub: fmtWon(tech.cost), tone: 'info', go: () => this.openModal('research') });
    const stuck = g.jams.find((j) => j.stuck > 40 && !j.site);
    if (stuck) out.push({ title: `${stuck.node.name} 막힘`, sub: `트럭 ${stuck.waiting}대. 신호를 놓거나 트럭을 줄이세요`, tone: 'bad', go: () => this.goNode(stuck.node) });
    const full = g.sites.filter((s) => s.available && s.produces && s.stock > g.siteCap(s) * 0.75 && !s.yard.length).sort((a, b) => GOODS[b.goods].price - GOODS[a.goods].price)[0];
    if (full) out.push({ title: `${full.name} 화물 적체`, sub: '트럭을 늘리면 바로 수익이 됩니다', tone: 'warn', go: () => this.goSite(full) });
    const idle = g.sites.filter((s) => s.available && s.produces && s.yard.length >= 2).sort((a, b) => b.yard.length - a.yard.length)[0];
    if (idle) out.push({ title: `${idle.name} 화물 부족`, sub: `트럭 ${idle.yard.length}대가 기다립니다. ${idle.inputs ? '원료를 더 보내세요' : '생산을 증설하세요'}`, tone: 'info', go: () => this.goSite(idle) });
    return out.slice(0, 3);
  }

  goSite(s) {
    this.select({ type: 'site', site: s });
    const k = Math.min(this.r.cam.k, 0.2);
    this.r.cam.focus(s.x, s.y, k);
  }
  goNode(n) {
    if (n.site) { this.goSite(n.site); return; }
    this.select({ type: 'node', node: n });
    this.r.cam.focus(n.x, n.y, Math.min(this.r.cam.k, 0.1));
  }

  siteStatus(s) {
    const g = this.game;
    if (!s.produces) return { tone: 'ok', short: '정상', text: '납품 받는 중' };
    const frac = s.stock / g.siteCap(s);
    const trucks = s.routesOut.reduce((sum, q) => sum + q.trucks.length, 0);
    if (s.inputs && s.inBuf.some((v) => v < 0.05) && s.stock < 1) return { tone: 'bad', short: '원료 없음', text: `원료가 없어 멈췄습니다. ${s.inputs.map((slot) => slot.map((q) => GOODS[q].name).join('·')).join(' + ')}을(를) 보내세요.` };
    if (!trucks) return { tone: 'warn', short: '트럭 없음', text: '트럭을 사서 노선을 여세요.' };
    if (frac > 0.75) return { tone: 'warn', short: '트럭 부족', text: '화물이 쌓입니다. 트럭을 더 사면 바로 수익이 늘어납니다.' };
    if (s.yard.length >= 2) return { tone: 'info', short: '화물 부족', text: s.inputs ? `트럭 ${s.yard.length}대가 화물을 기다립니다. 원료를 더 보내세요.` : `트럭 ${s.yard.length}대가 화물을 기다립니다. 생산을 늘리세요.` };
    return { tone: 'ok', short: '원활', text: '' };
  }

  goodsPill(gid) {
    const g = GOODS[gid];
    return h('span', { class: 'goods', key: gid }, h('i', { style: `background:${g.color}` }), g.name);
  }

  siteView(s) {
    const g = this.game;
    const regionName = g.regions[s.region].short;
    const head = this.head(raw(siteIcon(s), 'ico site-ico'), s.name, `${regionName} · ${SITE_KIND_NAME[s.kind]}${s.kind === 'city' ? ` · ${CITY_STAGE_NAME[s.cityStage]}` : ''}`, () => this.select(null));
    const node = g.net.nodes[s.node];
    const body = [];
    if (s.produces) body.push(...this.productionSec(s));
    if (s.isCity || s.kind === 'port') body.push(...this.consumerSec(s));
    if (s.inputs && !s.isCity && s.inBuf.some((v) => v < g.inputCap(s) * 0.1)) body.push(...this.factoryIncoming(s));
    if (s.produces) body.push(...this.routesSec(s));
    if (node.waiting >= 3) body.push(this.baySec(s));
    body.push(this.siteMore(s));
    return [head, h('div', { class: 'p-body', key: `body-${s.id}` }, body)];
  }

  productionSec(s) {
    const g = this.game;
    const cap = g.siteCap(s);
    const rate = g.siteRate(s);
    const st = this.siteStatus(s);
    const frac = s.stock / cap;
    const gd = GOODS[s.goods];
    const kids = [];
    const chain = [];
    if (s.inputs) {
      s.inputs.forEach((slot, i) => {
        if (i > 0) chain.push(h('span', { class: 'sep', key: `p${i}` }, '+'));
        chain.push(h('span', { class: 'goods', key: `in${i}` }, slot.map((q) => h('i', { key: q, style: `background:${GOODS[q].color}` })), slotName(slot)));
      });
      chain.push(h('span', { class: 'sep', key: 'to' }, '→'));
    }
    chain.push(this.goodsPill(s.goods));
    kids.push(h('div', { class: 'chain', key: 'chain' }, chain));
    if (st.tone !== 'ok') kids.push(h('p', { class: `status ${st.tone}`, key: 'st' }, st.text));
    kids.push(this.meter('창고', frac, gd.color, `창고 ${fmtTon(s.stock)} / ${fmtTon(cap)}`, 'stock', frac > 0.85));
    if (s.inputs) {
      const ic = g.inputCap(s);
      s.inputs.forEach((slot, i) => {
        const name = slot.length === 1 ? GOODS[slot[0]].name : '원료';
        kids.push(this.meter(name, s.inBuf[i] / ic, GOODS[slot[0]].color, `${name} ${fmtTon(s.inBuf[i])} / ${fmtTon(ic)}`, `ib${i}`, s.inBuf[i] < ic * 0.05));
      });
    }
    const cost = g.upgradeCost(s);
    kids.push(h('button', {
      class: 'btn up', key: 'upg', disabled: g.money < cost, onclick: () => { if (g.buyUpgrade(s)) { this.sound.buy(); this.renderInspector(true); } else this.sound.deny(); },
      'data-tip': `생산 ${rate.toFixed(2)} → ${(rate * 1.38).toFixed(2)} t/s (Lv.${s.level + 1})\n늘어난 물량을 나를 트럭이 더 필요해집니다.`,
    }, h('span', null, '생산 +38%'), h('span', { class: 'price' }, fmtWon(cost))));
    return [h('div', { class: 'sec', key: 'prod' }, kids)];
  }

  consumerSec(s) {
    const g = this.game;
    const kids = [];
    if (s.kind === 'city') {
      const scale = 1 + Math.sqrt(s.pop) / 8;
      const need = [0, 25, 110, 480, 2000, 9000];
      const cur = s.cityStage;
      const a = need[cur] * scale * Math.pow(1.5, s.stage);
      const b = cur < 5 ? need[cur + 1] * scale * Math.pow(1.5, s.stage) : a;
      const f = cur < 5 ? (s.growth - a) / (b - a) : 1;
      kids.push(h('p', { class: 'bonus', key: 'bonus' }, '납품가 ', h('b', null, `+${s.cityStage * 8}%`)));
      kids.push(this.meter('성장', f, 'var(--ink)', `${cur < 5 ? `다음 단계 ${CITY_STAGE_NAME[cur + 1]}` : '최대로 자랐습니다'}\n납품할수록 자라고 납품가가 오릅니다. 시멘트는 5배 빨리 키웁니다.\n인구 약 ${s.pop}만 명`, 'grow'));
    }
    if (s.kind === 'dokdo') kids.push(h('p', { class: 'bonus', key: 'dok' }, '납품가 ', h('b', null, '6배'), ' · 울릉도를 거쳐 뱃길로 갑니다'));
    kids.push(h('div', { class: 'chain', key: 'acc' }, [...s.accepts].filter((q) => s.isCity || s.kind === 'port').map((q) => this.goodsPill(q))));
    const active = s.routesIn.some((q) => q.trucks.length);
    if (!active) kids.push(h('p', { class: 'status', key: 'none' }, s.kind === 'port' ? '아직 수출하는 트럭이 없습니다.' : '아직 납품하는 트럭이 없습니다. 공장을 눌러 이곳으로 가는 노선에 트럭을 사세요.'));
    return [h('div', { class: 'sec', key: 'consume' }, kids)];
  }

  factoryIncoming(s) {
    const lines = s.routesIn.filter((q) => q.valid).sort((a, b) => b.trucks.length - a.trucks.length || a.dist - b.dist).slice(0, 6);
    if (!lines.length) return [];
    return [h('div', { class: 'sec', key: 'incoming' }, h('h3', null, '원료 공급처'), lines.map((q) => h('button', { class: 'list-row', key: q.id, onclick: () => this.goSite(q.from), onmouseenter: () => this.updateHighlights(q), onmouseleave: () => this.updateHighlights(), 'data-tip': `${GOODS[q.goods].name} · ${Math.round(q.dist)}km` },
      raw(siteIcon(q.from), 'ico'), h('span', { class: 't' }, q.from.name), h('span', { class: `state ${q.trucks.length ? '' : 'warn'}` }, q.trucks.length ? `${q.trucks.length}대` : '트럭 없음'))))];
  }

  // 고를 트럭이 둘 이상일 때만 보여 준다
  modelSeg() {
    const unlocked = TRUCKS.map((m, i) => [m, i]).filter(([, i]) => this.game.modelUnlocked(i));
    if (unlocked.length < 2) return null;
    return h('div', { class: 'seg', key: 'models' }, unlocked.map(([q, i]) => h('button', {
      key: q.id, class: this.modelSel === i ? 'on' : '',
      onclick: () => { this.modelSel = i; this.sound.click(); this.renderInspector(true); },
      'data-tip': `${q.name}\n${q.desc}\n적재 ${q.cap}t · 속도 ${Math.round(q.speed * 100)}%`,
    }, q.short)));
  }
  countSeg() {
    return h('div', { class: 'seg', key: 'buyn' }, [[1, '1대'], [5, '5대'], [10, '10대'], [0, '최대']].map(([n, label]) => h('button', {
      key: String(n), class: this.buyCount === n ? 'on' : '', onclick: () => { this.buyCount = n; this.sound.click(); this.renderInspector(true); },
    }, label)));
  }

  routesSec(s) {
    const g = this.game;
    const kids = [];
    const routes = s.routesOut.filter((q) => q.valid).sort((a, b) => a.dist - b.dist);
    if (!g.modelUnlocked(this.modelSel)) this.modelSel = 0;
    const m = this.modelSel;
    if (routes.length) kids.push(this.modelSeg());
    if (routes.length && g.truckCount >= 3) kids.push(this.countSeg());
    if (!routes.length) kids.push(h('p', { class: 'status', key: 'nor' }, '아직 이 화물을 받아줄 곳이 없습니다. 권역을 더 개발하면 열립니다.'));
    if (routes.length && GOODS[s.goods].growth) kids.push(h('p', { class: 'status', key: 'grow' }, `값은 싸지만 도시에 납품하면 도시가 ${GOODS[s.goods].growth}배 빨리 자랍니다.`));
    for (const q of routes) {
      const cap = g.truckCap(TRUCKS[m]);
      const trip = q.perTon * cap * (1 + g.upg.pay * 0.14);
      const afford = g.truckAffordable(q, m);
      const n = this.buyCount === 0 ? Math.max(1, afford) : this.buyCount;
      const price = g.truckBatchPrice(q, m, n);
      const running = q.trucks.length > 0 && q.rate > 0;
      // 고른 차종보다 적게 싣는 트럭을 바꾼다. 대수는 구매 대수를 따르고, 돈이 모자라면 살 수 있는 만큼만
      const conv = g.convertibleTrucks(q, m);
      const convLimit = this.buyCount === 0 ? conv.length : Math.min(this.buyCount, conv.length);
      let convN = 0, convCost = 0;
      const convNames = new Set();
      for (const v of conv.slice(0, convLimit)) {
        const c = g.convertPrice(v, m);
        if (convCost + c > g.money) break;
        convCost += c;
        convN++;
        convNames.add(TRUCKS[v.nextModel ?? v.modelIdx].short);
      }
      const mix = TRUCKS.map((t, i) => [t.short, q.trucks.filter((v) => (v.nextModel ?? v.modelIdx) === i && !v.retire).length]).filter((p) => p[1]).map((p) => `${p[0]} ${p[1]}대`).join(' · ');
      kids.push(h('div', {
        class: `route${!q.opened && routes.some((x) => x.opened) ? ' new' : ''}`, key: q.id, style: `--c:${GOODS[q.goods].color}`,
        onmouseenter: () => this.updateHighlights(q), onmouseleave: () => this.updateHighlights(),
        'data-tip': `${Math.round(q.dist)}km · 막힘 없으면 ${Math.round(q.freeTime)}초\n1회 ${fmtWon(trip)} · 분당 ${fmtWon(q.rate * 60)}`,
      },
      h('div', { class: 'route-top' }, h('span', { class: 'name' }, q.to.name), h('b', null, running ? `${fmtWon(q.rate * 60)}/분` : `1회 ${fmtWon(trip)}`)),
      h('div', { class: 'route-act' },
        h('button', {
          class: 'btn sell', disabled: !q.trucks.length, 'aria-label': '트럭 한 대 처분', 'data-tip': '트럭 한 대를 처분합니다 (구매가의 50% 환급).\n도로가 막힐 때 숨통을 틔웁니다.',
          onclick: () => { if (g.sellTruck(q)) { this.sound.click(); this.renderInspector(true); } },
        }, ico('minus')),
        h('span', { class: 'count', key: `c${q.trucks.length}`, 'data-tip': mix ? `이 노선의 트럭\n${mix}` : '이 노선의 트럭 수' }, `${q.trucks.length}대`),
        h('button', {
          class: 'btn buy', disabled: g.money < price,
          onclick: () => {
            let bought = 0;
            for (let i = 0; i < n; i++) { if (g.buyTruck(q, m)) bought++; else break; }
            if (bought) { this.sound.buy(); this.updateHighlights(); this.renderInspector(true); this.renderTop(); } else this.sound.deny();
          },
        }, n > 1 ? `트럭 ${n}대` : '트럭', h('span', { class: 'price' }, fmtWon(price)))),
      conv.length > 0 && h('button', {
        class: 'btn up conv', key: 'conv', disabled: !convN,
        'data-tip': `더 적게 싣는 트럭 ${conv.length}대를 ${TRUCKS[m].name}으로 바꿀 수 있습니다.\n값은 지금 트럭을 팔고(구매가의 50%) 새로 산 것과 같습니다.\n달리는 트럭은 다음 거점에 닿을 때 바뀝니다.`,
        onclick: () => {
          const r = g.convertTrucks(q, m, convN);
          this.afterConvert(r.n, r.paid, m);
        },
      }, h('span', null, `${[...convNames].join('·') || TRUCKS[conv[0].nextModel ?? conv[0].modelIdx].short} ${Math.max(1, convN)}대 → ${TRUCKS[m].short}`), h('span', { class: 'price' }, fmtWon(convN ? convCost : g.convertPrice(conv[0], m)))),
      g.techs.has('autobuy') && h('label', { class: 'field small' }, '자동 배차', h('input', { type: 'checkbox', checked: q.auto, onchange: (e) => { q.auto = e.target.checked; q.model = m; } }))));
    }
    return [h('div', { class: 'sec', key: 'routes' }, kids)];
  }

  baySec(s) {
    const g = this.game;
    const cost = g.bayCost(s);
    const node = g.net.nodes[s.node];
    const waiting = node.waiting;
    return h('div', { class: 'sec', key: 'bay' },
      waiting >= 3 && h('p', { class: 'status bad', key: 'wait' }, `진입로에 트럭 ${waiting}대가 기다립니다.`),
      s.bays < 12 && h('button', {
        class: 'btn up', key: 'buybay', disabled: g.money < cost, onclick: () => { if (g.buyBay(s)) { this.sound.buy(); this.renderInspector(true); } else this.sound.deny(); },
        'data-tip': `상하차장 ${s.bays} → ${s.bays + 1}칸\n진입로 정체가 큰길까지 번지는 것을 막아 줍니다.`,
      }, h('span', null, '상하차장 +1칸'), h('span', { class: 'price' }, fmtWon(cost))));
  }

  siteMore(s) {
    const g = this.game;
    const node = g.net.nodes[s.node];
    const kids = [this.moreBtn()];
    if (this.more) {
      const rows = [];
      if (s.produces) {
        rows.push(this.kv('생산량', `${g.siteRate(s).toFixed(2)} t/s`));
        rows.push(this.kv('창고', `${fmtTon(s.stock)} / ${fmtTon(g.siteCap(s))}`));
        rows.push(this.kv('이 거점의 트럭', `${s.routesOut.reduce((sum, q) => sum + q.trucks.length, 0)}대`));
        rows.push(this.kv('화물을 기다리는 트럭', `${s.yard.length}대`));
      }
      if (s.inputs) {
        const ic = g.inputCap(s);
        s.inputs.forEach((slot, i) => rows.push(this.kv(slot.length === 1 ? GOODS[slot[0]].name : '원료', `${fmtTon(s.inBuf[i])} / ${fmtTon(ic)}`, `in${i}`)));
      }
      if (s.isCity || s.kind === 'port') {
        rows.push(this.kv('누적 납품', fmtTon(s.delivered)));
        rows.push(this.kv('들어오는 트럭', `${s.routesIn.reduce((sum, q) => sum + q.trucks.length, 0)}대`));
      }
      rows.push(this.kv('상하차장', `${s.bays}칸`));
      if (s.lot && s.lot.cap) rows.push(this.kv('주차장', `${s.lot.used} / ${s.lot.cap}칸`));
      kids.push(h('div', { class: 'kvs', key: 'kvs' }, rows));
      if (node.waiting < 3) kids.push(this.baySec(s));
      if (s.inputs && !s.isCity && !s.inBuf.some((v) => v < g.inputCap(s) * 0.1)) kids.push(...this.factoryIncoming(s));
      if (s.isCity || s.kind === 'port') {
        const lines = s.routesIn.filter((q) => q.trucks.length).sort((a, b) => b.rate - a.rate).slice(0, 6);
        if (lines.length) {
          kids.push(h('div', { class: 'sec', key: 'lines' }, h('h3', null, '들어오는 노선'), lines.map((q) => h('button', { class: 'list-row', key: q.id, onclick: () => this.goSite(q.from), onmouseenter: () => this.updateHighlights(q), onmouseleave: () => this.updateHighlights(), 'data-tip': `${GOODS[q.goods].name} · ${Math.round(q.dist)}km` },
            raw(siteIcon(q.from), 'ico'), h('span', { class: 't' }, q.from.name), h('span', { class: 'state' }, `${q.trucks.length}대`)))));
        }
      }
    }
    return h('div', { class: 'sec more', key: 'more' }, kids);
  }

  nodeView(n) {
    const g = this.game;
    const roads = [...new Map(n.roads.filter((r) => r.ref && (r.kind === 'x' || r.kind === 'n')).map((r) => [`${r.kind}${r.ref}`, r])).values()].slice(0, 3);
    const leading = roads.length ? h('div', { class: 'badges' }, roads.map((r) => raw(routeBadge(r.kind, r.ref), 'badge'))) : ico('t_signal');
    const head = this.head(leading, n.name, `${g.regions[n.region]?.short || ''} · ${CONTROL_NAME[n.control]}`, () => this.select(null));
    const body = [];
    const stuck = n.stuckT > 25;
    if (n.waiting >= 3) body.push(h('p', { class: `status ${stuck ? 'bad' : 'warn'}`, key: 'wait' }, stuck ? `트럭 ${n.waiting}대가 ${fmtTime(n.stuckT)}째 막혀 있습니다.` : `트럭 ${n.waiting}대가 기다립니다.`));
    const opts = [
      ['auto', 'select', '기본', true],
      ['signal', 'signal', '신호등', g.techs.has('signal')],
      ['roundabout', 'roundabout', '회전교차로', g.techs.has('roundabout')],
      ['interchange', 'interchange', '입체교차로', g.techs.has('interchange')],
    ].filter((q) => q[3]);
    body.push(h('div', { class: 'ctl-grid', key: 'ctl' }, opts.map(([id, toolId, name]) => {
      const t = TOOLS.find((q) => q.id === toolId);
      const price = g.controlPrice(n, id);
      const on = n.control === id;
      return h('button', {
        key: id, class: `ctl${on ? ' on' : ''}`, style: `--c:${t.color}`, disabled: !on && g.money < price,
        'data-tip': id === 'auto' ? '먼저 온 트럭부터 천천히 통과합니다. 몰리면 금방 막힙니다.' : t.desc,
        onclick: () => { if (!on && g.setControl(n, id)) { this.sound.place(); this.r.baseDirty = true; this.renderInspector(true); } },
      }, h('span', { class: 'disc' }, ico(t.icon)), h('b', null, name), h('small', null, on ? '사용 중' : price ? fmtWon(price) : '무료'));
    })));
    if (n.control === 'roundabout' && g.techs.has('ring2') && n.ringLanes < 2) {
      body.push(h('button', { class: 'btn up', key: 'ring2', onclick: () => { if (g.buyRing2(n)) { this.sound.place(); this.r.baseDirty = true; } } }, '2차로로 확장'));
    }
    if ((stuck || n.waiting > 6) && g.techs.has('tow')) {
      body.push(h('button', {
        class: 'btn', key: 'tow', disabled: g.money < g.towPrice(n),
        onclick: () => { const c = g.tow(n); if (c) { this.sound.horn(); this.toast('tow', `트럭 ${c}대를 견인했습니다`, '화물을 내려놓고 출발지로 돌아갑니다'); } },
      }, ico('tow'), `맨 앞 트럭 견인 ${fmtWon(g.towPrice(n))}`));
    }
    const anySign = n.control === 'auto' && n.inE.some((e) => e.sign > 0);
    const more = [this.moreBtn()];
    if (n.control === 'auto' && (anySign || this.more)) {
      const rows = n.inE.filter((e) => e.road.open && e.road.kind !== 'f').map((e) => {
        const defaultYield = !anySign && n.major.size && !n.major.has(e.id);
        const from = g.net.nodes[e.from];
        const q = e.lanes.reduce((sum, l) => sum + l.veh.length, 0);
        return h('div', { class: 'approach', key: `e${e.id}`, 'data-tip': `${e.road.name || KIND_NAME[e.road.kind]} · ${q}대${defaultYield ? ' · 기본 양보' : ''}` },
          h('span', { class: 'who' }, `${from.site ? from.site.name : from.name} 쪽`),
          h('div', { class: 'seg mini' }, [[0, '없음', null], [1, null, 't_yield'], [2, null, 't_stop']].map(([sign, text, icon]) => h('button', {
            key: String(sign), class: e.sign === sign ? 'on' : '',
            'data-tip': sign === 0 ? '표지 없음' : `${sign === 1 ? '양보' : '정지'} 표지 ${fmtWon(g.signPrice(e, sign))}`,
            onclick: () => { if (g.setSign(e, sign)) { this.sound.place(); this.renderInspector(true); } else if (e.sign !== sign) this.sound.deny(); },
          }, icon ? ico(icon) : text))));
      });
      body.push(h('div', { class: 'sec', key: 'signs' }, h('h3', null, '진입 방향별 표지'), rows));
    }
    if (this.more) {
      more.push(h('div', { class: 'kvs', key: 'kvs' },
        this.kv('대기 트럭', `${n.waiting}대`),
        this.kv('처리량', `${Math.round(n.flow * 60)}대/분`),
        this.kv('최장 정지', n.stuckT < 1 ? '없음' : fmtTime(n.stuckT))));
      if (n.control === 'signal') more.push(h('p', { class: 'status', key: 'sig' }, g.techs.has('smartsig') ? '감응 신호가 차가 빠지는 동안 녹색을 최대 8초까지 늘리고, 막히면 일찍 끊습니다.' : '기다리는 방향을 보고 충돌 없는 흐름끼리 묶어 4.6초씩 보냅니다.'));
    }
    body.push(h('div', { class: 'sec more', key: 'more' }, more));
    return [head, h('div', { class: 'p-body', key: `body-n${n.id}` }, body)];
  }

  projectView(p) {
    const g = this.game;
    const price = g.projectPrice(p);
    const avail = g.projectAvailable(p);
    const stageName = g.regions[p.stage]?.short || '';
    return [this.head(ico(p.kind === 'bridge' ? 'bridge' : 'bypass'), p.name, `${p.kind === 'bridge' ? '대교·해상 도로' : '우회 고속도로'} · ${Math.round(p.km)}km`, () => this.select(null)),
      h('div', { class: 'p-body', key: `body-p${p.id}` },
        h('p', { class: 'status', key: 'd' }, p.desc),
        p.built ? h('p', { class: 'status ok', key: 'b' }, '개통 완료')
          : avail ? h('button', { class: 'btn buy', key: 'b', disabled: g.money < price, 'data-tip': `실제 총사업비 기준${PROJECT_COST[p.id].est ? ' (추정)' : ''}. 건설하면 트럭들이 알아서 더 빠른 길로 다닙니다.`, onclick: () => { if (g.buildProject(p)) { this.sound.fanfare(); this.r.baseDirty = true; this.select(null); this.renderTop(); } else this.sound.deny(); } }, '건설', h('span', { class: 'price' }, fmtWon(price)))
            : h('p', { class: 'status warn', key: 'b' }, `${stageName} 권역이 열리면 건설할 수 있습니다`)),
    ];
  }

  ferryView(r) {
    const g = this.game;
    const fy = r.ferryObj;
    const price = g.ferryPrice(fy);
    return [this.head(ico('ship'), r.name, `${Math.round(r.len)}km 뱃길 · 한 번에 ${fy.cap}대`, () => this.select(null)),
      h('div', { class: 'p-body', key: `body-f${r.id}` },
        h('button', { class: 'btn up', key: 'up', disabled: g.money < price || fy.cap >= 120, 'data-tip': `한 번에 싣는 트럭 ${fy.cap} → ${fy.cap + 10}대\n배가 작으면 터미널 줄이 큰길까지 밀립니다.`, onclick: () => { if (g.buyFerry(fy)) { this.sound.buy(); this.renderInspector(true); } else this.sound.deny(); } }, h('span', null, '카페리 증편'), h('span', { class: 'price' }, fmtWon(price))),
        h('div', { class: 'sec more', key: 'more' }, this.moreBtn(), this.more && h('div', { class: 'kvs', key: 'kvs' },
          this.kv('지금 실린 트럭', `${fy.cargo.length}대`),
          this.kv('운항 횟수', `${fy.trips}회`),
          this.kv('상태', fy.state === 'dock' ? '접안 중' : '운항 중')))),
    ];
  }

  roadView(r) {
    if (r.kind === 'f') return this.ferryView(r);
    const g = this.game;
    const hasBadge = r.ref && (r.kind === 'x' || r.kind === 'n') && /^\d+$/.test(r.ref);
    const leading = hasBadge ? raw(routeBadge(r.kind, r.ref), 'badge') : ico('t_lane');
    const a = g.net.nodes[r.a], b = g.net.nodes[r.b];
    const head = this.head(leading, r.name || KIND_NAME[r.kind], `${Math.round(r.len)}km · 왕복 ${r.lanes * 2}차로`, () => this.select(null));
    const body = [];
    for (const e of [r.fwd, r.bwd]) {
      if (e.cong <= 0.3) continue;
      const to = g.net.nodes[e.to];
      body.push(h('p', { class: `status ${e.cong > 0.62 ? 'bad' : 'warn'}`, key: `c${e.id}` }, `${to.site ? to.site.name : to.name} 방향이 막힙니다 (${e.count}대)`));
    }
    const canAdd = g.canAddLane(r);
    const price = g.lanePrice(r);
    if (canAdd) {
      body.push(h('button', {
        class: 'btn up', key: 'lane', disabled: g.money < price,
        'data-tip': `1km당 ${fmtWon(LANE_PRICE_PER_KM[r.kind])} 기준입니다. 차로가 늘수록 비싸지고, 땅값이 비싼 지역은 보상비가 더 듭니다.\n차로가 늘면 줄을 더 많이 세울 수 있고, 좌회전과 직진 트럭이 서로 막지 않습니다.`,
        onclick: () => { if (g.addLane(r)) { this.sound.place(); this.r.baseDirty = true; this.renderInspector(true); } else this.sound.deny(); },
      }, h('span', null, `왕복 ${r.lanes * 2} → ${r.lanes * 2 + 2}차로`), h('span', { class: 'price' }, fmtWon(price))));
    } else body.push(h('p', { class: 'status', key: 'max' }, '최대 차로입니다.'));
    const more = [this.moreBtn()];
    if (this.more) {
      more.push(h('div', { class: 'kvs', key: 'kvs' },
        this.kv('구간', `${a.site ? a.site.name : a.name} – ${b.site ? b.site.name : b.name}`),
        this.kv('제한 속도', `${r.kind === 'x' ? 100 : r.kind === 'n' ? 80 : 60}km/h`),
        this.kv('양방향 트럭', `${r.fwd.count + r.bwd.count}대`)));
    }
    body.push(h('div', { class: 'sec more', key: 'more' }, more));
    return [head, h('div', { class: 'p-body', key: `body-r${r.id}` }, body)];
  }

  // ── 창 ─────────────────────────────────────────────
  openModal(name, data = null) {
    this.modalName = name;
    this.modalData = data;
    clearTimeout(this.modalT);
    this.el.modal.classList.remove('closing');
    this.el.modal.classList.add('show');
    this.sound.click();
    this.renderModal();
    this.renderTop();
    const body = this.el.modal.querySelector('.p-body');
    if (body) body.scrollTop = 0;
  }
  closeModal() {
    this.modalName = null;
    const m = this.el.modal;
    m.classList.add('closing');
    clearTimeout(this.modalT);
    this.modalT = setTimeout(() => {
      m.classList.remove('show', 'closing');
      patch(m, []);
    }, 150);
    this.confirmReset = false;
    this.saveText = '';
    this.renderTop();
  }
  renderModal() {
    const n = this.modalName;
    if (!n) return;
    const v = n === 'research' ? this.researchDialog() : n === 'build' ? this.buildDialog() : n === 'settings' ? this.settingsDialog() : n === 'welcome' ? this.welcomeDialog() : n === 'offline' ? this.offlineDialog() : n === 'alldone' ? this.allDoneDialog() : null;
    patch(this.el.modal, v ? [v] : []);
    this.el.modal.onclick = (e) => { if (e.target === this.el.modal && n !== 'welcome') this.closeModal(); };
  }

  dialogHead(title, sub) {
    return h('div', { class: 'd-head', key: 'head' }, h('h2', null, title), sub && h('span', null, sub), h('button', { class: 'p-x', onclick: () => this.closeModal(), 'aria-label': '닫기', 'data-tip': '닫기 (Esc)' }, ico('close')));
  }

  researchDialog() {
    const g = this.game;
    const upgRows = UPGRADES.map((u) => {
      const lv = g.upg[u.id];
      const cost = g.upgradeCostOf(u.id);
      const maxed = lv >= u.max;
      return h('div', { class: 'row', key: u.id, 'data-tip': u.desc },
        h('span', { class: 'disc' }, ico(u.icon)),
        h('div', { class: 't' }, h('b', null, u.name), h('small', null, maxed ? `${u.fmt(lv * u.per)} · 최고 단계` : `${u.fmt(lv * u.per)} → ${u.fmt((lv + 1) * u.per).replace(/^.*?(?=[+−])/, '')}`)),
        !maxed && h('button', { class: 'btn buy', disabled: g.money < cost, onclick: () => { if (g.buyUpg(u.id)) { this.sound.buy(); this.renderModal(); this.renderTop(); } } }, h('span', { class: 'price' }, fmtWon(cost))));
    });
    const open = TECHS.filter((t) => g.techVisible(t) && !g.techs.has(t.id));
    const done = TECHS.filter((t) => g.techs.has(t.id));
    const hidden = TECHS.filter((t) => !g.techVisible(t) && !g.techs.has(t.id)).length;
    const techRows = open.map((t) => h('div', { class: 'row', key: t.id },
      h('span', { class: 'disc' }, ico(t.icon)),
      h('div', { class: 't' }, h('b', null, t.name), h('small', null, t.desc)),
      h('button', { class: 'btn buy', disabled: g.money < t.cost, onclick: () => { if (g.buyTech(t.id)) { this.sound.fanfare(); this.renderDock(); this.renderModal(); this.renderTop(); } } }, h('span', { class: 'price' }, fmtWon(t.cost)))));
    return h('div', { class: 'dialog', role: 'dialog', 'aria-label': '연구' },
      this.dialogHead('연구', `자금 ${fmtWon(g.money)}`),
      h('div', { class: 'p-body' },
        techRows.length > 0 && h('div', { class: 'list', key: 'tech' }, h('h3', null, '새로운 기술'), techRows),
        h('div', { class: 'list', key: 'upg' }, h('h3', null, '꾸준히 강해지는 연구'), upgRows),
        (done.length > 0 || hidden > 0) && h('p', { class: 'foot', key: 'foot' }, done.length > 0 && `완료: ${done.map((t) => t.name).join(', ')}. `, hidden > 0 && `권역이 더 개발되면 ${hidden}개가 더 열립니다.`)));
  }

  buildDialog() {
    const g = this.game;
    const list = g.projects.filter((p) => p.roads.length).sort((a, b) => a.stage - b.stage);
    const avail = list.filter((p) => p.stage <= g.stage && !p.built);
    const built = list.filter((p) => p.built);
    const locked = list.filter((p) => p.stage > g.stage).length;
    return h('div', { class: 'dialog', role: 'dialog', 'aria-label': '건설' },
      this.dialogHead('우회도로와 대교', `자금 ${fmtWon(g.money)}`),
      h('div', { class: 'p-body' },
        avail.length ? h('div', { class: 'list', key: 'c' }, h('h3', null, '실제 총사업비 기준입니다. 건설하면 트럭이 알아서 더 빠른 길로 다닙니다.'), avail.map((p) => {
          const price = g.projectPrice(p);
          return h('div', { class: 'row', key: p.id },
            h('span', { class: 'disc' }, ico(p.kind === 'bridge' ? 'bridge' : 'bypass')),
            h('div', { class: 't' }, h('b', null, p.name), h('small', null, `${Math.round(p.km)}km · ${p.desc}${PROJECT_COST[p.id].est ? ' · 사업비 추정' : ''}`)),
            h('div', { class: 'row-act' },
              h('button', { class: 'btn', onclick: () => { this.closeModal(); this.showProject(p); } }, '위치'),
              h('button', { class: 'btn buy', disabled: g.money < price, onclick: () => { if (g.buildProject(p)) { this.sound.fanfare(); this.r.baseDirty = true; this.renderModal(); this.renderTop(); } } }, h('span', { class: 'price' }, fmtWon(price)))));
        })) : h('p', { class: 'foot', key: 'none' }, '지금 건설할 수 있는 도로가 없습니다.'),
        (built.length > 0 || locked > 0) && h('p', { class: 'foot', key: 'foot' }, built.length > 0 && `개통: ${built.map((p) => p.name).join(', ')}. `, locked > 0 && `다음 권역이 열리면 ${locked}개가 더 나옵니다.`)));
  }

  showProject(p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of p.roads) { x0 = Math.min(x0, r.bb[0]); y0 = Math.min(y0, r.bb[1]); x1 = Math.max(x1, r.bb[2]); y1 = Math.max(y1, r.bb[3]); }
    this.r.cam.fitBox(x0 - 8, y0 - 8, x1 + 8, y1 + 8, 0.8, 1.2);
    this.r.ping((x0 + x1) / 2, (y0 + y1) / 2, '#8e6fc9');
  }

  settingsDialog() {
    const app = this.app, snd = this.sound;
    return h('div', { class: 'dialog small', role: 'dialog', 'aria-label': '설정' },
      this.dialogHead('설정'),
      h('div', { class: 'p-body' },
        h('div', { class: 'sec', key: 'snd' }, h('h3', null, '소리'),
          h('label', { class: 'field' }, '효과음 크기', h('input', { id: 'set-vol', type: 'range', min: 0, max: 1, step: 0.05, value: snd.volume, oninput: (e) => { snd.setVolume(Number(e.target.value)); app.saveSettings(); snd.click(); } })),
          h('label', { class: 'field' }, '배경음 크기', h('input', { id: 'set-music', type: 'range', min: 0, max: 1, step: 0.05, value: snd.musicVolume, oninput: (e) => { snd.setMusicVolume(Number(e.target.value)); app.saveSettings(); } })),
          h('label', { class: 'field' }, '배경음 켜기', h('input', { id: 'set-music-on', type: 'checkbox', checked: snd.musicOn, onchange: (e) => this.setMusic(e.target.checked) })),
          h('div', { class: 'field' }, h('span', { class: 'now-playing' }, snd.track.title, h('small', null, snd.track.artist)), h('button', { class: 'btn', onclick: () => { snd.unlock(); snd.nextTrack(); this.renderModal(); } }, '다음 곡'))),
        h('div', { class: 'sec', key: 'map' }, h('h3', null, '지도'),
          h('div', { class: 'btn-row' },
            h('button', { class: `btn${this.r.palName === 'day' ? ' go' : ''}`, onclick: () => { this.r.setPalette('day'); app.saveSettings(); app.drawMiniBase(); this.renderModal(); } }, '낮'),
            h('button', { class: `btn${this.r.palName === 'night' ? ' go' : ''}`, onclick: () => { this.r.setPalette('night'); app.saveSettings(); app.drawMiniBase(); this.renderModal(); } }, '밤'))),
        h('div', { class: 'sec', key: 'save' }, h('h3', null, '저장', h('span', null, '20초마다 이 브라우저에 자동 저장')),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', onclick: () => { app.save(); this.saveText = btoa(unescape(encodeURIComponent(JSON.stringify(this.game.serialize())))); this.renderModal(); this.toast('star', '저장했습니다', '아래 글자를 복사해 두면 다른 기기로 옮길 수 있습니다'); } }, '저장 코드 만들기'),
            h('button', { class: 'btn', onclick: () => { const t = document.getElementById('set-savebox').value.trim(); if (!t) { this.toast('warn', '저장 코드를 먼저 붙여넣으세요'); return; } app.importSave(t); } }, '코드 불러오기')),
          h('textarea', { id: 'set-savebox', class: 'savebox', placeholder: '저장 코드가 여기에 나타납니다. 불러올 코드를 붙여넣어도 됩니다.', value: this.saveText, spellcheck: 'false' }),
          this.confirmReset
            ? h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => { this.confirmReset = false; this.renderModal(); } }, '취소'), h('button', { class: 'btn danger', onclick: () => app.resetGame() }, '정말 처음부터'))
            : h('button', { class: 'btn danger', onclick: () => { this.confirmReset = true; this.renderModal(); } }, '처음부터 다시 시작')),
        h('div', { class: 'sec', key: 'keys' }, h('h3', null, '조작법'),
          h('p', { class: 'credit' }, '지도 끌기: 이동 · 휠 또는 두 손가락: 확대 · 1~8: 도구 선택 · 차로 도구로 끌기: 범위 넓히기 · 스페이스바: 일시정지 · R: 연구 · B: 건설 · L: 거점 목록 · M: 배경음 · Esc 또는 우클릭: 취소')),
        h('div', { class: 'sec', key: 'credit' }, h('h3', null, '만든 재료'),
          h('p', { class: 'credit' }, 'Rischer Kriebl의 게임 Incremental Traffic에서 영감을 받아 대한민국 지도로 다시 만든 비공식 팬 프로젝트입니다. 원작의 코드와 그림은 쓰지 않았습니다. 화면 디자인은 Dinosaur Polo Club의 Mini Metro를 참고했습니다.', h('br'), '지도 데이터: 도로·강·지명 © OpenStreetMap contributors (ODbL), 행정구역 KOSTAT(southkorea-maps), 해안선 Natural Earth. 그림은 모두 코드로 그린 벡터입니다.', h('br'), `배경음: ${MUSIC_TRACKS.map((q) => `${q.artist}, ${q.title}`).join(' · ')} (모두 CC0, OpenGameArt). 효과음은 코드로 합성했습니다.`, h('br'), '금액은 실제 시세와 공사비를 바탕으로 잡았고, 값이 너무 싼 벌크 화물만 게임에 맞게 올렸습니다.'))));
  }

  welcomeDialog() {
    return h('div', { class: 'welcome', role: 'dialog', 'aria-label': '시작' },
      h('h1', null, '팔도 트래픽'),
      h('p', { class: 'lead' }, '충주 사과밭의 용달 한 대로 시작해 전국 물류망을 완성하세요.'),
      h('ul', null,
        h('li', null, h('b', null, '트럭을 사면'), ' 화물을 나르고 돈이 들어옵니다'),
        h('li', null, h('b', null, '트럭이 늘면'), ' 길이 막힙니다. 표지와 신호, 차로로 푸세요'),
        h('li', null, h('b', null, '납품이 쌓이면'), ' 다음 권역이 열립니다')),
      h('button', { class: 'cta', onclick: () => { this.sound.unlock(); this.closeModal(); this.app.startFresh(); } }, h('span', { class: 'arrow' }, '→'), h('span', null, '충청북도에서 시작')),
      h('p', { class: 'credit' }, 'Incremental Traffic에서 영감을 받은 비공식 팬 프로젝트입니다.'));
  }

  offlineDialog() {
    const d = this.modalData;
    return h('div', { class: 'welcome', role: 'dialog', 'aria-label': '돌아오셨습니다' },
      h('h1', null, fmtWon(d.earned)),
      h('p', { class: 'lead' }, `${fmtTime(d.seconds)} 동안 비운 사이에 벌었습니다. 정체를 풀어 줄 사람이 없어 평소 수익의 절반입니다.`),
      h('button', { class: 'cta', onclick: () => this.closeModal() }, h('span', { class: 'arrow' }, '→'), h('span', null, '운행 계속')));
  }

  allDoneDialog() {
    const g = this.game;
    return h('div', { class: 'welcome', role: 'dialog', 'aria-label': '전국 물류망 완성' },
      h('h1', null, '전국 물류망 완성'),
      h('p', { class: 'lead' }, `${fmtTime(g.time)} 만에 팔도를 모두 이었습니다. 트럭 ${g.truckCount}대가 누적 ${fmtTon(g.totalTons)}을 날랐습니다.`),
      h('p', { class: 'lead' }, '이제 붐 단계입니다. 전국 납품 실적을 쌓을 때마다 납품가가 15%씩 오릅니다.'),
      h('button', { class: 'cta', onclick: () => this.closeModal() }, h('span', { class: 'arrow' }, '→'), h('span', null, '계속 운행')));
  }

  // ── 알림 ───────────────────────────────────────────
  toast(icon, title, sub, onClick) {
    const box = this.el.toasts;
    const t = document.createElement('button');
    t.className = 'toast';
    t.innerHTML = `<span class="ico">${iconHtml(icon)}</span><span><span class="ttl"></span><small></small></span>`;
    t.querySelector('.ttl').textContent = title;
    if (sub) t.querySelector('small').textContent = sub; else t.querySelector('small').remove();
    t.onclick = () => { if (onClick) onClick(); t.remove(); };
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 3600);
    setTimeout(() => t.remove(), 4000);
  }

  showBanner(small, big, em) {
    const el = this.el.banner;
    el.classList.remove('show');
    patch(el, [h('div', { class: 'banner-sign' }, h('small', null, small), h('b', null, big), em && h('em', null, em))]);
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  // ── 튜토리얼 ───────────────────────────────────────
  renderCoach() {
    const el = this.el.coach;
    const g = this.game;
    const steps = this.coachSteps();
    if (this.coachOff || !g.flags.tutorial) { el.classList.remove('show'); this.r.tutorTarget = null; return; }
    // 조건을 넘긴 단계는 건너뛴다
    while (this.coachStep < steps.length && steps[this.coachStep].done()) this.coachStep++;
    if (this.coachStep >= steps.length) { el.classList.remove('show'); this.r.tutorTarget = null; g.flags.tutorial = false; return; }
    const s = steps[this.coachStep];
    this.r.tutorTarget = s.target ? s.target() : null;
    patch(el, [h('div', { class: 'coach-card' }, h('h4', null, s.title), h('p', null, s.text), h('div', { class: 'coach-foot' }, h('span', null, `${this.coachStep + 1} / ${steps.length}`), h('button', { onclick: () => { this.coachOff = true; g.flags.tutorial = false; this.renderCoach(); } }, '설명 끄기')))]);
    el.classList.add('show');
  }

  coachSteps() {
    if (this._steps) return this._steps;
    const g = this.game;
    const apple = g.siteById.get('p_chungju_apple');
    const food = g.siteById.get('f_eumseong_food');
    const firstRoute = () => apple.routesOut[0];
    const foodRoutes = () => food.routesOut;
    this._steps = [
      { title: '첫 트럭을 사 보세요', text: '지도에서 고리가 퍼지는 충주 사과밭을 누르세요.', target: () => apple, done: () => (this.sel && this.sel.site === apple) || apple.routesOut.some((q) => q.trucks.length) },
      { title: '사과를 공장으로', text: '오른쪽 카드에서 파란 트럭 버튼을 누르세요. 노선이 지도에 선으로 나타납니다.', target: () => null, done: () => firstRoute() && firstRoute().trucks.length > 0 },
      { title: '납품 대금이 들어옵니다', text: '적재함에 색이 차 있으면 짐을 실은 트럭, 회색이면 빈 트럭입니다. 돈이 모이면 트럭을 더 사세요. 거점 옆의 작은 네모가 쌓인 화물입니다.', target: () => null, done: () => firstRoute() && firstRoute().trucks.length >= 3 },
      { title: '이제 가공식품', text: '공장에 사과가 들어가면 가공식품이 쌓입니다. 음성 식품공장을 눌러 청주로 가는 트럭을 사세요. 값이 더 비쌉니다.', target: () => food, done: () => foodRoutes().some((q) => q.trucks.length > 0) },
      { title: '납품하면 지역이 자랍니다', text: '위쪽 막대가 납품 실적입니다. 실적이 쌓이면 새 거점이 열리고, 다 채우면 다음 권역이 개통됩니다.', target: () => null, done: () => g.progress() >= 0.2 },
      { title: '길이 막히기 시작하면', text: '어두운 고리가 생긴 교차로를 누르세요. 진입 방향에 양보 표지를 칠하면 나머지 방향이 멈추지 않고 지나갑니다. 연구에서 신호등도 배울 수 있습니다.', target: () => null, done: () => g.techs.has('signal') || g.progress() >= 0.6 || g.stage > 0 },
    ];
    return this._steps;
  }
}
