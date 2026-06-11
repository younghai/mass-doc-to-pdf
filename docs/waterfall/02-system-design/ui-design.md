# UI 설계서 (UI Design)

> Mass Doc to PDF (mass-doc-to-pdf)의 프론트엔드 UI 설계서. 화면 목록, 각 화면 상세 스펙, 공용 컴포넌트, API 통신 패턴, 반응형/접근성 고려사항을 정의한다.

| 항목 | 내용 |
| --- | --- |
| **프로젝트명** | Mass Doc to PDF (mass-doc-to-pdf) |
| **문서 버전** | v1.0 |
| **작성일** | 2026-06-11 |
| **최종 수정일** | 2026-06-11 |
| **작성자** | 개발팀 |
| **문서 상태** | 작성 완료 |

---

## 1. 기술 스택

| 항목 | 기술 | 버전 | 역할 |
| --- | --- | --- | --- |
| UI 프레임워크 | React | 18 | 컴포넌트 기반 UI |
| 빌드 도구 | Vite | 5+ | 번들링, HMR, 환경 변수 |
| 서버 상태 관리 | TanStack Query | 5 | API 캐싱, 폴링, 낙관적 업데이트 |
| 스타일링 | TailwindCSS | 3 | 유틸리티 기반 CSS |
| 라우팅 | React Router | 6 | SPA 클라이언트 라우팅 |
| 서빙 | Nginx | - | Docker 컨테이너 정적 파일 서빙 (포트 8081) |

---

## 2. 화면 목록

| 경로 | 화면명 | 설명 | 인증 필요 |
| --- | --- | --- | --- |
| `/` | Landing | 서비스 소개, 시작 버튼 | N |
| `/login` | Login | Google OAuth 로그인, DEV_AUTH 안내 | N |
| `/upload` | Upload | 단건 파일 업로드 및 즉시 결과 표시 | Y |
| `/batch` | BatchUpload | 다중 파일 일괄 업로드, 진행률 집계 | Y |
| `/jobs` | Jobs | 전체 작업 목록, 상태 필터 탭 | Y |
| `/jobs/:id` | JobDetail | 작업 상세, 품질 리포트, PDF 미리보기 | Y |
| `/dashboard` | Dashboard | 통계 요약, 성공률 차트 | Y |

---

## 3. 화면 상세

### 3.1 Landing (`/`)

| 항목 | 내용 |
| --- | --- |
| **목적** | 서비스 첫인상 전달, 로그인 유도 |
| **인증** | 불필요 (공개) |

**주요 기능:**
- 서비스명 (Mass Doc to PDF), 한 줄 설명, 지원 포맷 아이콘 배지 표시
- "지금 시작하기" CTA 버튼 → `/login` 또는 이미 로그인 시 `/upload`로 이동
- 지원 파일 형식 목록 (HWP, HWPX, DOC, DOCX, PPT, PPTX, XLS, XLSX)
- 변환 흐름 3단계 설명 (업로드 → 변환 → 다운로드)

**UI 상태:**
- 이미 인증된 사용자가 접근 시 `/upload`로 자동 리다이렉트

---

### 3.2 Login (`/login`)

| 항목 | 내용 |
| --- | --- |
| **목적** | Google OAuth 인증 진입 |
| **인증** | 불필요 (공개) |

**주요 기능:**
- Google 계정으로 로그인 버튼 (Google OAuth 표준 버튼)
- 클릭 시 `GET /api/auth/signin/google` 호출
- 로그인 성공 후 `/upload`로 리다이렉트

**DEV_AUTH 모드 안내:**
- `VITE_DEV_AUTH=true` 환경 변수 설정 시 "개발 모드로 입장" 버튼 추가 표시
- 클릭 시 `POST /api/auth/dev-login` 호출하여 세션 생성

**UI 상태:**
- 이미 인증된 사용자가 접근 시 `/upload`로 자동 리다이렉트
- 로딩 중 버튼 비활성화 + 스피너 표시

---

### 3.3 Upload (`/upload`)

| 항목 | 내용 |
| --- | --- |
| **목적** | 단건 파일 업로드 및 즉시 변환 결과 확인 |
| **인증** | 필요 |
| **API 호출** | `POST /api/convert`, `GET /api/jobs/:id` (폴링) |

