// 게임 수치 정의. 가격 단위는 원.

export const MAN = 10000;
export const EOK = 1e8;
export const JO = 1e12;

// tier: 1 원자재 ~ 5 초대형 완제품, price: 톤당 납품가(원)
// 원목·석회석·철광석·시멘트·목재는 실제 시세로는 트럭값을 벌 수 없어 3~20배 올렸고, 나머지는 실제 도매·수출 단가 수준이다.
// rate: 기본 생산량(t/s)을 따로 정할 때, weight: 납품 실적 점수를 따로 정할 때, growth: 도시 성장 배율
export const GOODS = {
  fruit: { name: '과일', tier: 1, price: 600 * MAN, color: '#e8553f' },
  grain: { name: '농산물', tier: 1, price: 300 * MAN, color: '#dba520' },
  fish: { name: '수산물', tier: 1, price: 650 * MAN, color: '#1fa3b8' },
  timber: { name: '원목', tier: 1, price: 60 * MAN, color: '#94633a' },
  stone: { name: '석회석', tier: 1, price: 40 * MAN, color: '#98a1a8' },
  ore: { name: '철광석', tier: 1, price: 50 * MAN, color: '#b5573a' },
  crude: { name: '원유', tier: 1, price: 75 * MAN, color: '#4a4458' },
  food: { name: '가공식품', tier: 2, price: 800 * MAN, color: '#f08a24' },
  cement: { name: '시멘트', tier: 2, price: 80 * MAN, growth: 5, color: '#7f8c96' },
  lumber: { name: '목재', tier: 2, price: 150 * MAN, color: '#c98b4a' },
  steel: { name: '철강', tier: 2, price: 90 * MAN, color: '#5b7a99' },
  chem: { name: '화학소재', tier: 2, price: 150 * MAN, color: '#8e5bc2' },
  furniture: { name: '가구', tier: 3, price: 1200 * MAN, color: '#b5651d' },
  parts: { name: '기계부품', tier: 3, price: 1800 * MAN, color: '#3f6fb5' },
  appliance: { name: '가전', tier: 4, price: 2500 * MAN, color: '#17a673' },
  car: { name: '자동차', tier: 4, price: 3000 * MAN, color: '#d43f5e' },
  ship: { name: '선박 블록', tier: 5, price: 1000 * MAN, color: '#1f5fa8' },
  chip: { name: '반도체', tier: 5, price: 10 * EOK, rate: 0.014, weight: 100, color: '#00b3a4' },
};
export const TIER_NAME = ['', '원자재', '소재', '부품·가공', '완제품', '초대형 완제품'];
export const TIER_WEIGHT = [0, 1, 2, 4, 8, 16];

export const CITY_ACCEPTS = ['food', 'cement', 'lumber', 'furniture', 'appliance', 'car'];
export const PORT_ACCEPTS = ['steel', 'chem', 'parts', 'appliance', 'car', 'ship', 'chip'];
export const AIR_ACCEPTS = ['chip', 'appliance'];
export const DOKDO_ACCEPTS = ['food'];

// 거점 종류별 기본 생산량 t/s
export const BASE_RATE = { 1: 0.26, 2: 0.3, 3: 0.24, 4: 0.22, 5: 0.2 };
// 생산 증설 1단계 기준 비용. 권역이 뒤로 갈수록, 레벨이 오를수록 커진다.
export const EXPAND_COST = {
  fruit: 5000 * MAN, grain: 3000 * MAN, fish: 5000 * MAN, timber: 1500 * MAN, stone: 5000 * MAN, ore: 1.5 * EOK, crude: 3 * EOK,
  food: 1 * EOK, cement: 3 * EOK, lumber: 5000 * MAN, steel: 8 * EOK, chem: 12 * EOK,
  furniture: 1.5 * EOK, parts: 3 * EOK, appliance: 5 * EOK, car: 8 * EOK, ship: 10 * EOK, chip: 100 * EOK,
};
// 상하차장 한 칸 기준 비용. 0: 생산하지 않는 곳, 1~5: 화물 등급
export const BAY_COST = [1 * EOK, 0.6 * EOK, 1.2 * EOK, 2 * EOK, 3 * EOK, 5 * EOK];
export const SITE_KIND_NAME = {
  orchard: '과수원', field: '농경지', forest: '산림', quarry: '광산', sea: '어항', salt: '염전',
  foodplant: '식품공장', sawmill: '제재소', furniture: '가구공장', cementplant: '시멘트공장',
  steelmill: '제철소', chemplant: '석유화학단지', partsplant: '부품공장', appliance: '가전공장',
  carplant: '자동차공장', fab: '반도체공장', shipyard: '조선소', port: '항만', city: '도시', dokdo: '독도',
};

