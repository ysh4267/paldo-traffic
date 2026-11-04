// 게임 상태와 규칙. DOM이 없어 Node에서도 돌아간다 (밸런스 봇이 같은 코드를 쓴다).
import { Network, shortestTree, extractPath, pathLength, MAX_LANES, BASE_LANES, SHIP_SPEED } from '../sim/network.js';
import { Traffic, GAP } from '../sim/traffic.js';
import {
  GOODS, TIER_WEIGHT, BASE_RATE, EXPAND_COST, BAY_COST, START_MONEY, TRUCK_STEP, TRUCKS, REGION_GOAL, ENDLESS_GOAL_BASE, TECHS, UPGRADES, TOOL_PRICE, PERKS, FAME_BASE, FAME_REF,
  LANE_PRICE_PER_KM, LANE_PRICE_MIN, LAND_FACTOR, PROJECT_COST, FERRY_PRICE, TOW_PRICE, CITY_ACCEPTS, PORT_ACCEPTS, AIR_ACCEPTS, DOKDO_ACCEPTS, fmtWon,
} from './defs.js';
import { Lot, EXIT_PREFIX } from './lot.js';

export const SAVE_VERSION = 2;
const ECON_DT = 0.05;
const CITY_STAGE_NEED = [0, 25, 110, 480, 2000, 9000];
const LOT_V = 3;         // 주차장 안에서 달리는 속도 km/s
const LOT_V_BACK = 2;    // 후진 속도
const LOT_LEAVE_V = 2.2; // 진입로로 나갈 때의 속도
const LOT_SHIFT = 0.2;   // 후진과 전진을 바꾸며 잠깐 서는 시간 s
const LOT_BUSY = 3;      // 나갈 차례를 기다리는 트럭이 이만큼이면 새 트럭은 칸 없이 기다린다
const LOT_RECHECK = 0.12; // 칸에서 나갈 길을 다시 살피는 간격 s
const LOT_LOOK = 1.6;    // 설 수 있는 거리보다 더 내다보는 거리 km
const LOT_HEADWAY = 0.08; // 앞차와 두는 시간 간격 s
const LOT_PATIENCE = 8;  // 통로를 가로지르려고 이만큼 기다렸으면 비집고 들어간다 s
const LOT_SQUEEZE = 2;   // 서로 막고 있던 트럭이 비켜 지나가는 동안 앞을 보지 않는 시간 s
// 노선 정체
const QUIET_SLOPE = 1.47; // 막히지 않은 편도 시간 = 자유 주행 시간 × 이 값 + QUIET_BASE. 빈 도로에서 잰 값
const QUIET_BASE = 7;
const QUIET_SHIP = 2.5;   // 배는 왔다 갔다 하니 타는 데까지 한 번 건너는 시간쯤 기다린다
const LEG_EMA = 0.3;      // 편도 시간 평균에 새 기록을 얼마나 섞는지
const JAM_RATIO = 1.35;   // 평소보다 이만큼 더 걸리면 막히는 노선으로 친다. 빈 도로의 트럭도 1.3배까지는 흔들린다
const JAM_SECONDS = 10;   // 짧은 노선은 몇 초만 늦어도 배수가 크니, 이만큼은 늦어야 막힌 것으로 친다
const SPOT_JAM = 0.3;     // 느린 혼잡도가 이만큼이면 막히는 곳
const SPOT_HELD = 1.5;    // 서 있는 트럭이 평균 이만큼이면 막히는 곳
const SPOT_MAX = 4;       // 노선 하나에 보여 줄 교차로와 도로 수
const QUEUE_MAX = 40;     // 줄을 거슬러 찾을 때 볼 구간 수
const CONVERT_FEE = 0.25; // 트럭을 바꿀 때 새 트럭값 가운데 꼭 내는 몫

export class Site {
  constructor(def, index, net) {
    this.def = def;
    this.index = index;
    this.id = def.id;
    this.name = def.name;
    this.kind = def.k;
    this.region = def.r;
    this.x = def.x;
    this.y = def.y;
    this.node = def.node;
    this.goods = def.g || null;
    this.inputs = def.in || null;
    this.stage = def.stage ?? def.r;
    this.pop = def.pop || 0;
    this.available = false;
    this.at = 0;
    this.level = 0;
    this.bays = 1;
    this.stock = 0;
    this.inBuf = this.inputs ? this.inputs.map(() => 0) : null;
    this.loadBays = [];
    this.unloadBays = [];
    this.unloadQ = [];   // 칸에 대고 하차 차례를 기다리는 트럭
    this.inbound = 0;    // 하차하러 들어오는 중이거나 기다리는 트럭 수
    this.lot = null;
    this.yard = [];
    this.exitQ = [];
    this.routesOut = [];
    this.routesIn = [];
    this.growth = 0;
    this.cityStage = 0;
    this.delivered = 0;
    this.idleWarn = 0;
    this.spurOut = null;
    this.spurIn = null;
    const n = net.nodes[def.node];
    n.site = this;
    const r = n.roads.find((q) => q.kind === 's');
    if (r) {
      // 지선은 항상 도로 → 거점 방향이 b
      this.spurOut = r.b === def.node ? r.bwd : r.fwd;
      this.spurIn = r.b === def.node ? r.fwd : r.bwd;
    }
    this.accepts = new Set();
    if (def.k === 'city') CITY_ACCEPTS.forEach((g) => this.accepts.add(g));
    if (def.k === 'port') (def.air ? AIR_ACCEPTS : PORT_ACCEPTS).forEach((g) => this.accepts.add(g));
    if (def.k === 'dokdo') DOKDO_ACCEPTS.forEach((g) => this.accepts.add(g));
    if (this.inputs) for (const slot of this.inputs) for (const g of slot) this.accepts.add(g);
    this.tier = this.goods ? GOODS[this.goods].tier : 0;
  }
  get produces() { return !!this.goods; }
  get isCity() { return this.kind === 'city' || this.kind === 'dokdo'; }
}

export class Route {
  constructor(from, to, goods) {
    this.id = `${from.id}>${to.id}`;
    this.from = from;
    this.to = to;
    this.goods = goods;
    this.pathTo = null;
    this.pathBack = null;
    this.dist = 0;
    this.freeTime = 0;
    this.trucks = [];
    this.perTon = 0;
    this.earned = 0;
    this.rate = 0;
    this.bucket = 0;
    this.auto = false;
    this.model = 0;
    this.delivered = 0;
    this.opened = false;
    this.freeBack = 0;
    this.shipTo = 0;
    this.shipBack = 0;
    // 방향별 최근 편도 시간: [돌아오는 길, 가는 길]
    this.legs = [{ real: 0, quiet: 0, n: 0 }, { real: 0, quiet: 0, n: 0 }];
  }
}

export class Game {
  constructor(data, opts = {}) {
    this.data = data;
    // 환생해도 남는 것
    const old = opts.legacy || {};
    this.legacy = { fame: 0, total: 0, runs: 0, earned: 0, ...old, best: { ...old.best }, perks: { ...old.perks } };
    this.net = new Network(data);
    this.traffic = new Traffic(this.net, { arrive: (v) => this.onArrive(v), arriveSpeed: (v) => this.arriveSpeed(v) });
    this.regions = data.regions.map((r, i) => ({ ...r, index: i, unlocked: false, pts: 0 }));
    this.sites = data.sites.map((d, i) => new Site(d, i, this.net));
    this.siteById = new Map(this.sites.map((s) => [s.id, s]));
    this.projects = data.projects.map((p) => ({ ...p, built: false, roads: [], km: 0 }));
    this.projById = new Map(this.projects.map((p) => [p.id, p]));
    for (const r of this.net.roads) {
      if (r.lock) {
        const p = this.projById.get(r.lock);
        if (p) { p.roads.push(r); p.km += r.len; }
      }
    }
    this.money = opts.money ?? START_MONEY;
    this.stage = 0;
    this.routes = new Map();
    this.routeVer = 0;
    this.lotVer = 0;           // 주차장이 새로 생기거나 넓어지면 오른다
    this.lotVehicles = new Set();
    this.lotMovers = [];
    this.lotGhosts = 0;        // 통로를 못 비켜 비집고 들어간 횟수
    this.lotExitV = 0;
    this.techs = new Set();
    this.upg = {};
    for (const u of UPGRADES) this.upg[u.id] = 0;
    this.time = 0;
    this.econT = 0;
    this.income = 0;       // 초당 수익 (이동 평균)
    this.incomeBucket = 0;
    this.incomeT = 0;
    this.totalEarned = 0;
    this.totalTons = 0;
    this.deliveries = 0;
    this.onTimeCount = 0;
    this.lateCount = 0;
    this.onTimeRate = 1;
    this.endless = 0;
    this.endlessPts = 0;
    this.events = [];
    this.floats = [];
    this.flags = {};
    this.towCount = 0;
    this.routeT = 0;
    this.autoT = 0;
    this.jamT = 0;
    this.jams = [];
    this.routeJams = [];
    this.navTrees = new Map();
    this.startTime = Date.now();
    this.assignOpenOrder();
    this.applyStage(0, true);
  }