**주요 기능:**
- `Dropzone` 컴포넌트: 드래그앤드롭 또는 파일 선택 클릭
- `qualityMode` 선택 라디오 버튼 (precise / quick, HWP 파일일 때만 표시)
- 업로드 중 프로그레스 바 (XHR progress 이벤트 기반)
- 업로드 완료 → `status=queued/pending` 시 폴링 시작
- 변환 완료(success/failed) → 인라인 결과 카드 표시

**API 통신:**
- `POST /api/convert` → `jobId` 획득
- `USE_QUEUE=0` 시 즉시 완료 JobDTO 반환
- `USE_QUEUE=1` 시 `GET /api/jobs/:id`를 2초 간격으로 폴링 (최대 5분)

**UI 상태:**

| 상태 | 표시 |
| --- | --- |
| idle | Dropzone 기본 UI |
| uploading | 프로그레스 바 + "업로드 중..." |
| converting | 스피너 + "변환 중..." + 경과 시간 |
| success | 초록 체크 배지 + 파일명 + 다운로드 버튼 + JobDetail 링크 |
| failed | 빨간 에러 배지 + 에러 메시지 + 재시도 버튼 |
| review | 노란 경고 배지 + "품질 검토 필요" + 다운로드 버튼 |

---

### 3.4 BatchUpload (`/batch`)

| 항목 | 내용 |
| --- | --- |
| **목적** | 다중 파일 일괄 업로드 및 진행률 모니터링 |
| **인증** | 필요 |
| **API 호출** | `POST /api/convert` (병렬), `GET /api/jobs` (폴링) |

**주요 기능:**
- 다중 파일 선택 (`multiple` 속성 Dropzone)
- 파일별 업로드 큐 표시 (파일명, 크기, 현재 상태)
- 전체 진행률 바: 완료 건수 / 전체 건수
- 결과 집계 카드: 성공 N건 / 실패 N건 / 검토 N건
- 실패 파일 일괄 재시도 버튼
- 완료된 파일 개별 다운로드 링크

**배치 그룹 관리:**
- 동일 업로드 세션의 Job들은 `batchId`로 그룹화
- `GET /api/jobs?status=` 폴링으로 배치 내 전체 상태 갱신

**UI 상태:**

| 상태 | 표시 |
| --- | --- |
| idle | 파일 선택 영역 |
| pending | 파일 목록 + "업로드 시작" 버튼 |
| uploading | 파일별 프로그레스 바 |
| converting | 전체 진행률 바 + 개별 상태 아이콘 |
| completed | 결과 집계 카드 + 일괄 다운로드 옵션 |

---

### 3.5 Jobs (`/jobs`)

| 항목 | 내용 |
| --- | --- |
| **목적** | 전체 변환 작업 목록 조회, 필터, 관리 |
| **인증** | 필요 |
| **API 호출** | `GET /api/jobs?status=`, `POST /api/jobs/:id/retry`, `DELETE /api/jobs/:id` |

**주요 기능:**
- 상태 필터 탭: 전체 / 진행중(running+queued) / 성공(success) / 실패(failed) / 검토(review)
- `JobsTable` 컴포넌트: 파일명, 포맷, 크기, 상태 배지, 소요시간, 생성일, 액션
- 행 클릭 → `/jobs/:id` 이동
- 성공 행 → 다운로드 아이콘 버튼
- 실패 행 → 재시도 아이콘 버튼
- 모든 행 → 삭제 아이콘 버튼 (확인 모달)
- 진행중 작업 존재 시 10초마다 자동 새로고침

**폴링 전략:**
- `running` 또는 `queued` 상태 Job이 있을 때만 `refetchInterval: 10000` 활성화
- 모든 Job이 terminal 상태(success/failed)면 폴링 중단

---

### 3.6 JobDetail (`/jobs/:id`)

| 항목 | 내용 |
| --- | --- |
| **목적** | 단건 작업 상세 정보, 품질 리포트, 미리보기, 다운로드 |
| **인증** | 필요 |
| **API 호출** | `GET /api/jobs/:id`, `GET /api/jobs/:id/quality`, `GET /api/jobs/:id/preview`, `GET /api/jobs/:id/preview.png` |

