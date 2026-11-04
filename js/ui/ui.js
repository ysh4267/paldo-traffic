// 화면 UI 전체: 돈과 속도, 목표, 도구, 정보 카드, 창, 알림
// 평소에는 돈과 목표만 보이고, 나머지 수치는 문제가 생기거나 직접 열어 볼 때만 나타난다.
import { h, ico, raw, patch } from './dom.js';
import { iconHtml, routeBadge, siteIcon } from '../render/art.js';
import { MUSIC_TRACKS } from './audio.js';
import { GOODS, TRUCKS, TECHS, UPGRADES, PERKS, SITE_KIND_NAME, fmtWon, fmtKo, fmtTon, fmtTime, josa, PROJECT_COST, LANE_PRICE_PER_KM } from '../game/defs.js';

export const TOOLS = [
  { id: 'select', icon: 't_select', color: '#4a4a46', name: '선택', key: '1', desc: '거점과 교차로, 도로를 눌러 자세히 봅니다.' },
  { id: 'yield', icon: 't_yield', color: '#e0a21c', name: '양보 표지', key: '2', desc: '교차로로 들어오는 방향에 칠하면 그쪽이 양보합니다. 나머지 방향은 멈추지 않고 통과합니다.' },
  { id: 'stop', icon: 't_stop', color: '#d9412b', name: '정지 표지', key: '3', desc: '칠한 방향의 트럭이 반드시 한 번 멈춘 뒤 진입합니다. 흐름을 강하게 조절할 때 씁니다.' },
  { id: 'signal', icon: 't_signal', color: '#2c9a58', name: '신호등', key: '4', tech: 'signal', desc: '방향별로 번갈아 보냅니다. 교통량이 많은 교차로의 처리량이 크게 늘어납니다.' },
  { id: 'roundabout', icon: 't_roundabout', color: '#3f7fb8', name: '회전교차로', key: '5', tech: 'roundabout', desc: '멈추지 않고 합류합니다. 교통량이 중간쯤인 곳에 좋습니다.' },
  { id: 'interchange', icon: 't_interchange', color: '#9a4fc4', name: '입체교차로', key: '6', tech: 'interchange', desc: '교차 흐름을 입체로 분리합니다. 같은 차로로 합류할 때만 양보합니다. 연결로에서 기다릴 수 있어 IC 사이 짧은 구간과 거점 진입로에 트럭이 이어서 들어갑니다.' },
  { id: 'lane', icon: 't_lane', color: '#e0752b', name: '차로 추가', key: '7', desc: '도로를 눌러 양방향으로 한 차로씩 늘립니다. 끌어서 범위를 고르면 그 안의 도로를 한 번에 늘립니다. Shift를 누른 채 끌면 지나간 도로만 늘립니다.' },
  { id: 'remove', icon: 't_remove', color: '#8a857a', name: '원상복구', key: '8', desc: '교차로의 표지·신호를 없애 기본 상태로 돌립니다. 설치비는 돌려받지 못합니다.' },
  { id: 'fleet', icon: 't_fleet', color: '#3f7fb8', name: '눌러서 고르기', menu: true },
];

// 도구 줄에서 이 도구 앞에 칸막이를 넣는다
const DOCK_BREAKS = new Set(['yield', 'lane']);
const LIST_KINDS = [['all', '전체'], ['raw', '원료'], ['factory', '공장'], ['dest', '납품처']];
const LIST_SORTS = [['region', '권역'], ['state', '상태'], ['name', '이름'], ['trucks', '트럭'], ['income', '수익'], ['stock', '창고']];
// 상태순으로 볼 때 위에서부터 놓는 순서. 급한 것이 먼저다
const LIST_STATES = ['원료 없음', '트럭 없음', '트럭 부족', '화물 부족', '원활', '정상'];
const STATE_TIPS = { '원료 없음': '원료가 없어 멈춘 공장', '트럭 없음': '트럭이 한 대도 없는 거점', '트럭 부족': '창고에 화물이 쌓이는 거점', '화물 부족': '트럭이 화물을 기다리는 거점', 원활: '잘 돌아가는 거점', 정상: '납품받는 곳' };
// 트럭을 더할 노선
const BUY_ON = [['running', '달리는 곳', '달리는 노선마다 더합니다. 트럭이 없는 거점은 가장 잘 버는 노선을 엽니다.'], ['empty', '빈 곳', '트럭이 없는 노선을 모두 엽니다.'], ['all', '전부', '거점의 모든 노선에 더합니다.']];
const slotName = (slot) => (slot.length === 1 ? GOODS[slot[0]].name : '농수산물');
const CITY_STAGE_NAME = ['마을', '읍내', '소도시', '중도시', '대도시', '메가시티'];
const CONTROL_NAME = { auto: '비보호 교차로', signal: '신호 교차로', roundabout: '회전교차로', interchange: '입체교차로' };
const KIND_NAME = { x: '고속도로', n: '국도', r: '연결로', s: '진입로', f: '뱃길' };
const BRIEF_MAX = 8; // 브리핑에 보여 줄 노선 수
const SPOT_CONTROLS = [['signal', '신호등'], ['roundabout', '회전교차로'], ['interchange', '입체교차로']];
const SPOT_SHOWN = 2; // 노선 카드에 먼저 보여 줄 교차로와 도로 수. 나머지는 눌러서 편다
const TODO_HOLD = 6000; // 할 일 줄을 다시 고르는 간격(ms). 너무 자주 바뀌면 눈에 거슬린다
const fmtRatio = (v) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1));

