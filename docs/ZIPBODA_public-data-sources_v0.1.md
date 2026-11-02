# 집보다(Zipboda) 공공데이터 연계 원천 조사 (API-114)

## 1. 문서 정보

| 항목 | 내용 |
|------|------|
| 문서명 | 집보다(Zipboda) 공공데이터 연계 원천 조사 — LH·SH·GH·IH·청약홈 공고 API와 테이블 매핑 |
| 버전 | v0.2.1 |
| 작성일 | 2026-10-26 |
| 기반 문서 | /docs/ZIPBODA_development-plan_v0.1.md, /docs/ZIPBODA_erd_v0.1.md, /docs/ZIPBODA_erd-draft_v0.1.md, /src/database/schema.prisma |

### 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| v0.1.0 | 2026-10-26 | Claude | 신규 작성 — 기관별 공고 제공 방식(LH API 3종·청약홈 API 2종·IH API·SH RSS·GH 웹·마이홈 API)과 사이트 수집 가능 여부(robots.txt — GH 전체 차단), 인증·승인·트래픽, subscriptions·floorplans·units 열 매핑, 원천 식별자와 중복 공고, 설계 영향, 4개 기관 모두 받기 위한 수집 전략(주·보완 원천, 관리자 등록 안전망, 공공데이터 제공신청), 인증키 신청 우선순위, 미확인 사항 |
| v0.2.0 | 2026-10-27 | Claude | §10 개발키 호출 결과 추가 — LH 3종·청약홈 3종·마이홈 정상, IH 504(서비스 연결실패), GH 파일 API 401. 마이홈에 SH·GH·IH 공고 0건, 청약홈에는 SH·GH·IH 분양 공고만 소수 — 세 기관의 임대 공고는 어떤 API에도 없음을 확인. LH 날짜 파라미터는 활용가이드 이름이 적용됨, LH 목록에 상가 공고가 섞임 |
| v0.2.1 | 2026-10-27 | Claude | ERD v0.3.1 구조와 맞춤 — §5 열 매핑이 v0.2 테이블 기준 조사 결과임을 밝히고 ERD §4 근거 열·§4.6 일정 대응표를 대표로 지정. §7 설계 영향 1(원천 키를 notice_sources PK(source, source_key)로, 정정본 PAN_ID도 같은 공고의 원천 참조로)·2(값별 정하는 원천은 ERD 규칙 12·13, 매칭 실패는 sync_failures WARNING)·3(금액은 원 단위 정수 열 + price_note)·5(geocode_method → complexes.geocode_status)의 근거를 ERD 초안 §5.2에서 ERD v0.3으로 바꿈 |

---

## 2. 목적·범위

- 개발계획서 §3.2(공공데이터 연계)와 API-114(동기화) 착수 전에, 기관별로 공고를 어떤 경로로 받을 수 있는지와 우리 테이블의 어느 열을 채울 수 있는지 정리한다.
- 조사일은 2026-10-23~26이고, 근거는 공공데이터포털·기관 사이트의 공개 문서다(§10). 실제 호출로 확인하지 않은 내용은 '미확인'으로 적는다. 인증키를 받으면 §10부터 확인한다.
- 범위는 서울·인천·경기의 LH·SH·GH·IH 공고다(ITF-001·ITF-004).

---

## 3. 기관별 제공 방식

| 원천 | 방식 | API(공공데이터포털 ID) | 인증·승인 | 트래픽(개발) | 형식 | 갱신 |
|------|------|------------------------|-----------|--------------|------|------|
| LH | API 3종 | 분양임대공고문 조회 15058530, 공고 상세 15057999, 공급정보 15056765 | serviceKey, 개발·운영 모두 자동승인 | API마다 10,000건, 30tps | JSON | 실시간 |
| 청약홈(한국부동산원) | API 2종 | 분양정보 조회 15098547, 경쟁률 조회 15098905 | 개발 자동승인, **운영 심의** | 40,000건 | JSON·XML | 실시간 |
| IH | API(목록만) | 15149725 | 개발 자동승인, 운영 심의 | 1,000건 | JSON | 실시간 |
| SH | 웹·RSS | 공고 API를 찾지 못함. 열린데이터광장에는 공급계획 같은 파일만 있음 | — | — | RSS(EUC-KR, 최근 약 29건) | — |
| GH | 웹만 | 공고 API·RSS 없음. 파일데이터 15119414·15119391은 연 1회 스냅숏 | — | — | CSV | 연간 |
| 국토부 마이홈 | API | 공공주택 모집공고 15108420 — 국민임대·영구임대·행복주택 등 공공임대를 유형별로 준다 | 개발·운영 모두 자동승인, 이용허락 제한 없음 | 1,000건 | JSON | 실시간 |