export const START_MONEY = 5000 * MAN;
// 같은 노선에 한 대 늘 때마다 차고지와 기사 채용비로 오르는 비율
export const TRUCK_STEP = 0.03;
// 트럭 4종. price: 첫 대 가격, load: 상하차 시간(초)
export const TRUCKS = [
  { id: 'hauler', name: '1톤 용달', short: '1톤', cap: 1, speed: 1, len: 0.72, price: 2200 * MAN, load: 1.3, width: 0.2, tech: null, desc: '싸고 작습니다. 기본 트럭' },
  { id: 'cargo', name: '5톤 카고', short: '5톤', cap: 5, speed: 0.96, len: 1.02, price: 7500 * MAN, load: 1.9, width: 0.24, tech: 'cargo5', desc: '같은 물량을 적은 대수로 나릅니다' },
  { id: 'trailer', name: '25톤 트레일러', short: '25톤', cap: 25, speed: 0.82, len: 1.8, price: 2.8 * EOK, load: 3, width: 0.27, tech: 'trailer', desc: '가장 많이 싣지만 길고 느립니다' },
  { id: 'express', name: '특송 윙바디', short: '특송', cap: 8, speed: 1.4, len: 0.98, price: 1.5 * EOK, load: 1.3, width: 0.24, tech: 'express', onTime: 1.15, desc: '빠르고 정시 도착에 강합니다' },
];

// 권역별 진행 목표 (납품 실적 점수)
export const REGION_GOAL = [260, 800, 2200, 5000, 11000, 14000, 32000, 70000, 200000];
export const ENDLESS_GOAL_BASE = 800000;

// 일회성 연구
export const TECHS = [
  { id: 'signal', name: '신호등', icon: 't_signal', cost: 8000 * MAN, stage: 0, at: 0.08, desc: '교차로에 신호등을 설치합니다. 몰리는 교차로의 처리량이 크게 늘어납니다.' },
  { id: 'tow', name: '구난 계약', icon: 'tow', cost: 4 * EOK, stage: 0, at: 0.6, desc: '오래 막힌 교차로에 구난차를 불러 맨 앞 트럭을 빼낼 수 있습니다.' },
  { id: 'roundabout', name: '회전교차로', icon: 't_roundabout', cost: 8 * EOK, stage: 1, at: 0, desc: '멈추지 않고 합류하는 회전교차로를 놓습니다. 교통량이 적당한 곳에 좋습니다.' },
  { id: 'cargo5', name: '5톤 카고', icon: 'truck_cargo', cost: 15 * EOK, stage: 1, at: 0.3, desc: '5톤 트럭을 구매합니다. 같은 물량을 훨씬 적은 대수로 옮깁니다.' },
  { id: 'smartsig', name: '감응 신호', icon: 'smartsig', cost: 50 * EOK, stage: 2, at: 0, desc: '신호등이 대기열을 보고 현시를 연장하거나 일찍 끊습니다.' },
  { id: 'interchange', name: '입체교차로', icon: 't_interchange', cost: 200 * EOK, stage: 3, at: 0, desc: '교차 흐름을 입체로 분리합니다. 값비싸지만 합류 외 충돌이 사라집니다.' },
  { id: 'trailer', name: '25톤 트레일러', icon: 'truck_trailer', cost: 300 * EOK, stage: 3, at: 0.4, desc: '한 번에 25톤을 나릅니다. 길이가 길어 교차로를 오래 차지합니다.' },
  { id: 'nav', name: '실시간 내비', icon: 'nav', cost: 800 * EOK, stage: 4, at: 0, desc: '출발하는 트럭이 정체를 피해 더 빠른 길을 고릅니다.' },
  { id: 'express', name: '특송 윙바디', icon: 'truck_express', cost: 1500 * EOK, stage: 4, at: 0.5, desc: '40% 빠르고 정시 보너스를 더 받는 특송 트럭입니다.' },
  { id: 'autobuy', name: '자동 배차', icon: 'auto', cost: 3000 * EOK, stage: 5, at: 0, desc: '화물이 쌓인 노선에 켜두면 자금이 넉넉할 때 트럭을 알아서 삽니다.' },
  { id: 'ring2', name: '2차로 회전교차로', icon: 'roundabout2', cost: 6000 * EOK, stage: 6, at: 0, desc: '회전교차로의 원형 차로를 두 줄로 늘립니다.' },
  { id: 'autotow', name: '자동 구난', icon: 'tow', cost: 1 * JO, stage: 6, at: 0.3, desc: '교착이 오래가면 구난차가 알아서 출동합니다.' },
];

