// OSM 원본 데이터 다운로드 (Overpass API). 결과는 .cache/raw/ 에 저장한다.
// 사용법: node tools/fetch-osm.mjs [roads|junctions|places|rivers|lakes ...]
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('.cache/raw');
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const AREA = 'area["ISO3166-1"="KR"][admin_level=2]->.kr;';

const RIVERS = ['한강', '남한강', '북한강', '낙동강', '금강', '섬진강', '영산강', '임진강', '소양강', '동강', '서강',
  '만경강', '동진강', '형산강', '태화강', '평창강', '달천', '내성천', '황강', '남강', '탐진강', '보성강'];
const LAKES = ['충주호', '소양호', '대청호', '안동호', '임하호', '파로호', '의암호', '청평호', '팔당호', '합천호', '시화호',
  '춘천호', '주암호', '옥정호', '횡성호', '영주호', '보령호', '장성호', '용담호', '영천호', '소양강댐', '충주댐', '대청댐',
  '안동댐', '임하댐', '합천댐', '주암댐', '용담댐', '화천댐', '팔당댐', '섬진강댐', '남강댐', '진양호', '담양호', '광동호'];

const QUERIES = {
  roads: `[out:json][timeout:240];${AREA}(way["highway"~"^(motorway|motorway_link|trunk)$"](area.kr););out tags geom;`,
  primary: `[out:json][timeout:270];${AREA}(way["highway"="primary"](area.kr););out tags geom;`,
  jeju: `[out:json][timeout:120];(way["highway"~"^(trunk|primary|secondary)$"](33.1,126.1,33.6,127.0););out tags geom;`,
  junctions: `[out:json][timeout:120];${AREA}(node["highway"="motorway_junction"](area.kr););out;`,
  places: `[out:json][timeout:120];${AREA}(node["place"~"^(city|town)$"](area.kr);node["place"="county"](area.kr);node["place"="island"]["name"](area.kr););out;`,
  rivers: `[out:json][timeout:240];${AREA}(way["waterway"="river"]["name"~"^(${RIVERS.join('|')})$"](area.kr););out tags geom;`,
  lakes: `[out:json][timeout:240];${AREA}(way["natural"="water"]["name"~"(${LAKES.join('|')})"](area.kr);relation["natural"="water"]["name"~"(${LAKES.join('|')})"](area.kr););out tags geom;`,
};
const FILES = { roads: 'osm_major_roads.json', primary: 'osm_primary.json', jeju: 'osm_jeju.json', junctions: 'osm_junctions.json', places: 'osm_places.json', rivers: 'osm_rivers.json', lakes: 'osm_lakes.json' };

async function run(name) {
  for (const url of MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'paldo-traffic-data-build/0.1 (personal game project)' },
          body: new URLSearchParams({ data: QUERIES[name] }),
          signal: AbortSignal.timeout(280000),
        });
        const text = await res.text();
        if (!res.ok) { console.log(name, url, 'http', res.status); await new Promise((r) => setTimeout(r, 8000)); continue; }
        const n = JSON.parse(text).elements.length;
        fs.writeFileSync(path.join(OUT, FILES[name]), text);
        console.log(name, 'ok', url, 'elements', n, 'bytes', text.length);
        return;
      } catch (e) {
        console.log(name, url, 'err', e.message);
      }
    }
  }
  throw new Error('all mirrors failed: ' + name);
}

const names = process.argv.slice(2);
for (const n of names.length ? names : Object.keys(QUERIES)) await run(n);