운영계정은 활용사례를 등록하면 트래픽 증량을 신청할 수 있다. 마이홈은 2024년부터 기관별 모집공고를 자동 수집(RPA)해 보여 준다고 국토부가 발표했다 — API에 SH·GH 공고가 담기는지는 키로 확인한다(요청 파라미터 코드는 포털 첨부 엑셀).

**사이트 수집 가능 여부(robots.txt, 2026-10-26 확인)**

| 기관 | robots.txt | 의미 |
|------|-----------|------|
| SH | `/upload`와 일부 지역센터 게시판만 차단 | 공고 게시판·RSS는 수집 허용. 공고문 첨부가 `/upload` 아래면 자동 내려받기 불가 |
| GH | `Disallow: /`(전체 차단) | **자동 수집 불가** — 정식 제공(§8) 또는 관리자 등록으로만 받는다 |
| IH | 전체 허용(Googlebot만 일부 차단) | 목록 API + 공고 상세 페이지 수집 가능 |

---

## 4. 원천별 메모

### 4.1 LH
- 목록: `apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1`. 상세 `…/lhLeaseNoticeDtlInfo1/getLeaseNoticeDtlInfo1`, 공급정보 `…/lhLeaseNoticeSplInfo1/getLeaseNoticeSplInfo1`.
- 필터: UPP_AIS_TP_CD(05 분양, 06 임대, 13 주거복지, 39 신혼희망), CNP_CD(서울 11·인천 28·경기 41), PG_SZ·PAGE.
- **기간 파라미터명이 문서마다 다르다**(포털: PAN_NT_ST_DT·CLSG_DT, 활용가이드: PAN_ST_DT·PAN_ED_DT 필수 + CLSG_ST_DT·CLSG_ED_DT). 실제 호출로 정한다.
- 응답은 `[{dsSch}, {resHeader, dsList}]` 같은 비표준 배열이다.
- 상세·공급정보는 공급정보구분코드(SPL_INF_TP_CD)마다 필드명이 다르다(예: 단지주소 LCT_ARA_ADR / LGDN_ADR). 원천별 어댑터에서 정규화한다(backend-architecture 규칙 §6).

### 4.2 청약홈
- 분양정보 `api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/` — APT, 오피스텔·도시형·민간임대, 잔여(무순위), 공공지원민간임대, 임의공급을 각각 상세(Detail)·주택형(Mdl)으로 준다. 필터는 `cond[RCRIT_PBLANC_DE::GTE]`, page·perPage.
- 경쟁률 `…/ApplyhomeInfoCmpetRtSvc/v1/` — 경쟁률·당첨가점·특별공급 신청현황.
- **행복주택·국민임대·매입임대 오퍼레이션은 없다.** 10년·6년 분양전환 공공임대는 APT 목록에 있음을 확인했다.

### 4.3 IH·SH·GH
- IH: `apis.data.go.kr/B552831/ih/slls-posts` — 목록 필드(sj·crtYmd·tyNm·seNm·link)뿐이라 접수기간·주소는 공고 본문에서 읽어야 한다. 공공누리 3유형(변경금지)이라 가공·표시 범위를 확인한다. RSS(`ih.co.kr/rss/bbsNotice.do`, 10건)도 있다.
- SH: RSS(`rssNoticeWrite.do`)에 title·link·pubDate·본문 HTML이 있고 발표·안내 글이 섞여 있다.
- GH: 게시판뿐이다. 파일데이터는 연간 스냅숏이라 동기화에 쓸 수 없다.

---

## 5. 테이블 열 매핑