**주요 기능:**

**상단 헤더:**
- 파일명, 포맷 배지, 크기, 생성일
- 상태 배지 (`StatusPill`): 색상 구분 (성공=초록, 실패=빨강, 검토=노랑, 진행=파랑)
- 품질 배지: `passed` (초록), `review` (노랑), `failed` (빨강) — 색맹 대응: 아이콘 병용

**미리보기 탭:**
- PDF 인라인 미리보기: `<iframe src="/api/jobs/:id/preview" />`
- PNG 첫 페이지 미리보기: `<img src="/api/jobs/:id/preview.png" />`
- 탭 전환 (PDF / 이미지)

**다운로드:**
- "PDF 다운로드" 버튼 → `GET /api/jobs/:id/download` (Content-Disposition: attachment)

**품질 리포트 섹션:**
- `GET /api/jobs/:id/quality` 응답 표시
- 엔진 시도 목록 (성공/실패 각 엔진, 소요 시간, 에러)
- 품질 검사 수치 (pageCount, pdfBytes, textChars, sourceBytes)
- 경고 목록 (`warnings[]`)
- 권장 조치 (`recommendedAction`)

**액션:**
- 실패 상태: "재시도" 버튼 → `POST /api/jobs/:id/retry`
- "삭제" 버튼 → `DELETE /api/jobs/:id` (확인 모달)

**UI 상태:**
- `running/queued` 상태이면 3초마다 폴링하여 상태 갱신
- 완료 후 폴링 중단

---

### 3.7 Dashboard (`/dashboard`)

| 항목 | 내용 |
| --- | --- |
| **목적** | 전체 변환 현황 통계 한눈에 파악 |
| **인증** | 필요 |
| **API 호출** | `GET /api/stats` |

**주요 기능:**
- `StatCard` 4종: 총 작업 수, 성공 건수, 실패 건수, 진행중 건수
- `SuccessRateChart`: 성공률 도넛 차트 또는 진행 바 (successRate %)
- 30초마다 자동 새로고침 (`refetchInterval: 30000`)
- Jobs 화면 바로가기 링크 (상태별 필터 적용)

---

## 4. 공용 컴포넌트

| 컴포넌트 | 파일 위치 | 역할 |
| --- | --- | --- |
| `Layout` | `components/Layout.tsx` | 전체 페이지 레이아웃 (헤더, 네비, 컨텐츠 영역) |
| `Dropzone` | `components/Dropzone.tsx` | 파일 드래그앤드롭 + 클릭 선택, 확장자 검증, 크기 제한 피드백 |
| `JobsTable` | `components/JobsTable.tsx` | 작업 목록 테이블 (정렬, 상태 배지, 액션 버튼) |
| `StatCard` | `components/StatCard.tsx` | 통계 수치 카드 (레이블 + 숫자 + 아이콘) |
| `StatusPill` | `components/StatusPill.tsx` | 작업 상태 배지 (색상 + 아이콘으로 색맹 대응) |
| `SuccessRateChart` | `components/SuccessRateChart.tsx` | 성공률 시각화 (도넛 또는 프로그레스 바) |
| `QualityBadge` | `components/QualityBadge.tsx` | 품질 등급 배지 (passed/review/failed + 아이콘) |

### StatusPill 상태별 스타일

| status | 배경 | 텍스트 | 아이콘 |
| --- | --- | --- | --- |
| `pending` | gray-100 | gray-600 | 시계 |
| `queued` | blue-100 | blue-700 | 대기열 |
| `running` | yellow-100 | yellow-700 | 스피너 (애니메이션) |
| `success` | green-100 | green-700 | 체크 |
| `failed` | red-100 | red-700 | X |
| `review` | amber-100 | amber-700 | 경고 삼각형 |

---

## 5. API 통신 패턴

### 5.1 TanStack Query 기본 구성

```typescript
// 작업 목록 조회 (status 필터)
const { data: jobs } = useQuery({
  queryKey: ['jobs', status],
  queryFn: () => fetchJobs(status),
  refetchInterval: hasActiveJobs(jobs) ? 10_000 : false,
});

// 작업 단건 조회 (JobDetail 폴링)
const { data: job } = useQuery({
  queryKey: ['job', id],
  queryFn: () => fetchJob(id),
  refetchInterval: isTerminal(job?.status) ? false : 3_000,
});

// 통계 조회 (Dashboard 주기적 갱신)
const { data: stats } = useQuery({
  queryKey: ['stats'],
  queryFn: fetchStats,
  refetchInterval: 30_000,
});
```

