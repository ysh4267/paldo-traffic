// 게임 상태와 규칙. DOM이 없어 Node에서도 돌아간다 (밸런스 봇이 같은 코드를 쓴다).
import { Network, shortestTree, extractPath, pathLength, MAX_LANES, BASE_LANES } from '../sim/network.js';
import { Traffic } from '../sim/traffic.js';
import {
  GOODS, TIER_WEIGHT, BASE_RATE, TRUCKS, REGION_GOAL, ENDLESS_GOAL_BASE, TECHS, UPGRADES, TOOL_PRICE,
  LANE_PRICE_PER_KM, PROJECT_PRICE_PER_KM, REGION_SCALE, CITY_ACCEPTS, PORT_ACCEPTS, AIR_ACCEPTS, DOKDO_ACCEPTS, fmtWon,
} from './defs.js';

export const SAVE_VERSION = 1;
const ECON_DT = 0.05;
const TRUCK_K = 3.2;
const TRUCK_G = 1.085;
const CITY_STAGE_NEED = [0, 25, 110, 480, 2000, 9000];

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
  }
}

export class Game {
  constructor(data, opts = {}) {
    this.data = data;
    this.net = new Network(data);
    this.traffic = new Traffic(this.net, { arrive: (v) => this.onArrive(v) });
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
    this.money = opts.money ?? 62 * 10000;
    this.stage = 0;
    this.routes = new Map();
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
    const base = BASE_RATE[s.tier] * Math.pow(1.55, s.stage);
    return base * Math.pow(1.38, s.level);
  }
  siteCap(s) { return Math.max(24, this.siteRate(s) * 70); }
  inputCap(s) { return Math.max(30, this.siteRate(s) * 110); }

  upgradeCost(s) {
    if (!s.produces) return Infinity;
    const g = GOODS[s.goods];
    return g.price * 9 * (1 + s.stage * 0.45) * Math.pow(1.72, s.level) * Math.pow(1.55, s.stage);
  }
  bayCost(s) {
    const base = s.produces ? GOODS[s.goods].price : 12 * 10000;
    return base * 7 * Math.pow(2.4, s.bays - 1) * Math.pow(1.55, s.stage);
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
        const v = s.exitQ[0];
        if (v.retire) { s.exitQ.shift(); this.removeTruck(v); continue; }
        const first = v.path[0];
        if (!this.traffic.inject(v, first, 0)) break;
        s.exitQ.shift();
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
    v.tripStart = this.time;
    v.expected = (r.freeTime / v.model.speed / (1 + this.upg.speed * 0.05)) * 1.45 + 5;
    v.state = 'queue';
    s.exitQ.push(v);
  }

  finishUnload(s, v) {
    this.payDelivery(s, v);
    const r = v.route;
    v.leg = 0;
    v.cargo = 0;
    v.goods = null;
    v.path = this.pathFor(r, 0);
    v.state = 'queue';
    s.exitQ.push(v);
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

  // 트럭이 경로 끝(거점)에 도착
  onArrive(v) {
    const r = v.route;
    if (v.retire) { this.removeTruckFromSim(v); return true; }
    const bayF = 1 - this.upg.bay * 0.08;
    if (v.leg === 1) {
      const s = r.to;
      if (s.unloadBays.length >= s.bays) return false;
      v.state = 'bay';
      s.unloadBays.push({ v, t: 0, T: v.model.load * bayF });
      return true;
    }
    const s = r.from;
    v.state = 'queue';
    v.yardT = 0;
    s.yard.push(v);
    return true;
  }

  payDelivery(s, v) {
    const g = GOODS[v.goods];
    const r = v.route;
    const tons = v.cargo;
    let mult = 1 + this.upg.pay * 0.14;
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

    const weight = TIER_WEIGHT[g.tier];
    const pts = tons * weight;
    const reg = this.regions[s.region];
    reg.pts += pts;
    if (this.allUnlocked && this.progress() >= 1) this.endlessPts += pts;
    if (s.isCity) this.growCity(s, pts);
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
      const g = GOODS[r.goods];
      r.perTon = g.price * (0.55 + r.dist / 55);
    }
  }

  truckPrice(route, modelIdx) {
    const m = TRUCKS[modelIdx];
    const count = route.trucks.length;
    return route.perTon * m.priceF * TRUCK_K * Math.pow(TRUCK_G, count);
  }

  // n대를 한꺼번에 살 때 값 (대수에 따라 값이 오른다)
  truckBatchPrice(route, modelIdx, n) {
    const first = this.truckPrice(route, modelIdx);
    return first * ((Math.pow(TRUCK_G, n) - 1) / (TRUCK_G - 1));
  }
  // 지금 돈으로 살 수 있는 최대 대수 (최소 1)
  truckAffordable(route, modelIdx, limit = 200) {
    let n = 0;
    let price = this.truckPrice(route, modelIdx);
    let money = this.money;
    while (n < limit && money >= price) { money -= price; price *= TRUCK_G; n++; }
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
    v.modelIdx = modelIdx;
    v.price = price;
    v.leg = 0;
    v.path = route.pathBack;
    v.state = 'queue';
    v.yardT = 0;
    route.trucks.push(v);
    route.from.yard.push(v);
    route.opened = true;
    return v;
  }