> 아래 표는 v0.2 테이블(subscriptions 한 테이블) 기준으로 조사한 원천 필드다. ERD v0.3.1(공고·단지·공고×단지 칸·일정 분리)에서는 ERD §4 각 표의 '근거' 열과 §4.6 일정 대응표가 열 대응을 대표한다.

### 5.1 subscriptions

| 열 | LH | 청약홈(APT 상세 기준) | IH |
|----|----|------------------------|----|
| title | PAN_NM | HOUSE_NM | sj |
| agency_code | 고정(1) | 없음 — 사업주체명 BSNS_MBY_NM으로 추론(값 형식 미확인) | 고정(4) |
| region_code | CNP_CD_NM | SUBSCRPT_AREA_CODE(_NM) | 없음 |
| address | 상세 dsSbd LCT_ARA_ADR 또는 LGDN_ADR(+상세주소) | HSSPLY_ADRES | 없음 |
| lat·lng | 없음 | 없음 | 없음 |
| supply_type | UPP_AIS_TP_NM·AIS_TP_CD_NM | HOUSE_SECD_NM·HOUSE_DTL_SECD_NM·RENT_SECD_NM | tyNm·seNm |
| households | dsSbd SUM_TOT_HSH_CNT 또는 HSH_CNT | 없음 | 없음 |
| supply_units | 공급정보 SIL_HSH_CNT 또는 NOW_HSH_CNT 합 | TOT_SUPLY_HSHLDCO | 없음 |
| recruit_count·application_count | 없음 | 경쟁률 API SUPLY_HSHLDCO·REQ_CNT(CMPET_RATE) | 없음 |
| post_date | PAN_DT·PAN_NT_ST_DT | RCRIT_PBLANC_DE | crtYmd |
| apply_start·end_date | dsSplScdl SBSC_ACP_ST_DT·CLSG_DT(임대) 또는 순위별 ACP_DTTM 문자열(분양) | RCEPT_BGNDE·ENDDE(APT 외 SUBSCRPT_RCEPT_*) | 없음 |
| contract_date | CTRT_ST_DT·CTRT_ED_DT | CNTRCT_CNCLS_BGNDE·ENDDE | 없음 |
| move_in_month | MVIN_XPC_YM(자유형식 "2019년 12월", "2015.10") | MVN_PREARNGE_YM | 없음 |
| apply_url | DTL_URL(_MOB) | PBLANC_URL·HMPG_ADRES | link |
| image_url | dsSbdAhfl AHFL_URL(조감도·배치도) | 없음 | 없음 |
| cancelled_at | 없음 — PAN_SS '정정공고중', dsEtcInfo CRC_RSN으로 추론만 | 없음 | 없음 |

당첨자발표일(LH PZWR_ANC_DT, 청약홈 PRZWNER_PRESNATN_DE)과 공고 PDF(LH dsAhflInfo AHFL_URL)도 받을 수 있다 — 지금 테이블에는 열이 없다.

### 5.2 floorplans·units

| 열 | LH | 청약홈 |
|----|----|--------|
| 전용면적 | RSDN_DDO_AR 또는 DDO_AR | HOUSE_TY(주택형 문자열)·SUPLY_AR, 오피스텔 EXCLUSE_AR |
| 타입 | HTY_NM 또는 HTY_NNA | HOUSE_TY·TP |
| 평면도 이미지 | **없음** | **없음** |
| 공급 세대(units) | SIL_HSH_CNT·NOW_HSH_CNT(금회)·TOT_HSH_CNT | SUPLY_HSHLDCO(일반)·SPSPLY_HSHLDCO(특공) |
| 가격(units) | SIL_AMT(평균분양가, 원)·LS_GMY(보증금)·RFE/MM_RFE(월세). "공고문 참조" 같은 문자열도 있다 | LTTOT_TOP_AMOUNT(최고분양가, 만원) |

---

## 6. 원천 식별자와 중복 공고

| 원천 | 식별자 후보 | 비고 |
|------|-------------|------|
| LH | (PAN_ID, CCR_CNNT_SYS_DS_CD) | PAN_ID 형식이 연계시스템마다 다르다(0000059250·2015122300004663·BN-0001490). 상세 호출용 SPL_INF_TP_CD·UPP_AIS_TP_CD·AIS_TP_CD도 함께 저장 |
| 청약홈 | (HOUSE_MANAGE_NO, PBLANC_NO), 주택형은 + MODEL_NO | |
| IH | link | ID 필드 없음 |
| SH(RSS) | link의 seq | |

