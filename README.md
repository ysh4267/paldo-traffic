# 팔도 트래픽

**바로 플레이: https://ysh4267.github.io/paldo-traffic/**

대한민국 실제 도로망 위에서 트럭을 굴리고, 표지판과 신호등과 차로로 정체를 풀며 전국 물류망을 완성하는 인크리멘탈 웹게임입니다.

Rischer Kriebl의 [Incremental Traffic](https://store.steampowered.com/app/5475960/Incremental_Traffic/)에서 영감을 받아 한국 지도로 다시 만든 비공식 팬 프로젝트입니다. 원작의 코드와 그림은 쓰지 않았고, 게임 안의 그림은 모두 코드로 그린 벡터입니다. 화면과 트럭 표현은 Dinosaur Polo Club의 [Mini Metro](https://store.steampowered.com/app/287980/Mini_Metro/)를 참고했습니다.

## 게임 소개

- 도로 위의 차는 전부 내 트럭입니다. 트럭을 늘리면 돈을 벌지만 그만큼 길이 막힙니다.
- 트럭이 다니는 노선은 화물 색 선으로 지도에 나타나, 전국 물류망이 지하철 노선도처럼 자라납니다.
- 거점마다 주차장이 있어 트럭이 칸에 들어가 멈추고, 후진으로 빠져나와 다시 달립니다. 안에서는 앞차를 따라 줄을 서고, 후진하는 트럭은 길이 빌 때까지 칸에서 기다립니다.
- 거점 카드에서 노선의 트럭을 더 많이 싣는 차종으로 바꿀 수 있습니다. 값을 내면 나르는 양은 그대로 두고 대수가 줄어듭니다. 1톤 5대가 5톤 1대가 됩니다.
- 지도를 왼쪽으로 끌면 범위 안의 거점이 한꺼번에 골라지고, 공용 메뉴로 트럭을 사고 바꾸고 팔거나 생산과 상하차장을 늘릴 수 있습니다. 지도는 오른쪽으로 끌어 옮깁니다.
- 거점 목록에서 권역, 상태, 빈 노선 같은 조건으로 거점을 걸러 여러 곳을 고를 수도 있습니다. 목록은 저절로 바뀌지 않고 새로고침하거나 새로 열 때만 바뀝니다. 목록에서 거점을 고르면 목록 왼쪽 팝업에서 바로 관리합니다.
- 정체 브리핑은 어디서 어디로 가는 노선이 평소보다 몇 배 걸리는지 보여 줍니다. 노선을 누르면 막힌 구간 전체가 보이게 카메라가 옮겨 가 구간을 빨갛게 칠하고, 줄의 맨 앞에 있는 교차로와 막히는 도로를 그 자리에서 고칠 수 있습니다.
- 트럭은 차종과 짐 무게에 따라 가속이 다르고, 브레이크를 미리 밟아 부드럽게 멈춥니다. 급한 코너 앞에서는 속도를 줄이고 크게 돌아 나갑니다.
- 차선 단위로 움직이는 시뮬레이션이라 정체, 꼬리물기, 교착이 저절로 생깁니다.
- 1톤 트럭 ₩2,200만, 신호등 ₩7,300만, 인천대교 ₩2.38조처럼 금액은 실제 시세와 공사비를 바탕으로 했습니다.
- 양보·정지 표지, 신호등, 회전교차로, 입체교차로, 차로 추가로 정체를 풉니다. 차로 추가 도구로 지도를 끌면 범위 안의 도로를 한 번에 넓힐 수 있습니다.
- 충북에서 시작해 충남, 경북, 전북, 전남, 제주, 경남, 강원, 수도권 순서로 권역이 열립니다.
- 사과밭에서 시작한 물류가 제철소, 자동차공장, 조선소, 반도체공장, 수출항까지 이어집니다.
- 후반에는 서해대교, 인천대교, 수도권 순환고속도로 같은 우회로와 대교를 건설합니다. 개통하면 카메라가 천천히 도로 전체를 비추고 어디인지 칠해 보여 줍니다.
- 수도권까지 모든 권역을 열면 환생할 수 있습니다. 처음부터 다시 달리는 대신 번 돈에 따라 명성을 얻고, 명성으로 납품가, 트럭값, 시작 자금, 기술 이전, 도로 유산 같은 영구 보너스를 삽니다.

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
| `js/ui/` | 패널, 창, 튜토리얼, 효과음과 배경음 재생 |
| `audio/` | 배경음 |
| `data/korea.json` | 가공된 지도 데이터 |
| `tools/` | 지도 데이터 빌드, 밸런스 봇, 교차로 처리량 측정, 노선 점검, 생산 사슬 점검, 주차장 점검, 환생 점검, 정체 브리핑 점검, 트럭 전환 점검 |

지도 데이터를 다시 만들려면 `node tools/fetch-osm.mjs`로 원본을 받고 `node tools/build-map.mjs`를 실행합니다. 원본은 `.cache/raw/`에 저장되며 저장소에는 올리지 않습니다.

## 데이터 출처와 라이선스

`data/korea.json`은 아래 자료를 가공해 만들었습니다.

- 도로, 강, 호수, 지명: © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/) 라이선스. 이 파일에서 파생된 도로 그래프도 같은 조건을 따릅니다.
- 행정구역: 통계청(KOSTAT) 자료를 가공한 [southkorea-maps](https://github.com/southkorea/southkorea-maps)
- 주변 해안선: [Natural Earth](https://www.naturalearthdata.com/) (퍼블릭 도메인)
- 지형: [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen, SRTM 등)

거점의 특산물과 산업 입지는 실제 지역을 참고했지만, 생산량은 게임용으로 만든 값입니다.

## 배경음

기타와 피아노 곡 다섯 곡을 차례로 틀며, 모두 OpenGameArt의 CC0 곡입니다. 원본 WAV는 112kbps MP3로 변환하며 곡마다 크기를 맞췄습니다. 표기 의무는 없지만 만든 사람을 밝혀 둡니다. 효과음은 코드로 합성합니다.

- [Sunset Plains](https://opengameart.org/content/sunset-plains), Yoiyami
- [Piano melody](https://opengameart.org/node/155545), bramd
- [Wooden Inn](https://opengameart.org/content/wooden-inn), Indieteur
- [Yoiyami Core Theme – Deep Blue Ambient Piano](https://opengameart.org/content/yoiyami-core-theme-%E2%80%93-deep-blue-ambient-piano), Yoiyami
- [Serenade Guitar](https://opengameart.org/content/serenade-guitar), Pro Sensory (Alex McCulloch)

## 금액 기준

금액은 실제 값을 바탕으로 잡되, 게임이 굴러가도록 일부를 조정했습니다.

| 항목 | 게임 금액 | 근거 |
| --- | --- | --- |
| 1톤 트럭 | ₩2,200만 | [포터 II 2026](https://www.hyundaimotorgroup.com/ko/news/CONT0000000000196277) ₩2,152만부터 |
| 5톤 트럭 | ₩7,500만 | 5톤급 카고 ₩5,500만~₩7,000만대 |
| 25톤 트레일러, 특송 윙바디 | ₩2.8억, ₩1.5억 | 추정값 (공식 가격을 확인하지 못함) |
| 과일, 농산물, 수산물 | 톤당 ₩600만, ₩300만, ₩650만 | 도매가 ([사과](https://kbmaeil.com/article/202403130387345), [쌀](https://www.atfis.or.kr/fip/front/M000000289/stats/kamisWhole.do), [고등어](https://www.seafood.no/contentassets/9a6e769b1f4d4c788768d96d2ae9f8b2/03.-seungpyo-hong---kmi---mackerel-supply-demand-and-price-trend-analysis-1.pdf)) |
| 원유, 철강, 화학소재 | 톤당 ₩75만, ₩90만, ₩150만 | [나프타](https://www.ceicdata.com/en/korea/raw-material-prices), [열연](https://www.procurementresource.com/ko/resource-center/hot-rolled-coil-price-trends) 시세 수준 |
| 자동차 | 톤당 ₩3,000만 | [수출 단가](https://www.dailian.co.kr/news/view/1046397/)와 신차 가격 수준 |
| 가공식품, 가구, 부품, 가전, 선박 블록, 반도체 | 톤당 ₩800만~₩10억 | 소매가와 건조가에서 어림한 값 |
| 신호등 | ₩7,300만 | [교차로당 ₩7,300만](https://m.go.seoul.co.kr/news/2012/04/19/20120419015024)~[₩1억](https://www.kukinews.com/article/view/kuk200906220096) |
| 회전교차로 | ₩3.5억 | [강동구 사례](https://gangdong.go.kr/web/newportal/press/3273) 등 |
| 입체교차로 | ₩500억 | 실제 IC 사업비 ₩127억~₩996억 ([대구·경북](https://m.go.seoul.co.kr/news/2026/05/15/20260515019008), [동용인](https://www.heraldk.com/article/2025121119512754908)) |
| 카페리 증편 | ₩680억부터 | [2만7천톤급 수주 금액](https://news.mtn.co.kr/news-detail/2018091813492080745) |
| 대교, 고속도로 | 실제 총사업비 | 아래 목록 |

실제 값에서 일부러 벗어난 것은 다음과 같습니다.

- **값싼 벌크 화물**: 원목, 석회석, 철광석, 시멘트, 목재는 실제 시세(톤당 ₩2만~₩60만)로는 트럭값을 벌 수 없어 3~20배 올렸습니다.
- **차로 추가**: 고속도로 1km당 ₩50억, 국도 ₩15억으로, 실제([회덕–비룡 확장 ₩129억/km](https://eiec.kdi.re.kr/epic_txt/1999/R9909027.HWP))의 절반 이하입니다. 실제 값으로는 초중반에 차로를 전혀 늘릴 수 없었습니다. 몇 번째 차로든 값이 같습니다.
- **연구비, 생산 증설비**: 실제 금액이 따로 없는 항목이라 단계별 수입에 맞춰 정했습니다.
- **수익**: 운임이 아니라 싣고 간 화물의 납품 대금입니다. 실제 운임으로는 트럭값을 벌기까지 수백 번을 달려야 합니다.

대교와 고속도로 총사업비: [인천대교](https://www.molit.go.kr/USR/policyTarget/dtl.jsp?idx=148) ₩2.38조, [거가대교](https://knnews.co.kr/news/articleView.php?idxno=995166) ₩1.98조, 이순신대교(여수산단 진입도로 포함) ₩1.07조, [서해대교](https://en.wikipedia.org/wiki/Seohae_Bridge) ₩6,700억, [서울양양](https://mobile.newsis.com/view/NISX20170629_0014969338) ₩2.37조, [상주영천](https://m.go.seoul.co.kr/news/2017/06/19/20170619500131) ₩2.15조, [순천완주](https://m.go.seoul.co.kr/news/2011/01/26/20110126015010) ₩2.25조, [서울–세종](https://m.go.seoul.co.kr/news/2016/09/03/20160903006014) 약 ₩10조, 부산외곽순환 ₩2.33조, 함양울산 ₩7.46조(세 구간 합), [새만금 방조제](https://www.mpva.go.kr/isnc/contents.do?key=622) ₩2.9조. 평택제천(₩2.5조)과 수도권 제1·2순환(₩3조, ₩10조)은 사업비를 찾지 못해 비슷한 노선으로 추정했고, 게임 안에도 추정이라고 적어 두었습니다.