### 5.2 상태별 refetchInterval 전략

| 화면 | 조건 | refetchInterval |
| --- | --- | --- |
| Upload | `status=queued/running` | 2초 |
| Jobs | `running` 또는 `queued` Job 존재 | 10초 |
| Jobs | 모든 Job terminal 상태 | 비활성 |
| JobDetail | `status=queued/running` | 3초 |
| JobDetail | `status=success/failed` | 비활성 |
| Dashboard | 항상 | 30초 |

### 5.3 낙관적 업데이트 (Optimistic Update)

삭제 및 재시도 액션은 낙관적 업데이트를 적용하여 즉각적인 UI 반응을 제공한다.

```typescript
// 삭제 낙관적 업데이트
const deleteMutation = useMutation({
  mutationFn: (id: string) => deleteJob(id),
  onMutate: async (id) => {
    await queryClient.cancelQueries({ queryKey: ['jobs'] });
    const prev = queryClient.getQueryData(['jobs']);
    queryClient.setQueryData(['jobs'], (old) =>
      old?.filter((j) => j.id !== id)
    );
    return { prev };
  },
  onError: (_, __, ctx) => {
    queryClient.setQueryData(['jobs'], ctx?.prev);
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
});
```

---

## 6. 반응형 및 접근성 고려사항

### 6.1 반응형 레이아웃

| 브레이크포인트 | 레이아웃 |
| --- | --- |
| `sm` (640px 미만) | 1열 스택 레이아웃, 네비게이션 햄버거 메뉴 |
| `md` (640px~1024px) | 2열 그리드 (StatCard), 사이드바 축소 |
| `lg` (1024px 이상) | 3-4열 그리드 (StatCard), 사이드바 전체 표시 |

- `JobsTable`: 모바일에서 파일명/상태/액션만 표시, 나머지 컬럼 숨김
- `Dropzone`: 터치 이벤트 지원 (tap to open file picker)
- PDF 미리보기 `<iframe>`: 모바일에서 `height: 60vh` 고정

### 6.2 접근성 (a11y)

| 항목 | 적용 방법 |
| --- | --- |
| 색맹 대응 | `StatusPill`, `QualityBadge`에 색상 외 아이콘 병용 |
| 키보드 내비게이션 | 모든 버튼/링크 `Tab` 접근 가능, `Enter`/`Space` 동작 |
| ARIA 레이블 | 아이콘 전용 버튼에 `aria-label` 필수 |
| 포커스 관리 | 모달 열릴 때 포커스 트랩, 닫힐 때 트리거 버튼으로 복귀 |
| 스크린 리더 | 폴링 상태 변경 시 `aria-live="polite"` 영역에 상태 문자열 갱신 |
| 로딩 상태 | 스피너에 `role="status"` + `aria-label="변환 중"` |
| 에러 메시지 | `role="alert"` 적용으로 즉시 읽힘 |

### 6.3 성능 고려사항

| 항목 | 내용 |
| --- | --- |
| PNG 미리보기 캐시 | `Cache-Control: public, max-age=600` (서버 응답 헤더) |
| PDF `<iframe>` 지연 로드 | `loading="lazy"` 속성, 탭 전환 시 마운트 |
| TanStack Query staleTime | 통계: 25초, 작업 목록: 5초, 작업 상세: 2초 |
| 번들 분할 | React Router lazy import로 화면별 코드 스플리팅 |

---

## 7. 관련 문서

| 문서명 | 위치 |
| --- | --- |
| 서비스 기획서 | `docs/waterfall/00-planning/service-planning.md` |
| 시스템 아키텍처 설계서 | `docs/waterfall/02-system-design/system-architecture-design.md` |
| API 설계서 | `docs/waterfall/02-system-design/api-design.md` |
| DB 설계서 | `docs/waterfall/02-system-design/database-design.md` |

---

## 8. 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-11 | 개발팀 | 초안 작성 |