- **같은 공고가 두 원천에 있다.** 2026-10-23 확인: LH '시흥거모 S-1블록 공공분양주택'(panId 0000061186)이 청약홈 APT '국민'에 '시흥거모지구 S-1블록 공공분양(본청약)'으로 있다. SH 고덕강일 3단지·마곡 17단지 토지임대부도 청약홈에 있다.
- 두 원천 사이에 공통 ID가 없고 이름도 다르다 — 정규화한 주택명 + 모집공고일 + 주소로 맞춘다.
- 청약홈 화면은 이런 공공분양의 경쟁률에 '사업주체문의'를 보여 준다. API에 값이 있는지는 미확인.

---

## 7. 설계에 주는 영향

| # | 내용 | 관련 |
|---|------|------|
| 1 | 원천 키는 원천별 복합값을 한 문자열로 담는다(예: `LH:<연계시스템>:<PAN_ID>`, `APPLYHOME:<주택관리번호>:<공고번호>`). ERD v0.3 notice_sources의 PK(source, source_key)로 받는다(원천 이름은 source 열에 따로 두어 키에서는 뺀다). 정정본의 새 PAN_ID도 같은 공고의 원천 참조로 더한다 | ERD §4.2, 규칙 7 |
| 2 | 같은 공고가 기관 원천과 청약홈에 함께 있으면 **기관 원천을 기준**으로 두고, 청약홈은 경쟁률·특공 등 보조 값만 채운다(값마다 정하는 원천은 ERD 규칙 12). 매칭 실패분은 sync_failures(WARNING, MATCH)로 보내 사람이 확인한다 | ERD §5 규칙 12·13. 옛 근거: ERD 초안 §5.2 |
| 3 | 공급 주택형(units)의 가격·세대는 LH 공급정보·청약홈 주택형(Mdl)에서 받는다. 금액은 원 단위 정수 열(보증금·월임대료·분양가)에 담고, 숫자가 아닐 때("공고문 참조")는 금액을 비우고 안내 문자열(price_note)에 원문을 둔다 | ERD §4.7, 규칙 10 |
| 4 | **평면도는 어느 API에도 없다** — 공고 PDF에서 추출하는 지금의 web 트레이싱 도구 사슬을 S4(평면도 자산)로 옮겨야 한다 | 개발계획서 S4 |
| 5 | 좌표가 없어 Kakao 지오코딩을 유지한다. '○○택지개발지구 내 A83블록' 같은 블록 주소는 실패할 수 있어 지오코딩 상태(complexes.geocode_status)·수동 보정(MANUAL) 경로를 둔다 | ERD §4.3 |
| 6 | 취소는 원천에 명시 필드가 없다 — 정정·취소 사유로 추론하되, 확실하지 않으면 관리자 확인으로 넘긴다(관리자만 '취소' 지정, ERD 초안 D8) | ERD 초안 D8 |
| 7 | 입주 예정월·분양 접수일 등 자유형식 문자열은 파서로 바꾸고, 못 읽으면 비워 둔다(A3 공백 처리) | backend.rule A3 |
| 8 | SH·GH는 API가 없다 — 마이홈 API에 담기는지 먼저 확인하고, 없으면 SH RSS·GH 게시판 수집을 검토한다. SH는 게시판·RSS 수집이 허용되나 GH는 robots로 전체 차단이라 정식 제공신청이 필요하다 | §8 |
| 9 | LH API 3종은 각각 하루 10,000건·30tps다. 목록은 수시로, 상세·공급정보는 새로 생기거나 바뀐 공고만 부른다 | 개발계획서 §3.2 |

---

## 8. 4개 기관 모두 받기 위한 수집 전략

요구사항: LH·SH·GH·IH 공고를 **빠짐없이** 받는다. 한 원천으로는 안 되므로 기관마다 주 원천과 보완 원천을 겹쳐 두고, 마지막 안전망으로 관리자 등록(API-110~113 관리자 공고 관리)을 둔다.

