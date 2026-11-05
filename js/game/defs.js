// 게임 수치 정의. 가격 단위는 원.

export const MAN = 10000;
export const EOK = 1e8;
export const JO = 1e12;

// tier: 1 원자재 ~ 5 초대형 완제품, price: 톤당 납품가(원)
// 원목·석회석·철광석·시멘트·목재는 실제 시세로는 트럭값을 벌 수 없어 3~20배 올렸고, 나머지는 실제 도매·수출 단가 수준이다.
// rate: 기본 생산량(t/s)을 따로 정할 때, weight: 납품 실적 점수를 따로 정할 때, growth: 도시 성장 배율
export const GOODS = {
  fruit: { name: '과일', tier: 1, price: 600 * MAN, color: '#e8452e' },
  grain: { name: '농산물', tier: 1, price: 300 * MAN, color: '#e6b31c' },
  fish: { name: '수산물', tier: 1, price: 650 * MAN, color: '#2e9bd6' },
  timber: { name: '원목', tier: 1, price: 60 * MAN, color: '#8a5a33' },
  stone: { name: '석회석', tier: 1, price: 40 * MAN, color: '#8f989e' },
  ore: { name: '철광석', tier: 1, price: 50 * MAN, color: '#b4553a' },
  crude: { name: '원유', tier: 1, price: 75 * MAN, color: '#3e3a4a' },
  food: { name: '가공식품', tier: 2, price: 800 * MAN, color: '#f08a1d' },
  cement: { name: '시멘트', tier: 2, price: 80 * MAN, growth: 5, color: '#6f7c85' },
  lumber: { name: '목재', tier: 2, price: 150 * MAN, color: '#c08a4a' },
  steel: { name: '철강', tier: 2, price: 90 * MAN, color: '#3f6e9e' },
  chem: { name: '화학소재', tier: 2, price: 150 * MAN, color: '#9a4fc4' },
  furniture: { name: '가구', tier: 3, price: 1200 * MAN, color: '#a8612a' },
  parts: { name: '기계부품', tier: 3, price: 1800 * MAN, color: '#2350a8' },
  appliance: { name: '가전', tier: 4, price: 2500 * MAN, color: '#12a36e' },
  car: { name: '자동차', tier: 4, price: 3000 * MAN, color: '#d6336c' },
  ship: { name: '선박 블록', tier: 5, price: 1000 * MAN, color: '#0f7c8f' },
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
// 트럭 4종. price: 첫 대 가격, load: 상하차 시간(초), acc: 빈 차의 출발 가속, brk: 평소 브레이크 (km/s²)
export const TRUCKS = [
  { id: 'hauler', name: '1톤 용달', short: '1톤', cap: 1, speed: 1, len: 0.72, price: 2200 * MAN, load: 0.9, width: 0.2, acc: 3.4, brk: 4.6, tech: null, desc: '싸고 작습니다. 기본 트럭' },
  { id: 'cargo', name: '5톤 카고', short: '5톤', cap: 5, speed: 0.96, len: 1.02, price: 7500 * MAN, load: 1.3, width: 0.24, acc: 2.8, brk: 4.2, tech: 'cargo5', desc: '같은 물량을 적은 대수로 나릅니다' },
  { id: 'trailer', name: '25톤 트레일러', short: '25톤', cap: 25, speed: 0.82, len: 1.8, price: 2.8 * EOK, load: 2.2, width: 0.27, acc: 1.9, brk: 3.6, tech: 'trailer', desc: '가장 많이 싣지만 길고 느립니다' },
  { id: 'express', name: '특송 윙바디', short: '특송', cap: 8, speed: 1.4, len: 0.98, price: 1.5 * EOK, load: 0.9, width: 0.24, acc: 3.6, brk: 4.8, tech: 'express', onTime: 1.15, desc: '빠르고 정시 도착에 강합니다' },
];

// 권역별 진행 목표 (납품 실적 점수)
export const REGION_GOAL = [200, 620, 1700, 3850, 8500, 10800, 24600, 54000, 154000];
export const ENDLESS_GOAL_BASE = 620000;

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
  { id: 'ring2', name: '2차로 회전교차로', icon: 'roundabout2', cost: 6000 * EOK, stage: 6, at: 0, desc: '회전교차로의 원형 차로를 두 줄로 늘립니다.' },
  { id: 'autotow', name: '자동 구난', icon: 'tow', cost: 1 * JO, stage: 6, at: 0.3, desc: '교착이 오래가면 구난차가 알아서 출동합니다.' },
];

