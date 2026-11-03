# 팔도 트래픽

대한민국 실제 도로망 위에서 트럭을 굴리고, 표지판과 신호등과 차로로 정체를 풀며 전국 물류망을 완성하는 인크리멘탈 웹게임입니다.

Rischer Kriebl의 [Incremental Traffic](https://store.steampowered.com/app/5475960/Incremental_Traffic/)에서 영감을 받아 한국 지도로 다시 만든 비공식 팬 프로젝트입니다. 원작의 코드와 그림은 쓰지 않았고, 게임 안의 그림은 모두 코드로 그린 벡터입니다.

## 게임 소개

- 도로 위의 차는 전부 내 트럭입니다. 트럭을 늘리면 돈을 벌지만 그만큼 길이 막힙니다.
- 차선 단위로 움직이는 시뮬레이션이라 정체, 꼬리물기, 교착이 저절로 생깁니다.
- 양보·정지 표지, 신호등, 회전교차로, 입체교차로, 차로 추가로 정체를 풉니다.
- 충북에서 시작해 충남, 경북, 전북, 전남, 제주, 경남, 강원, 수도권 순서로 권역이 열립니다.
- 사과밭에서 시작한 물류가 제철소, 자동차공장, 조선소, 반도체공장, 수출항까지 이어집니다.
- 후반에는 서해대교, 인천대교, 수도권 순환고속도로 같은 우회로와 대교를 건설합니다.

## 실행

빌드 과정이 없는 순수 ES 모듈 프로젝트입니다. 아무 정적 서버로 열면 됩니다. GitHub Pages는 `main` 브랜치 루트를 그대로 게시하면 됩니다.

```bash
node tools/serve.mjs 8765
```

## 폴더 구조

| 경로 | 내용 |
| --- | --- |
| `js/sim/` | 도로망과 차선 기반 교통 시뮬레이션 (DOM 없음) |
| `js/game/` | 화물, 트럭, 연구, 권역 진행, 저장 |
| `js/render/` | 캔버스 렌더링과 벡터 아트 |
| `js/ui/` | 패널, 창, 튜토리얼, 효과음 |
| `data/korea.json` | 가공된 지도 데이터 |
| `tools/` | 지도 데이터 빌드, 밸런스 봇, 교차로 처리량 측정, 노선 점검 |

지도 데이터를 다시 만들려면 `node tools/fetch-osm.mjs`로 원본을 받고 `node tools/build-map.mjs`를 실행합니다. 원본은 `.cache/raw/`에 저장되며 저장소에는 올리지 않습니다.

## 데이터 출처와 라이선스

`data/korea.json`은 아래 자료를 가공해 만들었습니다.

- 도로, 강, 호수, 지명: © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/) 라이선스. 이 파일에서 파생된 도로 그래프도 같은 조건을 따릅니다.
- 행정구역: 통계청(KOSTAT) 자료를 가공한 [southkorea-maps](https://github.com/southkorea/southkorea-maps)
- 주변 해안선: [Natural Earth](https://www.naturalearthdata.com/) (퍼블릭 도메인)
- 지형: [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen, SRTM 등)

거점의 특산물과 산업 입지는 실제 지역을 참고했지만, 생산량과 운임은 게임용으로 만든 값입니다.
