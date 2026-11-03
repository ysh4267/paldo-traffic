// 권역·거점 큐레이션 데이터. 실제 지역 특산물·산업 입지를 기준으로 고른 목록이며 좌표는 대략값이다.
// k: 거점 종류(아이콘), g: 생산 화물, in: 원료 슬롯(슬롯 안의 화물은 택일), a: 받아주는 화물 추가 지정
// stage: 해금되는 권역 순서 (생략하면 해당 권역 해금 시)

export const REGIONS = [
  { id: 'cb', name: '충청북도', short: '충북', provinces: ['충청북도'] },
  { id: 'cn', name: '충청남도·대전·세종', short: '충남', provinces: ['충청남도', '대전광역시', '세종특별자치시'] },
  { id: 'gb', name: '경상북도·대구', short: '경북', provinces: ['경상북도', '대구광역시'] },
  { id: 'jb', name: '전북특별자치도', short: '전북', provinces: ['전라북도'] },
  { id: 'jn', name: '전라남도·광주', short: '전남', provinces: ['전라남도', '광주광역시'] },
  { id: 'jj', name: '제주특별자치도', short: '제주', provinces: ['제주특별자치도'] },
  { id: 'gn', name: '경상남도·부산·울산', short: '경남', provinces: ['경상남도', '부산광역시', '울산광역시'] },
  { id: 'gw', name: '강원특별자치도', short: '강원', provinces: ['강원도'] },
  { id: 'sd', name: '수도권', short: '수도권', provinces: ['서울특별시', '인천광역시', '경기도'] },
];

const FOOD_IN = [['fruit', 'grain', 'fish']];

// [id, 이름, 권역, 종류, 위도, 경도, 추가옵션]
const P = (id, name, r, k, lat, lon, g, extra = {}) => ({ id, name, r, k, lat, lon, g, ...extra });
const F = (id, name, r, k, lat, lon, g, input, extra = {}) => ({ id, name, r, k, lat, lon, g, in: input, ...extra });
// 도시: pop 만명
const C = (id, name, r, lat, lon, pop) => ({ id, name, r, k: 'city', lat, lon, pop });
// 항만: g 수입 원자재(없으면 수출 전용)
const Port = (id, name, r, lat, lon, g, extra = {}) => ({ id, name, r, k: 'port', lat, lon, g, ...extra });

