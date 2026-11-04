// 게임에 쓰는 그림. 전부 코드로 직접 그린 단색 SVG 벡터이며 외부 이미지는 없다.
// 글자색(currentColor)을 따라가므로 버튼 색이 곧 아이콘 색이다.
import { GOODS } from '../game/defs.js';

const S = (body, vb = 40) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}">${body}</svg>`;
const line = (d, w = 3.4) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const solid = (d) => `<path d="${d}" fill="currentColor" fill-rule="evenodd"/>`;
const ring = (cx, cy, r, w = 3.4) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${w}"/>`;
const dot = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`;

// ── 거점 도형 ───────────────────────────────────────
// 단위 좌표이며 캔버스와 DOM이 함께 쓴다
const ngon = (n, r) => Array.from({ length: n }, (_, i) => {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
});
const starPoints = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
  const r = i % 2 ? 0.56 : 1.3;
  return [Math.cos(a) * r, Math.sin(a) * r];
});
export const SHAPES = {
  triangle: [[0, -1.18], [1.08, 0.72], [-1.08, 0.72]],
  square: [[-0.88, -0.88], [0.88, -0.88], [0.88, 0.88], [-0.88, 0.88]],
  diamond: [[0, -1.24], [1.24, 0], [0, 1.24], [-1.24, 0]],
  pentagon: ngon(5, 1.12),
  hexagon: ngon(6, 1.08),
  cross: [[-0.38, -1.1], [0.38, -1.1], [0.38, -0.38], [1.1, -0.38], [1.1, 0.38], [0.38, 0.38], [0.38, 1.1], [-0.38, 1.1], [-0.38, 0.38], [-1.1, 0.38], [-1.1, -0.38], [-0.38, -0.38]],
  star: starPoints,
};
// 원자재는 세모, 공장은 네모, 완제품 공장은 오각·육각, 항만은 마름모, 도시는 동그라미
const KIND_SHAPE = {
  orchard: 'triangle', field: 'triangle', forest: 'triangle', quarry: 'triangle', sea: 'triangle', salt: 'triangle',
  foodplant: 'square', sawmill: 'square', cementplant: 'square', steelmill: 'square', chemplant: 'square', furniture: 'square', partsplant: 'square',
  appliance: 'pentagon', carplant: 'pentagon', fab: 'hexagon', shipyard: 'hexagon',
  port: 'diamond', city: 'circle', dokdo: 'star',
};
export function siteShape(s) {
  if (s.kind === 'port' && s.def.air) return 'cross';
  return KIND_SHAPE[s.kind] || 'circle';
}
function shapeSvg(shape, fillDot) {
  const R = 13;
  const style = 'fill="var(--station, #fff)" stroke="var(--ink, #2a2a28)" stroke-width="4.6" stroke-linejoin="round"';
  const body = shape === 'circle'
    ? `<circle cx="20" cy="20" r="${R}" ${style}/>`
    : `<polygon points="${SHAPES[shape].map(([x, y]) => `${(20 + x * R).toFixed(1)},${(20 + y * R).toFixed(1)}`).join(' ')}" ${style}/>`;
  const inner = fillDot ? `<circle cx="20" cy="${shape === 'triangle' ? 22 : 20}" r="5" fill="${fillDot}"/>` : '';
  return S(body + inner);
}
export function siteIcon(s) {
  return shapeSvg(siteShape(s), s.goods ? GOODS[s.goods].color : null);
}

// 톱니바퀴 윤곽
function gearPath() {
  const out = [];
  const teeth = 8;
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / teeth / 4;
    const r = i % 4 < 2 ? 17 : 13;
    out.push(`${(20 + Math.cos(a) * r).toFixed(1)} ${(20 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M${out.join('L')}ZM20 14a6 6 0 1 0 0 12a6 6 0 1 0 0-12Z`;
}
const truckSide = (bodyD, wheels) => S(solid(bodyD) + wheels.map((x) => dot(x, 29.5, 3.6)).join(''));

export const ICONS = {
  // ── 도구 ──────────────────────────────────────────
  t_select: S(solid('M11 5 31 22 21.500 23.500 26.500 33.500 21.800 35.800 17 25.800 11 31.500Z')),
  t_yield: S(line('M7.500 11H32.500L20 32Z', 3.8)),
  t_stop: S(solid('M14 5h12l9 9v12l-9 9H14l-9-9V14ZM11.500 17.800v4.400h17v-4.400Z')),
  t_signal: S(`<rect x="12.500" y="4" width="15" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="3.200"/>${dot(20, 11.500, 3)}${dot(20, 20, 3)}${dot(20, 28.500, 3)}`),
  t_roundabout: S(line('M31.500 12.500A14 14 0 1 0 34 20', 3.8) + solid('M26 13.500 35.500 15.500 35 5.500Z')),
  t_interchange: S(line('M6 31 34 9', 4) + line('M6 9 15.500 16.500M24.500 23.500 34 31', 4)),
  t_lane: S(line('M9 6V34M18 6V34', 3.8) + line('M30 14V26M24 20H36', 3.8)),
  t_remove: S(line('M10 10 30 30M30 10 10 30', 4.6)),
  check: S(line('M7 21 16 30 33 10', 6)),
  t_fleet: S(line('M4 11V4H11M29 4H36V11M36 29V36H29M11 36H4V29', 3.2) + solid('M9 14h13v11H9ZM24 17.500h4l4 4V25h-8Z') + dot(14, 27, 2.800) + dot(27.500, 27, 2.800)),
  tow: S(line('M20 4V16', 3.8) + line('M20 16a6.500 6.500 0 1 1-6.500 6.500', 3.8) + line('M12 4H28', 3.8)),

  // ── 트럭 ──────────────────────────────────────────
  truck: truckSide('M4 12h20v15H4ZM26 17h6l5 5v5H26Z', [11, 31]),
  truck_hauler: truckSide('M7 14h15v13H7ZM24 18h5l4 4.500v4.500h-9Z', [13, 28.500]),
  truck_cargo: truckSide('M3 10h22v17H3ZM27 15h6l4 5.500v6.500H27Z', [10, 19, 32]),
  truck_trailer: truckSide('M1 9h25v18H1ZM28 13h6l5 6v8H28Z', [7, 15, 23, 33]),
  truck_express: truckSide('M3 10h22v17H3ZM7 16.500v4h14v-4ZM27 15h6l4 5.500v6.500H27Z', [10, 32]),

  // ── 연구 ──────────────────────────────────────────
  won: S(line('M8 9 13.500 31 20 14 26.500 31 32 9', 3.2) + line('M5 17.500H35M5 23.500H35', 2.6)),
  money: S(line('M8 9 13.500 31 20 14 26.500 31 32 9', 3.2) + line('M5 17.500H35M5 23.500H35', 2.6)),
  engine: S(line('M9 9 20 20 9 31M21 9 32 20 21 31', 4.2)),
  crate: S(line('M7 13 20 6 33 13V28L20 35 7 28ZM7 13 20 20 33 13M20 20V35', 3)),
  forklift: S(line('M13 33V8M6 15 13 8 20 15M27 7V32M20 25 27 32 34 25', 3.4)),
  parking: S(`<rect x="5" y="5" width="30" height="30" rx="6" fill="none" stroke="currentColor" stroke-width="3.200"/>` + line('M15.500 29V11.500H21.500A5.800 5.800 0 0 1 21.500 23.100H15.500', 3.8)),
  clock: S(ring(20, 20, 14.500) + line('M20 11V20.500L26.500 24.500', 3.4)),
  nav: S(solid('M20 4C12.500 4 7 10 7 16.500 7 25.500 20 36.500 20 36.500S33 25.500 33 16.500C33 10 27.500 4 20 4ZM20 11a5.500 5.500 0 1 0 0 11a5.500 5.500 0 1 0 0-11Z')),
  smartsig: S(`<rect x="6" y="6" width="13" height="28" rx="5.500" fill="none" stroke="currentColor" stroke-width="3"/>${dot(12.500, 13, 2.600)}${dot(12.500, 20, 2.600)}${dot(12.500, 27, 2.600)}` + line('M25 14a8.500 8.500 0 0 1 0 12M30.500 9.500a15 15 0 0 1 0 21', 3)),
  auto: S(line('M33 20A13 13 0 0 1 10.500 29M7 20A13 13 0 0 1 29.500 11', 3.6) + solid('M28 3.500 34.500 12.500 24.500 14.500ZM12 36.500 5.500 27.500 15.500 25.500Z')),
  roundabout2: S(ring(20, 20, 15, 3.2) + ring(20, 20, 7.500, 3.2)),
  warn: S(solid('M20 4 38 35H2ZM18 14v11h4V14ZM18 27.500v4h4v-4Z')),
  jam: S(`<rect x="3" y="15" width="10" height="10" rx="2" fill="currentColor"/><rect x="15" y="15" width="10" height="10" rx="2" fill="currentColor"/><rect x="27" y="15" width="10" height="10" rx="2" fill="currentColor"/>`),
  lock: S(line('M12.500 18v-5a7.500 7.500 0 0 1 15 0v5', 3.4) + `<rect x="8" y="18" width="24" height="17" rx="3" fill="currentColor"/>`),
  research: S(line('M15.500 5H24.500M17 5V16L7.500 31.500C6.500 34 8 35.500 10.500 35.500H29.500C32 35.500 33.500 34 32.500 31.500L23 16V5', 3) + solid('M13 26h14l3.500 6.500c.5 1 0 1.500-1 1.500H10.500c-1 0-1.500-.5-1-1.500Z')),
  build: S(line('M3 27H37', 3.6) + line('M5 27C5 15 15 11 20 11S35 15 35 27', 3.2) + line('M12.500 27V14.500M20 27V11M27.500 27V14.500', 2.600)),
  list: S(line('M8 11H32M8 20H32M8 29H32', 3.8)),
  gear: S(solid(gearPath())),
  star: S(solid('M20 3.500 25 15 37.500 16.200 28 24.500 30.800 36.500 20 30.200 9.200 36.500 12 24.500 2.500 16.200 15 15Z')),
  ship: S(solid('M4 23H36L31 34H9Z') + line('M20 6V21M20 8 30 18H20', 3)),
  bridge: S(line('M3 27H37', 3.6) + line('M5 27C5 15 15 11 20 11S35 15 35 27', 3.2) + line('M12.500 27V14.500M20 27V11M27.500 27V14.500', 2.600)),
  bypass: S(line('M7 35C7 17 33 23 33 5', 4.2)),

  // ── 공통 ──────────────────────────────────────────
  pause: S(`<rect x="9" y="6" width="8" height="28" rx="1.500" fill="currentColor"/><rect x="23" y="6" width="8" height="28" rx="1.500" fill="currentColor"/>`),
  close: S(`<path d="M9 9l22 22M31 9 9 31" stroke="currentColor" stroke-width="4.500" stroke-linecap="round"/>`),
  chevron: S(`<path d="M14 7l13 13-13 13" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),
  plus: S(`<path d="M20 7v26M7 20h26" stroke="currentColor" stroke-width="5.500" stroke-linecap="round"/>`),
  minus: S(`<path d="M7 20h26" stroke="currentColor" stroke-width="5.500" stroke-linecap="round"/>`),
  sound: S(`<path d="M5 15h7l10-8v26l-10-8H5z" fill="currentColor"/><path d="M27 13c3 4 3 10 0 14M31 8c6 7 6 17 0 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`),
  mute: S(`<path d="M5 15h7l10-8v26l-10-8H5z" fill="currentColor"/><path d="M28 15l9 10M37 15l-9 10" stroke="currentColor" stroke-width="3.200" stroke-linecap="round"/>`),
  home: S(`<path d="M20 4 3 19h5v17h9V25h6v11h9V19h5z" fill="currentColor"/>`),
};
for (const kind of Object.keys(KIND_SHAPE)) ICONS[kind] = shapeSvg(KIND_SHAPE[kind]);
for (const id of Object.keys(GOODS)) ICONS[`g_${id}`] = S(`<rect x="8" y="8" width="24" height="24" rx="4" fill="${GOODS[id].color}"/>`);

// 도로 번호 배지. 고속도로는 검은 원, 국도는 테두리만
export function routeBadge(kind, ref) {
  const num = String(ref || '').slice(0, 3);
  const fs = num.length >= 3 ? 13 : 16;
  const filled = kind === 'x';
  const disc = filled
    ? '<circle cx="20" cy="20" r="18" fill="var(--ink, #2a2a28)"/>'
    : '<circle cx="20" cy="20" r="16.500" fill="none" stroke="var(--ink, #2a2a28)" stroke-width="3"/>';
  return S(`${disc}<text x="20" y="${20 + fs * 0.36}" text-anchor="middle" font-size="${fs}" font-weight="700" font-family="Helvetica Neue, Arial, sans-serif" fill="${filled ? 'var(--paper, #f6f1e3)' : 'var(--ink, #2a2a28)'}">${num}</text>`);
}

// DOM에서 쓰는 HTML
export function iconHtml(name) {
  return ICONS[name] || '';
}