  // ── 해금 순서 ─────────────────────────────────────────
  assignOpenOrder() {
    for (const reg of this.regions) {
      const all = this.sites.filter((s) => s.region === reg.index && s.stage === reg.index);
      const cities = all.filter((s) => s.isCity);
      const others = all.filter((s) => !s.isCity);
      const seq = [];
      if (cities.length) seq.push(cities.shift());
      const push = (s) => { if (s && !seq.includes(s)) seq.push(s); };
      const raws = others.filter((s) => !s.inputs);
      const facts = others.filter((s) => s.inputs);
      let cityEvery = 2;
      for (let i = 0; i < raws.length; i++) {
        push(raws[i]);
        const f = facts.find((q) => !seq.includes(q) && q.accepts.has(raws[i].goods));
        if (f) push(f);
        if (i % cityEvery === 0 && cities.length) seq.push(cities.shift());
      }
      for (const f of facts) push(f);
      for (const c of cities) seq.push(c);
      const N = seq.length;
      seq.forEach((s, i) => { s.at = i < 3 ? 0 : 0.07 + (0.73 * (i - 3)) / Math.max(1, N - 3); });
    }
    // 뒤늦게 열리는 거점은 해당 단계 시작과 함께
    for (const s of this.sites) if (s.stage !== s.region) s.at = 0;
  }

  regionGoal(i = this.stage) {
    if (i < REGION_GOAL.length) return REGION_GOAL[i];
    return ENDLESS_GOAL_BASE;
  }

  get currentRegion() { return this.regions[Math.min(this.stage, this.regions.length - 1)]; }
  get allUnlocked() { return this.stage >= this.regions.length - 1; }

  // 현재 단계 달성률 0~1
  progress() {
    const reg = this.currentRegion;
    return Math.min(1, reg.pts / this.regionGoal(reg.index));
  }

  applyStage(stage, silent = false) {
    this.stage = stage;
    for (const reg of this.regions) reg.unlocked = reg.index <= stage;
    this.updateRoadAccess();
    this.updateSiteAvailability(silent);
    if (!silent) {
      if (this.allUnlocked) this.flags.openAt = this.time;
      this.events.push({ type: 'region', region: this.regions[stage] });
    }
  }

  updateRoadAccess() {
    for (const r of this.net.roads) {
      if (r.kind === 'f') { r.open = r.stage <= this.stage; continue; }
      const regionOk = r.region <= this.stage;
      r.open = regionOk && r.built;
    }
    // 뱃길 터미널 지선은 뱃길이 열리면 함께 연다
    for (const r of this.net.roads) {
      if (r.kind !== 'f' || !r.open) continue;
      for (const nid of [r.a, r.b]) {
        for (const q of this.net.nodes[nid].roads) if (q.kind === 'r' && q.built) q.open = true;
      }
    }
    // 잠긴 권역 안의 해금 거점 지선은 열어 준다
    for (const s of this.sites) {
      if (s.stage <= this.stage && s.spurIn) s.spurIn.road.open = true;
    }
    this.net.version++;
  }

  updateSiteAvailability(silent = false) {
    const prog = this.progress();
    let changed = false;
    for (const s of this.sites) {
      if (s.available) continue;
      const stageReached = s.stage < this.stage || (s.stage === this.stage && (s.at <= prog));
      if (stageReached) {
        s.available = true;
        changed = true;
        this.initSite(s);
        if (!silent) this.events.push({ type: 'site', site: s });
      }
    }
    if (changed) this.refreshRoutes();
    return changed;
  }

  initSite(s) {
    if (s.produces) s.stock = s.inputs ? 0 : this.siteCap(s) * 0.4;
  }

  // ── 생산 ──────────────────────────────────────────────
  siteRate(s) {
    if (!s.produces) return 0;
    const base = (GOODS[s.goods].rate ?? BASE_RATE[s.tier]) * Math.pow(1.55, s.stage);
    return base * Math.pow(1.38, s.level) * (1 + this.perk('rate') * 0.05);
  }
  siteCap(s) { return Math.max(24, this.siteRate(s) * 70); }
  inputCap(s) { return Math.max(30, this.siteRate(s) * 110); }

  upgradeCost(s) {
    if (!s.produces) return Infinity;
    return EXPAND_COST[s.goods] * (1 + s.stage * 0.45) * Math.pow(1.72, s.level) * Math.pow(1.55, s.stage);
  }
  bayCost(s) {
    return BAY_COST[s.produces ? s.tier : 0] * Math.pow(1.9, s.bays - 1) * Math.pow(1.55, s.stage);
  }
  buyUpgrade(s) {
    const c = this.upgradeCost(s);
    if (this.money < c) return false;
    this.money -= c;
    s.level++;
    return true;
  }
  buyBay(s) {
    const c = this.bayCost(s);
    if (this.money < c || s.bays >= 12) return false;
    this.money -= c;
    s.bays++;
    return true;
  }

  stepEconomy(dt) {
    const tech = this.upg;
    const bayF = 1 - tech.bay * 0.08;
    for (const s of this.sites) {
      if (!s.available) continue;
      // 생산
      if (s.produces) {
        const cap = this.siteCap(s);
        if (s.stock < cap) {
          const rate = this.siteRate(s);
          let amount = rate * dt;
          if (s.inputs) {
            for (let i = 0; i < s.inputs.length; i++) amount = Math.min(amount, s.inBuf[i]);
            for (let i = 0; i < s.inputs.length; i++) s.inBuf[i] -= amount;
          }
          s.stock = Math.min(cap, s.stock + amount);
        }
      }
      // 상차
      for (let i = s.loadBays.length - 1; i >= 0; i--) {
        const b = s.loadBays[i];
        b.t += dt;
        if (b.t >= b.T) {
          s.loadBays.splice(i, 1);
          this.finishLoad(s, b.v);
        }
      }
      // 하차
      for (let i = s.unloadBays.length - 1; i >= 0; i--) {
        const b = s.unloadBays[i];
        b.t += dt;
        if (b.t >= b.T) {
          s.unloadBays.splice(i, 1);
          this.finishUnload(s, b.v);
        }
      }
      // 칸에 댄 트럭 → 하차 시작
      while (s.unloadQ.length && s.unloadBays.length < s.bays) {
        const v = s.unloadQ.shift();
        s.inbound--;
        v.state = 'bay';
        s.unloadBays.push({ v, t: 0, T: v.model.load * bayF });
      }
      // 대기장 → 상차장
      if (s.yard.length) {
        for (const v of s.yard) v.yardT = (v.yardT || 0) + dt;
        while (s.yard.length && s.loadBays.length < s.bays) {
          const v = s.yard[0];
          const cap = this.truckCap(v.model);
          const full = s.stock >= cap;
          const partial = v.yardT >= 8 && s.stock >= Math.max(0.5, cap * 0.25);
          if (!full && !partial) break;
          s.yard.shift();
          this.startLoad(s, v, bayF);
        }
      }
      // 출발
      while (s.exitQ.length) {
        // 출구 앞에 서 있는 트럭부터 내보낸다. 앞이 빈 줄 보이는데 서 있으면 어색하다. 칸 없이 기다리던 트럭은 그 틈에 나간다
        if (!s.exitQ[0].lot) {
          const i = s.exitQ.findIndex((q) => q.lot);
          if (i > 0) {
            const q = s.exitQ[i];
            s.exitQ[i] = s.exitQ[0];
            s.exitQ[0] = q;
          }
        }
        const v = s.exitQ[0];
        if (v.retire) { s.exitQ.shift(); this.removeTruck(v); continue; }
        const first = v.path[0];
        const L = v.lot;
        const dOdo = v.dOdo, dV = v.dV, speed = v.v;
        if (!this.traffic.inject(v, first, 0)) {
          v.v = 0;
          v.a = 0;
          break;
        }
        s.exitQ.shift();
        // 주차장에서 나온 트럭은 멈추지 않고 그대로 이어 달린다
        if (L) {
          v.passed(L.seg);
          v.dOdo = dOdo;
          v.dV = dV;
          v.v = speed;
          this.dropLot(v);
        }
      }
    }
  }

  truckCap(model) { return model.cap * (1 + this.upg.cap * 0.1); }

  startLoad(s, v, bayF) {
    const cap = this.truckCap(v.model);
    const tons = Math.min(cap, s.stock);
    s.stock -= tons;
    v.cargo = tons;
    v.goods = s.goods;
    v.state = 'bay';
    v.yardT = 0;
    s.loadBays.push({ v, t: 0, T: v.model.load * bayF });
  }

  finishLoad(s, v) {
    const r = v.route;
    v.leg = 1;
    v.path = this.pathFor(r, 1);
    v.legStart = this.time;
    v.tripStart = this.time;
    v.expected = (r.freeTime / v.model.speed / (1 + this.upg.speed * 0.05)) * 1.6 + 11;
    this.leaveLot(s, v);
  }

  finishUnload(s, v) {
    this.payDelivery(s, v);
    if (v.retire) { this.removeTruck(v); return; }
    const r = v.route;
    v.leg = 0;
    v.cargo = 0;
    v.goods = null;
    v.path = this.pathFor(r, 0);
    v.legStart = this.time;
    this.leaveLot(s, v);
  }

  pathFor(route, leg) {
    if (this.techs.has('nav')) {
      const fresh = this.navPath(route, leg);
      if (fresh) return fresh;
    }
    return leg === 1 ? route.pathTo : route.pathBack;
  }

