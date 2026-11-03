// 화면 UI 전체: 상단 안내판, 도구 독, 정보 패널, 창, 알림
import { h, ico, raw, patch } from './dom.js';
import { iconHtml, routeShield } from '../render/art.js';
import { GOODS, TRUCKS, TECHS, UPGRADES, SITE_KIND_NAME, TIER_NAME, REGION_GOAL, fmtWon, fmtKo, fmtTon, fmtTime } from '../game/defs.js';
import { LANE_W } from '../sim/network.js';

export const TOOLS = [
  { id: 'select', icon: 't_select', name: '선택', key: '1', desc: '거점과 교차로, 도로를 눌러 자세히 봅니다.' },
  { id: 'yield', icon: 't_yield', name: '양보 표지', key: '2', desc: '교차로로 들어오는 방향에 칠하면 그쪽이 양보합니다. 나머지 방향은 멈추지 않고 통과합니다.' },
  { id: 'stop', icon: 't_stop', name: '정지 표지', key: '3', desc: '칠한 방향의 트럭이 반드시 한 번 멈춘 뒤 진입합니다. 흐름을 강하게 조절할 때 씁니다.' },
  { id: 'signal', icon: 't_signal', name: '신호등', key: '4', tech: 'signal', desc: '방향별로 번갈아 보냅니다. 교통량이 많은 교차로의 처리량이 크게 늘어납니다.' },
  { id: 'roundabout', icon: 't_roundabout', name: '회전교차로', key: '5', tech: 'roundabout', desc: '멈추지 않고 합류합니다. 교통량이 중간쯤인 곳에 좋습니다.' },
  { id: 'interchange', icon: 't_interchange', name: '입체교차로', key: '6', tech: 'interchange', desc: '교차 흐름을 입체로 분리합니다. 같은 차로로 합류할 때만 양보합니다.' },
  { id: 'lane', icon: 't_lane', name: '차로 추가', key: '7', desc: '도로를 눌러 양방향으로 한 차로씩 늘립니다. 드래그하면 이어서 칠합니다.' },
  { id: 'remove', icon: 't_remove', name: '원상복구', key: '8', desc: '교차로의 표지·신호를 없애 기본 상태로 돌립니다. 설치비는 돌려받지 못합니다.' },
];

const CITY_STAGE_NAME = ['마을', '읍내', '소도시', '중도시', '대도시', '메가시티'];
const CONTROL_NAME = { auto: '비보호 교차로', signal: '신호 교차로', roundabout: '회전교차로', interchange: '입체교차로' };
const KIND_NAME = { x: '고속도로', n: '국도', r: '연결로', s: '진입로', f: '뱃길' };