export const SITES = [
  // ── 충북 ──────────────────────────────
  C('c_cheongju', '청주', 'cb', 36.642, 127.489, 85),
  C('c_chungju', '충주', 'cb', 36.991, 127.926, 21),
  C('c_jecheon', '제천', 'cb', 37.133, 128.191, 13),
  P('p_chungju_apple', '충주 사과밭', 'cb', 'orchard', 37.05, 127.84, 'fruit'),
  P('p_goesan_corn', '괴산 옥수수밭', 'cb', 'field', 36.78, 127.80, 'grain'),
  P('p_yeongdong_grape', '영동 포도밭', 'cb', 'orchard', 36.18, 127.80, 'fruit'),
  P('p_danyang_lime', '단양 석회석 광산', 'cb', 'quarry', 37.03, 128.40, 'stone'),
  F('f_eumseong_food', '음성 식품공장', 'cb', 'foodplant', 36.93, 127.68, 'food', FOOD_IN),
  F('f_danyang_cement', '단양 시멘트공장', 'cb', 'cementplant', 36.97, 128.32, 'cement', [['stone']]),

  // ── 충남·대전·세종 ──────────────────────
  C('c_daejeon', '대전', 'cn', 36.351, 127.385, 145),
  C('c_cheonan', '천안', 'cn', 36.815, 127.114, 66),
  C('c_sejong', '세종', 'cn', 36.48, 127.289, 39),
  C('c_seosan', '서산', 'cn', 36.785, 126.45, 17),
  C('c_gongju', '공주', 'cn', 36.446, 127.119, 10),
  P('p_dangjin_rice', '당진 쌀 평야', 'cn', 'field', 36.84, 126.62, 'grain'),
  P('p_nonsan_berry', '논산 딸기밭', 'cn', 'orchard', 36.20, 127.10, 'fruit'),
  P('p_geumsan_ginseng', '금산 인삼밭', 'cn', 'field', 36.10, 127.50, 'grain'),
  P('p_boryeong_fish', '보령 대천항', 'cn', 'sea', 36.33, 126.52, 'fish'),
  P('p_gongju_forest', '공주 산림', 'cn', 'forest', 36.38, 127.00, 'timber'),
  F('f_cheonan_food', '천안 식품공장', 'cn', 'foodplant', 36.86, 127.20, 'food', FOOD_IN),
  F('f_buyeo_saw', '부여 제재소', 'cn', 'sawmill', 36.27, 126.90, 'lumber', [['timber']]),
  F('f_daejeon_furn', '대전 가구공장', 'cn', 'furniture', 36.42, 127.43, 'furniture', [['lumber']]),
  Port('o_dangjin', '당진항', 'cn', 36.98, 126.68, 'ore'),
  F('f_dangjin_steel', '당진 제철소', 'cn', 'steelmill', 36.99, 126.78, 'steel', [['ore']]),
  F('f_asan_parts', '아산 부품공장', 'cn', 'partsplant', 36.74, 127.02, 'parts', [['steel']]),
  Port('o_daesan', '대산항', 'cn', 37.03, 126.34, 'crude', { stage: 4 }),
  F('f_daesan_chem', '대산 석유화학단지', 'cn', 'chemplant', 36.97, 126.40, 'chem', [['crude']], { stage: 4 }),
  F('f_asan_car', '아산 자동차공장', 'cn', 'carplant', 36.79, 126.94, 'car', [['parts'], ['chem']], { stage: 5 }),

  // ── 경북·대구 ───────────────────────────
  C('c_daegu', '대구', 'gb', 35.871, 128.601, 237),
  C('c_pohang', '포항', 'gb', 36.03, 129.33, 50),
  C('c_gumi', '구미', 'gb', 36.12, 128.30, 41),
  C('c_gyeongju', '경주', 'gb', 35.856, 129.225, 25),
  C('c_andong', '안동', 'gb', 36.568, 128.729, 15),
  P('p_cheongsong_apple', '청송 사과밭', 'gb', 'orchard', 36.43, 129.05, 'fruit'),
  P('p_uiseong_garlic', '의성 마늘밭', 'gb', 'field', 36.36, 128.68, 'grain'),
  P('p_seongju_melon', '성주 참외밭', 'gb', 'orchard', 35.92, 128.26, 'fruit'),
  P('p_bonghwa_pine', '봉화 춘양목 숲', 'gb', 'forest', 36.92, 128.90, 'timber'),
  P('p_guryongpo_fish', '구룡포항', 'gb', 'sea', 35.99, 129.55, 'fish'),
  F('f_andong_food', '안동 식품공장', 'gb', 'foodplant', 36.52, 128.78, 'food', FOOD_IN),
  F('f_yeongju_saw', '영주 제재소', 'gb', 'sawmill', 36.83, 128.60, 'lumber', [['timber']]),
  F('f_daegu_furn', '대구 가구공장', 'gb', 'furniture', 35.92, 128.47, 'furniture', [['lumber']]),
  Port('o_yeongil', '영일만항', 'gb', 36.11, 129.44, 'ore'),
  F('f_pohang_steel', '포항 제철소', 'gb', 'steelmill', 35.98, 129.39, 'steel', [['ore']]),
  F('f_gyeongju_parts', '경주 부품공장', 'gb', 'partsplant', 35.78, 129.28, 'parts', [['steel']]),
  F('f_gumi_appl', '구미 가전공장', 'gb', 'appliance', 36.13, 128.42, 'appliance', [['parts'], ['chem']], { stage: 4 }),

  // ── 전북 ───────────────────────────────
  C('c_jeonju', '전주', 'jb', 35.824, 127.148, 64),
  C('c_gunsan', '군산', 'jb', 35.968, 126.737, 26),
  C('c_iksan', '익산', 'jb', 35.948, 126.958, 27),
  C('c_namwon', '남원', 'jb', 35.416, 127.39, 8),
  P('p_gimje_rice', '김제 쌀 평야', 'jb', 'field', 35.80, 126.88, 'grain'),
  P('p_gochang_melon', '고창 수박밭', 'jb', 'orchard', 35.44, 126.70, 'fruit'),
  P('p_buan_fish', '부안 곰소항', 'jb', 'sea', 35.59, 126.58, 'fish'),
  P('p_muju_forest', '무주 덕유산 숲', 'jb', 'forest', 35.93, 127.68, 'timber'),
  F('f_iksan_food', '익산 식품공장', 'jb', 'foodplant', 36.01, 126.98, 'food', FOOD_IN),
  F('f_jangsu_saw', '장수 제재소', 'jb', 'sawmill', 35.65, 127.52, 'lumber', [['timber']]),
  F('f_wanju_furn', '완주 가구공장', 'jb', 'furniture', 35.90, 127.20, 'furniture', [['lumber']]),
  F('f_gunsan_parts', '군산 부품공장', 'jb', 'partsplant', 35.93, 126.62, 'parts', [['steel']]),
  Port('o_gunsan', '군산항', 'jb', 35.98, 126.60, null),
  F('f_jeonju_car', '전주 상용차공장', 'jb', 'carplant', 35.87, 127.06, 'car', [['parts'], ['chem']], { stage: 4 }),

  // ── 전남·광주 ───────────────────────────
  C('c_gwangju', '광주', 'jn', 35.16, 126.85, 143),
  C('c_yeosu', '여수', 'jn', 34.76, 127.66, 27),
  C('c_suncheon', '순천', 'jn', 34.95, 127.487, 28),
  C('c_mokpo', '목포', 'jn', 34.81, 126.392, 22),
  P('p_naju_pear', '나주 배밭', 'jn', 'orchard', 35.02, 126.73, 'fruit'),
  P('p_haenam_cabbage', '해남 배추밭', 'jn', 'field', 34.57, 126.60, 'grain'),
  P('p_boseong_tea', '보성 녹차밭', 'jn', 'orchard', 34.77, 127.08, 'fruit'),
  P('p_wando_fish', '완도 전복 양식장', 'jn', 'sea', 34.31, 126.76, 'fish'),
  P('p_sinan_salt', '신안 천일염전', 'jn', 'salt', 34.82, 126.20, 'fish'),
  P('p_damyang_bamboo', '담양 대나무숲', 'jn', 'forest', 35.32, 126.98, 'timber'),
  F('f_gwangju_food', '광주 식품공장', 'jn', 'foodplant', 35.20, 126.72, 'food', FOOD_IN),
  F('f_suncheon_saw', '순천 제재소', 'jn', 'sawmill', 34.99, 127.40, 'lumber', [['timber']]),
  Port('o_yeosu', '여수항', 'jn', 34.74, 127.75, 'crude'),
  F('f_yeosu_chem', '여수 석유화학단지', 'jn', 'chemplant', 34.84, 127.67, 'chem', [['crude']]),
  Port('o_gwangyang', '광양항', 'jn', 34.90, 127.68, 'ore'),
  F('f_gwangyang_steel', '광양 제철소', 'jn', 'steelmill', 34.93, 127.75, 'steel', [['ore']]),
  F('f_daebul_parts', '대불 부품공장', 'jn', 'partsplant', 34.76, 126.46, 'parts', [['steel']]),
  F('f_gwangju_appl', '광주 가전공장', 'jn', 'appliance', 35.21, 126.83, 'appliance', [['parts'], ['chem']]),
  F('f_gwangju_car', '광주 자동차공장', 'jn', 'carplant', 35.13, 126.79, 'car', [['parts'], ['chem']]),

  // ── 제주 ───────────────────────────────
  C('c_jeju', '제주', 'jj', 33.50, 126.53, 49),
  C('c_seogwipo', '서귀포', 'jj', 33.253, 126.56, 18),
  P('p_seogwipo_tangerine', '서귀포 감귤밭', 'jj', 'orchard', 33.30, 126.66, 'fruit'),
  P('p_gujwa_carrot', '구좌 당근밭', 'jj', 'field', 33.50, 126.82, 'grain'),
  P('p_hallim_fish', '한림항', 'jj', 'sea', 33.41, 126.26, 'fish'),
  F('f_jeju_food', '제주 식품공장', 'jj', 'foodplant', 33.46, 126.42, 'food', FOOD_IN),

  // ── 경남·부산·울산 ──────────────────────
  C('c_busan', '부산', 'gn', 35.18, 129.075, 330),
  C('c_ulsan', '울산', 'gn', 35.54, 129.31, 110),
  C('c_changwon', '창원', 'gn', 35.228, 128.681, 101),
  C('c_gimhae', '김해', 'gn', 35.228, 128.889, 53),
  C('c_jinju', '진주', 'gn', 35.18, 128.108, 34),
  P('p_namhae_garlic', '남해 마늘밭', 'gn', 'field', 34.82, 127.90, 'grain'),
  P('p_changnyeong_onion', '창녕 양파밭', 'gn', 'field', 35.53, 128.48, 'grain'),
  P('p_hadong_tea', '하동 녹차밭', 'gn', 'orchard', 35.12, 127.70, 'fruit'),
  P('p_tongyeong_oyster', '통영 굴 양식장', 'gn', 'sea', 34.84, 128.41, 'fish'),
  P('p_busan_fish', '부산 공동어시장', 'gn', 'sea', 35.08, 129.03, 'fish'),
  P('p_sancheong_forest', '산청 지리산 숲', 'gn', 'forest', 35.38, 127.82, 'timber'),
  F('f_gimhae_food', '김해 식품공장', 'gn', 'foodplant', 35.27, 128.82, 'food', FOOD_IN),
  F('f_hapcheon_saw', '합천 제재소', 'gn', 'sawmill', 35.57, 128.16, 'lumber', [['timber']]),
  F('f_yangsan_furn', '양산 가구공장', 'gn', 'furniture', 35.38, 129.05, 'furniture', [['lumber']]),
  F('f_changwon_parts', '창원 기계공장', 'gn', 'partsplant', 35.19, 128.62, 'parts', [['steel']]),
  F('f_changwon_appl', '창원 가전공장', 'gn', 'appliance', 35.24, 128.72, 'appliance', [['parts'], ['chem']]),
  Port('o_ulsan', '울산항', 'gn', 35.50, 129.40, 'crude'),
  F('f_ulsan_chem', '울산 석유화학단지', 'gn', 'chemplant', 35.46, 129.35, 'chem', [['crude']]),
  F('f_ulsan_car', '울산 자동차공장', 'gn', 'carplant', 35.55, 129.40, 'car', [['parts'], ['chem']]),
  F('f_geoje_ship', '거제 조선소', 'gn', 'shipyard', 34.88, 128.70, 'ship', [['steel'], ['parts']]),
  Port('o_busan', '부산신항', 'gn', 35.08, 128.80, null),

  // ── 강원 ───────────────────────────────
  C('c_wonju', '원주', 'gw', 37.342, 127.92, 36),
  C('c_chuncheon', '춘천', 'gw', 37.881, 127.73, 29),
  C('c_gangneung', '강릉', 'gw', 37.752, 128.876, 21),
  C('c_sokcho', '속초', 'gw', 38.207, 128.56, 8),
  P('p_pyeongchang_cabbage', '평창 고랭지 배추밭', 'gw', 'field', 37.63, 128.72, 'grain'),
  P('p_hongcheon_corn', '홍천 옥수수밭', 'gw', 'field', 37.70, 127.90, 'grain'),
  P('p_inje_birch', '인제 자작나무 숲', 'gw', 'forest', 38.03, 128.22, 'timber'),
  P('p_jeongseon_lime', '정선 석회석 광산', 'gw', 'quarry', 37.40, 128.70, 'stone'),
  P('p_sokcho_fish', '속초항', 'gw', 'sea', 38.20, 128.61, 'fish'),
  F('f_wonju_food', '원주 식품공장', 'gw', 'foodplant', 37.36, 127.98, 'food', FOOD_IN),
  F('f_gangneung_saw', '강릉 제재소', 'gw', 'sawmill', 37.71, 128.85, 'lumber', [['timber']]),
  F('f_chuncheon_furn', '춘천 가구공장', 'gw', 'furniture', 37.92, 127.75, 'furniture', [['lumber']]),
  F('f_samcheok_cement', '삼척 시멘트공장', 'gw', 'cementplant', 37.43, 129.16, 'cement', [['stone']]),
  Port('o_donghae', '동해항', 'gw', 37.49, 129.14, null),

  // ── 수도권 ─────────────────────────────
  C('c_seoul', '서울', 'sd', 37.566, 126.978, 940),
  C('c_incheon', '인천', 'sd', 37.456, 126.705, 300),
  C('c_suwon', '수원', 'sd', 37.264, 127.029, 120),
  C('c_seongnam', '성남', 'sd', 37.42, 127.127, 92),
  C('c_goyang', '고양', 'sd', 37.658, 126.832, 107),
  C('c_uijeongbu', '의정부', 'sd', 37.738, 127.034, 46),
  P('p_icheon_rice', '이천 쌀 평야', 'sd', 'field', 37.30, 127.40, 'grain'),
  P('p_yeoju_potato', '여주 고구마밭', 'sd', 'field', 37.28, 127.68, 'grain'),
  P('p_anseong_pear', '안성 배밭', 'sd', 'orchard', 37.02, 127.25, 'fruit'),
  P('p_soraepogu_fish', '소래포구', 'sd', 'sea', 37.40, 126.74, 'fish'),
  P('p_pocheon_forest', '포천 산림', 'sd', 'forest', 37.96, 127.22, 'timber'),
  F('f_namyangju_food', '남양주 식품공장', 'sd', 'foodplant', 37.64, 127.24, 'food', FOOD_IN),
  F('f_pocheon_furn', '포천 가구공장', 'sd', 'furniture', 37.84, 127.16, 'furniture', [['lumber']]),
  F('f_gapyeong_saw', '가평 제재소', 'sd', 'sawmill', 37.83, 127.50, 'lumber', [['timber']]),
  F('f_ansan_parts', '안산 부품공단', 'sd', 'partsplant', 37.30, 126.78, 'parts', [['steel']]),
  F('f_hwaseong_car', '화성 자동차공장', 'sd', 'carplant', 37.17, 126.83, 'car', [['parts'], ['chem']]),
  F('f_gwangmyeong_car', '광명 자동차공장', 'sd', 'carplant', 37.43, 126.87, 'car', [['parts'], ['chem']]),
  F('f_paju_display', '파주 디스플레이공장', 'sd', 'appliance', 37.80, 126.72, 'appliance', [['parts'], ['chem']]),
  F('f_icheon_fab', '이천 반도체공장', 'sd', 'fab', 37.24, 127.47, 'chip', [['chem'], ['parts']]),
  F('f_yongin_fab', '용인 반도체공장', 'sd', 'fab', 37.17, 127.20, 'chip', [['chem'], ['parts']]),
  F('f_pyeongtaek_fab', '평택 반도체공장', 'sd', 'fab', 37.03, 127.04, 'chip', [['chem'], ['parts']]),
  F('f_cheongju_fab', '청주 반도체공장', 'cb', 'fab', 36.66, 127.41, 'chip', [['chem'], ['parts']], { stage: 8 }),
  Port('o_pyeongtaek', '평택항', 'sd', 36.97, 126.84, null),
  Port('o_incheon', '인천항', 'sd', 37.44, 126.61, 'crude'),
  Port('o_airport', '인천공항 화물터미널', 'sd', 37.46, 126.46, null, { air: true }),

  // ── 울릉도·독도 (경북 권역, 뱃길) ─────────
  P('p_ulleung_squid', '울릉 오징어 어장', 'gb', 'sea', 37.50, 130.87, 'fish', { stage: 6, island: 'ulleung' }),
  { id: 'c_dokdo', name: '독도 경비대', r: 'gb', k: 'dokdo', lat: 37.2415, lon: 131.8645, pop: 0.1, stage: 7, island: 'dokdo' },
];