  sellTruck(route) {
    if (!route.trucks.length) return false;
    // 대기장에 있는 트럭부터
    const s = route.from;
    let v = s.yard.slice().reverse().find((q) => q.route === route);
    if (v) {
      s.yard.splice(s.yard.indexOf(v), 1);
      this.money += (v.price || 0) * 0.5;
      this.removeTruck(v);
      return true;
    }
    v = route.trucks.slice().reverse().find((q) => !q.retire);
    if (!v) return false;
    v.retire = true;
    this.money += (v.price || 0) * 0.5;
    route.trucks.splice(route.trucks.indexOf(v), 1);
    return true;
  }

  removeTruck(v) {
    this.traffic.extract(v);
    this.traffic.vehicles.delete(v);
    const r = v.route;
    const i = r.trucks.indexOf(v);
    if (i >= 0) r.trucks.splice(i, 1);
  }
  removeTruckFromSim(v) {
    this.traffic.vehicles.delete(v);
    const r = v.route;
    const i = r.trucks.indexOf(v);
    if (i >= 0) r.trucks.splice(i, 1);
  }

  get truckCount() { return this.traffic.vehicles.size; }

  // ── 도구 가격과 적용 ───────────────────────────────────
  regionScale(region) { return Math.pow(REGION_SCALE, Math.min(region, this.regions.length - 1)); }

  lanePrice(road) {
    const per = LANE_PRICE_PER_KM[road.kind] || 0;
    const extra = road.lanes - BASE_LANES[road.kind] + 1;
    return Math.max(8 * 10000, per * road.len * extra * extra * this.regionScale(road.region));
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

  controlPrice(node, control) {
    const scale = this.regionScale(node.region);
    if (control === 'auto') return 0;
    return (TOOL_PRICE[control] || 0) * scale;
  }
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
    const c = TOOL_PRICE.ring2 * this.regionScale(node.region);
    if (this.money < c) return false;
    this.money -= c;
    node.ringLanes = 2;
    this.net.computeGeometry(node);
    for (const e of node.inE) for (const l of e.lanes) l.conns.clear();
    return true;
  }
  signPrice(edge, sign) {
    const node = this.net.nodes[edge.to];
    if (sign === 0) return 0;
    return (sign === 1 ? TOOL_PRICE.yield : TOOL_PRICE.stop) * this.regionScale(node.region);
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
    const per = PROJECT_PRICE_PER_KM[p.kind] || PROJECT_PRICE_PER_KM.bypass;
    return per * p.km * this.regionScale(p.stage);
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
    return 4000 * 10000 * Math.pow(2.2, fy.level || 0) * this.regionScale(Math.max(fy.road.stage, 1));
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

  // ── 구난 ──────────────────────────────────────────────
  towPrice(node) { return 15 * 10000 * this.regionScale(node.region); }
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
          v.state = 'queue';
          v.yardT = 0;
          v.route.from.yard.push(v);
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
    if (this.jamT % 2 === 0) this.updateJams();
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
      towCount: this.towCount,
      lanes, controls, signs,
      ferries: this.traffic.ferries.filter((f) => f.level).map((f) => [f.road.id, f.level]),
      projects: this.projects.filter((p) => p.built).map((p) => p.id),
      sites: this.sites.filter((s) => s.available).map((s) => ({
        id: s.id, lv: s.level, b: s.bays, st: s.stock, inb: s.inBuf, gr: s.growth, cs: s.cityStage, d: s.delivered,
      })),
      routes: [...this.routes.values()].filter((r) => r.trucks.length || r.earned || r.auto).map((r) => ({
        id: r.id, m: r.trucks.map((t) => t.modelIdx), p: r.trucks.map((t) => Math.round(t.price || 0)), e: r.earned, d: r.delivered, a: r.auto ? 1 : 0, sel: r.model,
      })),
    };
  }

  static restore(data, save) {
    const g = new Game(data);
    g.money = save.money;
    g.time = save.time;
    save.pts.forEach((p, i) => { if (g.regions[i]) g.regions[i].pts = p; });
    g.techs = new Set(save.techs);
    g.traffic.smartSignals = g.techs.has('smartsig');
    Object.assign(g.upg, save.upg);
    g.income = save.income || 0;
    g.totalEarned = save.totalEarned || 0;
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
      r.earned = rec.e || 0; r.delivered = rec.d || 0; r.auto = !!rec.a; r.model = rec.sel || 0;
      rec.m.forEach((modelIdx, i) => {
        const v = g.addTruck(r, modelIdx, rec.p ? rec.p[i] : 0);
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
    const earned = this.income * capped * 0.5;
    this.money += earned;
    this.totalEarned += earned;
    return { seconds: capped, earned };
  }
}