  navPath(route, leg) {
    // 경로 재탐색은 노선·방향별로 몇 초에 한 번만
    const key = leg === 1 ? 'navTo' : 'navBack';
    const stamp = leg === 1 ? 'navToT' : 'navBackT';
    if (route[key] && this.time - route[stamp] < 8) return route[key];
    const start = leg === 1 ? route.from.spurOut : route.to.spurOut;
    const end = leg === 1 ? route.to.spurIn : route.from.spurIn;
    if (!start || !end) return null;
    let cached = this.navTrees.get(start.id);
    if (!cached || this.time - cached.t > 12) {
      cached = { t: this.time, tree: shortestTree(this.net, start, { congestion: true }) };
      this.navTrees.set(start.id, cached);
    }
    const p = extractPath(this.net, cached.tree, end);
    route[key] = p;
    route[stamp] = this.time;
    return p;
  }

  // 빼기로 한 트럭도 싣고 있던 짐은 내려놓고 사라진다
  hasLoad(v) { return v.leg === 1 && v.cargo > 0; }

  // 거점에 닿는 트럭이 서지 않고 들어갈 수 있는 속도. 0이면 차로 끝에 선다
  arriveSpeed(v) {
    const r = v.route;
    if (v.retire && !this.hasLoad(v)) return 0;
    const s = v.leg === 1 ? r.to : r.from;
    if (v.leg === 1 && s.inbound >= s.bays * 3) return 0;
    const lot = this.lotOf(s);
    if (!lot.canTake() || lot.waiting >= LOT_BUSY) return 0;
    return lot.entrySpeed(v, LOT_V);
  }

  // 트럭이 경로 끝(거점)에 도착
  onArrive(v) {
    const r = v.route;
    if (v.retire && !this.hasLoad(v)) { this.removeTruckFromSim(v); return true; }
    if (v.leg === 1) {
      const s = r.to;
      if (s.inbound >= s.bays * 3 && v.v < 1) return false;
      s.inbound++;
      this.noteLeg(v);
      this.enterLot(s, v);
      return true;
    }
    this.noteLeg(v);
    this.enterLot(r.from, v);
    return true;
  }

  // ── 노선 정체 ─────────────────────────────────────────
  // 막히지 않은 길을 달릴 때 걸리는 편도 시간. 빈 도로를 달린 트럭의 실제 시간에 맞췄다 (가속과 회전 포함)
  quietTime(r, leg, model) {
    const free = leg === 1 ? r.freeTime : r.freeBack, ship = leg === 1 ? r.shipTo : r.shipBack;
    return ((free - ship) / model.speed / (1 + this.upg.speed * 0.05)) * QUIET_SLOPE + QUIET_BASE + ship * QUIET_SHIP;
  }
  // 거점에 닿은 트럭이 편도에 걸린 시간을 적어 둔다
  noteLeg(v) {
    if (v.legStart === null || v.legStart === undefined) return;
    const st = v.route.legs[v.leg];
    const real = this.time - v.legStart, quiet = this.quietTime(v.route, v.leg, v.model);
    st.real = st.n ? st.real + (real - st.real) * LEG_EMA : real;
    st.quiet = st.n ? st.quiet + (quiet - st.quiet) * LEG_EMA : quiet;
    st.n++;
    v.legStart = null;
  }
  // 노선의 정체: 방향별로 평소보다 몇 배 걸리는지와, 그 때문에 길에서 노는 트럭 수.
  // 도착한 트럭의 기록에 아직 달리는 트럭이 이미 넘긴 시간을 더한다. 꽉 막히면 도착하는 트럭이 없어 기록만으로는 늦게 안다
  routeJam(r) {
    const count = [0, 0], over = [0, 0], late = [0, 0];
    const base = [0, 1].map((leg) => {
      const st = r.legs[leg];
      return st.n ? st.real / st.quiet : 1;
    });
    for (const v of r.trucks) {
      if (v.legStart === null || v.legStart === undefined) continue;
      const b = (this.time - v.legStart) / this.quietTime(r, v.leg, v.model);
      count[v.leg]++;
      if (b > base[v.leg]) { over[v.leg]++; late[v.leg] += b; }
    }
    const model = r.trucks.length ? r.trucks[0].model : TRUCKS[0];
    const legs = [0, 1].map((leg) => {
      const st = r.legs[leg];
      const ratio = Math.max(1, (base[leg] * (1 + count[leg] - over[leg]) + late[leg]) / (1 + count[leg]));
      const quiet = st.n ? st.quiet : this.quietTime(r, leg, model);
      return { ratio, quiet, real: quiet * ratio };
    });
    const moving = legs[0].real + legs[1].real;
    const lost = (r.trucks.length * (moving - legs[0].quiet - legs[1].quiet)) / moving;
    const worst = legs[1].ratio >= legs[0].ratio ? 1 : 0;
    return { route: r, back: legs[0], to: legs[1], worst, ratio: legs[worst].ratio, lost, trucks: r.trucks.length };
  }
  legJammed(leg) { return leg.ratio >= JAM_RATIO && leg.real - leg.quiet >= JAM_SECONDS; }
  // 많이 막히는 노선부터. 트럭이 많이 묶여 있을수록 앞선다
  updateRouteJams() {
    const list = [];
    for (const r of this.routes.values()) {
      if (!r.valid || !r.trucks.length) continue;
      const j = this.routeJam(r);
      if (this.legJammed(j.worst ? j.to : j.back)) list.push(j);
    }
    list.sort((a, b) => b.lost - a.lost);
    this.routeJams = list;
  }
  // 노선이 지나는 길에서 막히는 교차로와 도로. 정체는 뒤로 번지니 줄의 맨 앞이 진짜 원인이다
  // 꽤 오래 막혀 있는 구간인가
  stuckEdge(e) { return !!e && e.road.kind !== 'f' && (e.jam >= SPOT_JAM || e.held >= SPOT_HELD); }
  // 경로에서 줄이 이어진 구간들. 가는 길과 돌아오는 길을 따로 본다
  routeStretches(r) {
    const out = [];
    for (const leg of [1, 0]) {
      const path = this.pathFor(r, leg);
      if (!path) continue;
      let cur = null;
      for (const e of path) {
        if (!this.stuckEdge(e)) { cur = null; continue; }
        if (!cur) { cur = { leg, edges: [] }; out.push(cur); }
        cur.edges.push(e);
      }
    }
    return out;
  }
  // 이 교차로로 이어진 줄을 거슬러 올라가 모은다
  queueBehind(node) {
    const out = [], seen = new Set(), stack = [node];
    while (stack.length && out.length < QUEUE_MAX) {
      const n = stack.pop();
      for (const e of n.inE) {
        if (seen.has(e) || !this.stuckEdge(e)) continue;
        seen.add(e);
        out.push(e);
        stack.push(this.net.nodes[e.from]);
      }
    }
    return out;
  }
  routeSpots(r) {
    const nodes = new Map(), roads = new Map(), net = this.net;
    const stuck = (e) => this.stuckEdge(e);
    const add = (map, key, leg, make, held, jam, head) => {
      let q = map.get(key);
      if (!q) { q = make(); q.held = 0; q.jam = 0; q.head = false; q.legs = [false, false]; map.set(key, q); }
      q.held += held;
      q.jam = Math.max(q.jam, jam);
      q.head = q.head || head;
      q.legs[leg] = true;
    };
    for (const leg of [1, 0]) {
      const path = this.pathFor(r, leg);
      if (!path) continue;
      let behind = 0;
      path.forEach((e, i) => {
        const next = path[i + 1];
        const isStuck = stuck(e);
        behind = isStuck ? behind + e.held : 0;
        const head = isStuck && !stuck(next);
        const n = net.nodes[e.to];
        const road = e.road;
        if (road.kind === 'f') return;
        add(roads, road, leg, () => ({ road }), e.held, e.jam, false);
        const held = head ? behind : e.held;
        if (!next && n.site) {
          // 줄이 거점 앞에서 끝나면 칸이 모자란 것이다
          add(nodes, n, leg, () => ({ node: n, site: n.site }), held, e.jam, head);
        } else if (head && next && next.road.kind === 'f') {
          // 배를 기다리는 줄이면 배가 작은 것이다
          add(roads, next.road, leg, () => ({ road: next.road }), held, e.jam, true);
        } else if (!n.terminal && n.inE.length >= 3) {
          add(nodes, n, leg, () => ({ node: n }), held, e.jam, head);
        } else if (head && next) {
          // 갈림길이 아닌데 줄이 끊기면 다음 도로가 좁은 것이다
          add(roads, next.road, leg, () => ({ road: next.road }), held, e.jam, true);
        }
      });
    }
    const pick = (map) => {
      const all = [...map.values()].sort((a, b) => b.head - a.head || b.held - a.held || b.jam - a.jam);
      const hot = all.filter((q) => q.head || q.jam >= SPOT_JAM || q.held >= SPOT_HELD);
      return hot.slice(0, SPOT_MAX);
    };
    return { nodes: pick(nodes), roads: pick(roads) };
  }