// 단계형 연구
export const UPGRADES = [
  { id: 'pay', name: '납품가 협상', icon: 'money', base: 1.2 * EOK, mult: 2.6, max: 16, per: 0.14, fmt: (v) => `납품가 +${Math.round(v * 100)}%`, desc: '모든 납품 대금이 늘어납니다.' },
  { id: 'speed', name: '엔진 튜닝', icon: 'engine', base: 3 * EOK, mult: 3.4, max: 10, per: 0.05, fmt: (v) => `속도 +${Math.round(v * 100)}%`, desc: '트럭이 더 빨리 달립니다. 교차로도 더 자주 만납니다.' },
  { id: 'cap', name: '적재 최적화', icon: 'crate', base: 5 * EOK, mult: 3.4, max: 10, per: 0.1, fmt: (v) => `적재량 +${Math.round(v * 100)}%`, desc: '같은 트럭에 더 많이 싣습니다.' },
  { id: 'bay', name: '상하차 자동화', icon: 'forklift', base: 4 * EOK, mult: 3.2, max: 10, per: 0.08, fmt: (v) => `상하차 시간 −${Math.round(v * 100)}%`, desc: '상하차장에서 머무는 시간이 줄어듭니다.' },
  { id: 'lot', name: '주차 유도 시스템', icon: 'parking', base: 2 * EOK, mult: 3.2, max: 10, per: 0.05, fmt: (v) => `입출차 시간 −${Math.round(v * 100)}%`, desc: '거점 주차장을 드나드는 시간이 줄어듭니다. 나갈 차례를 기다리는 시간도 함께 줄어듭니다.' },
  { id: 'ontime', name: '정시 배송 관리', icon: 'clock', base: 10 * EOK, mult: 3.2, max: 10, per: 0.04, fmt: (v) => `정시 보너스 +${Math.round(v * 100)}%`, desc: '제시간 도착 시 받는 보너스가 커집니다.' },
];