// 뱃길. pts는 위경도 경유점 [lat, lon]
export const FERRIES = [
  { id: 'fy_mokpo_jeju', name: '목포–제주 카페리', from: { lat: 34.78, lon: 126.37 }, to: { lat: 33.53, lon: 126.54 }, via: [[34.45, 126.22], [33.95, 126.32]], stage: 5 },
  { id: 'fy_wando_jeju', name: '완도–제주 카페리', from: { lat: 34.31, lon: 126.76 }, to: { lat: 33.53, lon: 126.56 }, via: [[33.95, 126.75]], stage: 5 },
  { id: 'fy_yeosu_jeju', name: '여수–제주 카페리', from: { lat: 34.73, lon: 127.76 }, to: { lat: 33.53, lon: 126.58 }, via: [[34.25, 127.45], [33.75, 126.85]], stage: 5 },
  { id: 'fy_pohang_ulleung', name: '포항–울릉 여객선', from: { lat: 36.06, lon: 129.40 }, to: { lat: 37.47, lon: 130.91 }, via: [[36.6, 129.95]], stage: 6, toIsland: 'ulleung' },
  { id: 'fy_donghae_ulleung', name: '묵호–울릉 여객선', from: { lat: 37.55, lon: 129.13 }, to: { lat: 37.47, lon: 130.90 }, via: [], stage: 7, toIsland: 'ulleung' },
  { id: 'fy_ulleung_dokdo', name: '울릉–독도 보급선', from: { lat: 37.47, lon: 130.92 }, to: { lat: 37.2415, lon: 131.8645 }, via: [], stage: 7, fromIsland: 'ulleung', toIsland: 'dokdo' },
];