// 단계형 연구
export const UPGRADES = [
  { id: 'pay', name: '납품가 협상', icon: 'money', base: 1.2 * EOK, mult: 2.6, max: 16, per: 0.14, fmt: (v) => `납품가 +${Math.round(v * 100)}%`, desc: '모든 납품 대금이 늘어납니다.' },
  { id: 'speed', name: '엔진 튜닝', icon: 'engine', base: 3 * EOK, mult: 3.4, max: 10, per: 0.05, fmt: (v) => `속도 +${Math.round(v * 100)}%`, desc: '트럭이 더 빨리 달립니다. 교차로도 더 자주 만납니다.' },
  { id: 'cap', name: '적재 최적화', icon: 'crate', base: 5 * EOK, mult: 3.4, max: 10, per: 0.1, fmt: (v) => `적재량 +${Math.round(v * 100)}%`, desc: '같은 트럭에 더 많이 싣습니다.' },
  { id: 'bay', name: '상하차 자동화', icon: 'forklift', base: 4 * EOK, mult: 3.2, max: 10, per: 0.08, fmt: (v) => `상하차 시간 −${Math.round(v * 100)}%`, desc: '상하차장에서 머무는 시간이 줄어듭니다.' },
  { id: 'ontime', name: '정시 배송 관리', icon: 'clock', base: 10 * EOK, mult: 3.2, max: 10, per: 0.04, fmt: (v) => `정시 보너스 +${Math.round(v * 100)}%`, desc: '제시간 도착 시 받는 보너스가 커집니다.' },
];

// 교통 시설 설치비. 신호등·회전교차로·입체교차로·도로 확장은 실제 공사비 수준이다.
export const TOOL_PRICE = {
  yield: 300 * MAN,
  stop: 200 * MAN,
  signal: 7300 * MAN,
  roundabout: 3.5 * EOK,
  interchange: 500 * EOK,
  ring2: 10 * EOK,
};
// 차로 추가 1km당 비용
export const LANE_PRICE_PER_KM = { x: 50 * EOK, n: 15 * EOK, r: 8 * EOK, s: 3 * EOK };
export const LANE_PRICE_MIN = 3 * EOK;
// 토지 보상비 배율. 충북·충남·경북·전북·전남·제주·경남·강원·수도권 순서
export const LAND_FACTOR = [1, 1.2, 1.2, 1, 1.1, 1.3, 1.5, 1.4, 3];
// 우회도로·대교의 실제 총사업비. est: 사업비를 찾지 못해 길이와 비슷한 노선으로 추정한 값
export const PROJECT_COST = {
  b_seohae: { cost: 6700 * EOK },
  b_incheon: { cost: 2.383 * JO },
  b_yisunsin: { cost: 1.07 * JO },
  b_geoga: { cost: 1.983 * JO },
  r_ring1: { cost: 3 * JO, est: true },
  r_ring2: { cost: 10 * JO, est: true },
  r_sejongpocheon: { cost: 10 * JO },
  r_seoulyangyang: { cost: 2.366 * JO },
  r_pyeongtaekjecheon: { cost: 2.5 * JO, est: true },
  r_sangjuyeongcheon: { cost: 2.146 * JO },
  r_busanouter: { cost: 2.333 * JO },
  r_hamyangulsan: { cost: 7.455 * JO },
  r_sunchenwanju: { cost: 2.248 * JO },
  r_saemangeum: { cost: 2.9 * JO },
};
export const FERRY_PRICE = 680 * EOK;
export const TOW_PRICE = 80 * MAN;

// 큰 수 표기 (한국식 만·억·조·경)
const UNITS = [[1e24, '자'], [1e20, '해'], [1e16, '경'], [1e12, '조'], [1e8, '억'], [1e4, '만']];
export function fmtKo(n, digits = 3) {
  const neg = n < 0;
  const v = Math.abs(n);
  for (const [u, name] of UNITS) {
    if (v >= u) {
      const q = v / u;
      const s = q >= 1000 ? Math.round(q).toLocaleString('en-US')
        : q >= 100 ? q.toFixed(Math.max(0, digits - 3))
        : q >= 10 ? q.toFixed(Math.max(0, digits - 2))
        : q.toFixed(Math.max(0, digits - 1));
      return (neg ? '-' : '') + s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1') + name;
    }
  }
  return (neg ? '-' : '') + Math.round(v).toLocaleString('en-US');
}
export const fmtWon = (n, d) => '₩' + fmtKo(n, d);

// 받침에 맞는 조사 (이/가, 은/는, 을/를)
export function josa(word, withFinal, withoutFinal) {
  const code = word.charCodeAt(word.length - 1);
  const hasFinal = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 > 0;
  return word + (hasFinal ? withFinal : withoutFinal);
}
export function fmtTon(n) {
  if (n >= 1e4) return fmtKo(n) + 't';
  if (n >= 100) return Math.round(n).toLocaleString('en-US') + 't';
  if (n >= 10) return n.toFixed(1).replace(/\.0$/, '') + 't';
  return n.toFixed(1).replace(/\.0$/, '') + 't';
}
export function fmtTime(sec) {
  sec = Math.floor(sec);
  if (sec < 60) return `${sec}초`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
  return `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분`;
}