export class UI {
  constructor(app) {
    this.app = app;
    this.game = app.game;
    this.r = app.renderer;
    this.sound = app.sound;
    this.el = {
      top: document.getElementById('topbar'),
      goal: document.getElementById('goal'),
      stats: document.getElementById('statsbox'),
      dock: document.getElementById('dock'),
      menu: document.getElementById('menu'),
      todo: document.getElementById('todo'),
      insp: document.getElementById('inspector'),
      side: document.getElementById('sidecard'),
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
    this.listView = { q: '', kind: 'all', regions: [], states: [], empty: false, sort: 'region' };
    this.listOrder = null;
    this.listPicked = false; // 고른 거점만 보며 공용 메뉴를 쓰는 중
    this.listFilters = false; // 조건 칸을 펼쳤는가
    this.listTicks = false;   // 줄마다 고르는 칸을 꺼냈는가
    this.routeAll = false;    // 노선 카드에서 고칠 곳을 모두 펼쳤는가
    this.saveOpen = false;    // 설정 창의 저장 코드 칸을 펼쳤는가
    this.todoItem = null;
    this.todoT = -Infinity;
    this.briefOpen = false;
    this.brief = null;       // 브리핑 내용. 새로고침하기 전까지 그대로 둔다
    this.panelShown = false;
    this.panelScroll = 0;
    this.holds = {};
    this.panHints = 0;
    this.fleetPick = new Set();
    this.buyOn = 'running';
    this.more = false;
    this.showStats = false;
    this.confirmReset = false;
    this.confirmRebirth = false;
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
    // 누르면 설명은 치운다. 방금 펼친 칸을 가리지 않는다
    document.addEventListener('pointerdown', () => { this.tipFor = null; tip.classList.remove('show'); });
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
        // 저장 코드 칸에 커서가 있어도 Esc로 창을 닫을 수 있어야 한다
        if (e.key === 'Escape' && e.target.tagName === 'TEXTAREA') this.closeModal();
        return;
      }
      // 시작 화면에서는 단축키를 받지 않는다. 다른 창이 덮으면 시작할 수 없게 된다
      if (this.modalName === 'welcome') return;
      const t = TOOLS.find((q) => q.key === e.key);
      if (t) { this.pickTool(t); return; }
      if (e.key === 'Escape') {
        if (this.modalName) this.closeModal();
        else if (this.area) this.clearArea();
        else if (this.tool !== 'select') this.setTool('select');
        else if (this.sel) this.select(null);
        else if (this.listOpen) this.setList(false);
        else if (this.briefOpen) this.setBrief(false);
      }
      if (e.key === 'Enter' && this.area && this.area.pending && !this.modalName) { e.preventDefault(); this.applyArea(); }
      if (e.key === ' ') { e.preventDefault(); this.app.setSpeed(this.app.speed === 0 ? (this.app.lastSpeed || 1) : 0); }
      if (e.key === 'r' || e.key === 'R') this.openModal('research');
      if (e.key === 'b' || e.key === 'B') this.openModal('build');
      if (e.key === 'h' || e.key === 'H') this.openModal('rebirth');
      if (e.key === 'l' || e.key === 'L') this.toggleList();
      if (e.key === 'j' || e.key === 'J') this.toggleBrief();
      if (e.key === 't' || e.key === 'T') this.pickTool(TOOLS.find((q) => q.id === 'fleet'));
      if (e.key === 'm' || e.key === 'M') this.setMusic(!this.sound.musicOn);
    });
  }

  // ── 상태 변경 ──────────────────────────────────────
  select(sel) {
    if (sel && this.tool === 'fleet') this.setTool('select');
    this.sel = sel;
    this.r.selection = sel;
    this.r.hover = null;
    this.r.spotMarks = null;
    this.holds = {};
    this.routeAll = false;
    if (sel && sel.type === 'route') this.measureRoute(sel);
    this.r.jamGlow = this.jamFor(sel);
    this.syncListMap();
    this.app.applyCameraPadding();
    this.updateHighlights();
    this.renderInspector(true);
    this.renderTop();
    // 새 카드는 맨 위부터 보여 준다. 옆에 떠 있는 목록의 스크롤은 그대로 둔다
    if (sel) this.cardEl().querySelector('.p-body')?.scrollTo(0, 0);
  }

  // 고른 곳에 줄이 서 있으면 줄 전체를 칠한다
  jamFor(sel) {
    if (!sel) return null;
    const g = this.game, nodes = g.net.nodes;
    let edges = [];
    if (sel.type === 'route') edges = sel.stretches.flatMap((q) => q.edges);
    else if (sel.type === 'site') edges = g.queueBehind(nodes[sel.site.node]);
    else if (sel.node) edges = g.queueBehind(sel.node);
    else if (sel.road) {
      const set = new Set();
      for (const e of [sel.road.fwd, sel.road.bwd]) {
        if (!g.stuckEdge(e)) continue;
        set.add(e);
        for (const q of g.queueBehind(nodes[e.from])) set.add(q);
        for (const q of g.queueBehind(nodes[e.to])) set.add(q);
      }
      edges = [...set];
    }
    return edges.length ? { edges } : null;
  }
  // 구간이 한눈에 들어오게 카메라를 옮긴다
  fitEdges(edges, duration = 1.1, margin = 1.3, minK = 0.07) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of edges) {
      const b = e.road.bb;
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    this.r.cam.fitBox(x0, y0, x1, y1, duration, margin, minK);
  }
  // 구간이 지금 화면의 빈 곳에 다 들어와 있는가
  edgesInView(edges) {
    const c = this.r.cam, p = c.pad;
    return edges.every((e) => {
      const b = e.road.bb;
      return c.sx(b[0]) >= p.l && c.sx(b[2]) <= c.W - p.r && c.sy(b[1]) >= p.t && c.sy(b[3]) <= c.H - p.b;
    });
  }
  // 새로 개통한 도로가 다 보이게 천천히 옮기고 어디인지 칠한다
  showOpened(p) {
    if (!p.roads.length) return;
    this.flyToRoads(p.roads, 2.6, 1.25);
    this.r.flashRoads(p.roads);
  }
  flyToRoads(roads, duration, margin) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of roads) {
      x0 = Math.min(x0, r.bb[0]); y0 = Math.min(y0, r.bb[1]); x1 = Math.max(x1, r.bb[2]); y1 = Math.max(y1, r.bb[3]);
    }
    this.r.cam.fitBox(x0, y0, x1, y1, duration, margin, 0.07);
  }

  // 좁은 화면에는 창을 나란히 둘 자리가 없다. CSS의 좁은 화면 기준과 같아야 한다
  narrow() { return window.innerWidth <= 760; }
  // 목록이나 브리핑을 띄운 채 고른 것은 그 왼쪽 팝업에 연다
  sideShown() { return !!this.sel && (this.listOpen || this.briefOpen) && !this.narrow(); }
  cardEl() { return this.sideShown() ? this.el.side : this.el.insp; }
  // 지도에서 고른 곳을 왼쪽 팝업이 가리면 보이는 쪽으로 옮긴다
  revealSel(sel) {
    if (!this.sideShown()) return;
    const q = sel.site || sel.node, cam = this.r.cam;
    const x = q ? q.x : sel.road ? (sel.road.bb[0] + sel.road.bb[2]) / 2 : null;
    const y = q ? q.y : sel.road ? (sel.road.bb[1] + sel.road.bb[3]) / 2 : null;
    if (x !== null && cam.sx(x) > cam.W - cam.pad.r - 20) cam.focus(x, y, cam.k);
  }
  clearSel() {
    this.sel = null;
    this.r.selection = null;
    this.r.hover = null;
    this.r.spotMarks = null;
    this.r.jamGlow = null;
    this.holds = {};
    this.updateHighlights();
  }

  setList(open, picked = false) {
    if (open && this.briefOpen) this.setBrief(false);
    const closing = this.listOpen && !open;
    this.listOpen = open;
    this.listPicked = open && picked;
    this.listOrder = null;
    this.panelScroll = 0;
    // 새로 열 때 사는 노선은 지금 조건에 맞춘다
    if (open) this.buyOn = !picked && this.listView.empty ? 'empty' : 'running';
    // 닫으면 고른 것도 풀린다. 보이지 않게 남아 있으면 다음 선택에 섞인다
    if (!open) { this.fleetPick.clear(); this.listTicks = false; }
    if (!open && this.tool === 'fleet') this.setTool('select');
    // 왼쪽 팝업은 목록에 딸린 창이라 함께 닫는다. 여러 거점을 고르기 시작하면 공용 메뉴만 남긴다
    if (this.sel && (closing || (open && (picked || this.narrow())))) this.clearSel();
    this.syncListMap();
    this.app.applyCameraPadding();
    this.renderInspector(true);
    this.renderTop();
  }

  // 고른 거점과 조건 밖 거점은 목록이 열려 있을 때만 지도에 보인다
  syncListMap() {
    this.r.fleetPick = this.listOpen ? this.fleetPick : null;
    if (!this.listOpen) this.r.siteMatch = null;
  }
  // 고른 곳만 보고 있으면 닫지 않고 거점 목록으로 넓힌다
  toggleList() {
    if (this.listOpen && this.listPicked) {
      this.listPicked = false;
      this.listOrder = null;
      this.renderInspector(true);
      return;
    }
    this.setList(!this.listOpen);
  }
  setBrief(open) {
    if (open && this.listOpen) this.setList(false);
    const closing = this.briefOpen && !open;
    this.briefOpen = open;
    this.brief = null;
    this.panelScroll = 0;
    if (this.sel && (closing || (open && this.narrow()))) this.clearSel();
    this.app.applyCameraPadding();
    this.updateHighlights();
    this.renderInspector(true);
    this.renderTop();
  }
  toggleBrief() { this.setBrief(!this.briefOpen); }
  // 브리핑을 열고, 노선을 주면 고칠 곳까지 바로 연다
  openBrief(route) {
    this.sound.click();
    if (!this.briefOpen) this.setBrief(true);
    if (route) this.goRoute(route);
  }
  // 열어 둔 목록과 브리핑을 지금 상태로 다시 만든다
  refreshPanel() {
    this.sound.click();
    if (this.listOpen) this.listOrder = null;
    if (this.briefOpen) this.brief = null;
    if (this.sel && this.sel.type === 'route') this.measureRoute(this.sel);
    this.r.jamGlow = this.jamFor(this.sel);
    this.renderInspector(true);
    // 내용이 그대로여도 새로 불러온 것을 알 수 있게 살짝 깜빡인다
    this.el.insp.querySelector('.p-body')?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
  }
  ageText(t) {
    const sec = this.game.time - t;
    return sec < 60 ? '방금 기준' : `${Math.floor(sec / 60)}분 전 기준`;
  }
  // 카드 위에 마우스가 있는 동안에는 칸이 생기거나 사라지지 않게 한다. 누르려던 버튼이 밀려나지 않는다
  hold(key, value) {
    if (key in this.holds && this.cardEl().matches(':hover')) return this.holds[key];
    this.holds[key] = value;
    return value;
  }

  toggleStats() {
    this.showStats = !this.showStats;
    this.sound.click();
    this.renderTop();
  }

  updateHighlights(hovered = null) {
    const list = [];
    const sel = this.sel;
    if (sel && sel.type === 'route') list.push({ route: sel.route, strong: true });
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
    const picking = id === 'fleet' || this.tool === 'fleet';
    this.area = null;
    this.r.area = null;
    this.renderAreaBar();
    this.tool = id;
    this.r.tool = id;
    this.r.hover = null;
    this.r.toolColor = id === 'remove' ? '#d9412b' : '#3f7fb8';
    this.r.baseDirty = true;
    document.getElementById('map').classList.toggle('placing', id !== 'select');
    // 지도에서 고르기는 거점 목록과 함께 쓴다
    if (id === 'fleet') {
      if (!this.listOpen) this.setList(true);
      else if (this.sel && this.narrow()) this.clearSel();
    }
    if (picking) {
      this.app.applyCameraPadding();
      this.renderInspector(true);
    }
    this.renderDock();
    this.updateHint(null);
  }

  // 지도 클릭 처리
  applyAt(hit, e) {
    const g = this.game, r = this.r;
    const tool = this.tool;
    if (tool === 'select') {
      // Shift나 Ctrl을 누르고 누른 거점은 여러 거점 선택에 넣고 뺀다
      if (hit && hit.type === 'site' && hit.site.produces && e && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        this.pickOnMap([hit.site]);
        return;
      }
      this.sound.click();
      if (!hit) {
        // 빈 곳을 누르면 열린 카드를 먼저 닫고, 그다음 여러 거점 선택을 푼다
        if (!this.sel && this.listOpen && this.listPicked) this.setList(false);
        else this.select(null);
        return;
      }
      this.select(hit);
      this.revealSel(hit);
      // 줄이 화면 밖까지 이어지면 다 보이게 물러난다
      if (this.r.jamGlow && !this.edgesInView(this.r.jamGlow.edges)) this.fitEdges(this.r.jamGlow.edges);
      return;
    }
    if (!hit) return;
    if (tool === 'fleet') {
      this.pickOnMap([hit.site]);
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
    if (this.tool === 'fleet' || this.tool === 'select') {
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
    if (this.tool === 'fleet' || this.tool === 'select') {
      const list = [...this.area.sites];
      this.clearArea();
      if (list.length) this.pickOnMap(list);
      else if (this.tool === 'select') this.panHint();
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

  // 왼쪽 위 한 장에 돈, 속도, 수익, 목표를 모은다. 나머지 수치는 눌러야 펼쳐진다
  renderTop() {
    const g = this.game, app = this.app;
    const speedBtn = (v, label, tip) => h('button', { class: app.speed === v ? 'on' : '', onclick: () => app.setSpeed(v), 'data-tip': tip, 'aria-label': tip, html: label });
    patch(this.el.top, [
      h('button', { class: 'money', key: 'money', onclick: () => this.toggleStats(), 'aria-label': '자세한 통계', 'aria-expanded': this.showStats ? 'true' : 'false', 'data-tip': '눌러서 자세한 통계 보기' },
        h('strong', null, this.moneyText || fmtWon(g.money))),
      h('div', { class: 'speed', key: 'speed' },
        speedBtn(0, `<span class="ico">${iconHtml('pause')}</span>`, '일시정지 (스페이스바)'),
        speedBtn(1, '1', '보통 속도'), speedBtn(2, '2', '2배 속도'), speedBtn(4, '4', '4배 속도'), speedBtn(8, '8', '8배 속도')),
    ]);
    patch(this.el.stats, this.showStats ? [this.statsCard()] : []);
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
    return h('div', { class: 'kvs', key: 'stats' },
      this.kv(`${reg.short} 납품 실적`, `${fmtKo(reg.pts)} / ${fmtKo(g.regionGoal(reg.index))}`),
      next && this.kv('다음 권역', next.short),
      this.kv('트럭', `${g.truckCount}대`),
      this.kv('도로 위 / 멈춤', `${ms.onRoad}대 / ${ms.stopped}대`),
      this.kv('정시율', `${Math.round(g.onTimeRate * 100)}%`),
      this.kv('배송', `${g.deliveries.toLocaleString('en-US')}회`),
      this.kv('누적 물동량', fmtTon(g.totalTons)),
      this.kv('누적 수익', fmtWon(g.totalEarned)),
      this.kv('운행 시간', fmtTime(g.time)),
      g.legacy.runs > 0 && this.kv('회차', `${g.legacy.runs + 1}회차 · 명성 ${g.legacy.fame}`));
  }

  renderMenu() {
    const g = this.game;
    const researchReady = TECHS.some((t) => !g.techs.has(t.id) && g.techVisible(t) && g.money >= t.cost)
      || UPGRADES.some((u) => g.upg[u.id] < u.max && g.money >= g.upgradeCostOf(u.id));
    const buildReady = g.projects.some((p) => g.projectAvailable(p) && g.money >= g.projectPrice(p));
    const btn = (key, label, tip, onclick, dot, on) => h('button', { key, class: on ? 'on' : '', onclick, 'data-tip': tip, 'aria-label': tip, 'aria-pressed': on ? 'true' : null }, label, dot && h('i', { class: `dot ${dot === 'bad' ? 'bad' : ''}`.trim(), key: 'dot' }));
    // 환생은 권역이 하나 더 열리면 보여 준다. 처음부터 다 꺼내 놓으면 낯설다
    const L = g.legacy;
    const rebirthShown = g.stage >= 1 || L.runs > 0 || L.fame > 0;
    const rebirthReady = g.canRebirth() || PERKS.some((p) => g.perk(p.id) < p.max && L.fame >= g.perkCost(p.id));
    // 정체 브리핑도 트럭이 몇 대 늘어야 쓸 일이 생긴다
    const briefShown = g.stage >= 1 || g.truckCount >= 6 || L.runs > 0;
    const jammed = !this.briefOpen && g.routeJams.some((j) => j.ratio >= 2 && j.lost >= 1);
    patch(this.el.menu, [
      btn('research', '연구', '연구 (R)', () => this.openModal('research'), researchReady),
      btn('build', '건설', '우회도로·대교 건설 (B)', () => this.openModal('build'), buildReady),
      btn('list', '거점', '거점 목록 (L)', () => { this.sound.click(); this.toggleList(); }, false, this.listOpen),
      briefShown && btn('jam', '정체', '정체 브리핑 (J)', () => { this.sound.click(); this.toggleBrief(); }, jammed && 'bad', this.briefOpen),
      rebirthShown && btn('star', '환생', '환생과 명성 보너스 (H)', () => this.openModal('rebirth'), rebirthReady),
      h('button', { key: 'gear', class: 'icon', onclick: () => this.openModal('settings'), 'data-tip': '설정과 저장', 'aria-label': '설정과 저장' }, ico('gear')),
    ].filter(Boolean));
  }

  // 지금 손대면 좋은 곳 하나만 알려 준다
  renderTodo() {
    const show = !this.modalName && this.game.flags.tutorial !== true;
    const now = performance.now();
    if (show && now - this.todoT > TODO_HOLD) {
      this.todoT = now;
      this.todoItem = this.advice()[0] || null;
    }
    const a = show ? this.todoItem : null;
    patch(this.el.todo, a ? [h('button', { class: `todo ${a.tone || ''}`.trim(), key: a.title, onclick: a.go, 'data-tip': a.sub }, h('i'), h('span', null, a.title))] : []);
  }

  // 쓸 수 있는 도구만 보여 준다. 나머지는 연구하면 나타난다
  renderDock() {
    const g = this.game;
    const kids = [];
    for (const t of TOOLS) {
      if (t.menu || (t.tech && !g.techs.has(t.tech))) continue;
      if (DOCK_BREAKS.has(t.id)) kids.push(h('i', { class: 'sep', key: `sep-${t.id}` }));
      kids.push(h('button', {
        key: t.id,
        class: `tool${t.id === 'select' ? ' base' : ''}${this.tool === t.id ? ' on' : ''}`,
        style: `--c:${t.color}`,
        onclick: () => this.pickTool(t),
        'data-tip': `${t.name} (${t.key})\n${t.desc}`,
        'aria-label': t.name,
        'aria-pressed': this.tool === t.id ? 'true' : 'false',
      }, ico(t.icon)));
    }
    patch(this.el.dock, kids);
  }

  renderGoal() {
    const g = this.game;
    const reg = g.currentRegion;
    const prog = g.progress();
    const goalPts = g.regionGoal(reg.index);
    const rate = h('span', { class: 'rate', key: 'rate' }, g.income > 0 ? `+${fmtWon(g.income * 60)}/분` : '아직 수익 없음');
    let kids;
    if (g.flags.allDone) {
      const frac = g.endlessPts / g.endlessGoal();
      kids = [
        rate,
        h('span', { class: 'reg', key: 'reg', 'data-tip': `지금 납품가 +${Math.round((g.boomMult() - 1) * 100)}%` }, `붐 ${g.endless + 1}단계`),
        h('div', { class: 'track', key: 'track' }, h('div', { class: 'fill', style: `width:${(frac * 100).toFixed(1)}%` })),
        h('span', { class: 'pct', key: 'pct' }, `${Math.floor(frac * 100)}%`),
      ];
    } else {
      const next = g.regions[reg.index + 1];
      kids = [
        rate,
        h('span', { class: 'reg', key: 'reg' }, reg.short),
        h('div', { class: 'track', key: 'track', 'data-tip': `${reg.name}에 납품한 실적 ${fmtKo(reg.pts)} / ${fmtKo(goalPts)}\n${next ? `다 채우면 ${next.short} 개통` : '다 채우면 전국 물류망 완성'}` }, h('div', { class: 'fill', style: `width:${(prog * 100).toFixed(1)}%` })),
        h('span', { class: 'pct', key: 'pct' }, `${Math.floor(prog * 100)}%`),
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
    const sel = this.sel, el = this.el.insp;
    const panel = this.listOpen || this.briefOpen;
    const side = this.sideShown();
    // 좁은 화면에서는 카드가 목록을 덮는다. 카드를 닫으면 보던 자리로 돌아온다
    const panelShown = panel && (side || !sel);
    if (this.panelShown && panel && !panelShown) this.panelScroll = el.querySelector('.p-body')?.scrollTop || 0;
    const card = sel ? this.cardView(sel) : null;
    const main = panelShown ? (this.listOpen ? this.overviewView() : this.briefView()) : card;
    el.classList.toggle('is-list', panelShown);
    el.classList.toggle('picking', this.tool === 'fleet');
    this.paintCard(el, main);
    this.paintCard(this.el.side, side ? card : null);
    if (panelShown && !this.panelShown && this.panelScroll) {
      el.querySelector('.p-body')?.scrollTo(0, this.panelScroll);
      this.panelScroll = 0;
    }
    this.panelShown = panelShown;
  }
  cardView(sel) {
    if (sel.type === 'site') return this.siteView(sel.site);
    if (sel.type === 'node' || sel.type === 'approach') return this.nodeView(sel.node);
    if (sel.type === 'road') return this.roadView(sel.road);
    if (sel.type === 'project') return this.projectView(sel.project);
    if (sel.type === 'route') return this.routeView(sel);
    return null;
  }
  // 창 하나를 그린다. 내용이 없으면 잠깐 사라지는 움직임을 보여 주고 닫는다
  paintCard(el, view) {
    if (!view) {
      if (!el.hidden && !el.closing) {
        el.closing = true;
        el.classList.add('out');
        setTimeout(() => {
          if (!el.closing) return;
          el.closing = false;
          el.classList.remove('out');
          el.hidden = true;
          patch(el, []);
        }, 150);
      }
      return;
    }
    if (el.closing) { el.closing = false; el.classList.remove('out'); }
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

  head(leading, title, sub, onClose, extra) {
    return h('div', { class: 'p-head', key: 'head' },
      leading,
      h('div', { class: 'p-title' }, h('h2', null, title), sub && h('p', null, sub)),
      extra,
      onClose && h('button', { class: 'p-x', onclick: onClose, 'aria-label': '닫기', 'data-tip': '닫기 (Esc)' }, ico('close')));
  }

  refreshBtn() {
    return h('button', { class: 'p-x p-refresh', key: 'refresh', onclick: () => this.refreshPanel(), 'aria-label': '새로고침', 'data-tip': '지금 상태로 새로 불러옵니다.\n열어 둔 동안에는 저절로 바뀌지 않습니다.' }, ico('auto'));
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

  // 거점의 빈 노선. 납품처는 들어오는 노선으로 본다
  emptyRoutes(s) { return this.siteRoutes(s).filter((q) => q.valid && !q.trucks.length); }

  // 조건에 맞는 거점. skip에 적은 조건은 보지 않는다 (버튼에 보일 개수를 셀 때 쓴다)
  listMatch(skip = '') {
    const g = this.game, f = this.listView;
    const q = f.q.trim();
    return g.sites.filter((s) => {
      if (!s.available) return false;
      if (f.kind === 'raw' && !(s.produces && !s.inputs)) return false;
      if (f.kind === 'factory' && !(s.produces && s.inputs)) return false;
      if (f.kind === 'dest' && s.produces) return false;
      if (f.regions.length && !f.regions.includes(s.region)) return false;
      if (skip !== 'states' && f.states.length && !f.states.includes(this.siteStatus(s).short)) return false;
      if (skip !== 'empty' && f.empty && !this.emptyRoutes(s).length) return false;
      if (!q) return true;
      return `${s.name} ${g.regions[s.region].short} ${SITE_KIND_NAME[s.kind]} ${s.produces ? GOODS[s.goods].name : ''}`.includes(q);
    });
  }
  // 조건에 맞는 거점을 정렬한다
  listSites() {
    const list = this.listPicked ? [...this.fleetPick] : this.listMatch();
    const by = {
      state: (a, b) => LIST_STATES.indexOf(this.siteStatus(a).short) - LIST_STATES.indexOf(this.siteStatus(b).short) || this.stateMeasure(b)[0] - this.stateMeasure(a)[0],
      name: (a, b) => a.name.localeCompare(b.name, 'ko'),
      trucks: (a, b) => this.siteTruckCount(b) - this.siteTruckCount(a),
      income: (a, b) => this.siteIncome(b) - this.siteIncome(a),
      stock: (a, b) => this.siteStockFrac(b) - this.siteStockFrac(a),
    }[this.listPicked ? 'state' : this.listView.sort];
    return by ? list.sort(by) : list;
  }

  // 거점을 고르는 칸. 여러 곳을 묶은 칸은 일부만 골라져 있으면 가운데 줄로 보여 준다
  tickState(list) {
    const n = list.filter((s) => this.fleetPick.has(s)).length;
    return list.length > 0 && n === list.length ? 'on' : n ? 'some' : '';
  }
  tickMark(list) {
    const state = this.tickState(list);
    return h('span', { class: `tick-box ${state}`.trim(), key: 'box' }, state === 'on' && ico('check'));
  }
  tickBtn(list, label) {
    const state = this.tickState(list);
    return h('button', { class: 'tick', key: 'tick', role: 'checkbox', 'aria-checked': state === 'on' ? 'true' : state ? 'mixed' : 'false', 'aria-label': label, onclick: () => this.toggleBulk(list) }, this.tickMark(list));
  }

  // 목록 한 줄에 보일 값. 새로고침하기 전까지 이 값을 그대로 보여 준다
  rowSnap(s) {
    const f = this.listView, sort = this.listPicked ? 'state' : f.sort;
    const st = this.siteStatus(s);
    const empty = this.emptyRoutes(s);
    let right = st.tone !== 'ok' ? st.short : '';
    if (sort === 'state') right = this.stateMeasure(s)[1];
    // 빈 노선을 찾는 중이면 몇 개가 비었는지가 먼저다
    if (!this.listPicked && f.empty && empty.length) right = `빈 노선 ${empty.length}개`;
    if (sort === 'trucks') right = `${this.siteTruckCount(s)}대`;
    if (sort === 'income') right = `${fmtWon(this.siteIncome(s))}/분`;
    if (sort === 'stock') right = s.produces ? `${Math.round(this.siteStockFrac(s) * 100)}%` : '';
    const tip = s.produces ? `${GOODS[s.goods].name} · 트럭 ${this.siteTruckCount(s)}대` : `${SITE_KIND_NAME[s.kind]} · 납품 트럭 ${this.siteTruckCount(s)}대`;
    const names = empty.map((q) => (s.produces ? q.to : q.from).name);
    const emptyTip = names.length ? `\n빈 노선: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` 외 ${names.length - 4}개` : ''}` : '';
    return { right, tone: st.tone === 'ok' ? '' : st.tone, icon: siteIcon(s), tip: `${tip}${st.tone !== 'ok' ? `\n${st.short}` : ''}${emptyTip}` };
  }
  // 고르는 칸은 여러 곳을 고를 때만 꺼낸다. 평소에는 줄이 깔끔하다
  ticksOn() { return this.listTicks || this.listPicked || this.fleetPick.size > 0 || this.tool === 'fleet'; }
  listRow(s) {
    const q = this.listRows.get(s);
    const on = this.sel && this.sel.site === s;
    const ticks = this.ticksOn();
    return h('div', { class: `pick-row${ticks ? ' ticks' : ''}${on ? ' on' : ''}`, key: s.id },
      ticks && (s.produces ? this.tickBtn([s], `${s.name} 고르기`) : h('span', { class: 'tick-none', key: 'tick' })),
      h('button', { class: 'list-row', key: 'go', onclick: () => this.goSite(s), 'data-tip': q.tip },
        raw(q.icon, 'ico'), h('span', { class: 't' }, s.name), q.right && h('span', { class: `state ${q.tone}`.trim() }, q.right)));
  }

  // 작은 고르기 칸. 꼭 쓰는 값만 보이고 나머지는 눌러야 펼쳐진다
  pickSel(key, value, options, onchange, tip) {
    return h('select', {
      class: 'pick', key, value: String(value), 'aria-label': tip, 'data-tip': tip,
      onchange: (e) => { onchange(e.target.value); e.target.blur(); },
    }, options.map(([v, label]) => h('option', { key: String(v), value: String(v) }, label)));
  }

  chipBtn(key, on, label, tip, onclick) {
    return h('button', { key, class: `chip${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'data-tip': tip, onclick }, label);
  }
  mapChip() {
    return this.chipBtn('map', this.tool === 'fleet', '눌러서 고르기', '켜면 거점을 누를 때마다 넣고 뺍니다. 휴대폰에서는 한 손가락으로 끌어 고릅니다. (T)', () => this.pickTool(TOOLS.find((t) => t.id === 'fleet')));
  }

  // 찾기와 정렬만 늘 보이고, 조건은 눌러야 펼쳐진다. 켜 둔 조건은 접혀 있어도 작은 칸으로 남는다
  listTools(sites, filtering) {
    const g = this.game, f = this.listView, counts = this.listCounts;
    const set = (k, v) => { f[k] = v; this.sound.click(); this.renderInspector(true); };
    // 여러 개를 켤 수 있는 조건. 하나도 안 켜면 전부 보여 준다
    const flip = (k, v) => set(k, f[k].includes(v) ? f[k].filter((q) => q !== v) : [...f[k], v]);
    const setEmpty = (v) => { this.buyOn = v ? 'empty' : 'running'; set('empty', v); };
    const chip = (...a) => this.chipBtn(...a);
    const line = (key, label, kid) => h('div', { class: 'list-line', key }, h('span', { class: 'list-label' }, label), kid);
    const regions = this.listRegions;
    const ticks = this.ticksOn();
    const active = [];
    if (f.kind !== 'all') active.push(['kind', LIST_KINDS.find((q) => q[0] === f.kind)[1], () => set('kind', 'all')]);
    for (const i of f.regions) active.push([`r${i}`, g.regions[i].short, () => flip('regions', i)]);
    for (const st of f.states) active.push([st, st, () => flip('states', st)]);
    if (f.empty) active.push(['empty', '빈 노선 있음', () => setEmpty(false)]);
    const kids = [
      h('div', { class: 'list-bar', key: 'bar' },
        h('input', {
          class: 'list-search', key: 'q', type: 'search', placeholder: '이름, 권역, 화물로 찾기', value: f.q, 'aria-label': '거점 찾기',
          oninput: (e) => { f.q = e.target.value; this.renderInspector(true); },
          onkeydown: (e) => { if (e.key === 'Escape') { if (f.q) { f.q = ''; this.renderInspector(true); } else e.target.blur(); } },
        }),
        chip('filters', this.listFilters, active.length ? `조건 ${active.length}` : '조건', '종류, 권역, 상태, 빈 노선으로 거릅니다', () => { this.listFilters = !this.listFilters; this.sound.click(); this.renderInspector(true); })),
    ];
    if (this.listFilters) {
      kids.push(h('div', { class: 'filter-box', key: 'filter-box' },
        line('kinds', '종류', h('div', { class: 'seg' }, LIST_KINDS.map(([id, label]) => h('button', { key: id, class: f.kind === id ? 'on' : '', onclick: () => set('kind', id) }, label)))),
        regions.length > 1 && line('regions', '권역', h('div', { class: 'chips' }, regions.map((r) => chip(`r${r.index}`, f.regions.includes(r.index), r.short, `${r.name} 거점을 봅니다`, () => flip('regions', r.index))))),
        line('states', '상태', h('div', { class: 'chips' }, LIST_STATES.filter((st) => counts[st] || f.states.includes(st)).map((st) => chip(st, f.states.includes(st), `${st} ${counts[st] || 0}`, STATE_TIPS[st], () => flip('states', st))))),
        line('routes', '노선', h('div', { class: 'chips' }, chip('empty', f.empty, `빈 노선 있음 ${counts.empty}`, '트럭이 한 대도 없는 노선이 있는 거점만 봅니다', () => setEmpty(!f.empty))))));
    } else if (active.length) {
      kids.push(h('div', { class: 'chips', key: 'active' }, active.map(([key, label, off]) => h('button', { key, class: 'chip on', onclick: off, 'aria-label': `${label} 조건 끄기`, 'data-tip': '눌러서 이 조건을 끕니다' }, label, h('span', { class: 'x', key: 'x' }, '✕')))));
    }
    kids.push(h('div', { class: 'list-sort', key: 'sort' },
      this.pickSel('sort', f.sort, LIST_SORTS.map(([id, label]) => [id, `${label}순`]), (v) => set('sort', v), '줄 세울 기준'),
      chip('ticks', ticks, ticks ? '고르기 그만' : '여러 곳 고르기', '여러 거점을 골라 트럭을 한꺼번에 삽니다. 지도에서 끌어서 골라도 됩니다.', () => {
        this.sound.click();
        if (ticks) {
          this.listTicks = false;
          this.fleetPick.clear();
          if (this.tool === 'fleet') this.setTool('select');
        } else this.listTicks = true;
        this.renderInspector(true);
      })));
    if (ticks) {
      const can = sites.filter((s) => s.produces);
      const state = this.tickState(can);
      kids.push(h('div', { class: 'pick-line', key: 'pick' },
        h('button', { class: 'pick-all', key: 'all', disabled: !can.length, role: 'checkbox', 'aria-checked': state === 'on' ? 'true' : state ? 'mixed' : 'false', 'data-tip': '납품처에는 트럭을 둘 수 없어 고르지 않습니다', onclick: () => this.toggleBulk(can) },
          this.tickMark(can), can.length ? `${filtering ? '조건에 맞는' : '전체'} ${can.length}곳` : '고를 거점이 없습니다'),
        this.mapChip()));
    }
    return kids;
  }

  convertBtn(plan, routes, to) {
    const names = (set) => [...set].sort((a, b) => a.cap - b.cap).map((t) => t.short).join('·');
    return h('button', {
      class: 'btn up', key: 'go', disabled: !plan.n,
      'data-tip': `나르는 양은 그대로 두고 대수를 줄입니다. 1톤 5대가 5톤 1대가 됩니다.\n값은 새 트럭값에서 빠지는 트럭값의 절반을 뺀 만큼입니다.\n달리는 트럭은 다음 거점에 닿을 때 바뀌거나 사라집니다.${plan.n < plan.all ? `\n자금이 모자라 ${plan.all}대 중 ${plan.n}대만 바꿉니다.` : ''}`,
      onclick: () => this.convertFleet(routes, to),
      ...this.showRoutes(routes),
    }, h('span', null, `${names(plan.n ? plan.some : plan.every)} ${plan.n || plan.all}대 → ${TRUCKS[to].short} ${plan.k || plan.allK}대`), h('span', { class: 'price' }, fmtWon(plan.n ? plan.cost : plan.full)));
  }
  // 버튼에 마우스를 올리면 영향을 받는 노선을 지도에 보여 준다
  showRoutes(routes) {
    return {
      onmouseenter: () => { this.r.highlightRoutes = routes.map((route) => ({ route, strong: true })); },
      onmouseleave: () => this.updateHighlights(),
    };
  }
  convertFleet(routes, to) {
    let n = 0, k = 0, paid = 0;
    for (const q of routes) {
      const r = this.game.convertTrucks(q, to);
      n += r.n;
      k += r.k;
      paid += r.paid;
    }
    this.updateHighlights();
    this.afterConvert(n, k, paid, to);
  }
  afterConvert(n, k, paid, to) {
    if (!n) { this.sound.deny(); return; }
    this.sound.buy();
    this.toast('truck_hauler', `트럭 ${n}대를 ${TRUCKS[to].short} ${k}대로 바꿉니다`, `${fmtWon(paid)} · 달리는 트럭은 다음 거점에서 바뀝니다`);
    this.renderInspector(true);
    this.renderTop();
  }

  // ── 여러 거점 고르기 ───────────────────────────────
  // 전부 골라져 있으면 빼고, 아니면 모두 더한다
  toggleBulk(list) {
    const drop = list.every((s) => this.fleetPick.has(s));
    for (const s of list) {
      if (drop) this.fleetPick.delete(s);
      else this.fleetPick.add(s);
    }
    this.sound.click();
    // 고른 곳만 보던 중에 다 빠지면 닫는다
    if (this.listPicked && !this.fleetPick.size) {
      this.setList(false);
      return;
    }
    this.renderInspector(true);
  }
  // 지도에서 고르면 공용 메뉴가 바로 뜬다
  pickOnMap(list) {
    if (!this.listOpen) this.setList(true, true);
    // 고른 곳만 보는 중이면 새로 고른 곳이 목록에 들어와야 한다
    if (this.listPicked) this.listOrder = null;
    this.toggleBulk(list);
  }
  // 빈 곳을 끈 사람은 지도를 옮기려던 것일 수 있다
  panHint() {
    if (this.app.settings.dragPan || this.panHints >= 2) return;
    this.panHints++;
    this.toast('t_select', '범위 안에 고를 거점이 없습니다', '지도를 옮기려면 오른쪽 버튼으로 끄세요');
  }
  // 끄는 동안 범위 안에서 조건에 맞는 거점을 미리 보여 준다. 손을 떼면 toggleBulk로 더하거나 뺀다
  dragBulk(x0, y0, x1, y1) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    // 조건은 거점 목록을 펼쳐 둔 동안에만 따른다
    const base = this.listOpen && !this.listPicked ? this.listOrder || this.listMatch() : this.game.sites.filter((s) => s.available);
    const sites = base.filter((s) => s.produces && s.x >= lx && s.x <= hx && s.y >= ly && s.y <= hy);
    const drop = sites.length > 0 && sites.every((s) => this.fleetPick.has(s));
    this.area = { x0, y0, x1, y1, roads: [], pick: new Set(), total: 0, pending: false, paths: new Map(), pathK: 0, sites: new Set(sites), drop };
    this.r.area = this.area;
    patch(this.el.hint, [sites.length ? h('span', null, `거점 ${sites.length}곳 `, h('b', null, drop ? '빼기' : '더하기')) : h('span', null, '범위 안에 조건에 맞는 거점이 없습니다')]);
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
  // 고른 거점의 공용 메뉴: 거점 카드에서 하던 일을 고른 곳 전부에 한꺼번에 한다
  listFoot(sites) {
    const g = this.game, picked = [...this.fleetPick];
    if (!g.modelUnlocked(this.modelSel)) this.modelSel = 0;
    const m = this.modelSel;
    const running = picked.flatMap((s) => s.routesOut.filter((q) => q.valid && q.trucks.length));
    const trucks = running.reduce((sum, q) => sum + q.trucks.length, 0);
    const outside = picked.filter((s) => !sites.includes(s)).length;
    // 원료가 없어 멈춘 공장에 트럭을 더해도 싣고 갈 것이 없다
    const stopped = picked.filter((s) => this.siteStatus(s).short === '원료 없음');
    const buyRoutes = picked.filter((s) => !stopped.includes(s)).flatMap((s) => g.bulkRoutes(s, this.buyOn));
    const count = this.buyCount || 200;
    const plan = g.planBuy(buyRoutes, m, count);
    // 한 대도 못 사면 얼마가 드는지 보여 준다
    const short = plan.n ? plan : g.planBuy(buyRoutes, m, this.buyCount || 1);
    const conv = g.planConvert(running, m);
    const upg = g.planSites(picked, (s) => g.upgradeCost(s));
    const bay = g.planSites(picked.filter((s) => s.bays < 12), (s) => g.bayCost(s));
    // 할 수 없을 때만 까닭을 적는다
    const note = [
      !buyRoutes.length ? '트럭을 더할 노선이 없습니다' : !plan.n ? '자금 부족' : this.buyCount && plan.n < plan.want ? `자금이 모자라 ${plan.want}대 중 ${plan.n}대만` : '',
      stopped.length > 0 && `원료가 없어 멈춘 ${stopped.length}곳은 뺌`,
    ].filter(Boolean).join(' · ');
    const on = BUY_ON.find((q) => q[0] === this.buyOn);
    const autoOn = running.length > 0 && running.every((q) => q.auto);
    return h('div', { class: 'list-foot', key: 'foot' },
      !this.listPicked && h('div', { class: 'foot-top', key: 'top', 'data-tip': `달리는 노선 ${running.length}개 · 트럭 ${trucks}대` },
        h('b', null, `${picked.length}곳 고름`), outside > 0 && h('small', null, `${outside}곳은 조건 밖`),
        h('div', { class: 'foot-acts', key: 'acts' },
          h('button', { class: 'text-btn', key: 'only', 'data-tip': '고른 거점만 추려 봅니다', onclick: () => { this.sound.click(); this.listPicked = true; this.listOrder = null; this.renderInspector(true); } }, '고른 곳만'),
          h('button', { class: 'text-btn', key: 'clear', 'data-tip': '고른 거점을 모두 풉니다', onclick: () => this.toggleBulk(picked) }, '해제'))),
      h('div', { class: 'pick-row3', key: 'opts' },
        this.modelPick(),
        this.countPick('씩'),
        this.pickSel('buyon', this.buyOn, BUY_ON.map(([id, label]) => [id, label]), (v) => { this.buyOn = v; this.sound.click(); this.renderInspector(true); }, `트럭을 더할 노선\n${on[2]}`)),
      h('div', { class: 'foot-buy', key: 'buy' },
        h('button', { class: 'btn sell', key: 'sell', disabled: !running.length, 'aria-label': '달리는 노선마다 트럭 한 대 처분', 'data-tip': '달리는 노선마다 트럭을 한 대씩 처분합니다 (구매가의 50% 환급).\n도로가 막힐 때 숨통을 틔웁니다.', onclick: () => this.sellBulk(running), ...this.showRoutes(running) }, ico('minus')),
        h('button', {
          class: 'btn buy', key: 'go', disabled: !plan.n,
          'data-tip': `노선 ${buyRoutes.length}개에 ${this.buyCount ? `${count}대씩` : '돈이 닿는 만큼 고르게'} 더합니다.\n노선의 트럭이 늘수록 값이 오릅니다.`,
          onclick: () => this.buyBulk(buyRoutes, m, count),
          ...this.showRoutes(buyRoutes),
        }, buyRoutes.length ? [h('span', { key: 'n' }, `${TRUCKS[m].short} ${plan.n || short.want}대 사기`), h('span', { class: 'price', key: 'p' }, fmtWon(plan.n ? plan.cost : short.full))] : '더할 노선 없음')),
      note && h('p', { class: 'status', key: 'note' }, note),
      conv.all > 0 && this.convertBtn(conv, running, m),
      h('div', { class: 'btn-row', key: 'grow' },
        this.siteBtn('upg', '생산 +38%', upg, '고른 거점의 생산을 늘립니다. 늘어난 물량을 나를 트럭이 더 필요해집니다.', (s) => g.buyUpgrade(s), '생산을 늘렸습니다'),
        bay.all > 0 && this.siteBtn('bay', '상하차 +1칸', bay, '고른 거점의 상하차장을 한 칸씩 늘립니다. 진입로 정체가 큰길까지 번지는 것을 막아 줍니다.', (s) => g.buyBay(s), '상하차장을 늘렸습니다')),
      g.techs.has('autobuy') && running.length > 0 && h('label', { class: 'field small', key: 'auto', 'data-tip': '달리는 노선 전부에 자동 배차를 켜거나 끕니다' }, '달리는 노선 자동 배차',
        h('input', { type: 'checkbox', checked: autoOn, onchange: (e) => { for (const q of running) { q.auto = e.target.checked; q.model = m; } this.renderInspector(true); } })));
  }
  // 생산이나 상하차장처럼 거점마다 한 번씩 사는 버튼
  siteBtn(key, label, plan, tip, buy, done) {
    const n = plan.list.length;
    return h('button', {
      class: 'btn up', key, disabled: !n,
      'data-tip': `${tip}\n싼 곳부터 돈이 닿는 만큼 늘립니다. 지금은 ${plan.all}곳 중 ${n}곳`,
      onclick: () => this.growSites(plan, buy, done),
    }, h('span', null, label), h('span', { class: 'price' }, fmtWon(n ? plan.cost : plan.full)));
  }
  growSites(plan, buy, done) {
    const g = this.game, m0 = g.money;
    let n = 0;
    for (const s of plan.list) if (buy(s)) n++;
    if (!n) { this.sound.deny(); return; }
    this.sound.buy();
    this.toast('star', `${n}곳의 ${done}`, fmtWon(m0 - g.money));
    this.renderInspector(true);
    this.renderTop();
  }
  sellBulk(routes) {
    const g = this.game, m0 = g.money;
    let n = 0;
    for (const q of routes) if (g.sellTruck(q)) n++;
    if (!n) { this.sound.deny(); return; }
    this.sound.click();
    this.toast('truck_hauler', `트럭 ${n}대를 처분했습니다`, `+${fmtWon(g.money - m0)}`);
    this.updateHighlights();
    this.renderInspector(true);
    this.renderTop();
  }
  // 권역이나 상태로 묶은 줄의 제목. 칸을 누르면 묶음을 통째로 고른다
  groupHead(title, list) {
    const can = list.filter((s) => s.produces);
    return h('h3', null, h('span', { class: 'h-left' }, this.ticksOn() && can.length > 0 && this.tickBtn(can, `${title} 모두 고르기`), title), h('span', null, `${list.length}곳`));
  }

  overviewView() {
    const g = this.game, f = this.listView, pick = this.fleetPick, picked = this.listPicked;
    const sort = picked ? 'state' : f.sort;
    const filtering = !picked && (f.q.trim() || f.kind !== 'all' || f.regions.length || f.states.length || f.empty);
    // 게임이 돌아가도 목록은 그대로 둔다. 새로고침하거나, 창을 새로 열거나, 조건을 바꿀 때만 다시 고른다
    const key = JSON.stringify(f) + picked;
    if (!this.listOrder || key !== this.listKey) {
      this.listOrder = this.listSites();
      this.listStates = new Map(this.listOrder.map((s) => [s, this.siteStatus(s).short]));
      this.listRows = new Map(this.listOrder.map((s) => [s, this.rowSnap(s)]));
      this.listRegions = g.regions.filter((r) => r.unlocked);
      this.listCounts = { empty: this.listMatch('empty').filter((s) => this.emptyRoutes(s).length).length };
      for (const s of this.listMatch('states')) {
        const st = this.siteStatus(s).short;
        this.listCounts[st] = (this.listCounts[st] || 0) + 1;
      }
      this.r.siteMatch = filtering ? new Set(this.listOrder) : null;
      this.listKey = key;
      this.listT = g.time;
    }
    const sites = this.listOrder;
    // 찾기와 정렬은 줄을 내려도 그대로 위에 남는다
    const tools = picked
      ? h('div', { class: 'chips', key: 'modes' }, this.chipBtn('cond', false, '조건으로 더 고르기', '거점 목록을 펼쳐 권역, 상태, 빈 노선 같은 조건으로 더 고릅니다', () => { this.sound.click(); this.toggleList(); }), this.mapChip())
      : this.listTools(sites, filtering);
    const body = [];
    if (!sites.length) body.push(h('p', { class: 'status', key: 'none' }, '조건에 맞는 거점이 없습니다.'));
    else if (sort === 'region') {
      const grouped = g.regions.filter((r) => r.unlocked).map((r) => ({ r, list: sites.filter((s) => s.region === r.index) })).filter((q) => q.list.length).reverse();
      for (const { r, list } of grouped) body.push(h('div', { class: 'sec', key: `reg${r.index}` }, this.groupHead(r.short, list), list.map((s) => this.listRow(s))));
    } else if (sort === 'state') {
      // 순서를 정할 때의 상태로 묶어, 순서를 고정한 동안 줄이 다른 묶음으로 옮겨 가지 않게 한다
      for (const name of LIST_STATES) {
        const list = sites.filter((s) => this.listStates.get(s) === name);
        if (list.length) body.push(h('div', { class: 'sec', key: `st${name}` }, this.groupHead(name, list), list.map((s) => this.listRow(s))));
      }
    } else {
      body.push(h('div', { class: 'sec', key: 'sorted' }, h('h3', null, `${LIST_SORTS.find((q) => q[0] === sort)[1]} 순서`, h('span', null, `${sites.length}곳`)), sites.map((s) => this.listRow(s))));
    }
    const running = [...pick].flatMap((s) => s.routesOut.filter((q) => q.valid && q.trucks.length));
    const head = picked
      ? this.head(null, `거점 ${pick.size}곳 선택`, `달리는 노선 ${running.length}개 · 트럭 ${running.reduce((sum, q) => sum + q.trucks.length, 0)}대`, () => this.setList(false), this.refreshBtn())
      : this.head(null, '거점 목록', `${sites.length}곳 · ${this.ageText(this.listT)}`, () => this.setList(false), this.refreshBtn());
    return [head, h('div', { class: 'p-tools', key: 'tools' }, tools), h('div', { class: 'p-body', key: 'body' }, body), pick.size > 0 && this.listFoot(sites)].filter(Boolean);
  }

  // 연구와 환생은 메뉴의 점으로 알린다. 여기에는 지금 막히거나 쌓이는 곳만 적는다
  advice() {
    const g = this.game;
    const out = [];
    const stuck = g.jams.find((j) => j.stuck > 40 && !j.site);
    const worst = g.routeJams.find((j) => j.ratio >= 2 && j.lost >= 1);
    if (worst) out.push({ title: `${worst.route.from.name} → ${worst.route.to.name} 정체`, sub: `평소의 ${fmtRatio(worst.ratio)}배 걸립니다. 눌러서 고칠 곳을 봅니다`, tone: 'bad', go: () => this.openBrief(worst.route) });
    else if (stuck) out.push({ title: `${stuck.node.name} 막힘`, sub: `트럭 ${stuck.waiting}대. 신호를 놓거나 트럭을 줄이세요`, tone: 'bad', go: () => this.goNode(stuck.node) });
    const full = g.sites.filter((s) => s.available && s.produces && s.stock > g.siteCap(s) * 0.75 && !s.yard.length).sort((a, b) => GOODS[b.goods].price - GOODS[a.goods].price)[0];
    if (full) out.push({ title: `${full.name} 화물 적체`, sub: '트럭을 늘리면 바로 수익이 됩니다', tone: 'warn', go: () => this.goSite(full) });
    const idle = g.sites.filter((s) => s.available && s.produces && s.yard.length >= 2).sort((a, b) => b.yard.length - a.yard.length)[0];
    if (idle) out.push({ title: `${idle.name} 화물 부족`, sub: `트럭 ${idle.yard.length}대가 기다립니다. ${idle.inputs ? '원료를 더 보내세요' : '생산을 증설하세요'}`, tone: 'info', go: () => this.goSite(idle) });
    return out.slice(0, 3);
  }

  // ── 정체 브리핑 ────────────────────────────────────
  // 어디서 어디로 가는 노선이 가장 막히는지 보여 주고, 누르면 고칠 곳을 왼쪽에 연다.
  // 목록처럼 새로고침하기 전까지 그대로 둔다
  snapBrief() {
    const g = this.game;
    g.updateRouteJams();
    const routes = g.routeJams.slice(0, BRIEF_MAX).map((j) => {
      const { nodes, roads } = g.routeSpots(j.route);
      const top = nodes.find((q) => q.head) || roads.find((q) => q.head) || nodes[0] || roads[0];
      return { ...j, where: top ? this.spotName(top) : '' };
    });
    this.brief = { t: g.time, routes, total: g.routeJams.length, jams: g.jams.slice(0, 5) };
  }
  spotName(q) {
    if (q.site) return `${q.site.name} 입구`;
    if (q.node) return q.node.name;
    return q.road.name || KIND_NAME[q.road.kind];
  }
  legTone(leg) {
    return this.game.legJammed(leg) ? (leg.ratio >= 2 ? 'bad' : 'warn') : '';
  }
  legTimes(leg) { return `평소 ${fmtTime(leg.quiet)} → ${fmtTime(leg.real)}`; }
  briefView() {
    if (!this.brief) this.snapBrief();
    const b = this.brief;
    const body = [];
    if (b.routes.length) {
      body.push(h('div', { class: 'sec', key: 'routes' },
        h('h3', null, '가장 막히는 노선', h('span', null, '평소보다')),
        b.routes.map((q) => this.briefRow(q)),
        b.total > b.routes.length && h('p', { class: 'status', key: 'rest' }, `그 밖에 ${b.total - b.routes.length}개 노선이 막힙니다.`)));
    } else body.push(h('p', { class: 'status ok', key: 'calm' }, '지금은 크게 막히는 노선이 없습니다.'));
    if (b.jams.length) {
      body.push(h('div', { class: 'sec', key: 'jams' }, h('h3', null, '트럭이 많이 서 있는 곳'), b.jams.map((j) => h('button', {
        class: `list-row plain${this.sel && this.sel.node === j.node ? ' on' : ''}`, key: `j${j.node.id}`, onclick: () => this.goNode(j.node),
        onmouseenter: () => { this.r.hover = { type: 'node', node: j.node }; }, onmouseleave: () => { this.r.hover = null; },
      }, h('span', { class: 't' }, j.site ? `${j.site.name} 진입로` : j.node.name), h('span', { class: `state ${j.stuck > 30 ? 'bad' : 'warn'}` }, `${j.waiting}대`)))));
    }
    return [this.head(null, '정체 브리핑', this.ageText(b.t), () => this.setBrief(false), this.refreshBtn()), h('div', { class: 'p-body', key: 'body-brief' }, body)];
  }
  briefRow(q) {
    const r = q.route, on = this.sel && this.sel.route === r;
    return h('button', {
      class: `brief-row${on ? ' on' : ''}`, key: r.id, onclick: () => this.goRoute(r),
      onmouseenter: () => this.updateHighlights(r), onmouseleave: () => this.updateHighlights(),
      'data-tip': `가는 길: ${this.legTimes(q.to)}\n돌아오는 길: ${this.legTimes(q.back)}\n눌러서 고칠 곳을 봅니다`,
    },
      h('i', { style: `background:${GOODS[r.goods].color}` }),
      h('span', { class: 'brief-t' },
        h('b', null, `${r.from.name} → ${r.to.name}`),
        h('small', null, `${Math.round(q.lost) ? `${q.trucks}대 중 ${Math.round(q.lost)}대 묶임` : `트럭 ${q.trucks}대`}${q.where ? ` · ${q.where}` : ''}`)),
      h('span', { class: `state ${q.ratio >= 2 ? 'bad' : 'warn'}` }, `${fmtRatio(q.ratio)}배`));
  }
  goRoute(r) {
    this.select({ type: 'route', route: r });
    // 막힌 구간이 있으면 그 구간 전체를, 없으면 노선 전체를 보여 준다
    const glow = this.r.jamGlow;
    this.fitEdges(glow ? glow.edges : r.pathTo.filter((e) => e.road.kind !== 'f'), 1.1, 1.3, 0.09);
  }
  // 노선 카드의 고칠 곳은 열 때 정해 두고, 수치와 버튼만 지금 값을 보여 준다. 누르려던 버튼이 밀려나지 않는다
  measureRoute(sel) {
    const g = this.game, r = sel.route;
    const spots = g.routeSpots(r);
    const j = g.routeJam(r);
    const jammed = g.legJammed(j.to) || g.legJammed(j.back);
    const none = !spots.nodes.length && !spots.roads.length;
    const top = spots.nodes.find((q) => q.head) || spots.roads.find((q) => q.head);
    sel.spots = spots;
    sel.stretches = g.routeStretches(r);
    sel.sites = jammed && none ? [r.from, r.to] : [];
    sel.verdict = !jammed ? ['ok', '지금은 잘 흐릅니다.']
      : top ? ['warn', `줄의 맨 앞은 ${this.spotName(top)}입니다. 여기를 풀면 뒤따라 풀립니다.`]
        : none ? ['warn', '길은 막히지 않습니다. 거점을 드나드는 데 시간이 걸립니다.']
          : ['warn', '아래 구간에 트럭이 몰립니다.'];
    // 줄이 이어진 도로는 구간째 칠하니, 그 밖의 도로와 교차로만 따로 표시한다
    const inGlow = new Set(sel.stretches.flatMap((q) => q.edges.map((e) => e.road)));
    this.r.spotMarks = [
      ...spots.nodes.map((q) => ({ type: 'node', node: q.node })),
      ...spots.roads.filter((q) => q.road.kind !== 'f' && !inGlow.has(q.road)).map((q) => ({ type: 'road', road: q.road })),
    ];
  }
  routeView(sel) {
    const g = this.game, r = sel.route, j = g.routeJam(r);
    const line = (label, leg) => h('div', { class: 'kv', key: label }, h('span', null, label), h('b', { class: this.legTone(leg) }, this.legTimes(leg)));
    // 먼저 고칠 곳만 보여 주고 나머지는 눌러서 편다
    const nodes = this.routeAll ? sel.spots.nodes : sel.spots.nodes.slice(0, SPOT_SHOWN);
    const roads = this.routeAll ? sel.spots.roads : sel.spots.roads.slice(0, SPOT_SHOWN);
    const hidden = sel.spots.nodes.length + sel.spots.roads.length - nodes.length - roads.length;
    const body = [
      h('div', { class: 'kvs', key: 'times' }, line('가는 길', j.to), line('돌아오는 길', j.back)),
      h('p', { class: `status ${sel.verdict[0]}`, key: 'verdict' }, sel.verdict[1]),
    ];
    if (nodes.length) body.push(h('div', { class: 'sec', key: 'nodes' }, h('h3', null, '막히는 교차로'), nodes.map((q) => (q.site ? this.spotSite(q.site, q.head) : this.spotNode(q)))));
    if (roads.length) body.push(this.spotRoads(roads));
    if (sel.sites.length) body.push(h('div', { class: 'sec', key: 'sites' }, h('h3', null, '상하차장'), sel.sites.map((s) => this.spotSite(s, false))));
    if (hidden > 0) body.push(h('button', { class: 'more-btn', key: 'all', onclick: () => { this.routeAll = true; this.renderInspector(true); } }, `${hidden}곳 더 보기`, ico('chevron', 'turn-down')));
    return [
      this.head(null, `${r.from.name} → ${r.to.name}`, `${GOODS[r.goods].name} · ${Math.round(r.dist)}km · 트럭 ${r.trucks.length}대`, () => this.select(null)),
      h('div', { class: 'p-body', key: `body-${r.id}` }, body),
    ];
  }
  // 막히는 곳 한 줄의 제목. 누르면 지도에서 보여 준다
  spotHead(name, note, state, tone, head, mark, x, y) {
    return h('button', {
      class: 'spot-name', key: 'name', 'data-tip': '눌러서 지도에서 봅니다',
      onclick: () => this.goSpot(mark, x, y),
      onmouseenter: () => { this.r.hover = mark; }, onmouseleave: () => { this.r.hover = null; },
    },
      h('span', { class: 't' }, name, head && h('em', { key: 'head' }, '맨 앞')),
      state && h('span', { class: `state ${tone}`.trim(), key: 'state' }, state),
      note && h('small', { key: 'note' }, note));
  }
  // 고칠 곳을 누르면 그곳이 든 줄 전체가 보이게 옮기고 그 줄을 더 진하게 칠한다
  goSpot(mark, x, y) {
    this.sound.click();
    const sel = this.sel, glow = this.r.jamGlow;
    const node = mark.node ? mark.node.id : mark.site ? mark.site.node : null;
    const st = sel && sel.stretches && sel.stretches.find((q) => q.edges.some((e) => (node !== null ? e.to === node || e.from === node : e.road === mark.road)));
    if (st && glow) {
      glow.focus = st.edges;
      glow.focusPath = null;
      this.fitEdges(st.edges);
      return;
    }
    this.r.cam.focus(x, y, Math.min(this.r.cam.k, 0.1));
  }
  afterSpot(x, y) {
    this.sound.place();
    this.r.baseDirty = true;
    this.r.ping(x, y);
    this.renderInspector(true);
    this.renderTop();
  }
  spotNode(q) {
    const g = this.game, n = q.node;
    const opts = SPOT_CONTROLS.filter(([id]) => g.techs.has(id));
    const kids = [this.spotHead(n.name, '', n.waiting ? `${n.waiting}대 대기` : '', n.stuckT > 25 ? 'bad' : n.waiting >= 3 ? 'warn' : '', q.head, { type: 'node', node: n }, n.x, n.y)];
    if (opts.length) {
      kids.push(h('div', { class: 'ctl-grid tri', key: 'ctl' }, opts.map(([id, name]) => {
        const t = TOOLS.find((z) => z.id === id);
        const price = g.controlPrice(n, id), on = n.control === id;
        return h('button', {
          key: id, class: `ctl${on ? ' on' : ''}`, style: `--c:${t.color}`, disabled: !on && g.money < price, 'data-tip': t.desc,
          onclick: () => { if (!on && g.setControl(n, id)) this.afterSpot(n.x, n.y); },
        }, h('b', null, name), h('small', null, on ? '사용 중' : fmtWon(price)));
      })));
    } else kids.push(h('p', { class: 'status', key: 'locked' }, '연구에서 신호등을 열면 고칠 수 있습니다.'));
    if (n.control === 'roundabout' && g.techs.has('ring2') && n.ringLanes < 2) {
      kids.push(h('button', { class: 'btn up', key: 'ring2', disabled: g.money < g.ringPrice(), onclick: () => { if (g.buyRing2(n)) this.afterSpot(n.x, n.y); } }, h('span', null, '2차로로 확장'), h('span', { class: 'price' }, fmtWon(g.ringPrice()))));
    }
    return h('div', { class: 'spot', key: `n${n.id}` }, kids);
  }
  spotSite(s, head) {
    const g = this.game, n = g.net.nodes[s.node], cost = g.bayCost(s);
    return h('div', { class: 'spot', key: `s${s.id}` },
      this.spotHead(s.name, `상하차장 ${s.bays}칸`, n.waiting ? `${n.waiting}대 대기` : '', n.waiting >= 3 ? 'warn' : '', head, { type: 'site', site: s }, s.x, s.y),
      s.bays < 12 ? h('button', {
        class: 'btn up', key: 'bay', disabled: g.money < cost, 'data-tip': `상하차장 ${s.bays} → ${s.bays + 1}칸\n진입로 정체가 큰길까지 번지는 것을 막아 줍니다.`,
        onclick: () => { if (g.buyBay(s)) this.afterSpot(s.x, s.y); else this.sound.deny(); },
      }, h('span', null, '상하차장 +1칸'), h('span', { class: 'price' }, fmtWon(cost))) : h('p', { class: 'status', key: 'max' }, '상하차장을 다 늘렸습니다.'));
  }
  spotRoads(list) {
    const g = this.game;
    const can = list.map((q) => q.road).filter((r) => g.canAddLane(r));
    const total = can.reduce((sum, r) => sum + g.lanePrice(r), 0);
    return h('div', { class: 'sec', key: 'roads' }, h('h3', null, '막히는 도로'), list.map((q) => this.spotRoad(q)),
      can.length >= 2 && h('button', {
        class: 'btn up', key: 'all', disabled: g.money < total, 'data-tip': '위 도로를 모두 양방향으로 한 차로씩 늘립니다.',
        onclick: () => {
          let n = 0;
          for (const r of can) if (g.addLane(r)) n++;
          if (!n) { this.sound.deny(); return; }
          this.toast('t_lane', `도로 ${n}개를 넓혔습니다`, fmtWon(total));
          this.afterSpot((can[0].bb[0] + can[0].bb[2]) / 2, (can[0].bb[1] + can[0].bb[3]) / 2);
        },
      }, h('span', null, `${can.length}개 모두 넓히기`), h('span', { class: 'price' }, fmtWon(total))));
  }
  spotRoad(q) {
    const g = this.game, r = q.road;
    const a = g.net.nodes[r.a], b = g.net.nodes[r.b];
    const end = (n) => (n.site ? n.site.name : n.name);
    const x = (r.bb[0] + r.bb[2]) / 2, y = (r.bb[1] + r.bb[3]) / 2;
    const held = Math.round(r.fwd.held + r.bwd.held);
    const state = held ? `${held}대 정체` : '';
    const tone = r.fwd.jam > 0.62 || r.bwd.jam > 0.62 ? 'bad' : held ? 'warn' : '';
    const mark = { type: 'road', road: r };
    if (r.kind === 'f') {
      const fy = r.ferryObj, price = g.ferryPrice(fy);
      return h('div', { class: 'spot', key: `r${r.id}` },
        this.spotHead(r.name, `한 번에 ${fy.cap}대`, state, tone, q.head, mark, x, y),
        h('button', {
          class: 'btn up', key: 'up', disabled: g.money < price || fy.cap >= 120, 'data-tip': `한 번에 싣는 트럭 ${fy.cap} → ${fy.cap + 10}대`,
          onclick: () => { if (g.buyFerry(fy)) this.afterSpot(x, y); else this.sound.deny(); },
        }, h('span', null, '카페리 증편'), h('span', { class: 'price' }, fmtWon(price))));
    }
    const price = g.lanePrice(r);
    return h('div', { class: 'spot', key: `r${r.id}` },
      this.spotHead(r.name || KIND_NAME[r.kind], `${end(a)} – ${end(b)} · ${Math.round(r.len)}km`, state, tone, q.head, mark, x, y),
      g.canAddLane(r) ? h('button', {
        class: 'btn up', key: 'lane', disabled: g.money < price, 'data-tip': '차로가 늘면 줄을 더 많이 세울 수 있고, 좌회전과 직진 트럭이 서로 막지 않습니다.',
        onclick: () => { if (g.addLane(r)) this.afterSpot(x, y); else this.sound.deny(); },
      }, h('span', null, `왕복 ${r.lanes * 2} → ${r.lanes * 2 + 2}차로`), h('span', { class: 'price' }, fmtWon(price))) : h('p', { class: 'status', key: 'max' }, `왕복 ${r.lanes * 2}차로. 최대 차로입니다.`));
  }

  goSite(s) {
    this.select({ type: 'site', site: s });
    if (this.r.jamGlow) { this.fitEdges(this.r.jamGlow.edges); return; }
    const k = Math.min(this.r.cam.k, 0.2);
    this.r.cam.focus(s.x, s.y, k);
  }
  goNode(n) {
    if (n.site) { this.goSite(n.site); return; }
    this.select({ type: 'node', node: n });
    if (this.r.jamGlow) { this.fitEdges(this.r.jamGlow.edges); return; }
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
    const low = this.hold('low', !!s.inputs && !s.isCity && s.inBuf.some((v) => v < g.inputCap(s) * 0.1));
    const jam = this.hold('jam', node.waiting >= 3);
    // 원료가 모자라면 공급처를 먼저 보여 주되, 트럭 사는 줄을 밀어내지 않게 몇 곳만 꺼낸다
    if (low && !this.more) body.push(...this.factoryIncoming(s, 3));
    if (s.produces) body.push(...this.routesSec(s));
    if (jam) body.push(this.baySec(s, true));
    body.push(this.siteMore(s, low, jam));
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
    const said = this.hold('said', st.tone !== 'ok' ? st : null);
    if (said) kids.push(h('p', { class: `status ${said.tone}`, key: 'st' }, said.text));
    kids.push(this.meter('창고', frac, gd.color, `창고 ${fmtTon(s.stock)} / ${fmtTon(cap)}`, 'stock', frac > 0.85));
    if (s.inputs) {
      const ic = g.inputCap(s);
      s.inputs.forEach((slot, i) => {
        const name = slot.length === 1 ? GOODS[slot[0]].name : '원료';
        kids.push(this.meter(name, s.inBuf[i] / ic, GOODS[slot[0]].color, `${name} ${fmtTon(s.inBuf[i])} / ${fmtTon(ic)}`, `ib${i}`, s.inBuf[i] < ic * 0.05));
      });
    }
    // 나를 트럭이 없으면 생산을 늘려도 소용없으니 트럭을 산 뒤에 꺼낸다
    if (this.hold('grow', s.routesOut.some((q) => q.trucks.length))) {
      const cost = g.upgradeCost(s);
      kids.push(h('button', {
        class: 'btn up', key: 'upg', disabled: g.money < cost, onclick: () => { if (g.buyUpgrade(s)) { this.sound.buy(); this.renderInspector(true); } else this.sound.deny(); },
        'data-tip': `생산 ${rate.toFixed(2)} → ${(rate * 1.38).toFixed(2)} t/s (Lv.${s.level + 1})\n늘어난 물량을 나를 트럭이 더 필요해집니다.`,
      }, h('span', null, '생산 +38%'), h('span', { class: 'price' }, fmtWon(cost))));
    }
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

  factoryIncoming(s, max = 6) {
    const lines = s.routesIn.filter((q) => q.valid).sort((a, b) => b.trucks.length - a.trucks.length || a.dist - b.dist).slice(0, max);
    if (!lines.length) return [];
    return [h('div', { class: 'sec', key: 'incoming' }, h('h3', null, '원료 공급처'), lines.map((q) => h('button', { class: 'list-row', key: q.id, onclick: () => this.goSite(q.from), onmouseenter: () => this.updateHighlights(q), onmouseleave: () => this.updateHighlights(), 'data-tip': `${GOODS[q.goods].name} · ${Math.round(q.dist)}km` },
      raw(siteIcon(q.from), 'ico'), h('span', { class: 't' }, q.from.name), h('span', { class: `state ${q.trucks.length ? '' : 'warn'}` }, q.trucks.length ? `${q.trucks.length}대` : '트럭 없음'))))];
  }

  // 고를 트럭이 둘 이상일 때만 보여 준다
  modelPick() {
    const unlocked = TRUCKS.map((m, i) => [m, i]).filter(([, i]) => this.game.modelUnlocked(i));
    if (unlocked.length < 2) return null;
    const q = TRUCKS[this.modelSel];
    return this.pickSel('models', this.modelSel, unlocked.map(([t, i]) => [i, t.short]), (v) => { this.modelSel = Number(v); this.sound.click(); this.renderInspector(true); },
      `살 트럭: ${q.name}\n${q.desc}\n적재 ${q.cap}t · 속도 ${Math.round(q.speed * 100)}%`);
  }
  countPick(each = '') {
    return this.pickSel('buyn', this.buyCount, [[1, `1대${each}`], [5, `5대${each}`], [10, `10대${each}`], [0, '최대']], (v) => { this.buyCount = Number(v); this.sound.click(); this.renderInspector(true); }, '한 번에 살 대수');
  }

  routesSec(s) {
    const g = this.game;
    const routes = s.routesOut.filter((q) => q.valid).sort((a, b) => a.dist - b.dist);
    if (!routes.length) return [h('p', { class: 'status', key: 'nor' }, '아직 이 화물을 받아줄 곳이 없습니다. 권역을 더 개발하면 열립니다.')];
    if (!g.modelUnlocked(this.modelSel)) this.modelSel = 0;
    const m = this.modelSel;
    const running = routes.filter((q) => q.trucks.length);
    const kids = [h('h3', { key: 'h' }, '노선별 트럭', h('span', { class: 'picks', key: 'picks' }, this.modelPick(), g.truckCount >= 3 && this.countPick()))];
    if (GOODS[s.goods].growth) kids.push(h('p', { class: 'status', key: 'grow' }, `값은 싸지만 도시에 납품하면 도시가 ${GOODS[s.goods].growth}배 빨리 자랍니다.`));
    for (const q of routes) kids.push(this.routeRow(q, m, routes));
    const conv = g.planConvert(running, m);
    if (conv.all > 0) kids.push(this.convertBtn(conv, running, m));
    return [h('div', { class: 'sec', key: 'routes' }, kids)];
  }

  // 노선 한 줄. 왼쪽에 어디로 얼마, 오른쪽에 빼기, 대수, 더하기
  routeRow(q, m, routes) {
    const g = this.game;
    const trip = q.perTon * g.truckCap(TRUCKS[m]) * g.payMult();
    const n = this.buyCount === 0 ? Math.max(1, g.truckAffordable(q, m)) : this.buyCount;
    const price = g.truckBatchPrice(q, m, n);
    const running = q.trucks.length > 0 && q.rate > 0;
    const mix = this.truckMix(q);
    return h('div', {
      class: `route${!q.opened && routes.some((x) => x.opened) ? ' new' : ''}`, key: q.id,
      onmouseenter: () => this.updateHighlights(q), onmouseleave: () => this.updateHighlights(),
      'data-tip': `${Math.round(q.dist)}km · 막힘 없으면 ${Math.round(q.freeTime)}초\n1회 ${fmtWon(trip)} · 분당 ${fmtWon(q.rate * 60)}`,
    },
    h('div', { class: 'route-t', key: 't' }, h('span', { class: 'name' }, q.to.name), h('small', null, running ? `${fmtWon(q.rate * 60)}/분` : `1회 ${fmtWon(trip)}`)),
    h('div', { class: 'route-act', key: 'act' },
      h('button', {
        class: 'btn sell', key: 'sell', disabled: !q.trucks.length, 'aria-label': '트럭 한 대 처분', 'data-tip': '트럭 한 대를 처분합니다 (구매가의 50% 환급).\n도로가 막힐 때 숨통을 틔웁니다.',
        onclick: () => { if (g.sellTruck(q)) { this.sound.click(); this.renderInspector(true); } },
      }, ico('minus')),
      h('span', { class: 'count', key: `c${q.trucks.length}`, 'data-tip': mix ? `이 노선의 트럭\n${mix}` : '이 노선의 트럭 수' }, `${q.trucks.length}대`),
      h('button', {
        // 처음 배우는 동안에는 눌러야 할 곳이 또렷하게 보인다
        class: `btn buy${g.flags.tutorial ? ' first' : ''}`, key: 'buy', disabled: g.money < price, 'aria-label': `트럭 ${n}대 사기`, 'data-tip': `${TRUCKS[m].short} 트럭 ${n}대 사기`,
        onclick: () => {
          let bought = 0;
          for (let i = 0; i < n; i++) { if (g.buyTruck(q, m)) bought++; else break; }
          if (bought) { this.sound.buy(); this.updateHighlights(); this.renderInspector(true); this.renderTop(); } else this.sound.deny();
        },
      }, n > 1 ? `+${n}` : ico('plus'), h('span', { class: 'price' }, fmtWon(price)))));
  }
  truckMix(q) {
    return TRUCKS.map((t, i) => [t.short, q.trucks.filter((v) => (v.nextModel ?? v.modelIdx) === i && !v.retire).length]).filter((p) => p[1]).map((p) => `${p[0]} ${p[1]}대`).join(' · ');
  }
  // 자세히 안의 노선별 설정: 일부만 트럭을 바꾸거나 자동 배차를 켠다
  routeTune(q, m) {
    const g = this.game;
    // 고른 차종보다 적게 싣는 트럭을 바꾼다. 새로 생길 대수는 구매 대수를 따르고, 돈이 모자라면 닿는 만큼만
    const most = this.buyCount || Infinity;
    const plan = g.convertWithin(q, m, g.money, most);
    const whole = plan.keep ? plan : g.convertPlan(q, m, most);
    const names = [...new Set(whole.olds.map((v) => TRUCKS[v.nextModel ?? v.modelIdx].short))].join('·');
    const auto = g.techs.has('autobuy');
    return h('div', { class: 'tune', key: `tune${q.id}`, onmouseenter: () => this.updateHighlights(q), onmouseleave: () => this.updateHighlights() },
      h('span', { class: 'who', key: 'who' }, q.to.name, h('small', null, this.truckMix(q))),
      auto ? h('label', { class: 'field small', key: 'auto' }, '자동', h('input', { type: 'checkbox', checked: q.auto, onchange: (e) => { q.auto = e.target.checked; q.model = m; } })) : h('span', { key: 'auto' }),
      whole.keep > 0 && h('button', {
        class: 'btn up', key: 'conv', disabled: !plan.keep,
        'data-tip': `나르는 양은 그대로 두고 대수를 줄입니다. 1톤 5대가 5톤 1대가 됩니다.\n값은 새 트럭값에서 빠지는 트럭값의 절반을 뺀 만큼입니다.\n달리는 트럭은 다음 거점에 닿을 때 바뀌거나 사라집니다.`,
        onclick: () => {
          const r = g.convertTrucks(q, m, most);
          this.afterConvert(r.n, r.k, r.paid, m);
        },
      }, h('span', null, `${names} ${whole.olds.length}대 → ${TRUCKS[m].short} ${whole.keep}대`), h('span', { class: 'price' }, fmtWon(whole.cost))));
  }

  baySec(s, jam) {
    const g = this.game;
    const cost = g.bayCost(s);
    const node = g.net.nodes[s.node];
    return h('div', { class: 'sec', key: 'bay' },
      jam && h('p', { class: 'status bad', key: 'wait' }, `진입로에 트럭 ${node.waiting}대가 기다립니다.`),
      s.bays < 12 && h('button', {
        class: 'btn up', key: 'buybay', disabled: g.money < cost, onclick: () => { if (g.buyBay(s)) { this.sound.buy(); this.renderInspector(true); } else this.sound.deny(); },
        'data-tip': `상하차장 ${s.bays} → ${s.bays + 1}칸\n진입로 정체가 큰길까지 번지는 것을 막아 줍니다.`,
      }, h('span', null, '상하차장 +1칸'), h('span', { class: 'price' }, fmtWon(cost))));
  }

  siteMore(s, low, jam) {
    const g = this.game;
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
      if (!jam) kids.push(this.baySec(s, false));
      // 노선마다 따로 정하는 일은 여기에 둔다. 평소 줄에는 사고파는 것만 남긴다
      const tuned = s.produces ? s.routesOut.filter((q) => q.valid && q.trucks.length) : [];
      if (tuned.length && (g.techs.has('autobuy') || tuned.some((q) => g.convertibleTrucks(q, this.modelSel).length))) {
        kids.push(h('div', { class: 'sec', key: 'tune' }, h('h3', null, '노선별 설정'), tuned.map((q) => this.routeTune(q, this.modelSel))));
      }
      if (s.inputs && !s.isCity) kids.push(...this.factoryIncoming(s));
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
    if (this.hold('wait', n.waiting >= 3)) body.push(h('p', { class: `status ${stuck ? 'bad' : 'warn'}`, key: 'wait' }, stuck ? `트럭 ${n.waiting}대가 ${fmtTime(n.stuckT)}째 막혀 있습니다.` : `트럭 ${n.waiting}대가 기다립니다.`));
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
      body.push(h('button', { class: 'btn up', key: 'ring2', disabled: g.money < g.ringPrice(), onclick: () => { if (g.buyRing2(n)) { this.sound.place(); this.r.baseDirty = true; } } }, h('span', null, '2차로로 확장'), h('span', { class: 'price' }, fmtWon(g.ringPrice()))));
    }
    if (this.hold('tow', (stuck || n.waiting > 6) && g.techs.has('tow'))) {
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
        'data-tip': `1km당 ${fmtWon(LANE_PRICE_PER_KM[r.kind])} 기준입니다. 몇 번째 차로든 값이 같고, 땅값이 비싼 지역은 보상비가 더 듭니다.\n차로가 늘면 줄을 더 많이 세울 수 있고, 좌회전과 직진 트럭이 서로 막지 않습니다.`,
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
    this.confirmRebirth = false;
    this.saveText = '';
    this.saveOpen = false;
    this.renderTop();
  }
  renderModal() {
    const n = this.modalName;
    if (!n) return;
    const v = n === 'research' ? this.researchDialog() : n === 'build' ? this.buildDialog() : n === 'settings' ? this.settingsDialog() : n === 'welcome' ? this.welcomeDialog() : n === 'offline' ? this.offlineDialog() : n === 'alldone' ? this.allDoneDialog() : n === 'rebirth' ? this.rebirthDialog() : null;
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

  // 환생과 명성 상점
  rebirthDialog() {
    const g = this.game, L = g.legacy;
    const can = g.canRebirth();
    const gain = g.fameGain();
    const perkRow = (p) => {
      const lv = g.perk(p.id), maxed = lv >= p.max, cost = g.perkCost(p.id);
      return h('div', { class: 'row', key: p.id, 'data-tip': p.desc },
        h('span', { class: 'disc' }, ico(p.icon)),
        h('div', { class: 't' }, h('b', null, p.max > 1 ? `${p.name} ${lv}/${p.max}` : p.name), h('small', null, maxed ? `${p.fmt(lv)} · 최고 단계` : lv ? `${p.fmt(lv)} → ${p.to(lv + 1)}` : p.fmt(1))),
        !maxed && h('button', { class: 'btn buy', disabled: L.fame < cost, onclick: () => { if (g.buyPerk(p.id)) { this.sound.buy(); this.renderModal(); this.renderTop(); } else this.sound.deny(); } }, h('span', { class: 'price' }, `명성 ${cost}`)));
    };
    const lost = g.perk('roads') ? '돈, 트럭, 연구, 권역 진행' : '돈, 트럭, 연구, 권역 진행, 교차로와 차로';
    let action;
    if (!can) action = h('p', { class: 'status', key: 'lock' }, `${g.regions[g.regions.length - 1].short}까지 모든 권역을 열면 환생할 수 있습니다. 지금 ${g.stage + 1} / ${g.regions.length} 권역입니다.`);
    else if (!this.confirmRebirth) {
      action = h('button', { class: 'btn buy', key: 'go', disabled: gain < 1, onclick: () => { this.sound.click(); this.confirmRebirth = true; this.renderModal(); } }, h('span', null, '환생하기'), h('span', { class: 'price' }, `명성 +${gain}`));
    } else {
      action = [
        h('p', { class: 'status warn', key: 'warn' }, `${lost}가 처음으로 돌아갑니다. 되돌릴 수 없습니다.`),
        h('div', { class: 'btn-row', key: 'yes' },
          h('button', { class: 'btn', onclick: () => { this.sound.click(); this.confirmRebirth = false; this.renderModal(); } }, '취소'),
          h('button', { class: 'btn buy', onclick: () => this.app.rebirth() }, `환생하고 명성 +${gain}`)),
      ];
    }
    return h('div', { class: 'dialog', role: 'dialog', 'aria-label': '환생' },
      this.dialogHead('환생', `${L.runs + 1}회차 · 보유 명성 ${L.fame}`),
      h('div', { class: 'p-body' },
        h('div', { class: 'sec', key: 'now' },
          h('div', { class: 'kvs', key: 'kvs' },
            this.kv('이번 회차에 번 돈', fmtWon(g.totalEarned)),
            this.kv(can ? '지금 환생하면' : '지금까지 번 돈으로는', `명성 +${gain}`),
            this.kv('명성 1을 더 받으려면', `${fmtWon(g.fameNext())} 더`),
            L.runs > 0 && this.kv('지난 환생', `${L.runs}회`),
            L.total > 0 && this.kv(`모은 명성 ${L.total}`, `납품 대금과 실적 +${L.total}%`),
            L.best.time > 0 && this.kv('가장 빠른 전국 개통', fmtTime(L.best.time))),
          action),
        h('div', { class: 'list', key: 'perks-now' }, h('h3', null, '바로 듣는 보너스'), PERKS.filter((p) => p.now).map(perkRow)),
        h('div', { class: 'list', key: 'perks-next' }, h('h3', null, '다음 회차부터 듣는 보너스'), PERKS.filter((p) => !p.now).map(perkRow)),
        h('p', { class: 'foot', key: 'foot' }, '모은 명성 1마다 납품 대금과 실적이 1% 오릅니다. 명성을 써도 줄지 않습니다. 명성은 언제든 쓸 수 있고, 환생해도 명성과 보너스, 기록은 남습니다. 많이 벌수록 명성을 더 받지만 벌이가 늘수록 효율은 줄어듭니다.')));
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
              h('button', { class: 'btn buy', disabled: g.money < price, onclick: () => { if (g.buildProject(p)) { this.sound.fanfare(); this.r.baseDirty = true; this.closeModal(); } } }, h('span', { class: 'price' }, fmtWon(price)))));
        })) : h('p', { class: 'foot', key: 'none' }, '지금 건설할 수 있는 도로가 없습니다.'),
        (built.length > 0 || locked > 0) && h('p', { class: 'foot', key: 'foot' }, built.length > 0 && `개통: ${built.map((p) => p.name).join(', ')}. `, locked > 0 && `다음 권역이 열리면 ${locked}개가 더 나옵니다.`)));
  }

  showProject(p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of p.roads) { x0 = Math.min(x0, r.bb[0]); y0 = Math.min(y0, r.bb[1]); x1 = Math.max(x1, r.bb[2]); y1 = Math.max(y1, r.bb[3]); }
    this.r.cam.fitBox(x0 - 8, y0 - 8, x1 + 8, y1 + 8, 0.8, 1.2);
    this.r.ping((x0 + x1) / 2, (y0 + y1) / 2, '#8e6fc9');
    this.r.flashRoads(p.roads, 5);
  }

  settingsDialog() {
    const app = this.app, snd = this.sound;
    return h('div', { class: 'dialog small', role: 'dialog', 'aria-label': '설정' },
      this.dialogHead('설정'),
      h('div', { class: 'p-body' },
        h('div', { class: 'sec', key: 'snd' }, h('h3', null, '소리'),
          h('label', { class: 'field' }, '효과음', h('input', { id: 'set-vol', type: 'range', min: 0, max: 1, step: 0.05, value: snd.volume, oninput: (e) => { snd.setVolume(Number(e.target.value)); app.saveSettings(); snd.click(); } })),
          h('label', { class: 'field' }, '배경음', h('input', { id: 'set-music', type: 'range', min: 0, max: 1, step: 0.05, value: snd.musicVolume, oninput: (e) => { snd.setMusicVolume(Number(e.target.value)); app.saveSettings(); } })),
          h('label', { class: 'field' }, '배경음 켜기 (M)', h('input', { id: 'set-music-on', type: 'checkbox', checked: snd.musicOn, onchange: (e) => this.setMusic(e.target.checked) })),
          h('div', { class: 'field' }, h('span', { class: 'now-playing' }, snd.track.title, h('small', null, snd.track.artist)), h('button', { class: 'btn', onclick: () => { snd.unlock(); snd.nextTrack(); this.renderModal(); } }, '다음 곡'))),
        h('div', { class: 'sec', key: 'map' }, h('h3', null, '지도'),
          h('label', { class: 'field', 'data-tip': '켜면 왼쪽으로 끌어 지도를 옮기고, 오른쪽으로 끌어 거점을 고릅니다' }, '왼쪽으로 끌어 지도 옮기기', h('input', { id: 'set-drag', type: 'checkbox', checked: !!app.settings.dragPan, onchange: (e) => { app.settings.dragPan = e.target.checked; app.saveSettings(); } })),
          h('div', { class: 'field' }, '화면 색',
            h('div', { class: 'seg', key: 'pal' },
              h('button', { class: this.r.palName === 'day' ? 'on' : '', style: 'width:52px', onclick: () => { this.r.setPalette('day'); app.saveSettings(); app.drawMiniBase(); this.renderModal(); } }, '낮'),
              h('button', { class: this.r.palName === 'night' ? 'on' : '', style: 'width:52px', onclick: () => { this.r.setPalette('night'); app.saveSettings(); app.drawMiniBase(); this.renderModal(); } }, '밤')))),
        h('div', { class: 'sec', key: 'save' }, h('h3', null, '저장', h('span', null, '20초마다 이 브라우저에 자동 저장')),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', onclick: () => { app.save(); this.saveText = btoa(unescape(encodeURIComponent(JSON.stringify(this.game.serialize())))); this.saveOpen = true; this.renderModal(); this.toast('star', '저장했습니다', '아래 글자를 복사해 두면 다른 기기로 옮길 수 있습니다'); } }, '저장 코드 만들기'),
            h('button', { class: 'btn', onclick: () => {
              // 처음 누르면 붙여넣을 칸을 열고, 칸에 글자가 있으면 불러온다
              if (!this.saveOpen) { this.saveOpen = true; this.renderModal(); document.getElementById('set-savebox')?.focus(); return; }
              const t = document.getElementById('set-savebox').value.trim();
              if (!t) { this.toast('warn', '저장 코드를 먼저 붙여넣으세요'); return; }
              app.importSave(t);
            } }, '코드 불러오기')),
          this.saveOpen && h('textarea', { id: 'set-savebox', class: 'savebox', key: 'box', placeholder: '불러올 저장 코드를 붙여넣으세요.', value: this.saveText, spellcheck: 'false' })),
        h('details', { class: 'fold', key: 'keys' }, h('summary', null, '조작법'),
          h('p', { class: 'credit' }, '왼쪽으로 끌기: 여러 거점 고르기 · 오른쪽으로 끌기 또는 Shift를 누르고 끌기: 지도 이동 · Shift나 Ctrl을 누르고 거점 누르기: 넣고 빼기 · 손가락: 끌면 이동, 길게 눌렀다 끌면 고르기 · 휠 또는 두 손가락: 확대 · 1~8: 도구 선택 · 차로 도구로 끌기: 범위 넓히기 · 스페이스바: 일시정지 · R: 연구 · B: 건설 · L: 거점 목록 · J: 정체 브리핑 · T: 눌러서 고르기 · H: 환생 · M: 배경음 · Esc 또는 우클릭: 취소')),
        h('details', { class: 'fold', key: 'credit' }, h('summary', null, '만든 재료'),
          h('p', { class: 'credit' }, 'Rischer Kriebl의 게임 Incremental Traffic에서 영감을 받아 대한민국 지도로 다시 만든 비공식 팬 프로젝트입니다. 원작의 코드와 그림은 쓰지 않았습니다. 화면 디자인은 Dinosaur Polo Club의 Mini Metro를 참고했습니다.', h('br'), '지도 데이터: 도로·강·지명 © OpenStreetMap contributors (ODbL), 행정구역 KOSTAT(southkorea-maps), 해안선 Natural Earth. 그림은 모두 코드로 그린 벡터입니다.', h('br'), `배경음: ${MUSIC_TRACKS.map((q) => `${q.artist}, ${q.title}`).join(' · ')} (모두 CC0, OpenGameArt). 효과음은 코드로 합성했습니다.`, h('br'), '금액은 실제 시세와 공사비를 바탕으로 잡았고, 값이 너무 싼 벌크 화물만 게임에 맞게 올렸습니다.')),
        h('div', { class: 'fold', key: 'reset' },
          this.confirmReset
            ? h('div', { class: 'btn-row', key: 'yes' }, h('button', { class: 'btn', onclick: () => { this.confirmReset = false; this.renderModal(); } }, '취소'), h('button', { class: 'btn danger', onclick: () => app.resetGame() }, this.game.legacy.total > 0 ? '명성까지 지우고 처음부터' : '정말 처음부터'))
            : h('button', { class: 'text-btn', key: 'ask', onclick: () => { this.confirmReset = true; this.renderModal(); } }, '처음부터 다시 시작'))));
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
      h('p', { class: 'lead' }, `${fmtTime(d.seconds)} 동안 비운 사이에 벌었습니다. 정체를 풀어 줄 사람이 없어 평소 수익의 ${Math.round(d.share * 100)}%입니다.`),
      h('button', { class: 'cta', onclick: () => this.closeModal() }, h('span', { class: 'arrow' }, '→'), h('span', null, '운행 계속')));
  }

  allDoneDialog() {
    const g = this.game;
    return h('div', { class: 'welcome', role: 'dialog', 'aria-label': '전국 물류망 완성' },
      h('h1', null, '전국 물류망 완성'),
      h('p', { class: 'lead' }, `${fmtTime(g.time)} 만에 팔도를 모두 이었습니다. 트럭 ${g.truckCount}대가 누적 ${fmtTon(g.totalTons)}을 날랐습니다.`),
      h('p', { class: 'lead' }, '이제 붐 단계입니다. 전국 납품 실적을 쌓을 때마다 납품가가 15%씩 오릅니다.'),
      h('p', { class: 'lead' }, `지금 환생하면 명성 ${g.fameGain()}을 얻고 처음부터 다시 달립니다. 더 벌어 둘수록 명성이 늘어납니다.`),
      h('button', { class: 'cta', onclick: () => this.closeModal() }, h('span', { class: 'arrow' }, '→'), h('span', null, '계속 운행')),
      h('button', { class: 'btn', key: 'see', onclick: () => this.openModal('rebirth') }, '환생 살펴보기'));
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
    while (box.children.length > 2) box.firstChild.remove();
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
      { title: '사과를 공장으로', text: '오른쪽 카드에서 노선 옆의 파란 + 버튼을 누르면 트럭을 삽니다. 노선이 지도에 선으로 나타납니다.', target: () => null, done: () => firstRoute() && firstRoute().trucks.length > 0 },
      { title: '납품 대금이 들어옵니다', text: '적재함에 색이 차 있으면 짐을 실은 트럭, 회색이면 빈 트럭입니다. 돈이 모이면 트럭을 더 사세요. 거점 옆의 작은 네모가 쌓인 화물입니다.', target: () => null, done: () => firstRoute() && firstRoute().trucks.length >= 3 },
      { title: '이제 가공식품', text: '공장에 사과가 들어가면 가공식품이 쌓입니다. 음성 식품공장을 눌러 청주로 가는 트럭을 사세요. 값이 더 비쌉니다.', target: () => food, done: () => foodRoutes().some((q) => q.trucks.length > 0) },
      { title: '납품하면 지역이 자랍니다', text: '왼쪽 위 막대가 납품 실적입니다. 실적이 쌓이면 새 거점이 열리고, 다 채우면 다음 권역이 개통됩니다.', target: () => null, done: () => g.progress() >= 0.2 },
      { title: '길이 막히기 시작하면', text: '어두운 고리가 생긴 교차로를 누르세요. 진입 방향에 양보 표지를 칠하면 나머지 방향이 멈추지 않고 지나갑니다. 연구에서 신호등도 배울 수 있습니다.', target: () => null, done: () => g.techs.has('signal') || g.progress() >= 0.6 || g.stage > 0 },
    ];
    return this._steps;
  }
}