  // ── 주차장 ────────────────────────────────────────────
  lotOf(s) {
    if (!s.lot) { s.lot = new Lot(s, this); this.lotVer++; }
    return s.lot;
  }
  takeStall(s, v) {
    const lot = this.lotOf(s);
    const cap = lot.cap;
    const stall = lot.take(v);
    if (lot.cap !== cap) this.lotVer++;
    return stall;
  }
  newLotState(site, stall, phase, seg, s) {
    return { site, stall, phase, seg, s, hold: 0, wait: 0, go: false, ghost: 0, active: false, rest: null, restI: 0, restS0: 0, restN: 0, ax: 0, ay: 0, bx: 0, by: 0 };
  }
  // 차로 끝에 닿은 트럭이 칸을 찾아 들어간다. 칸이 없으면 보이지 않는 곳에서 기다린다
  enterLot(s, v) {
    const stall = s.lot && s.lot.waiting >= LOT_BUSY ? -1 : this.takeStall(s, v);
    if (stall < 0) { v.v = 0; v.a = 0; this.lotParked(s, v); return; }
    const lane = v.lane;
    const seg = s.lot.pathIn(stall, lane ? lane.index : 0);
    if (lane) v.passed(lane);
    v.state = 'lot';
    v.ci = 0;
    v.lot = this.newLotState(s, stall, 'in', seg, lane ? v.s - lane.edge.L : 0);
    s.lot.enter(v);
    this.lotVehicles.add(v);
    this.lotMovers.push(v);
  }
  // 새 트럭이나 구난된 트럭은 빈 칸에 바로 세운다
  parkNow(s, v) {
    v.legStart = null;
    if (v.nextModel !== null) this.applyConvert(v);
    const stall = this.takeStall(s, v);
    if (stall >= 0) {
      const seg = s.lot.pathIn(stall, 0);
      v.lot = this.newLotState(s, stall, 'park', seg, seg.len);
      this.lotVehicles.add(v);
    }
    v.state = 'queue';
    v.yardT = 0;
    s.yard.push(v);
  }
  // 칸에 멈춘 뒤: 실을 트럭은 대기장 줄에, 내릴 트럭은 하차 줄에 선다
  lotParked(s, v) {
    if (v.nextModel !== null) this.applyConvert(v);
    if (v.leg === 1) {
      v.state = 'queue';
      s.unloadQ.push(v);
    } else {
      v.state = 'queue';
      v.yardT = 0;
      s.yard.push(v);
    }
  }
  // 일을 마치면 후진으로 빠져나온다
  leaveLot(s, v) {
    const L = v.lot;
    if (!L) {
      v.state = 'queue';
      s.exitQ.push(v);
      return;
    }
    v.state = 'lot';
    L.phase = 'back';
    L.seg = s.lot.pathBack(L.stall);
    L.s = v.len;
    v.v = 0;
    v.a = 0;
    v.ci = 0;
    L.wait = 0;
    L.ghost = 0;
    L.hold = LOT_SHIFT;
    s.lot.waiting++;
    this.lotMovers.push(v);
  }
  dropLot(v) {
    const L = v.lot;
    if (!L) return;
    if (L.phase === 'back' && !L.go) L.site.lot.waiting--;
    if (L.stall >= 0) L.site.lot.release(L.stall);
    L.site.lot.leave(v);
    v.lot = null;
    this.lotVehicles.delete(v);
  }
  stepLot(dt) {
    const list = this.lotMovers;
    let keep = 0;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const L = v.lot;
      if (!L || L.phase === 'park' || L.phase === 'exit') continue;
      if (L.hold > 0) { L.hold -= dt; list[keep++] = v; continue; }
      const lot = L.site.lot;
      // 후진은 갈 길이 빌 때까지 칸에서 기다린다
      if (L.phase === 'back' && !L.go && !lot.tryBack(v)) {
        L.hold = LOT_RECHECK;
        list[keep++] = v;
        continue;
      }
      const remain = L.seg.len - L.s;
      const look = (v.v * v.v) / (2 * v.brake) + LOT_LOOK;
      let gap = remain, leadV = 0, head = 0, slowV, slowD;
      if (L.phase === 'out') gap = this.lotExitGap(v, remain, look);
      if (L.phase === 'out' && gap === Infinity) { slowV = LOT_LEAVE_V; slowD = remain; }
      if (L.phase === 'out' && gap < Infinity) leadV = this.lotExitV;
      let scanTo = Math.min(look, remain);
      if (L.phase === 'in') {
        // 칸 쪽으로 꺾기 전에 그 길이 비었는지 보고, 꺾을 곳까지는 앞차를 보며 간다
        const toTurn = L.seg.commitS - L.s;
        scanTo = Math.min(look, Math.max(0, toTurn));
        if (!L.go && toTurn <= look) {
          if (L.wait > LOT_PATIENCE) { lot.tryTurn(v, true); this.lotGhosts++; }
          else if (!lot.tryTurn(v, false)) {
            gap = Math.max(0, toTurn);
            if (v.v < 0.1) L.wait += dt;
          }
        }
      }
      let blocker = null;
      if (L.ghost > 0) L.ghost -= dt;
      else if (L.phase !== 'back' && scanTo > 0) {
        const g = lot.scan(v, scanTo);
        if (g < gap) {
          gap = g;
          leadV = lot.leadV;
          head = LOT_HEADWAY;
          slowD = undefined;
          blocker = lot.lead;
        }
      }
      const cs = L.seg.corners, tr = this.traffic;
      if (cs.length && tr.cornerAhead(v, cs, L.s) && tr.tighter(v, tr.cornerV, tr.cornerD, slowV, slowD)) {
        slowV = tr.cornerV;
        slowD = tr.cornerD;
      }
      const u = tr.drive(v, L.phase === 'back' ? LOT_V_BACK : LOT_V, gap, leadV, head, dt, slowV, slowD);
      // 다른 방향으로 가는 트럭과 서로 막고 있으면 언젠가는 비켜 지나간다. 같은 줄의 앞차는 끝까지 기다린다
      if (blocker && u < 0.05 && blocker.lot.phase !== L.phase && !(L.phase === 'out' && blocker.lot.phase === 'exit')) {
        L.wait += dt;
        if (L.wait > LOT_PATIENCE) {
          L.wait = 0;
          L.ghost = LOT_SQUEEZE;
          this.lotGhosts++;
        }
      }
      const ds = u * dt;
      L.s += ds;
      v.odo += ds;
      lot.passRest(v);
      lot.updateBody(v);
      if (remain - ds > 0.02 && (u > 0.02 || remain > 0.08)) { list[keep++] = v; continue; }
      // 구간 끝
      L.s = L.seg.len;
      const s = L.site;
      if (L.phase === 'in') {
        L.phase = 'park';
        v.v = 0;
        v.a = 0;
        lot.leave(v);
        this.lotParked(s, v);
      } else if (L.phase === 'back') {
        const stall = L.stall;
        lot.release(stall);
        L.stall = -1;
        L.phase = 'out';
        L.seg = lot.pathOut(stall);
        L.s = EXIT_PREFIX + v.len;
        L.go = false;
        L.rest = null;
        L.wait = 0;
        L.ghost = 0;
        lot.updateBody(v);
        v.v = 0;
        v.a = 0;
        v.ci = 0;
        L.hold = LOT_SHIFT;
        list[keep++] = v;
      } else {
        L.phase = 'exit';
        lot.updateBody(v);
        v.state = 'queue';
        s.exitQ.push(v);
      }
    }
    list.length = keep;
  }
  // 나가는 길 끝의 사정. 진입로에 자리가 있으면 Infinity, 없으면 멈춰야 할 곳까지의 거리
  lotExitGap(v, remain, look) {
    this.lotExitV = 0;
    const first = v.path && v.path[0];
    if (!first || remain > look + 1) return Infinity;
    let gap = Infinity;
    // 막 나간 트럭의 꽁무니가 아직 주차장 쪽에 남아 있으면 그 뒤에 선다
    for (const q of first.lanes) {
      const t = q.tail();
      if (!t) continue;
      const g = remain + t.s - t.len - GAP;
      if (g < gap && g < remain) { gap = g; this.lotExitV = t.v; }
    }
    if (!this.traffic.bestLane(first, v.path[1] || null, GAP)) {
      if (remain - 0.02 < gap) { gap = Math.max(0, remain - 0.02); this.lotExitV = 0; }
    }
    return gap;
  }

  // 연구와 명성 보너스를 합한 납품가 배율
  payMult() { return (1 + this.upg.pay * 0.14) * (1 + this.perk('pay') * 0.1) * this.fameMult(); }
  // 권역이 돈이 아니라 실적으로 열리니, 실적도 함께 올라야 회차가 빨라진다
  ptsMult() { return (1 + this.perk('pts') * 0.1) * this.fameMult(); }

  payDelivery(s, v) {
    const g = GOODS[v.goods];
    const r = v.route;
    const tons = v.cargo;
    let mult = this.payMult();
    if (s.kind === 'city') mult *= 1 + s.cityStage * 0.08;
    if (s.kind === 'dokdo') mult *= 6;
    mult *= this.boomMult();
    // 정시 여부
    const trip = this.time - v.tripStart;
    const late = trip / v.expected;
    let tag = '';
    const baseBonus = 0.2 + this.upg.ontime * 0.04;
    if (late <= 1) { mult *= 1 + baseBonus * (v.model.onTime || 1); tag = 'ontime'; this.onTimeCount++; }
    else if (late >= 2) { mult *= 0.72; tag = 'late'; this.lateCount++; }
    // 원료 과잉이면 값을 덜 받는다
    let overflow = false;
    if (s.inputs) {
      const slot = s.inputs.findIndex((list) => list.includes(v.goods));
      if (slot >= 0) {
        const cap = this.inputCap(s);
        if (s.inBuf[slot] >= cap) { mult *= 0.55; overflow = true; }
        s.inBuf[slot] = Math.min(cap, s.inBuf[slot] + tons);
      }
    }
    const pay = tons * r.perTon * mult;
    this.money += pay;
    this.totalEarned += pay;
    this.incomeBucket += pay;
    r.bucket += pay;
    r.earned += pay;
    r.delivered += tons;
    this.totalTons += tons;
    this.deliveries++;
    s.delivered += tons;

    const weight = g.weight ?? TIER_WEIGHT[g.tier];
    const pts = tons * weight * this.ptsMult();
    const reg = this.regions[s.region];
    reg.pts += pts;
    if (this.allUnlocked && this.progress() >= 1) this.endlessPts += pts;
    if (s.isCity) this.growCity(s, pts * (g.growth || 1));
    this.floats.push({ x: s.x, y: s.y, text: '+' + fmtWon(pay), tag, t: 0, overflow });
    if (this.floats.length > 40) this.floats.shift();
    this.checkProgress();
  }

  growCity(s, pts) {
    s.growth += pts;
    const scale = 1 + Math.sqrt(s.pop) / 8;
    let st = s.cityStage;
    while (st < 5 && s.growth >= CITY_STAGE_NEED[st + 1] * scale * Math.pow(1.5, s.stage)) st++;
    if (st !== s.cityStage) {
      s.cityStage = st;
      this.events.push({ type: 'city', site: s, stage: st });
    }
  }

  checkProgress() {
    this.progressT = (this.progressT || 0) + 1;
    if (this.progressT % 5 === 0) this.updateSiteAvailability();
    if (!this.allUnlocked && this.progress() >= 1) {
      this.applyStage(this.stage + 1);
      this.updateSiteAvailability();
    } else if (this.allUnlocked && this.progress() >= 1 && !this.flags.allDone) {
      this.flags.allDone = true;
      this.events.push({ type: 'alldone' });
    }
  }

  // 무한 모드: 전국 물동량 단계
  endlessGoal() { return ENDLESS_GOAL_BASE * Math.pow(1.8, this.endless); }
  checkEndless() {
    if (!this.flags.allDone) return;
    if (this.endlessPts >= this.endlessGoal()) {
      this.endlessPts -= this.endlessGoal();
      this.endless++;
      this.events.push({ type: 'boom', level: this.endless });
    }
  }
  boomMult() { return 1 + this.endless * 0.15; }

  // ── 노선 ──────────────────────────────────────────────
  refreshRoutes() {
    const avail = this.sites.filter((s) => s.available);
    const trees = new Map();
    for (const p of avail) {
      if (!p.produces || !p.spurOut) continue;
      const tree = shortestTree(this.net, p.spurOut);
      const cands = [];
      for (const c of avail) {
        if (c === p || !c.accepts.has(p.goods) || !c.spurIn) continue;
        const path = extractPath(this.net, tree, c.spurIn);
        if (!path) continue;
        cands.push({ c, path, km: pathLength(path), cost: tree.cost[c.spurIn.id] });
      }
      cands.sort((a, b) => a.km - b.km);
      // 원료로 쓰는 공장과 최종 소비처를 고르게 잇고, 먼 곳도 하나 남겨 둔다
      const facts = cands.filter((q) => q.c.inputs && q.c.accepts.has(p.goods));
      const ends = cands.filter((q) => !q.c.inputs);
      const keep = [...facts.slice(0, 2), ...ends.slice(0, 2)];
      if (!keep.length) keep.push(...cands.slice(0, 2));
      const nearest = keep.reduce((m, q) => Math.min(m, q.km), Infinity);
      const far = cands.filter((q) => !keep.includes(q) && q.km > nearest * 2 && q.km < nearest + 320);
      if (far.length) keep.push(far[Math.floor(far.length * 0.55)]);
      for (const q of keep) this.ensureRoute(p, q.c);
      trees.set(p, { tree, cands });
    }
    // 아무도 찾아오지 않는 거점은 가장 가까운 생산지와 이어 준다
    for (const c of avail) {
      if (!c.spurIn || c.routesIn.some((r) => r.valid !== false)) continue;
      let best = null;
      for (const [p, { cands }] of trees) {
        const q = cands.find((x) => x.c === c);
        if (q && (!best || q.km < best.km)) best = { p, km: q.km };
      }
      if (best) this.ensureRoute(best.p, c);
    }
    // 원료 칸이 하나라도 비면 공장이 아무것도 못 만드니, 칸마다 공급 노선을 하나는 잇는다
    for (const c of avail) {
      if (!c.inputs || !c.spurIn) continue;
      for (const slot of c.inputs) {
        if (c.routesIn.some((r) => r.valid !== false && slot.includes(r.goods))) continue;
        let best = null;
        for (const [p, { cands }] of trees) {
          if (!slot.includes(p.goods)) continue;
          const q = cands.find((x) => x.c === c);
          if (q && (!best || q.km < best.km)) best = { p, km: q.km };
        }
        if (best) this.ensureRoute(best.p, c);
      }
    }
    this.recomputePaths();
  }

  ensureRoute(p, c) {
    const id = `${p.id}>${c.id}`;
    let r = this.routes.get(id);
    if (!r) {
      r = new Route(p, c, p.goods);
      this.routes.set(id, r);
      p.routesOut.push(r);
      c.routesIn.push(r);
    }
    return r;
  }

  recomputePaths() {
    const trees = new Map();
    const treeOf = (s) => {
      if (!trees.has(s)) trees.set(s, shortestTree(this.net, s.spurOut));
      return trees.get(s);
    };
    for (const r of this.routes.values()) {
      const pt = extractPath(this.net, treeOf(r.from), r.to.spurIn);
      const pb = extractPath(this.net, treeOf(r.to), r.from.spurIn);
      if (!pt || !pb) {
        r.valid = false;
        continue;
      }
      r.valid = true;
      r.pathTo = pt;
      r.pathBack = pb;
      r.dist = pathLength(pt);
      r.freeTime = treeOf(r.from).cost[r.to.spurIn.id];
      r.freeBack = treeOf(r.to).cost[r.from.spurIn.id];
      // 뱃길 시간은 트럭 속도와 상관없다
      const ship = (path) => path.reduce((sum, e) => sum + (e.road.kind === 'f' ? e.road.len / SHIP_SPEED + 10 : 0), 0);
      r.shipTo = ship(pt);
      r.shipBack = ship(pb);
      const g = GOODS[r.goods];
      r.perTon = g.price * (0.91 + r.dist / 115);
    }
  }

  // 명성 보너스를 뺀 첫 대 가격
  modelPrice(modelIdx) { return TRUCKS[modelIdx].price * (1 - this.perk('truck') * 0.03); }

  truckPrice(route, modelIdx) {
    return this.modelPrice(modelIdx) * (1 + TRUCK_STEP * route.trucks.length);
  }

  // n대를 한꺼번에 살 때 값 (대수에 따라 값이 오른다)
  truckBatchPrice(route, modelIdx, n) {
    const c = route.trucks.length;
    return this.modelPrice(modelIdx) * (n * (1 + TRUCK_STEP * c) + (TRUCK_STEP * n * (n - 1)) / 2);
  }
  // 지금 돈으로 살 수 있는 최대 대수 (최소 1)
  truckAffordable(route, modelIdx, limit = 200) {
    let n = 0;
    let price = this.truckPrice(route, modelIdx);
    let money = this.money;
    const step = this.modelPrice(modelIdx) * TRUCK_STEP;
    while (n < limit && money >= price) { money -= price; price += step; n++; }
    return n;
  }

  modelUnlocked(modelIdx) {
    const t = TRUCKS[modelIdx].tech;
    return !t || this.techs.has(t);
  }

  buyTruck(route, modelIdx = 0, free = false) {
    if (!route.valid || !this.modelUnlocked(modelIdx)) return null;
    const price = free ? 0 : this.truckPrice(route, modelIdx);
    if (this.money < price) return null;
    this.money -= price;
    return this.addTruck(route, modelIdx, price);
  }

  addTruck(route, modelIdx, price = 0) {
    const m = TRUCKS[modelIdx];
    const v = this.traffic.newVehicle(m, route);
    v.speedF = m.speed * (1 + this.upg.speed * 0.05);
    v.modelIdx = modelIdx;
    v.price = price;
    v.leg = 0;
    v.path = route.pathBack;
    route.trucks.push(v);
    if (route.trucks.length === 1) this.routeVer++;
    this.parkNow(route.from, v);
    route.opened = true;
    return v;
  }

  sellTruck(route) {
    if (!route.trucks.length) return false;
    // 대기장에 있는 트럭부터
    const s = route.from;
    const v = s.yard.slice().reverse().find((q) => q.route === route) || route.trucks.slice().reverse().find((q) => !q.retire);
    if (!v) return false;
    this.money += (v.price || 0) * 0.5;
    this.retireTruck(v);
    return true;
  }
  // 트럭을 노선에서 뺀다. 세워 둔 트럭은 바로 사라지고, 달리는 트럭은 다음 거점에 닿을 때 사라진다
  retireTruck(v) {
    const r = v.route, yard = r.from.yard;
    const i = yard.indexOf(v);
    if (i >= 0) {
      yard.splice(i, 1);
      this.removeTruck(v);
      return;
    }
    v.retire = true;
    r.trucks.splice(r.trucks.indexOf(v), 1);
    if (!r.trucks.length) this.routeVer++;
  }

  // ── 트럭 전환 ─────────────────────────────────────
  // 이 노선에서 modelIdx보다 적게 싣는 트럭. 가장 적게 싣는 것부터
  convertibleTrucks(route, modelIdx) {
    const capOf = (v) => TRUCKS[v.nextModel ?? v.modelIdx].cap;
    const cap = TRUCKS[modelIdx].cap;
    return route.trucks.filter((v) => !v.retire && capOf(v) < cap).sort((a, b) => capOf(a) - capOf(b));
  }
  // 전환 계획: 나르는 양은 그대로 두고 대수를 줄인다. 1톤 5대가 5톤 1대가 된다.
  // maxNew는 새로 생길 트럭 수의 상한이다. 값은 새 트럭값에서 빠지는 트럭값의 절반을 뺀 만큼이고, 새 트럭값의 일부는 꼭 낸다
  convertPlan(route, modelIdx, maxNew = Infinity) {
    const cap = TRUCKS[modelIdx].cap;
    const olds = [];
    let tons = 0, refund = 0;
    if (maxNew >= 1) {
      for (const v of this.convertibleTrucks(route, modelIdx)) {
        const c = TRUCKS[v.nextModel ?? v.modelIdx].cap;
        if (olds.length && Math.ceil((tons + c) / cap) > maxNew) break;
        olds.push(v);
        tons += c;
        refund += (v.price || 0) * 0.5;
      }
    }
    const keep = Math.ceil(tons / cap);
    const price = this.modelPrice(modelIdx) * (1 + TRUCK_STEP * Math.max(0, route.trucks.length - olds.length + keep - 1));
    return { olds, keep, price, cost: Math.max(keep * price * CONVERT_FEE, keep * price - refund) };
  }
  // 돈이 모자라면 닿는 만큼만 바꾼다
  convertWithin(route, modelIdx, money, maxNew = Infinity) {
    let plan = this.convertPlan(route, modelIdx, maxNew);
    while (plan.keep && plan.cost > money) plan = this.convertPlan(route, modelIdx, plan.keep - 1);
    return plan;
  }
  // 트럭을 바꾼다. 세워 둔 트럭, 빈 트럭, 짐 실은 트럭 순으로 빼고 남은 트럭이 새 차종이 된다.
  // 서 있는 트럭은 바로, 달리는 트럭은 다음 거점에 닿을 때 바뀌거나 사라진다
  convertTrucks(route, modelIdx, maxNew = Infinity) {
    const out = { n: 0, k: 0, paid: 0 };
    if (!route.valid || !this.modelUnlocked(modelIdx)) return out;
    const plan = this.convertWithin(route, modelIdx, this.money, maxNew);
    if (!plan.keep) return out;
    this.money -= plan.cost;
    const rank = (v) => (route.from.yard.includes(v) ? 0 : this.hasLoad(v) ? 2 : 1);
    const order = plan.olds.slice().sort((a, b) => rank(a) - rank(b));
    const drop = order.length - plan.keep;
    order.forEach((v, i) => {
      if (i < drop) {
        this.retireTruck(v);
        return;
      }
      v.price = plan.price;
      v.nextModel = modelIdx;
      if (v.lot ? v.lot.phase === 'park' : v.state === 'queue' || v.state === 'bay') this.applyConvert(v);
    });
    out.n = order.length;
    out.k = plan.keep;
    out.paid = plan.cost;
    return out;
  }
  applyConvert(v) {
    const m = TRUCKS[v.nextModel];
    v.model = m;
    v.modelIdx = v.nextModel;
    v.len = m.len;
    v.speedF = m.speed * (1 + this.upg.speed * 0.05);
    v.nextModel = null;
    v.aT = undefined; // 축 길이가 바뀌었으니 다음에 그릴 때 곧게 다시 놓는다
  }
  // 거점마다 한 번씩 사는 것의 계획. 싼 곳부터 돈이 닿는 만큼
  planSites(sites, costOf) {
    const plan = { list: [], all: sites.length, cost: 0, full: 0 };
    let left = this.money;
    for (const [s, c] of sites.map((q) => [q, costOf(q)]).sort((a, b) => a[1] - b[1])) {
      plan.full += c;
      if (c > left) continue;
      left -= c;
      plan.cost += c;
      plan.list.push(s);
    }
    return plan;
  }
  // 여러 노선을 바꿀 때의 계획. n은 빠지는 트럭, k는 새로 생기는 트럭. all과 allK는 돈이 넉넉할 때의 수다
  planConvert(routes, modelIdx) {
    const plan = { n: 0, k: 0, all: 0, allK: 0, cost: 0, full: 0, some: new Set(), every: new Set() };
    if (!this.modelUnlocked(modelIdx)) return plan;
    const from = (v) => TRUCKS[v.nextModel ?? v.modelIdx];
    let left = this.money;
    for (const q of routes) {
      if (!q.valid) continue;
      const whole = this.convertPlan(q, modelIdx);
      if (!whole.keep) continue;
      plan.all += whole.olds.length;
      plan.allK += whole.keep;
      plan.full += whole.cost;
      for (const v of whole.olds) plan.every.add(from(v));
      const got = this.convertWithin(q, modelIdx, left);
      if (!got.keep) continue;
      left -= got.cost;
      plan.cost += got.cost;
      plan.n += got.olds.length;
      plan.k += got.keep;
      for (const v of got.olds) plan.some.add(from(v));
    }
    return plan;
  }

  // ── 여러 노선 한꺼번에 사기 ───────────────────────
  // 막히지 않을 때 시간당 버는 값
  routeValue(r) {
    return r.perTon / (r.freeTime * 2 + 6);
  }
  // 이 거점에서 트럭을 더할 노선. running은 달리는 노선 전부이고, 하나도 없으면 가장 잘 버는 노선을 연다. empty는 빈 노선, all은 전부
  bulkRoutes(s, on = 'running') {
    const valid = s.routesOut.filter((q) => q.valid);
    if (on === 'all') return valid;
    if (on === 'empty') return valid.filter((q) => !q.trucks.length);
    const running = valid.filter((q) => q.trucks.length);
    if (running.length) return running;
    return valid.length ? [valid.reduce((a, b) => (this.routeValue(b) > this.routeValue(a) ? b : a))] : [];
  }
  // 노선마다 n대까지 한 바퀴씩 돌며 산다. 잘 버는 노선이 먼저고, 돈이 모자라도 한 노선에 몰리지 않는다
  planBuy(routes, modelIdx, n) {
    const plan = { buy: [], n: 0, want: routes.length * n, cost: 0, full: 0 };
    for (const q of routes) plan.full += this.truckBatchPrice(q, modelIdx, n);
    if (!this.modelUnlocked(modelIdx)) return plan;
    const order = routes.filter((q) => q.valid).sort((a, b) => this.routeValue(b) - this.routeValue(a));
    let left = this.money;
    for (let round = 0; round < n; round++) {
      const before = plan.n;
      for (const q of order) {
        // 한 번 못 산 노선은 값이 내려가지 않으니 다음 바퀴에도 못 산다
        const price = this.modelPrice(modelIdx) * (1 + TRUCK_STEP * (q.trucks.length + round));
        if (price > left) continue;
        left -= price;
        plan.cost += price;
        plan.n++;
        plan.buy.push(q);
      }
      if (plan.n === before) break;
    }
    return plan;
  }
  bulkBuy(routes, modelIdx, n) {
    const out = { n: 0, paid: 0 };
    for (const q of this.planBuy(routes, modelIdx, n).buy) {
      const price = this.truckPrice(q, modelIdx);
      if (!this.buyTruck(q, modelIdx)) continue;
      out.n++;
      out.paid += price;
    }
    return out;
  }

  removeTruck(v) {
    this.dropLot(v);
    this.traffic.extract(v);
    this.traffic.vehicles.delete(v);
    const r = v.route;
    const i = r.trucks.indexOf(v);
    if (i >= 0) { r.trucks.splice(i, 1); if (!r.trucks.length) this.routeVer++; }
  }
  removeTruckFromSim(v) {
    this.dropLot(v);
    this.traffic.vehicles.delete(v);
    const r = v.route;
    const i = r.trucks.indexOf(v);
    if (i >= 0) { r.trucks.splice(i, 1); if (!r.trucks.length) this.routeVer++; }
  }

  get truckCount() { return this.traffic.vehicles.size; }

  // ── 도구 가격과 적용 ───────────────────────────────────
  buildMult() { return 1 - this.perk('build') * 0.04; }
  landFactor(region) { return LAND_FACTOR[Math.min(region, LAND_FACTOR.length - 1)]; }

  // 몇 번째 차로든 값이 같다. 길이와 땅값으로만 달라진다
  lanePrice(road) {
    const per = LANE_PRICE_PER_KM[road.kind] || 0;
    return Math.max(LANE_PRICE_MIN, per * road.len * this.landFactor(road.region)) * this.buildMult();
  }
  canAddLane(road) { return road.kind !== 'f' && road.lanes < MAX_LANES[road.kind]; }
  addLane(road) {
    if (!this.canAddLane(road)) return false;
    const c = this.lanePrice(road);
    if (this.money < c) return false;
    this.money -= c;
    this.net.setLanes(road, road.lanes + 1);
    return true;
  }

  // 교차로 설치비는 어디에 몇 번을 놓아도 같다
  controlPrice(node, control) {
    if (control === 'auto') return 0;
    return (TOOL_PRICE[control] || 0) * this.buildMult();
  }
  ringPrice() { return TOOL_PRICE.ring2 * this.buildMult(); }
  toolAllowed(tool) {
    if (tool === 'signal') return this.techs.has('signal');
    if (tool === 'roundabout') return this.techs.has('roundabout');
    if (tool === 'interchange') return this.techs.has('interchange');
    return true;
  }
  setControl(node, control) {
    if (node.terminal || node.inE.length < 2 || node.control === control) return false;
    if (!this.toolAllowed(control) && control !== 'auto') return false;
    const c = this.controlPrice(node, control);
    if (this.money < c) return false;
    this.money -= c;
    this.traffic.setControl(node, control);
    return true;
  }
  buyRing2(node) {
    if (node.control !== 'roundabout' || node.ringLanes >= 2 || !this.techs.has('ring2')) return false;
    const c = this.ringPrice();
    if (this.money < c) return false;
    this.money -= c;
    node.ringLanes = 2;
    this.net.computeGeometry(node);
    for (const e of node.inE) for (const l of e.lanes) l.conns.clear();
    return true;
  }
  signPrice(edge, sign) {
    if (sign === 0) return 0;
    return (sign === 1 ? TOOL_PRICE.yield : TOOL_PRICE.stop) * this.buildMult();
  }
  setSign(edge, sign) {
    const node = this.net.nodes[edge.to];
    if (node.control !== 'auto' || node.terminal) return false;
    if (edge.sign === sign) return false;
    const c = this.signPrice(edge, sign);
    if (this.money < c) return false;
    this.money -= c;
    edge.sign = sign;
    return true;
  }

  projectAvailable(p) { return !p.built && p.stage <= this.stage && p.roads.length > 0; }
  projectPrice(p) {
    return PROJECT_COST[p.id].cost * this.buildMult();
  }
  buildProject(p) {
    if (!this.projectAvailable(p)) return false;
    const c = this.projectPrice(p);
    if (this.money < c) return false;
    this.money -= c;
    this.completeProject(p);
    this.events.push({ type: 'project', project: p });
    return true;
  }
  completeProject(p) {
    p.built = true;
    for (const r of p.roads) r.built = true;
    this.updateRoadAccess();
    this.refreshRoutes();
  }

  // ── 뱃길 ──────────────────────────────────────────────
  ferryPrice(fy) {
    return FERRY_PRICE * Math.pow(1.5, fy.level || 0) * this.buildMult();
  }
  buyFerry(fy) {
    const c = this.ferryPrice(fy);
    if (this.money < c || fy.cap >= 120) return false;
    this.money -= c;
    fy.level = (fy.level || 0) + 1;
    fy.cap += 10;
    return true;
  }

  // ── 연구 ──────────────────────────────────────────────
  techVisible(t) {
    if (t.stage < this.stage) return true;
    return t.stage === this.stage && this.progress() >= (t.at || 0);
  }
  buyTech(id) {
    const t = TECHS.find((x) => x.id === id);
    if (!t || this.techs.has(id) || !this.techVisible(t) || this.money < t.cost) return false;
    this.money -= t.cost;
    this.techs.add(id);
    if (id === 'smartsig') this.traffic.smartSignals = true;
    this.events.push({ type: 'tech', tech: t });
    return true;
  }
  upgradeCostOf(id) {
    const u = UPGRADES.find((x) => x.id === id);
    return u.base * Math.pow(u.mult, this.upg[id]);
  }
  buyUpg(id) {
    const u = UPGRADES.find((x) => x.id === id);
    if (this.upg[id] >= u.max) return false;
    const c = this.upgradeCostOf(id);
    if (this.money < c) return false;
    this.money -= c;
    this.upg[id]++;
    if (id === 'speed') this.applySpeedTech();
    return true;
  }
  applySpeedTech() {
    const f = 1 + this.upg.speed * 0.05;
    for (const v of this.traffic.vehicles) v.speedF = v.model.speed * f;
  }

  // ── 환생 ──────────────────────────────────────────────
  perk(id) { return this.legacy.perks[id] || 0; }
  // 지금까지 모은 명성 1마다 납품 대금과 실적 +1%. 쓴 명성도 센다
  fameMult() { return 1 + this.legacy.total * 0.01; }
  perkCost(id) {
    const p = PERKS.find((q) => q.id === id);
    return Math.ceil(p.base * Math.pow(p.grow, this.perk(id)));
  }
  buyPerk(id) {
    const p = PERKS.find((q) => q.id === id);
    if (!p || this.perk(id) >= p.max) return false;
    const c = this.perkCost(id);
    if (this.legacy.fame < c) return false;
    this.legacy.fame -= c;
    this.legacy.perks[id] = this.perk(id) + 1;
    return true;
  }
  // 모든 권역을 열면 환생할 수 있다. 더 벌어 둘수록 명성을 더 받는다
  canRebirth() { return this.allUnlocked; }
  fameRate() { return FAME_BASE * (1 + this.perk('fame') * 0.1); }
  // 이번 회차에 번 돈으로 받을 명성
  fameGain() { return Math.floor(this.fameRate() * Math.sqrt(this.totalEarned / FAME_REF)); }
  // 명성 1을 더 받으려면 더 벌어야 할 돈
  fameNext() {
    const need = FAME_REF * Math.pow((this.fameGain() + 1) / this.fameRate(), 2);
    return Math.max(0, need - this.totalEarned);
  }
  // 회차를 새로 시작하는 저장 자료. 명성 보너스만 반영하고 나머지는 처음 상태다
  static freshSave(legacy, keep = {}) {
    const lv = (id) => (legacy.perks && legacy.perks[id]) || 0;
    const upg = {};
    for (const u of UPGRADES) upg[u.id] = Math.min(u.max, lv('study'));
    return {
      v: SAVE_VERSION, t: Date.now(), money: START_MONEY * Math.pow(2, lv('seed')), time: 0, stage: 0, pts: [],
      techs: TECHS.slice(0, lv('tech')).map((t) => t.id), upg,
      flags: { first: true, reborn: legacy.runs },
      ...keep, legacy,
    };
  }
  // 환생한 다음 회차의 저장 자료. 도로 유산이 있으면 깔아 둔 시설이 남는다
  rebirthSave() {
    if (!this.canRebirth()) return null;
    const L = this.legacy, gain = this.fameGain();
    const best = { ...L.best, boom: Math.max(L.best.boom || 0, this.endless) };
    if (this.flags.openAt && (!best.time || this.flags.openAt < best.time)) best.time = this.flags.openAt;
    const legacy = { ...L, fame: L.fame + gain, total: L.total + gain, runs: L.runs + 1, earned: L.earned + this.totalEarned, best, perks: { ...L.perks } };
    let keep = {};
    if (this.perk('roads')) {
      const s = this.serialize();
      keep = { lanes: s.lanes, controls: s.controls, signs: s.signs, ferries: s.ferries, projects: s.projects };
    }
    return Game.freshSave(legacy, keep);
  }

  // ── 구난 ──────────────────────────────────────────────
  towPrice() { return TOW_PRICE; }
  tow(node, free = false) {
    if (!free && (!this.techs.has('tow') || this.money < this.towPrice(node))) return 0;
    let moved = 0;
    for (const e of node.inE) {
      for (const lane of e.lanes) {
        for (let i = 0; i < 2 && lane.veh.length; i++) {
          const v = lane.veh[0];
          if (v.v > 0.4) break;
          this.traffic.extract(v);
          // 원래 가던 거점의 대기 줄로 옮긴다
          if (v.leg === 1) {
            v.state = 'queue';
            v.path = v.route.pathBack;
            v.cargo = 0;
            v.leg = 0;
          }
          this.parkNow(v.route.from, v);
          moved++;
        }
      }
    }
    if (moved) {
      if (!free) this.money -= this.towPrice(node);
      this.towCount += moved;
    }
    return moved;
  }

  // ── 메인 ──────────────────────────────────────────────
  tick(dt) {
    this.time += dt;
    this.traffic.step(dt);
    this.stepLot(dt);
    this.econT += dt;
    while (this.econT >= ECON_DT) {
      this.stepEconomy(ECON_DT);
      this.econT -= ECON_DT;
    }
    this.incomeT += dt;
    if (this.incomeT >= 1) {
      const inst = this.incomeBucket / this.incomeT;
      this.income += (inst - this.income) * (1 - Math.exp(-this.incomeT / 20));
      this.incomeBucket = 0;
      for (const r of this.routes.values()) {
        r.rate += (r.bucket / this.incomeT - r.rate) * (1 - Math.exp(-this.incomeT / 30));
        r.bucket = 0;
      }
      this.incomeT = 0;
      const total = this.onTimeCount + this.lateCount;
      this.onTimeRate = total ? this.onTimeCount / total : 1;
      this.checkEndless();
      this.slowChecks();
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      this.floats[i].t += dt;
      if (this.floats[i].t > 1.6) this.floats.splice(i, 1);
    }
  }

  slowChecks() {
    // 트럭이 한 대도 없고 돈도 없으면 다시 시작할 트럭을 준다
    if (this.truckCount === 0 && this.routes.size) {
      const r = [...this.routes.values()].filter((q) => q.valid).sort((a, b) => a.dist - b.dist)[0];
      if (r && this.money < this.truckPrice(r, 0)) { this.addTruck(r, 0, 0); this.events.push({ type: 'rescue' }); }
    }
    // 정체 순위
    this.jamT++;
    if (this.jamT % 2 === 0) { this.updateJams(); this.updateRouteJams(); }
    // 자동 구난
    if (this.techs.has('autotow')) {
      for (const n of this.net.nodes) {
        if (n.stuckT > 40 && !n.terminal) this.tow(n, true);
      }
    }
    // 자동 배차
    if (this.techs.has('autobuy')) {
      this.autoT++;
      if (this.autoT % 3 === 0) {
        for (const r of this.routes.values()) {
          if (!r.auto || !r.valid) continue;
          const s = r.from;
          if (s.stock > this.siteCap(s) * 0.6 && !s.yard.length) {
            const price = this.truckPrice(r, r.model);
            if (this.money > price * 4) this.buyTruck(r, r.model);
          }
        }
      }
    }
    // 뱃길 트럭 수 표시용 등
    if (this.flags.first !== true && this.deliveries > 0) { this.flags.first = true; this.events.push({ type: 'first' }); }
  }

  updateJams() {
    const list = [];
    for (const n of this.net.nodes) {
      if (n.waiting >= 3 && !n.terminal) list.push({ node: n, waiting: n.waiting, stuck: n.stuckT });
      else if (n.site && n.waiting >= 4) list.push({ node: n, waiting: n.waiting, stuck: n.stuckT, site: n.site });
    }
    list.sort((a, b) => b.waiting - a.waiting);
    this.jams = list.slice(0, 8);
    this.jamsTotal = list.reduce((s, q) => s + q.waiting, 0);
  }

  // 전체 트럭의 정지 비율 (대기장 제외)
  movingStats() {
    let onRoad = 0, stopped = 0;
    for (const v of this.traffic.vehicles) {
      if (v.lane || v.conn) { onRoad++; if (v.v < 0.5) stopped++; }
    }
    return { onRoad, stopped };
  }

  // ── 저장 ──────────────────────────────────────────────
  serialize() {
    const lanes = [];
    for (const r of this.net.roads) if (r.lanes !== BASE_LANES[r.kind]) lanes.push([r.id, r.lanes]);
    const controls = [];
    const signs = [];
    for (const n of this.net.nodes) {
      if (n.control !== 'auto') controls.push([n.id, n.control, n.ringLanes]);
    }
    for (const e of this.net.edges) if (e.sign) signs.push([e.id, e.sign]);
    return {
      v: SAVE_VERSION,
      t: Date.now(),
      money: this.money,
      time: this.time,
      stage: this.stage,
      pts: this.regions.map((r) => r.pts),
      techs: [...this.techs],
      upg: this.upg,
      income: this.income,
      totalEarned: this.totalEarned,
      totalTons: this.totalTons,
      deliveries: this.deliveries,
      onTimeCount: this.onTimeCount,
      lateCount: this.lateCount,
      endless: this.endless,
      endlessPts: this.endlessPts,
      flags: this.flags,
      legacy: this.legacy,
      towCount: this.towCount,
      lanes, controls, signs,
      ferries: this.traffic.ferries.filter((f) => f.level).map((f) => [f.road.id, f.level]),
      projects: this.projects.filter((p) => p.built).map((p) => p.id),
      sites: this.sites.filter((s) => s.available).map((s) => ({
        id: s.id, lv: s.level, b: s.bays, st: s.stock, inb: s.inBuf, gr: s.growth, cs: s.cityStage, d: s.delivered,
      })),
      routes: [...this.routes.values()].filter((r) => r.trucks.length || r.earned || r.auto).map((r) => ({
        id: r.id, m: r.trucks.map((t) => t.nextModel ?? t.modelIdx), p: r.trucks.map((t) => Math.round(t.price || 0)), e: r.earned, d: r.delivered, a: r.auto ? 1 : 0, sel: r.model,
      })),
    };
  }

  static restore(data, save) {
    const g = new Game(data, { legacy: save.legacy });
    const oldWon = (save.v || 1) < 2 ? 100 : 1;
    g.money = save.money * oldWon;
    g.time = save.time;
    save.pts.forEach((p, i) => { if (g.regions[i]) g.regions[i].pts = p; });
    g.techs = new Set(save.techs);
    g.traffic.smartSignals = g.techs.has('smartsig');
    Object.assign(g.upg, save.upg);
    g.income = (save.income || 0) * oldWon;
    g.totalEarned = (save.totalEarned || 0) * oldWon;
    g.totalTons = save.totalTons || 0;
    g.deliveries = save.deliveries || 0;
    g.onTimeCount = save.onTimeCount || 0;
    g.lateCount = save.lateCount || 0;
    g.endless = save.endless || 0;
    g.endlessPts = save.endlessPts || 0;
    g.flags = save.flags || {};
    g.towCount = save.towCount || 0;
    for (const id of save.projects || []) {
      const p = g.projById.get(id);
      if (p) { p.built = true; for (const r of p.roads) r.built = true; }
    }
    for (const [id, lanes] of save.lanes || []) if (g.net.roads[id]) g.net.setLanes(g.net.roads[id], lanes);
    for (const [id, control, ringLanes] of save.controls || []) {
      const n = g.net.nodes[id];
      if (!n) continue;
      n.ringLanes = ringLanes || 1;
      g.traffic.setControl(n, control);
    }
    for (const [id, sign] of save.signs || []) if (g.net.edges[id]) g.net.edges[id].sign = sign;
    for (const [id, level] of save.ferries || []) {
      const fy = g.net.roads[id] && g.net.roads[id].ferryObj;
      if (fy) { fy.level = level; fy.cap += level * 10; }
    }
    g.applyStage(save.stage, true);
    for (const rec of save.sites || []) {
      const s = g.siteById.get(rec.id);
      if (!s) continue;
      if (!s.available) { s.available = true; }
      s.level = rec.lv; s.bays = rec.b; s.stock = rec.st; if (rec.inb) s.inBuf = rec.inb;
      s.growth = rec.gr || 0; s.cityStage = rec.cs || 0; s.delivered = rec.d || 0;
    }
    g.refreshRoutes();
    for (const rec of save.routes || []) {
      const r = g.routes.get(rec.id);
      if (!r) {
        const [a, b] = rec.id.split('>');
        const sa = g.siteById.get(a), sb = g.siteById.get(b);
        if (!sa || !sb) continue;
        g.ensureRoute(sa, sb);
      }
    }
    g.recomputePaths();
    for (const rec of save.routes || []) {
      const r = g.routes.get(rec.id);
      if (!r || !r.valid) continue;
      r.earned = (rec.e || 0) * oldWon; r.delivered = rec.d || 0; r.auto = !!rec.a; r.model = rec.sel || 0;
      rec.m.forEach((modelIdx, i) => {
        const v = g.addTruck(r, modelIdx, oldWon > 1 ? TRUCKS[modelIdx].price : (rec.p ? rec.p[i] : 0));
        // 도로에 고르게 흩어 놓아 불러오자마자 한꺼번에 몰리지 않게 한다
        const leg = Math.random() < 0.5 ? 1 : 0;
        const path = leg === 1 ? r.pathTo : r.pathBack;
        const idx = Math.floor(Math.random() * path.length);
        v.path = path;
        v.leg = leg;
        if (leg === 1) {
          v.cargo = v.model.cap;
          v.goods = r.goods;
          v.tripStart = g.time;
          v.expected = r.freeTime * 2 + 10;
        }
        if (g.traffic.placeMidway(v, idx, Math.random())) {
          r.from.yard.splice(r.from.yard.indexOf(v), 1);
          g.dropLot(v);
          v.legStart = g.time;
        } else {
          v.leg = 0; v.path = r.pathBack; v.cargo = 0; v.goods = null;
        }
      });
    }
    g.applySpeedTech();
    return g;
  }

  // 자리 비운 시간만큼 수익 정산
  applyOffline(seconds) {
    const capped = Math.min(seconds, 8 * 3600);
    const share = 0.5 + this.perk('offline') * 0.1;
    const earned = this.income * capped * share;
    this.money += earned;
    this.totalEarned += earned;
    return { seconds: capped, earned, share };
  }
}