const svgStr = (s) => s;

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
      insp: document.getElementById('inspector'),
      vms: document.getElementById('vms'),
      hint: document.getElementById('toolhint'),
      tip: document.getElementById('tooltip'),
      toasts: document.getElementById('toasts'),
      coach: document.getElementById('coach'),
      banner: document.getElementById('banner'),
      modal: document.getElementById('modal'),
    };
    this.sel = null;
    this.tool = 'select';
    this.modelSel = 0;
    this.modalName = null;
    this.modalData = null;
    this.collapsed = window.innerWidth < 760;
    this.vmsMsgs = [];
    this.vmsT = 0;
    this.vmsIdx = 0;
    this.confirmReset = false;
    this.saveText = '';
    this.coachStep = 0;
    this.coachOff = false;
    this.bindTooltips();
    this.bindKeys();
  }

  bindTooltips() {
    const tip = this.el.tip;
    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t || e.pointerType === 'touch') { tip.hidden = true; return; }
      tip.textContent = t.getAttribute('data-tip');
      tip.hidden = false;
      const rc = t.getBoundingClientRect();
      const w = tip.offsetWidth, hh = tip.offsetHeight;
      let x = rc.right + 8, y = rc.top + rc.height / 2 - hh / 2;
      if (x + w > window.innerWidth - 8) x = Math.max(8, rc.left + rc.width / 2 - w / 2);
      if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
      if (y < 8) y = 8;
      if (x !== rc.right + 8) y = rc.bottom + 8;
      if (y + hh > window.innerHeight - 8) y = rc.top - hh - 8;
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
        if (this.modalName) this.closeModal();
        else if (this.tool !== 'select') this.setTool('select');
        else this.select(null);
      }
      if (e.key === ' ') { e.preventDefault(); this.app.setSpeed(this.app.speed === 0 ? (this.app.lastSpeed || 1) : 0); }
      if (e.key === 'r' || e.key === 'R') this.openModal('research');
      if (e.key === 'b' || e.key === 'B') this.openModal('build');
    });
  }

  // ── 상태 변경 ──────────────────────────────────────
  select(sel) {
    this.sel = sel;
    this.r.selection = sel;
    if (sel && this.collapsed) this.collapsed = false;
    this.updateHighlights();
    this.renderInspector(true);
    this.el.insp.querySelector('.p-body')?.scrollTo(0, 0);
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
      this.toast('lock', `${t.name}은(는) 아직 쓸 수 없습니다`, this.game.techVisible(tech) ? '연구 창에서 연구하세요' : '권역을 더 개발하면 연구가 열립니다');
      this.sound.deny();
      if (this.game.techVisible(tech)) this.openModal('research');
      return;
    }
    this.setTool(this.tool === t.id ? 'select' : t.id);
  }

  setTool(id) {
    this.tool = id;
    this.r.tool = id;
    this.r.hover = null;
    this.r.toolColor = id === 'remove' ? '#d9352b' : '#f6b01e';
    document.getElementById('map').classList.toggle('tool', id !== 'select');
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
      r.ping(x, y, '#f6b01e');
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
      const help = { yield: '교차로로 들어오는 방향을 누르세요', stop: '교차로로 들어오는 방향을 누르세요', signal: '교차로를 누르세요', roundabout: '교차로를 누르세요', interchange: '교차로를 누르세요', lane: '넓힐 도로를 누르세요', remove: '되돌릴 교차로를 누르세요' };
      patch(el, [h('span', null, `${def.name}: ${help[t]}  ·  `, h('b', null, 'Esc'), ' 취소')]);
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
    }
    if (text) patch(el, [h('span', null, text)]);
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
    if (this.modalName && this.modalName !== 'welcome' && this.modalName !== 'offline' && this.modalName !== 'settings') this.renderModal();
  }

  renderTop() {
    const g = this.game, app = this.app;
    const ms = this.lastMoving || { stopped: 0, onRoad: 0 };
    const stoppedShare = ms.onRoad ? ms.stopped / ms.onRoad : 0;
    const researchReady = TECHS.some((t) => !g.techs.has(t.id) && g.techVisible(t) && g.money >= t.cost)
      || UPGRADES.some((u) => g.upg[u.id] < u.max && g.money >= g.upgradeCostOf(u.id));
    const buildReady = g.projects.some((p) => g.projectAvailable(p) && g.money >= g.projectPrice(p));
    const speedBtn = (v, label, tip) => h('button', { class: app.speed === v ? 'on' : '', onclick: () => app.setSpeed(v), 'data-tip': tip, 'aria-label': tip, html: label });
    patch(this.el.top, [
      h('div', { class: 'brand' }, raw(routeShield('x', '8'), 'shield'), h('b', null, '팔도 트래픽')),
      h('div', { class: 'stat money', 'data-tip': '보유 자금' }, h('small', null, '자금'), h('strong', null, fmtWon(g.money))),
      h('div', { class: 'stat', 'data-tip': '최근 수익을 1분 기준으로 환산한 값입니다' }, h('small', null, '분당 수익'), h('strong', null, fmtWon(g.income * 60))),
      h('div', { class: 'stat', 'data-tip': '운행 중인 전체 트럭 수' }, h('small', null, '트럭'), h('strong', null, `${g.truckCount}대`)),
      h('div', { class: `stat optional${g.onTimeRate < 0.75 ? ' bad' : ''}`, 'data-tip': '제시간에 도착한 배송 비율입니다. 정시 도착은 운임 보너스를 받고, 크게 늦으면 깎입니다.' }, h('small', null, '정시율'), h('strong', null, `${Math.round(g.onTimeRate * 100)}%`)),
      h('div', { class: `stat optional${stoppedShare > 0.35 ? ' bad' : ''}`, 'data-tip': '도로 위 트럭 중 멈춰 있는 대수입니다' }, h('small', null, '정체'), h('strong', null, `${ms.stopped}대`)),
      h('div', { class: 'bar-spacer' }),
      h('div', { class: 'speed' },
        speedBtn(0, `<span class="ico">${iconHtml('pause')}</span>`, '일시정지 (스페이스바)'),
        speedBtn(1, '1배', '보통 속도'), speedBtn(2, '2배', '2배 속도'), speedBtn(4, '4배', '4배 속도')),
      h('div', { class: 'menu' },
        h('button', { onclick: () => this.openModal('research'), 'data-tip': '연구 (R)' }, ico('research'), h('span', null, '연구'), researchReady && h('i', { class: 'dot' })),
        h('button', { onclick: () => this.openModal('build'), 'data-tip': '우회도로·대교 건설 (B)' }, ico('build'), h('span', null, '건설'), buildReady && h('i', { class: 'dot' })),
        h('button', { onclick: () => this.openModal('settings'), 'data-tip': '설정과 저장', 'aria-label': '설정' }, ico('gear'))),
    ]);
  }

  renderDock() {
    const g = this.game;
    const kids = [];
    TOOLS.forEach((t) => {
      const locked = t.tech && !g.techs.has(t.tech);
      kids.push(h('button', {
        key: t.id,
        class: `tool${this.tool === t.id ? ' on' : ''}${locked ? ' locked' : ''}`,
        onclick: () => this.pickTool(t),
        'data-tip': `${t.name}\n${t.desc}${locked ? '\n연구하면 쓸 수 있습니다.' : ''}`,
        'aria-label': t.name,
      }, ico(t.icon), locked && raw(iconHtml('lock'), 'padlock'), h('kbd', null, t.key)));
      if (t.id === 'select' || t.id === 'interchange') kids.push(h('div', { class: 'dock-sep', key: `sep-${t.id}` }));
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
        h('span', { class: 'route' }, `전국 물류망 붐 ${g.endless + 1}단계`),
        h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(frac * 100).toFixed(1)}%` })),
        h('span', null, `${Math.floor(frac * 100)}%`),
        h('span', { class: 'next' }, `운임 +${Math.round((g.boomMult() - 1) * 100)}%`),
      ];
    } else {
      const next = g.regions[reg.index + 1];
      kids = [
        h('span', { class: 'route' }, reg.short),
        h('div', { class: 'track', 'data-tip': `${reg.name}에 납품한 실적입니다. 비싼 화물일수록 점수가 큽니다.` }, h('div', { class: 'fill', style: `width:${(prog * 100).toFixed(1)}%` })),
        h('span', null, `${fmtKo(reg.pts)} / ${fmtKo(goalPts)}`),
        h('span', { class: 'next' }, next ? `달성하면 ${next.short} 개통` : '달성하면 전국 물류망 완성'),
      ];
    }
    patch(this.el.goal, kids);
  }

  // ── 정보 패널 ──────────────────────────────────────
  renderInspector(force = false) {
    if (!force) {
      // 패널 위에서 버튼을 누르는 중에는 갱신을 쉰다
      if (this.pressing) return;
    }
    const sel = this.sel;
    let view;
    if (!sel) view = this.overviewView();
    else if (sel.type === 'site') view = this.siteView(sel.site);
    else if (sel.type === 'node') view = this.nodeView(sel.node);
    else if (sel.type === 'road') view = this.roadView(sel.road);
    else if (sel.type === 'approach') view = this.nodeView(sel.node);
    else view = this.overviewView();
    this.el.insp.classList.toggle('collapsed', !sel && this.collapsed);
    patch(this.el.insp, view);
  }

  head(cls, leading, title, sub, onClose) {
    return h('div', { class: `p-head ${cls}`, key: 'head' },
      leading,
      h('div', { class: 'p-title' }, h('h2', null, title), sub && h('p', null, sub)),
      onClose && h('button', { class: 'p-x', onclick: onClose, 'aria-label': '닫기', 'data-tip': '닫기 (Esc)' }, ico('close')));
  }

  overviewView() {
    const g = this.game;
    const sites = g.sites.filter((s) => s.available);
    const producers = sites.filter((s) => s.produces);
    const advice = this.advice();
    const jams = g.jams.slice(0, 5);
    const body = [];
    if (advice.length) {
      body.push(h('div', { class: 'sec', key: 'adv' }, h('h3', null, '지금 할 만한 일'), advice.map((a, i) => h('button', { class: 'list-row', key: `a${i}`, onclick: a.go },
        ico(a.icon), h('div', { class: 't' }, h('b', null, a.title), h('small', null, a.sub)), h('span', { class: 'chip ' + (a.tone || '') }, a.tag)))));
    }
    if (jams.length) {
      body.push(h('div', { class: 'sec', key: 'jam' }, h('h3', null, '정체 구간', h('span', null, `${g.jamsTotal || 0}대 대기`)), jams.map((j) => h('button', { class: 'list-row', key: `j${j.node.id}`, onclick: () => this.goNode(j.node) },
        ico(j.site ? (j.site.isCity ? 'city' : j.site.kind) : 'jam'), h('div', { class: 't' }, h('b', null, j.site ? `${j.site.name} 진입로` : j.node.name), h('small', null, j.site ? '상하차장이 밀립니다' : CONTROL_NAME[j.node.control])), h('span', { class: `chip ${j.stuck > 30 ? 'bad' : 'warn'}` }, `${j.waiting}대`)))));
    }
    const grouped = g.regions.filter((r) => r.unlocked).map((r) => ({ r, list: producers.filter((s) => s.region === r.index) })).filter((q) => q.list.length).reverse();
    for (const { r, list } of grouped.slice(0, 3)) {
      body.push(h('div', { class: 'sec', key: `reg${r.index}` }, h('h3', null, `${r.short} 거점`, h('span', null, `${list.length}곳`)), list.map((s) => {
        const st = this.siteStatus(s);
        const trucks = s.routesOut.reduce((sum, q) => sum + q.trucks.length, 0);
        return h('button', { class: 'list-row', key: s.id, onclick: () => this.goSite(s) },
          ico(s.kind), h('div', { class: 't' }, h('b', null, s.name), h('small', null, `${GOODS[s.goods].name} · 트럭 ${trucks}대`)), h('span', { class: `chip ${st.tone}` }, st.short));
      })));
    }
    return [
      this.head('', raw(routeShield('x', '8'), 'shield'), '전국 운행 현황', `${g.currentRegion.name} 개발 중`, null),
      h('div', { class: 'p-body', key: 'body' }, body),
    ];
  }

  advice() {
    const g = this.game;
    const out = [];
    const tech = TECHS.find((t) => !g.techs.has(t.id) && g.techVisible(t) && g.money >= t.cost);
    if (tech) out.push({ icon: tech.icon, title: `${tech.name} 연구 가능`, sub: fmtWon(tech.cost), tag: '연구', tone: 'info', go: () => this.openModal('research') });
    const stuck = g.jams.find((j) => j.stuck > 40 && !j.site);
    if (stuck) out.push({ icon: 'warn', title: `${stuck.node.name} 막힘`, sub: '신호를 놓거나 트럭을 줄이세요', tag: `${stuck.waiting}대`, tone: 'bad', go: () => this.goNode(stuck.node) });
    const full = g.sites.filter((s) => s.available && s.produces && s.stock > g.siteCap(s) * 0.75 && !s.yard.length).sort((a, b) => GOODS[b.goods].price - GOODS[a.goods].price)[0];
    if (full) out.push({ icon: full.kind, title: `${full.name} 화물 적체`, sub: '트럭을 늘리면 바로 수익이 됩니다', tag: '트럭', tone: 'warn', go: () => this.goSite(full) });
    const idle = g.sites.filter((s) => s.available && s.produces && s.yard.length >= 2).sort((a, b) => b.yard.length - a.yard.length)[0];
    if (idle) out.push({ icon: idle.kind, title: `${idle.name} 화물 부족`, sub: `트럭 ${idle.yard.length}대가 기다립니다`, tag: idle.inputs ? '원료' : '증설', tone: 'info', go: () => this.goSite(idle) });
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
    if (!trucks) return { tone: 'warn', short: '트럭 없음', text: '아직 트럭이 없습니다. 아래 노선에서 트럭을 사세요.' };
    if (frac > 0.75) return { tone: 'warn', short: '트럭 부족', text: '화물이 쌓이고 있습니다. 트럭을 더 사면 바로 수익이 늘어납니다.' };
    if (s.yard.length >= 2) return { tone: 'info', short: '화물 부족', text: s.inputs ? `트럭 ${s.yard.length}대가 화물을 기다립니다. 원료를 더 보내거나 생산을 증설하세요.` : `트럭 ${s.yard.length}대가 화물을 기다립니다. 생산을 증설하세요.` };
    return { tone: 'ok', short: '원활', text: '트럭과 생산량이 잘 맞습니다.' };
  }

  goodsPill(gid, sub) {
    const g = GOODS[gid];
    return h('span', { class: 'goods-pill', key: gid }, ico(`g_${gid}`), g.name, sub && h('small', null, sub));
  }

  siteView(s) {
    const g = this.game;
    const regionName = g.regions[s.region].short;
    const headCls = s.isCity ? '' : s.kind === 'port' ? 'blue' : s.inputs ? 'blue' : 'dark';
    const iconName = s.isCity && s.kind !== 'dokdo' ? 'city' : s.kind;
    const head = this.head(headCls, h('div', { class: 'badge' }, raw(iconHtml(iconName), 'ico" style="width:100%;height:100%'.split('"')[0])), s.name, `${regionName} · ${SITE_KIND_NAME[s.kind]}${s.isCity && s.kind === 'city' ? ` · ${CITY_STAGE_NAME[s.cityStage]}` : ''}`, () => this.select(null));
    const body = [];
    if (s.produces) body.push(...this.productionSec(s));
    if (s.isCity || s.kind === 'port') body.push(...this.consumerSec(s));
    if (s.inputs && !s.isCity) body.push(...this.factoryIncoming(s));
    if (s.produces) body.push(...this.routesSec(s));
    body.push(this.baySec(s));
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
        if (i > 0) chain.push(raw(iconHtml('plus'), 'chain-plus ico sep'));
        chain.push(h('span', { class: 'goods-pill', key: `in${i}` }, slot.map((q) => ico(`g_${q}`)), slot.length === 1 ? GOODS[slot[0]].name : '농수산물'));
      });
      chain.push(raw(iconHtml('chevron'), 'ico sep'));
    }
    chain.push(this.goodsPill(s.goods, TIER_NAME[gd.tier]));
    kids.push(h('div', { class: 'chain', key: 'chain' }, chain));
    kids.push(h('div', { class: 'statusline', key: 'st' }, h('span', { class: `chip ${st.tone}` }, st.short), h('span', { class: 'note' }, st.text)));
    kids.push(h('div', { class: 'meter', key: 'stock' }, h('span', { class: 'label' }, '창고'), h('div', { class: 'track' }, h('div', { class: `fill${frac > 0.85 ? ' bad' : frac > 0.5 ? ' warn' : ''}`, style: `width:${(frac * 100).toFixed(1)}%` })), h('span', { class: 'val' }, `${fmtTon(s.stock)} / ${fmtTon(cap)}`)));
    if (s.inputs) {
      const ic = g.inputCap(s);
      s.inputs.forEach((slot, i) => {
        const f = s.inBuf[i] / ic;
        kids.push(h('div', { class: 'meter', key: `ib${i}` }, h('span', { class: 'label' }, slot.length === 1 ? GOODS[slot[0]].name : '원료'), h('div', { class: 'track' }, h('div', { class: `fill${f >= 1 ? ' bad' : ''}`, style: `width:${(Math.min(1, f) * 100).toFixed(1)}%` })), h('span', { class: 'val' }, `${fmtTon(s.inBuf[i])}`)));
      });
    }
    const cost = g.upgradeCost(s);
    kids.push(h('button', {
      class: 'btn up', key: 'upg', disabled: g.money < cost, onclick: () => { if (g.buyUpgrade(s)) { this.sound.buy(); this.renderInspector(true); } else this.sound.deny(); },
      'data-tip': `생산량이 38% 늘어나고 창고도 커집니다.\n늘어난 물량을 나를 트럭이 더 필요해집니다.`,
    }, h('span', null, `생산 증설 Lv.${s.level + 1}`, h('small', null, `${rate.toFixed(2)} → ${(rate * 1.38).toFixed(2)} t/s`)), h('span', { class: 'price' }, fmtWon(cost))));
    return [h('div', { class: 'sec', key: 'prod' }, h('h3', null, '생산', h('span', null, `${rate.toFixed(2)} t/s`)), kids)];
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
      kids.push(h('div', { class: 'meter', key: 'grow' }, h('span', { class: 'label' }, '도시 성장'), h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(Math.min(1, f) * 100).toFixed(1)}%` })), h('span', { class: 'val' }, cur < 5 ? CITY_STAGE_NAME[cur + 1] : '최대')));
      kids.push(h('p', { class: 'note', key: 'g2' }, `인구 약 ${s.pop}만 명. 지금 납품 운임 `, h('b', null, `+${s.cityStage * 8}%`), ' 납품할수록 도시가 커지고 운임이 오릅니다.'));
    }
    if (s.kind === 'dokdo') kids.push(h('p', { class: 'note', key: 'dok' }, '독도 경비대에 보급품을 보내면 운임을 6배로 받습니다. 울릉도를 거쳐 뱃길로 갑니다.'));
    kids.push(h('div', { class: 'chain', key: 'acc' }, [...s.accepts].filter((q) => s.isCity || s.kind === 'port').map((q) => this.goodsPill(q))));
    const lines = s.routesIn.filter((q) => q.trucks.length).sort((a, b) => b.rate - a.rate).slice(0, 6);
    kids.push(h('div', { class: 'kv', key: 'kv' }, h('div', null, h('small', null, '누적 납품'), h('b', null, fmtTon(s.delivered))), h('div', null, h('small', null, '들어오는 노선'), h('b', null, `${lines.length}개`)), h('div', null, h('small', null, '배치 트럭'), h('b', null, `${s.routesIn.reduce((sum, q) => sum + q.trucks.length, 0)}대`))));
    for (const q of lines) {
      kids.push(h('button', { class: 'list-row', key: q.id, onclick: () => this.goSite(q.from), onmouseenter: () => this.updateHighlights(q), onmouseleave: () => this.updateHighlights() },
        ico(q.from.kind), h('div', { class: 't' }, h('b', null, q.from.name), h('small', null, `${GOODS[q.goods].name} · ${Math.round(q.dist)}km`)), h('span', { class: 'chip' }, `${q.trucks.length}대`)));
    }
    if (!lines.length) kids.push(h('p', { class: 'note', key: 'none' }, s.kind === 'port' ? '아직 수출하는 트럭이 없습니다.' : '아직 납품하는 트럭이 없습니다. 공장을 눌러 이곳으로 가는 노선에 트럭을 사세요.'));
    return [h('div', { class: 'sec', key: 'consume' }, h('h3', null, s.kind === 'port' ? '받는 수출 화물' : '받는 화물'), kids)];
  }

  factoryIncoming(s) {
    const lines = s.routesIn.filter((q) => q.valid).sort((a, b) => b.trucks.length - a.trucks.length || a.dist - b.dist).slice(0, 6);
    if (!lines.length) return [];
    return [h('div', { class: 'sec', key: 'incoming' }, h('h3', null, '원료 공급처'), lines.map((q) => h('button', { class: 'list-row', key: q.id, onclick: () => this.goSite(q.from), onmouseenter: () => this.updateHighlights(q), onmouseleave: () => this.updateHighlights() },
      ico(q.from.kind), h('div', { class: 't' }, h('b', null, q.from.name), h('small', null, `${GOODS[q.goods].name} · ${Math.round(q.dist)}km`)), h('span', { class: `chip ${q.trucks.length ? '' : 'warn'}` }, q.trucks.length ? `${q.trucks.length}대` : '트럭 없음'))))];
  }

  routesSec(s) {
    const g = this.game;
    const kids = [];
    // 트럭 선택
    const unlockedCount = TRUCKS.filter((_, i) => g.modelUnlocked(i)).length;
    if (unlockedCount > 1) {
      kids.push(h('div', { class: 'model-row', key: 'models' }, TRUCKS.map((m, i) => {
        const locked = !g.modelUnlocked(i);
        return h('button', {
          key: m.id, class: `model${this.modelSel === i ? ' on' : ''}${locked ? ' locked' : ''}`,
          onclick: () => { if (!locked) { this.modelSel = i; this.sound.click(); this.renderInspector(true); } },
          'data-tip': `${m.name}\n${m.desc}\n적재 ${m.cap}t · 속도 ${Math.round(m.speed * 100)}% · 길이 ${m.len}km${locked ? '\n연구하면 쓸 수 있습니다.' : ''}`,
        }, ico(`truck_${m.id}`), m.short);
      })));
    }
    if (!g.modelUnlocked(this.modelSel)) this.modelSel = 0;
    const m = this.modelSel;
    const routes = s.routesOut.filter((q) => q.valid).sort((a, b) => a.dist - b.dist);
    if (!routes.length) kids.push(h('p', { class: 'note', key: 'nor' }, '아직 이 화물을 받아줄 곳이 없습니다. 권역을 더 개발하면 열립니다.'));
    for (const q of routes) {
      const cap = g.truckCap(TRUCKS[m]);
      const trip = q.perTon * cap * (1 + g.upg.pay * 0.14);
      const price = g.truckPrice(q, m);
      kids.push(h('div', {
        class: `route-card${!q.opened && routes.some((x) => x.opened) ? ' new' : ''}`, key: q.id,
        onmouseenter: () => this.updateHighlights(q), onmouseleave: () => this.updateHighlights(),
      },
      h('div', { class: 'route-top' }, raw(iconHtml('chevron'), 'ico arrow'), h('span', { class: 'name' }, q.to.name), h('span', { class: 'dist' }, `${Math.round(q.dist)}km · ${Math.round(q.freeTime)}초`)),
      h('div', { class: 'route-info' }, h('span', null, '1회 ', h('b', null, fmtWon(trip))), h('span', null, '분당 ', h('b', null, fmtWon(q.rate * 60)))),
      h('div', { class: 'route-act' },
        h('div', { class: 'count', 'data-tip': '이 노선의 트럭 수' }, q.trucks.length, h('small', null, '대')),
        h('button', {
          class: 'btn buy', disabled: g.money < price,
          onclick: () => { if (g.buyTruck(q, m)) { this.sound.buy(); this.updateHighlights(); this.renderInspector(true); this.renderTop(); this.app.notifyBought(q); } else this.sound.deny(); },
        }, `${TRUCKS[m].short} 트럭 구매`, h('span', { class: 'price' }, fmtWon(price))),
        h('button', {
          class: 'btn sell', disabled: !q.trucks.length, 'aria-label': '트럭 한 대 처분', 'data-tip': '트럭 한 대를 처분합니다 (구매가의 50% 환급).\n도로가 막힐 때 숨통을 틔웁니다.',
          onclick: () => { if (g.sellTruck(q)) { this.sound.click(); this.renderInspector(true); } },
        }, ico('minus'))),
      g.techs.has('autobuy') && h('label', { class: 'field', style: 'min-height:0;font-size:12px' }, '자동 배차', h('input', { type: 'checkbox', checked: q.auto, onchange: (e) => { q.auto = e.target.checked; q.model = m; } }))));
    }
    return [h('div', { class: 'sec', key: 'routes' }, h('h3', null, '운송 노선'), kids)];
  }

  baySec(s) {
    const g = this.game;
    const cost = g.bayCost(s);
    const node = g.net.nodes[s.node];
    const waiting = node.waiting;
    return h('div', { class: 'sec', key: 'bay' }, h('h3', null, '상하차장', h('span', null, `${s.bays}칸`)),
      h('div', { class: 'statusline' }, h('span', { class: `chip ${waiting >= 3 ? 'bad' : 'ok'}` }, waiting >= 3 ? `진입로 ${waiting}대 대기` : '대기 없음'), s.yard.length > 0 && h('span', { class: 'chip info' }, `대기장 ${s.yard.length}대`)),
      s.bays < 12 && h('button', {
        class: 'btn up', disabled: g.money < cost, onclick: () => { if (g.buyBay(s)) { this.sound.buy(); this.renderInspector(true); } else this.sound.deny(); },
        'data-tip': '상하차장이 늘면 트럭이 진입로에서 덜 기다립니다.\n진입로 정체가 큰길까지 번지는 것을 막아 줍니다.',
      }, h('span', null, `상하차장 ${s.bays} → ${s.bays + 1}칸`), h('span', { class: 'price' }, fmtWon(cost))));
  }

  nodeView(n) {
    const g = this.game;
    const roads = [...new Map(n.roads.filter((r) => r.ref && (r.kind === 'x' || r.kind === 'n')).map((r) => [`${r.kind}${r.ref}`, r])).values()].slice(0, 4);
    const leading = roads.length ? h('div', { class: 'shields' }, roads.map((r) => raw(routeShield(r.kind, r.ref), 'shield-inline'))) : raw(iconHtml('t_signal'), 'ico');
    const head = this.head('', leading, n.name, `${g.regions[n.region]?.short || ''} · ${CONTROL_NAME[n.control]}`, () => this.select(null));
    const body = [];
    const stuck = n.stuckT > 25;
    body.push(h('div', { class: 'kv', key: 'kv' },
      h('div', null, h('small', null, '대기 트럭'), h('b', null, `${n.waiting}대`)),
      h('div', null, h('small', null, '처리량'), h('b', null, `${Math.round(n.flow * 60)}대/분`)),
      h('div', null, h('small', null, '최장 정지'), h('b', null, n.stuckT < 1 ? '없음' : fmtTime(n.stuckT)))));
    const opts = [
      ['auto', 't_select', '기본', '비보호', true],
      ['signal', 't_signal', '신호등', null, g.techs.has('signal')],
      ['roundabout', 't_roundabout', '회전교차로', null, g.techs.has('roundabout')],
      ['interchange', 't_interchange', '입체교차로', null, g.techs.has('interchange')],
    ];
    body.push(h('div', { class: 'sec', key: 'ctl' }, h('h3', null, '교차로 방식'),
      h('div', { class: 'ctl-grid' }, opts.map(([id, icon, name, sub, can]) => {
        const price = g.controlPrice(n, id);
        const on = n.control === id;
        return h('button', {
          key: id, class: `ctl${on ? ' on' : ''}`, disabled: !can || (!on && g.money < price),
          'data-tip': id === 'auto' ? '먼저 온 트럭부터 천천히 통과합니다. 몰리면 금방 막힙니다.' : TOOLS.find((t) => t.id === id).desc,
          onclick: () => { if (!on && g.setControl(n, id)) { this.sound.place(); this.r.baseDirty = true; this.renderInspector(true); } },
        }, ico(icon), h('span', null, h('b', null, name), h('small', null, on ? '사용 중' : !can ? '연구 필요' : price ? fmtWon(price) : sub || '무료')));
      })),
      n.control === 'roundabout' && g.techs.has('ring2') && n.ringLanes < 2 && h('button', { class: 'btn buy', onclick: () => { if (g.buyRing2(n)) { this.sound.place(); this.r.baseDirty = true; } } }, '2차로로 확장')));
    if (n.control === 'auto') {
      const anySign = n.inE.some((e) => e.sign > 0);
      const rows = n.inE.filter((e) => e.road.open && e.road.kind !== 'f').map((e) => {
        const defaultYield = !anySign && n.major.size && !n.major.has(e.id);
        const from = g.net.nodes[e.from];
        const q = e.lanes.reduce((sum, l) => sum + l.veh.length, 0);
        return h('div', { class: 'approach', key: `e${e.id}` },
          h('div', { class: 'who' }, (from.site ? from.site.name : from.name) + ' 쪽', h('small', null, `${e.road.name || KIND_NAME[e.road.kind]} · ${q}대${defaultYield ? ' · 기본 양보' : ''}`)),
          h('div', { class: 'seg' }, [[0, '없음', null], [1, null, 't_yield'], [2, null, 't_stop']].map(([sign, text, icon]) => h('button', {
            key: String(sign), class: e.sign === sign ? 'on' : '',
            'data-tip': sign === 0 ? '표지 없음' : `${sign === 1 ? '양보' : '정지'} 표지 ${fmtWon(g.signPrice(e, sign))}`,
            onclick: () => { if (g.setSign(e, sign)) { this.sound.place(); this.renderInspector(true); } else if (e.sign !== sign) this.sound.deny(); },
          }, icon ? ico(icon) : text))));
      });
      body.push(h('div', { class: 'sec', key: 'signs' }, h('h3', null, '진입 방향별 표지'), rows, h('p', { class: 'note', key: 'nt' }, anySign ? '표지가 없는 방향이 우선 도로입니다.' : n.major.size ? '고속도로 직진 흐름이 기본 우선입니다.' : '표지가 없으면 먼저 온 차부터 번갈아 지나갑니다.')));
    }
    if (n.control === 'signal') {
      body.push(h('div', { class: 'sec', key: 'sig' }, h('h3', null, '신호 운영'), h('p', { class: 'note' }, g.techs.has('smartsig') ? '감응 신호가 차가 빠지는 동안 녹색을 최대 8초까지 늘리고, 막히면 일찍 끊습니다.' : '기다리는 방향을 보고 충돌 없는 흐름끼리 묶어 4.6초씩 보냅니다. 감응 신호를 연구하면 더 똑똑해집니다.')));
    }
    if (stuck || n.waiting > 6) {
      const canTow = g.techs.has('tow');
      body.push(h('div', { class: 'sec', key: 'tow' }, h('h3', null, '구난'),
        h('button', {
          class: 'btn', disabled: !canTow || g.money < g.towPrice(n),
          onclick: () => { const c = g.tow(n); if (c) { this.sound.horn(); this.toast('tow', `트럭 ${c}대를 견인했습니다`, '화물을 내려놓고 출발지로 돌아갑니다'); } },
        }, ico('tow'), canTow ? `맨 앞 트럭 견인 ${fmtWon(g.towPrice(n))}` : '구난 계약을 연구하면 견인할 수 있습니다')));
    }
    return [head, h('div', { class: 'p-body', key: `body-n${n.id}` }, body)];
  }

  ferryView(r) {
    const g = this.game;
    const fy = r.ferryObj;
    const price = g.ferryPrice(fy);
    const state = fy.state === 'dock' ? '접안 중' : '운항 중';
    const a = fy.sideOf(r.a);
    return [this.head('blue', raw(iconHtml('ship'), 'ico'), r.name, `${Math.round(r.len)}km 뱃길 · ${state}`, () => this.select(null)),
      h('div', { class: 'p-body', key: `body-f${r.id}` },
        h('div', { class: 'kv', key: 'kv' },
          h('div', null, h('small', null, '한 번에 실음'), h('b', null, `${fy.cap}대`)),
          h('div', null, h('small', null, '지금 실린 트럭'), h('b', null, `${fy.cargo.length}대`)),
          h('div', null, h('small', null, '운항 횟수'), h('b', null, `${fy.trips}회`))),
        h('p', { class: 'note', key: 'nt' }, '트럭은 터미널에서 줄을 서서 배를 기다립니다. 배가 작으면 줄이 큰길까지 밀립니다.', a < 0 ? '' : ''),
        h('button', { class: 'btn up', key: 'up', disabled: g.money < price || fy.cap >= 120, onclick: () => { if (g.buyFerry(fy)) { this.sound.buy(); this.renderInspector(true); } else this.sound.deny(); } }, h('span', null, `카페리 증편 ${fy.cap} → ${fy.cap + 10}대`), h('span', { class: 'price' }, fmtWon(price)))),
    ];
  }

  roadView(r) {
    if (r.kind === 'f') return this.ferryView(r);
    const g = this.game;
    const hasShield = r.ref && (r.kind === 'x' || r.kind === 'n') && /^\d+$/.test(r.ref);
    const leading = hasShield ? raw(routeShield(r.kind, r.ref), 'shield') : raw(iconHtml('t_lane'), 'ico');
    const a = g.net.nodes[r.a], b = g.net.nodes[r.b];
    const head = this.head(r.kind === 'x' ? '' : 'blue', leading, r.name || KIND_NAME[r.kind], `${a.site ? a.site.name : a.name} – ${b.site ? b.site.name : b.name}`, () => this.select(null));
    const dirRow = (e) => {
      const to = g.net.nodes[e.to];
      const c = e.cong;
      return h('div', { class: 'meter', key: `d${e.id}`, style: 'grid-template-columns:96px 1fr auto' }, h('span', { class: 'label', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, `${to.site ? to.site.name : to.name}`), h('div', { class: 'track' }, h('div', { class: `fill${c > 0.62 ? ' bad' : c > 0.3 ? ' warn' : ''}`, style: `width:${Math.max(2, c * 100).toFixed(0)}%` })), h('span', { class: 'val' }, `${e.count}대`));
    };
    const canAdd = g.canAddLane(r);
    const price = g.lanePrice(r);
    return [head, h('div', { class: 'p-body', key: `body-r${r.id}` },
      h('div', { class: 'kv', key: 'kv' },
        h('div', null, h('small', null, '길이'), h('b', null, `${Math.round(r.len)}km`)),
        h('div', null, h('small', null, '차로'), h('b', null, `왕복 ${r.lanes * 2}`)),
        h('div', null, h('small', null, '제한 속도'), h('b', null, `${r.kind === 'x' ? 100 : r.kind === 'n' ? 80 : 60}km/h`))),
      h('div', { class: 'sec', key: 'flow' }, h('h3', null, '방향별 혼잡도'), dirRow(r.fwd), dirRow(r.bwd)),
      h('div', { class: 'sec', key: 'lane' }, h('h3', null, '확장'),
        canAdd ? h('button', { class: 'btn buy', disabled: g.money < price, onclick: () => { if (g.addLane(r)) { this.sound.place(); this.r.baseDirty = true; this.renderInspector(true); } else this.sound.deny(); } }, h('span', null, `왕복 ${r.lanes * 2} → ${r.lanes * 2 + 2}차로`), h('span', { class: 'price' }, fmtWon(price))) : h('p', { class: 'note' }, '최대 차로입니다.'),
        h('p', { class: 'note', key: 'nt' }, '차로가 늘면 줄을 더 많이 세울 수 있고, 좌회전과 직진 트럭이 서로 막지 않습니다.'))),
    ];
  }

  // ── 창 ─────────────────────────────────────────────
  openModal(name, data = null) {
    this.modalName = name;
    this.modalData = data;
    this.el.modal.classList.add('show');
    this.sound.click();
    this.renderModal();
    const body = this.el.modal.querySelector('.p-body');
    if (body) body.scrollTop = 0;
  }
  closeModal() {
    this.modalName = null;
    this.el.modal.classList.remove('show');
    patch(this.el.modal, []);
    this.confirmReset = false;
    this.saveText = '';
  }
  renderModal() {
    const n = this.modalName;
    if (!n) return;
    const v = n === 'research' ? this.researchDialog() : n === 'build' ? this.buildDialog() : n === 'settings' ? this.settingsDialog() : n === 'welcome' ? this.welcomeDialog() : n === 'offline' ? this.offlineDialog() : n === 'alldone' ? this.allDoneDialog() : null;
    patch(this.el.modal, v ? [v] : []);
    this.el.modal.onclick = (e) => { if (e.target === this.el.modal && n !== 'welcome') this.closeModal(); };
  }

  researchDialog() {
    const g = this.game;
    const techCards = TECHS.filter((t) => g.techVisible(t) || g.techs.has(t.id)).map((t) => {
      const done = g.techs.has(t.id);
      const can = !done && g.money >= t.cost;
      return h('div', { class: `card${done ? ' done' : can ? ' can' : ''}`, key: t.id }, ico(t.icon), h('div', null, h('h4', null, t.name, done && h('span', null, '완료')), h('p', null, t.desc),
        !done && h('button', { class: 'btn buy', disabled: !can, onclick: () => { if (g.buyTech(t.id)) { this.sound.fanfare(); this.renderDock(); this.renderModal(); this.renderTop(); } } }, '연구', h('span', { class: 'price' }, fmtWon(t.cost)))));
    });
    const hidden = TECHS.filter((t) => !g.techVisible(t) && !g.techs.has(t.id)).length;
    const upgCards = UPGRADES.map((u) => {
      const lv = g.upg[u.id];
      const cost = g.upgradeCostOf(u.id);
      const maxed = lv >= u.max;
      return h('div', { class: `card${!maxed && g.money >= cost ? ' can' : ''}`, key: u.id }, ico(u.icon), h('div', null, h('h4', null, u.name, h('span', null, `Lv.${lv}`)), h('p', null, u.desc, ' ', h('b', null, u.fmt(lv * u.per)), lv < u.max && ` → ${u.fmt((lv + 1) * u.per)}`),
        !maxed ? h('button', { class: 'btn buy', disabled: g.money < cost, onclick: () => { if (g.buyUpg(u.id)) { this.sound.buy(); this.renderModal(); this.renderTop(); } } }, '향상', h('span', { class: 'price' }, fmtWon(cost))) : h('span', { class: 'chip ok' }, '최고 단계')));
    });
    return h('div', { class: 'dialog', role: 'dialog', 'aria-label': '연구' },
      this.head('', ico('research'), '연구', `보유 자금 ${fmtWon(g.money)}`, () => this.closeModal()),
      h('div', { class: 'p-body' },
        h('div', null, h('h3', { class: 'group' }, '꾸준히 강해지는 연구'), h('div', { class: 'cards' }, upgCards)),
        h('div', null, h('h3', { class: 'group' }, `새로운 기술${hidden ? ` · 권역이 더 개발되면 ${hidden}개가 더 열립니다` : ''}`), h('div', { class: 'cards' }, techCards))));
  }

  buildDialog() {
    const g = this.game;
    const list = g.projects.filter((p) => p.roads.length).sort((a, b) => a.stage - b.stage);
    const avail = list.filter((p) => p.stage <= g.stage);
    const locked = list.length - avail.length;
    return h('div', { class: 'dialog', role: 'dialog', 'aria-label': '건설' },
      this.head('blue', ico('build'), '우회도로와 대교', `보유 자금 ${fmtWon(g.money)}`, () => this.closeModal()),
      h('div', { class: 'p-body' },
        h('p', { class: 'note', key: 'intro' }, '지도에 보라색 점선으로 표시된 도로입니다. 건설하면 트럭이 알아서 더 빠른 길로 다닙니다.'),
        avail.length ? h('div', { class: 'cards', key: 'c' }, avail.map((p) => {
          const price = g.projectPrice(p);
          return h('div', { class: `card${p.built ? ' done' : g.money >= price ? ' can' : ''}`, key: p.id }, ico(p.kind === 'bridge' ? 'ship' : 'build'), h('div', null, h('h4', null, p.name, h('span', null, `${Math.round(p.km)}km`)), h('p', null, p.desc),
            p.built ? h('span', { class: 'chip ok' }, '개통 완료') : h('div', { class: 'btn-row' },
              h('button', { class: 'btn', onclick: () => { this.closeModal(); this.showProject(p); } }, '위치 보기'),
              h('button', { class: 'btn buy', disabled: g.money < price, onclick: () => { if (g.buildProject(p)) { this.sound.fanfare(); this.r.baseDirty = true; this.renderModal(); this.renderTop(); } } }, h('span', { class: 'price' }, fmtWon(price))))));
        })) : h('p', { class: 'note' }, '아직 건설할 수 있는 도로가 없습니다.'),
        locked > 0 && h('p', { class: 'note', key: 'lk' }, `다음 권역이 열리면 프로젝트 ${locked}개가 더 나옵니다.`)));
  }

  showProject(p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of p.roads) { x0 = Math.min(x0, r.bb[0]); y0 = Math.min(y0, r.bb[1]); x1 = Math.max(x1, r.bb[2]); y1 = Math.max(y1, r.bb[3]); }
    this.r.cam.fitBox(x0 - 8, y0 - 8, x1 + 8, y1 + 8, 0.8, 1.2);
    this.r.ping((x0 + x1) / 2, (y0 + y1) / 2, '#7c3fd1');
  }

  settingsDialog() {
    const app = this.app, snd = this.sound;
    return h('div', { class: 'dialog small', role: 'dialog', 'aria-label': '설정' },
      this.head('dark', ico('gear'), '설정', null, () => this.closeModal()),
      h('div', { class: 'p-body' },
        h('div', { class: 'sec', key: 'snd' }, h('h3', null, '소리'),
          h('label', { class: 'field' }, '효과음 크기', h('input', { id: 'set-vol', type: 'range', min: 0, max: 1, step: 0.05, value: snd.volume, oninput: (e) => { snd.setVolume(Number(e.target.value)); app.saveSettings(); snd.click(); } }))),
        h('div', { class: 'sec', key: 'map' }, h('h3', null, '지도'),
          h('div', { class: 'btn-row' },
            h('button', { class: `btn${this.r.palName === 'day' ? ' go' : ''}`, onclick: () => { this.r.setPalette('day'); app.saveSettings(); this.renderModal(); } }, '주간 지도'),
            h('button', { class: `btn${this.r.palName === 'night' ? ' go' : ''}`, onclick: () => { this.r.setPalette('night'); app.saveSettings(); this.renderModal(); } }, '야간 지도'))),
        h('div', { class: 'sec', key: 'save' }, h('h3', null, '저장', h('span', null, '20초마다 이 브라우저에 자동 저장')),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', onclick: () => { app.save(); this.saveText = btoa(unescape(encodeURIComponent(JSON.stringify(this.game.serialize())))); this.renderModal(); this.toast('star', '저장했습니다', '아래 글자를 복사해 두면 다른 기기로 옮길 수 있습니다'); } }, '저장 코드 만들기'),
            h('button', { class: 'btn', onclick: () => { const t = document.getElementById('set-savebox').value.trim(); if (!t) { this.toast('warn', '저장 코드를 먼저 붙여넣으세요'); return; } app.importSave(t); } }, '코드 불러오기')),
          h('textarea', { id: 'set-savebox', class: 'savebox', placeholder: '저장 코드가 여기에 나타납니다. 불러올 코드를 붙여넣어도 됩니다.', value: this.saveText, spellcheck: 'false' }),
          this.confirmReset
            ? h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => { this.confirmReset = false; this.renderModal(); } }, '취소'), h('button', { class: 'btn danger', onclick: () => app.resetGame() }, '정말 처음부터'))
            : h('button', { class: 'btn danger', onclick: () => { this.confirmReset = true; this.renderModal(); } }, '처음부터 다시 시작')),
        h('div', { class: 'sec', key: 'credit' }, h('h3', null, '만든 재료'),
          h('p', { class: 'credit' }, 'Rischer Kriebl의 게임 Incremental Traffic에서 영감을 받아 대한민국 지도로 다시 만든 비공식 팬 프로젝트입니다. 원작의 코드와 그림은 쓰지 않았습니다.', h('br'), '지도 데이터: 도로·강·지명 © OpenStreetMap contributors (ODbL), 행정구역 KOSTAT(southkorea-maps), 해안선 Natural Earth, 지형 Terrain Tiles. 그림은 모두 코드로 그린 벡터입니다.'))));
  }

  welcomeDialog() {
    return h('div', { class: 'dialog small', role: 'dialog', 'aria-label': '시작' },
      h('div', { class: 'welcome-hero' }, h('h1', null, '팔도 트래픽'), h('p', null, '충주 사과밭의 용달 한 대로 시작해 전국 물류망을 완성하세요. 도로 위의 차는 전부 당신의 트럭입니다. 막히면 당신 탓입니다.')),
      h('div', { class: 'p-body' },
        h('div', { class: 'sec' },
          h('div', { class: 'list-row', style: 'cursor:default' }, ico('truck_hauler'), h('div', { class: 't' }, h('b', null, '트럭을 사서 화물을 나릅니다'), h('small', null, '배송할 때마다 운임이 들어옵니다')), h('span')),
          h('div', { class: 'list-row', style: 'cursor:default' }, ico('t_signal'), h('div', { class: 't' }, h('b', null, '트럭이 늘면 길이 막힙니다'), h('small', null, '양보 표지, 신호등, 차로 추가로 풉니다')), h('span')),
          h('div', { class: 'list-row', style: 'cursor:default' }, ico('city'), h('div', { class: 't' }, h('b', null, '도시가 자라고 권역이 열립니다'), h('small', null, '충북에서 수도권까지, 뱃길로 제주와 독도까지')), h('span'))),
        h('button', { class: 'btn go', style: 'min-height:46px;font-size:16px', onclick: () => { this.sound.unlock(); this.closeModal(); this.app.startFresh(); } }, '충청북도에서 시작'),
        h('p', { class: 'credit', style: 'margin:0' }, 'Incremental Traffic에서 영감을 받은 비공식 팬 프로젝트입니다.')));
  }

  offlineDialog() {
    const d = this.modalData;
    return h('div', { class: 'dialog small', role: 'dialog', 'aria-label': '돌아오셨습니다' },
      this.head('', ico('truck'), '다녀오셨습니까', `${fmtTime(d.seconds)} 동안 비웠습니다`, () => this.closeModal()),
      h('div', { class: 'p-body' }, h('p', { class: 'note' }, '자리를 비운 사이에도 트럭은 달렸습니다. 다만 정체를 풀어 줄 사람이 없어 평소 수익의 절반만 벌었습니다.'),
        h('div', { class: 'kv' }, h('div', { style: 'grid-column:1/-1' }, h('small', null, '벌어들인 운임'), h('b', { style: 'font-size:26px' }, fmtWon(d.earned)))),
        h('button', { class: 'btn go', onclick: () => this.closeModal() }, '운행 계속')));
  }

  allDoneDialog() {
    const g = this.game;
    return h('div', { class: 'dialog small', role: 'dialog', 'aria-label': '전국 물류망 완성' },
      h('div', { class: 'welcome-hero' }, h('h1', null, '전국 물류망 완성'), h('p', null, `${fmtTime(g.time)} 만에 팔도를 모두 이었습니다. 트럭 ${g.truckCount}대가 누적 ${fmtTon(g.totalTons)}을 날랐습니다.`)),
      h('div', { class: 'p-body' }, h('p', { class: 'note' }, '이제 붐 단계가 시작됩니다. 전국 납품 실적을 쌓을 때마다 운임이 15%씩 오릅니다. 얼마나 큰 물류망까지 막히지 않게 굴릴 수 있는지 끝까지 가 보세요.'),
        h('button', { class: 'btn go', onclick: () => this.closeModal() }, '계속 운행')));
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
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4600);
  }

  showBanner(small, big, em, blue = false) {
    const el = this.el.banner;
    el.classList.remove('show');
    patch(el, [h('div', { class: `banner-sign${blue ? ' blue' : ''}` }, h('small', null, small), h('b', null, big), em && h('em', null, em))]);
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  // ── 도로전광표지 ───────────────────────────────────
  vmsTick(dt) {
    this.vmsT -= dt;
    if (this.vmsT > 0) return;
    this.vmsT = 6.5;
    const g = this.game;
    const msgs = [];
    const jams = g.jams.filter((j) => !j.site);
    for (const j of jams.slice(0, 3)) {
      const road = j.node.inE.slice().sort((a, b) => b.count - a.count)[0]?.road;
      msgs.push({ t: `${road?.name || ''} ${j.node.name} 부근 트럭 ${j.waiting}대 정체`, c: 'red', go: () => this.goNode(j.node) });
    }
    for (const j of g.jams.filter((q) => q.site).slice(0, 1)) {
      msgs.push({ t: `${j.site.name} 진입로 ${j.waiting}대 대기 · 상하차장 증설 요망`, c: 'red', go: () => this.goSite(j.site) });
    }
    if (!msgs.length) {
      const reg = g.currentRegion;
      const pool = [
        { t: `${reg.short} 전 구간 소통 원활`, c: 'green' },
        { t: `누적 물동량 ${fmtTon(g.totalTons)} · 배송 ${g.deliveries.toLocaleString('en-US')}회`, c: '' },
        { t: '졸음운전은 사고의 지름길 · 쉬어 가세요', c: '' },
        { t: '안전거리 확보 · 트럭은 서로 양보합니다', c: '' },
        { t: `정시 배송률 ${Math.round(g.onTimeRate * 100)}%`, c: '' },
      ];
      msgs.push(pool[this.vmsIdx % pool.length]);
    }
    const m = msgs[this.vmsIdx % msgs.length];
    this.vmsIdx++;
    const el = this.el.vms;
    el.className = m.c || '';
    el.onclick = m.go || null;
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = m.t;
    el.appendChild(span);
    const over = span.offsetWidth - (el.clientWidth - 28);
    if (over > 0) { span.style.setProperty('--shift', `${-over}px`); span.classList.add('scroll'); }
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
      { title: '첫 트럭을 사 보세요', text: '지도에서 깜빡이는 충주 사과밭을 누르세요.', target: () => apple, done: () => (this.sel && this.sel.site === apple) || apple.routesOut.some((q) => q.trucks.length) },
      { title: '사과를 공장으로', text: '오른쪽 패널의 음성 식품공장 노선에서 노란 트럭 구매 버튼을 누르세요.', target: () => null, done: () => firstRoute() && firstRoute().trucks.length > 0 },
      { title: '운임이 들어옵니다', text: '트럭이 사과를 내려놓으면 돈이 들어옵니다. 돈이 모이면 트럭을 더 사세요. 창고 게이지가 빨개지면 트럭이 모자란다는 뜻입니다.', target: () => null, done: () => firstRoute() && firstRoute().trucks.length >= 3 },
      { title: '이제 가공식품', text: '공장에 사과가 들어가면 가공식품이 쌓입니다. 음성 식품공장을 눌러 청주로 가는 트럭을 사세요. 값이 훨씬 비쌉니다.', target: () => food, done: () => foodRoutes().some((q) => q.trucks.length > 0) },
      { title: '납품하면 지역이 자랍니다', text: '위쪽 막대가 납품 실적입니다. 실적이 쌓이면 새 거점이 열리고, 다 채우면 다음 권역이 개통됩니다.', target: () => null, done: () => g.progress() >= 0.2 },
      { title: '길이 막히기 시작하면', text: '붉게 깜빡이는 교차로를 누르세요. 진입 방향에 양보 표지를 칠하면 나머지 방향이 멈추지 않고 지나갑니다. 연구에서 신호등도 배울 수 있습니다.', target: () => null, done: () => g.techs.has('signal') || g.progress() >= 0.6 || g.stage > 0 },
    ];
    return this._steps;
  }
}

void svgStr; void LANE_W; void REGION_GOAL;