// 건설해야 쓸 수 있는 우회도로·대교. 해당 노선명 또는 범위 안의 도로가 잠긴 채 시작한다.
// names: 도로 이름이 일치하면 잠금, box: [위도1, 경도1, 위도2, 경도2] 안에 중심점이 있으면 잠금
export const PROJECTS = [
  { id: 'b_seohae', name: '서해대교', kind: 'bridge', stage: 8, box: [36.90, 126.72, 37.02, 126.86], onlyKind: 'x', desc: '평택–당진 바다를 가로지르는 사장교' },
  { id: 'b_incheon', name: '인천대교', kind: 'bridge', stage: 8, names: ['인천대교고속도로'], desc: '영종도–송도 직결' },
  { id: 'b_yisunsin', name: '이순신대교', kind: 'bridge', stage: 4, box: [34.86, 127.68, 34.93, 127.76], onlyKind: 'n', desc: '여수–광양 현수교' },
  { id: 'b_geoga', name: '거가대교', kind: 'bridge', stage: 6, box: [34.97, 128.72, 35.08, 128.86], desc: '부산–거제 침매터널·사장교' },
  { id: 'r_ring1', name: '수도권제1순환고속도로', kind: 'bypass', stage: 8, names: ['수도권제1순환고속도로'], desc: '서울을 한 바퀴 도는 외곽순환' },
  { id: 'r_ring2', name: '수도권제2순환고속도로', kind: 'bypass', stage: 8, names: ['수도권제2순환고속도로'], desc: '수도권 바깥 큰 순환로' },
  { id: 'r_sejongpocheon', name: '세종포천고속도로', kind: 'bypass', stage: 8, names: ['세종포천고속도로'], desc: '제2경부 축, 경부선의 숨통' },
  { id: 'r_seoulyangyang', name: '서울양양고속도로', kind: 'bypass', stage: 7, names: ['서울양양고속도로'], desc: '인제양양터널을 지나는 동서 지름길' },
  { id: 'r_pyeongtaekjecheon', name: '평택제천고속도로', kind: 'bypass', stage: 2, names: ['평택제천고속도로'], desc: '충북 북부와 서해안을 잇는 지름길' },
  { id: 'r_sangjuyeongcheon', name: '상주영천고속도로', kind: 'bypass', stage: 3, names: ['상주영천고속도로'], desc: '경부선 대구 구간 우회' },
  { id: 'r_busanouter', name: '부산외곽순환고속도로', kind: 'bypass', stage: 6, names: ['부산외곽순환고속도로'], desc: '김해–기장 직결 순환로' },
  { id: 'r_hamyangulsan', name: '함양울산고속도로', kind: 'bypass', stage: 6, names: ['함양울산고속도로'], desc: '남해선 혼잡을 덜어주는 내륙 축' },
  { id: 'r_sunchenwanju', name: '순천완주고속도로', kind: 'bypass', stage: 4, names: ['순천완주고속도로'], desc: '호남 동부 내륙을 관통' },
  { id: 'r_saemangeum', name: '새만금 방조제 도로', kind: 'bridge', stage: 4, box: [35.60, 126.45, 35.90, 126.60], onlyKind: 'n', desc: '군산–부안을 바다 위로 잇는 33.9km 방조제' },
];

export const SEA_LABELS = [
  { name: '동해', lat: 37.0, lon: 130.5 },
  { name: '서해', lat: 36.6, lon: 125.4 },
  { name: '남해', lat: 34.0, lon: 128.2 },
];