// 환생은 언제든 할 수 있다. 이번 회차에 번 돈의 제곱근에 비례해 명성을 얻고, 연 권역 수만큼 더 받는다
// FAME_REF를 벌면 명성 FAME_BASE. 봇 기준으로 모든 권역을 여는 약 3시간에 ₩7조, 전국을 완성하면 ₩70조(명성 63)쯤 번다
export const FAME_BASE = 20;
export const FAME_REF = 7 * JO;
const fmtTimes = (v) => `×${v >= 100 ? fmtKo(v) : v.toFixed(2).replace(/\.?0+$/, '')}`;
const supplyOff = (n) => Math.round((1 - 1 / (1 + n * 0.04)) * 1000) / 10;
// 명성 보너스. now는 산 즉시 듣고, 나머지는 다음 회차를 시작할 때 듣는다. 값은 base × grow^단계
// endless는 최고 단계가 없다. 수가 끝없이 커져도 게임이 망가지지 않는 효과만 넣는다 (속도는 교차로 판정이 깨지므로 뺐다)
export const PERKS = [
  { id: 'brand', name: '국민 브랜드', icon: 'won', now: true, endless: true, base: 3, grow: 1.15, max: Infinity, to: (n) => fmtTimes(Math.pow(1.05, n)), fmt: (n) => `납품 대금 ${fmtTimes(Math.pow(1.05, n))}`, desc: '단계마다 모든 납품 대금에 1.05배가 곱해집니다.' },
  { id: 'network', name: '국가 물류망', icon: 'nav', now: true, endless: true, base: 3, grow: 1.15, max: Infinity, to: (n) => fmtTimes(Math.pow(1.05, n)), fmt: (n) => `납품 실적 ${fmtTimes(Math.pow(1.05, n))}`, desc: '단계마다 납품 실적에 1.05배가 곱해져 권역이 빨리 열립니다.' },
  { id: 'load', name: '경량 적재함', icon: 'crate', now: true, endless: true, base: 4, grow: 1.17, max: Infinity, to: (n) => `+${n * 5}%`, fmt: (n) => `적재량 +${n * 5}%`, desc: '같은 물량을 적은 대수로 날라 도로가 덜 막힙니다.' },
  { id: 'supply', name: '장기 공급 계약', icon: 'truck_trailer', now: true, endless: true, base: 3, grow: 1.15, max: Infinity, to: (n) => `−${supplyOff(n)}%`, fmt: (n) => `트럭값과 공사비 −${supplyOff(n)}%`, desc: '단계가 오를수록 트럭, 교통 시설, 도로 공사가 모두 싸집니다. 0원이 되지는 않습니다.' },
  { id: 'hall', name: '명예의 전당', icon: 'star', now: true, endless: true, base: 6, grow: 1.2, max: Infinity, to: (n) => `+${n * 5}%`, fmt: (n) => `환생 때 얻는 명성 +${n * 5}%`, desc: '번 돈과 연 권역으로 받는 명성이 모두 늘어납니다.' },
  { id: 'pay', name: '단골 화주', icon: 'won', now: true, base: 2, grow: 1.35, max: 30, to: (n) => `+${n * 10}%`, fmt: (n) => `납품 대금 +${n * 10}%`, desc: '거래처가 늘어 모든 납품 대금이 오릅니다.' },
  { id: 'pts', name: '물류 인증', icon: 'star', now: true, base: 3, grow: 1.4, max: 20, to: (n) => `+${n * 10}%`, fmt: (n) => `납품 실적 +${n * 10}%`, desc: '납품 실적이 더 크게 쌓여 권역이 빨리 열립니다.' },
  { id: 'rate', name: '협력 공장', icon: 'forklift', now: true, base: 3, grow: 1.4, max: 20, to: (n) => `+${n * 5}%`, fmt: (n) => `모든 거점 생산 +${n * 5}%`, desc: '물량이 늘어 나를 트럭이 더 필요해집니다.' },
  { id: 'truck', name: '대량 구매 계약', icon: 'truck_cargo', now: true, base: 2, grow: 1.35, max: 15, to: (n) => `−${n * 3}%`, fmt: (n) => `트럭값 −${n * 3}%`, desc: '모든 차종을 싸게 사고, 차종을 바꿀 때도 덜 듭니다.' },
  { id: 'build', name: '공사 협약', icon: 'bridge', now: true, base: 2, grow: 1.35, max: 15, to: (n) => `−${n * 4}%`, fmt: (n) => `교통 시설과 도로 공사 −${n * 4}%`, desc: '표지, 신호등, 회전교차로, 입체교차로, 차로, 대교, 카페리가 모두 싸집니다.' },
  { id: 'offline', name: '야간 운행', icon: 'clock', now: true, base: 2, grow: 1.6, max: 5, to: (n) => `${50 + n * 10}%`, fmt: (n) => `자리 비운 동안 평소 수익의 ${50 + n * 10}%`, desc: '게임을 꺼 둔 동안 들어오는 돈이 늘어납니다.' },
  { id: 'fame', name: '업계 평판', icon: 'star', now: true, base: 5, grow: 1.5, max: 10, to: (n) => `+${n * 10}%`, fmt: (n) => `환생 때 얻는 명성 +${n * 10}%`, desc: '이 보너스를 먼저 사 두면 환생할 때마다 명성을 더 받습니다.' },
  { id: 'seed', name: '창업 자금', icon: 'money', base: 1, grow: 1.6, max: 12, to: (n) => fmtWon(START_MONEY * Math.pow(2, n)), fmt: (n) => `시작 자금 ${fmtWon(START_MONEY * Math.pow(2, n))}`, desc: '단계마다 시작 자금이 두 배가 됩니다.' },
  { id: 'tech', name: '기술 이전', icon: 'research', base: 2, grow: 1.3, max: TECHS.length, to: (n) => TECHS[n - 1].name, fmt: (n) => `처음부터 ${TECHS[Math.min(n, TECHS.length) - 1].name}까지 연구 완료`, desc: '연구 목록의 앞에서부터 차례로 처음부터 쓸 수 있습니다.' },
  { id: 'study', name: '연구 유산', icon: 'engine', base: 5, grow: 1.7, max: 5, to: (n) => `${n}단계`, fmt: (n) => `꾸준히 강해지는 연구 ${n}단계로 시작`, desc: '납품가, 속도, 적재, 상하차, 입출차, 정시 연구가 이 단계에서 시작합니다.' },
  { id: 'roads', name: '도로 유산', icon: 'bypass', base: 30, grow: 1, max: 1, to: () => '', fmt: () => '환생해도 교차로, 차로, 표지, 대교 유지', desc: '이번 회차에 깐 교통 시설과 도로가 다음 회차에도 그대로 남습니다.' },
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