| 기관 | 주 원천 | 보완 원천 | 그래도 빠지는 것 → 처리 |
|------|---------|-----------|------------------------|
| LH | LH API 3종(분양·임대·신혼희망·주거복지 전부) | 청약홈(공공분양 경쟁률) | 거의 없음 |
| SH | 청약홈(공공분양·토지임대부만, 연 수 건) | SH RSS(공고 목록·링크) | **임대 공고는 어떤 API에도 없다**(마이홈 0건, §10.1) → 정식 제공신청(아래)이 필수. 결과 전에는 RSS로 공고를 감지하고 관리자가 공고문을 보고 보완 |
| GH | 청약홈(분양만, 연 십여 건) | 기존 파일 API(15119414 모집정보 등, 연간 갱신 — 초기 데이터·주택관리번호용) | **임대 공고는 어떤 API에도 없고** 사이트 자동 수집도 막혀 있다(robots 전체 차단) → **정식 제공신청이 핵심**. 결과 전까지는 관리자 등록 |
| IH | IH API(목록) | 청약홈(분양만, 연 수 건) · IH 공고 상세 페이지(수집 허용) | IH API가 지금 504(서비스 연결실패) — 복구를 기다리며 포털에 오류 신고. 상세 일정·공급정보는 상세 페이지 파싱, 실패 시 관리자 보완 |

- 동기화는 원천마다 결과(가져온 수·새 공고·실패)를 sync_runs에 남긴다. 관리자 화면에서 **기관별로 최근 공고가 끊기지 않았는지** 볼 수 있게 한다(빠짐 감지).
- 같은 공고가 여러 원천에 있으면 §6 규칙으로 하나로 합친다.

### 8.1 공공데이터 제공신청 (SH·GH, 필요하면 IH 상세)
- 근거: 「공공데이터의 제공 및 이용 활성화에 관한 법률」 제27조. 공공기관은 신청을 받은 날부터 **10일 이내**(부득이하면 10일 연장)에 제공 여부를 정해야 한다. 거부 사유는 정보공개법상 비공개 정보이거나 제3자 권리(저작권 등)가 있는 경우로 한정된다.
- 거부되면 통지받은 날부터 **60일 이내** 공공데이터 분쟁조정을 신청할 수 있다(02-6191-2064, odmc@nia.or.kr).
- 경로: 공공데이터포털 > 공공데이터 > 공공데이터 제공신청 > 제공신청서 작성.

## 9. 인증키 신청 우선순위 (사용자 조치)

| 순위 | API | 승인 | 이유 |
|------|-----|------|------|
| 1 | 청약홈 분양정보 15098547 | 개발 자동·운영 심의 | 운영 심의가 가장 오래 걸린다 |
| 2 | LH 공고문 15058530 + 상세 15057999 + 공급정보 15056765 | 자동 | LH 주 원천 |
| 3 | 마이홈 모집공고 15108420 | 자동 | LH·타 지역 공사 공고 교차 확인용(SH·GH·IH는 없음, §10.1) |
| 4 | 청약홈 경쟁률 15098905 | 개발 자동·운영 심의 | 신청 인원·경쟁률 |
| 5 | IH 공고문 15149725 | 개발 자동·운영 심의 | IH 목록 |

공공데이터포털 한 계정으로 신청하면 모든 API가 같은 일반 인증키를 쓴다. 키는 zipboda-api의 `.env`에만 두고 커밋하지 않는다.

---

## 10. 미확인 사항과 확인 결과

### 10.1 개발키 호출 결과 (2026-10-27)

| API | 결과 |
|-----|------|
| LH 공고문·상세·공급정보 | 정상. 목록은 `[{dsSch}, {dsList, resHeader}]`, 상세는 dsSbd·dsSplScdl·dsAhflInfo 등, 공급정보는 dsList01(층·호·전용면적·보증금·월세). 목록에 **상가(임대상가)** 공고도 섞여 UPP_AIS_TP_CD로 걸러야 한다. 날짜는 "2026.10.13" 형식 |
| 청약홈 분양정보·주택형·경쟁률 | 정상(APT 공고 2,916건, 주택형 14,933건, 경쟁률 55,524건) |
| 마이홈 임대·분양 모집공고 | 정상. 응답 `response.body.item[]`, 필드 pblancId·pblancNm·suplyInsttNm·suplyTyNm·rcritPblancDe·przwnerPresnatnDe·beginDe·endDe·fullAdres·pnu·totHshldCo·sumSuplyCo·rentGtn·mtRntchrg·url 등. **그러나 지금 조회되는 임대 189건·분양 64건 중 SH·GH·IH는 0건**(LH 176·62건, 나머지는 경북·광주·제주·강원 공사) |
| IH 공고문 | HTTP 504 `SERVICETIMEOUT_ERROR`(서비스 연결실패) — 포털이 IH 서버에 닿지 못한다. 키 문제가 아니다 |
| GH 파일 API(15119414·15119391 자동변환) | HTTP 401 '유효하지 않은 인증키' — 활용신청이 안 됐거나 반영 전 |

**청약홈의 SH·GH·IH 공고(최근 1년, 사업주체명 기준)**: APT는 SH 2건(토지임대부)·GH 2건·IH 1건, 무순위·잔여는 GH 5건·IH 1건, 임의공급은 GH 8건. 모두 분양이고 **SH·GH·IH의 임대(행복주택·국민임대·매입임대·장기전세) 공고는 어떤 API에도 없다** — §8.1 제공신청이 필수다.

### 10.2 남은 미확인 사항

| # | 항목 | 확인 방법 |
|---|------|-----------|
| 1 | ~~LH 목록의 기간 파라미터명~~ **확인**: 활용가이드 이름(PAN_ST_DT·PAN_ED_DT)이 적용된다(서울 조회 16건→21건). 포털 이름(PAN_NT_ST_DT·CLSG_DT)은 무시된다 | — |
| 2 | ~~마이홈에 SH·GH·IH 공고가 담기는지~~ **확인**: 담기지 않는다(10.1) | — |
| 3 | 청약홈 공공분양 경쟁률 값 유무 | 시흥거모 S-1 등 아는 공고로 경쟁률 API 호출 |
| 4 | ~~GH·IH 공공분양이 청약홈에 올라오는지~~ **확인**: 일부 올라온다(10.1) | — |
| 5 | GH 파일데이터 '지도링크URL' 내용 | 활용신청 후 호출 |
| 6 | SH 공고문 첨부파일 경로가 robots 차단 경로(/upload) 아래인지, SH 이용약관상 수집 허용 범위 | 공고 하나의 첨부 링크 확인, 이용약관 확인(필요 시 기관 문의) |
| 7 | GH·SH 제공신청 결과(제공 형태·필드·갱신 주기) | 신청 후 10~20일 안에 통지 |

---

## 11. 출처

- LH: https://www.data.go.kr/data/15058530/openapi.do · https://www.data.go.kr/data/15057999/openapi.do · https://www.data.go.kr/data/15056765/openapi.do · https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancList.do?mi=1026
- 청약홈: https://www.data.go.kr/data/15098547/openapi.do · https://www.data.go.kr/data/15098905/openapi.do · https://infuser.odcloud.kr/api/stages/37000/api-docs · https://infuser.odcloud.kr/api/stages/36148/api-docs · https://www.applyhome.co.kr/ai/aia/selectAPTLttotPblancListView.do
- IH: https://www.data.go.kr/data/15149725/openapi.do · https://www.ih.co.kr/main/guide/rss.jsp
- SH: https://data.seoul.go.kr/dataList/OA-12918/F/1/datasetView.do · https://www.i-sh.co.kr/main/lay2/program/S1T294C295/www/rss/rssNoticeWrite.do
- GH: https://www.gh.or.kr/gh/announcement-of-salerental001.do · https://www.data.go.kr/data/15119414/fileData.do · https://www.data.go.kr/data/15119391/fileData.do
- 마이홈: https://www.data.go.kr/data/15108420/openapi.do
- 제공신청: https://www.data.go.kr/tcs/dor/insertDataOfferReqstProcssView.do
- robots.txt: https://www.i-sh.co.kr/robots.txt · https://www.gh.or.kr/robots.txt · https://www.ih.co.kr/robots.txt
