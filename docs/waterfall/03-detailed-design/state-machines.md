# 상태 머신 및 시퀀스 다이어그램

| 항목 | 내용 |
|------|------|
| 문서 번호 | WF-03-02 |
| 버전 | v1.0 |
| 작성일 | 2026-06-11 |
| 작성자 | 개발팀 |
| 상태 | 확정 |

---

## 1. ConversionJob 상태 머신

```mermaid
stateDiagram-v2
    [*] --> pending : 업로드 완료

    pending --> running   : inline 변환 (USE_QUEUE=false)
    pending --> queued    : 큐 등록 (USE_QUEUE=true)

    queued --> running    : worker.claimNext() 성공\n(낙관적 잠금 획득)

    running --> success   : 변환 성공 + S3 저장 완료
    running --> failed    : 변환 실패 (attempts >= maxAttempts)
    running --> queued    : 변환 실패 (attempts < maxAttempts)\n→ retryOrGiveUp() → markPending → re-enqueue

    failed --> [*]        : 최종 실패 (재시도 소진)
    success --> [*]       : 완료

    note right of running
        stuck-running reaper:
        lockedAt > 10분 → 자동 재시도
    end note
```

### 상태 전이 상세

| 이전 상태 | 이후 상태 | 트리거 | 담당 모듈 |
|-----------|-----------|--------|-----------|
| `pending` | `running` | `USE_QUEUE=false`일 때 업로드 직후 인라인 실행 | `routes/convert.ts` |
| `pending` | `queued` | `USE_QUEUE=true`일 때 큐에 등록 | `routes/convert.ts` |
| `queued` | `running` | `worker.claimNext()` 낙관적 잠금 성공 | `queue/worker.ts` |
| `running` | `success` | 변환 완료, S3 업로드, DB 업데이트 | `jobs/jobService.ts` |
| `running` | `queued` | 실패 but `attempts < maxAttempts` | `queue/jobQueue.ts` |
| `running` | `failed` | 실패 and `attempts >= maxAttempts` | `queue/jobQueue.ts` |
| `running` | `queued` | stuck-running reaper가 10분 초과 감지 | `queue/worker.ts` |

---

## 2. 품질 상태 결정 로직

```mermaid
flowchart TD
    A[변환 시도 목록 + warnings 수집] --> B{전체 실패?}
    B -- 예 --> Z[status: failed]
    B -- 아니오 --> C{실패 시도 존재?\nOR warnings 존재?}
    C -- 예 --> Y[status: review]
    C -- 아니오 --> X[status: passed]

    X --> G1[grade 계산]
    Y --> G1
    G1 --> G2{성공 엔진?}
    G2 -- Hancom / rhwp-cli precise --> GA[grade: good]
    G2 -- rhwp Python --> GB[grade: acceptable]
    G2 -- H2Orestart / builtin --> GC[grade: fallback]
    G2 -- 없음 --> GD[grade: failed]

    GC --> QG{Office precise 모드?}
    QG -- 예 --> QE[QualityGateError 발생\n변환 결과 거부]
    QG -- 아니오 --> QOK[결과 반환]
    GA --> QOK
    GB --> QOK
```

---

## 3. 워커 폴 시퀀스 다이어그램

```mermaid
sequenceDiagram
    participant W as Worker (poll loop)
    participant Q as JobQueue
    participant DB as Database
    participant E as Engine Chain
    participant S as S3 Storage

    loop 2초 간격
        W->>Q: claimNext()
        Q->>DB: SELECT id WHERE status='queued'\nAND (lockedAt IS NULL\nOR lockedAt < now()-10m)\nLIMIT 1 FOR UPDATE
        alt 잡 없음
            DB-->>Q: null
            Q-->>W: null
            W->>W: sleep 2s
        else 잡 획득
            DB-->>Q: job row
            Q->>DB: UPDATE lockedAt=now(), lockedBy=workerId
            Q-->>W: job

            W->>E: runEngineChain(job)
            loop 엔진 체인 순회
                E->>E: converter.convert(input, output)
                alt 성공
                    E->>E: attempts.push(success)
                    E->>E: break
                else 실패
                    E->>E: attempts.push(failure)
                    E->>E: continue 다음 엔진
                end
            end

            alt 변환 성공
                E->>S: storage.put(pdfBuffer)
                S-->>E: s3Key
                E-->>W: qualityReport
                W->>DB: markSuccess(jobId, s3Key, qualityReport)
            else 변환 실패
                E-->>W: ConversionError
                W->>Q: retryOrGiveUp(jobId)
                Q->>DB: attempts++
                alt attempts >= maxAttempts
                    Q->>DB: markFailed(jobId)
                else
                    Q->>DB: markPending(jobId)\nlockedAt=NULL
                end
            end
        end
    end
```

---

## 4. 엔진 체인 폴백 시퀀스

```mermaid
sequenceDiagram
    participant C as Caller (convert route / worker)
    participant R as Registry
    participant E1 as Hancom SDK
    participant E2 as rhwp-cli
    participant E3 as rhwp Python
    participant E4 as H2Orestart
    participant E5 as Builtin

    C->>R: getChain('hwp', 'precise')
    R-->>C: [E1?, E2?, E3?, E4, E5]

    Note over C: enabled 엔진만 포함됨

    C->>E1: convert(input, output)
    alt E1 성공
        E1-->>C: OK (grade: good)
        Note over C: attempts=[{E1,good,success}]
    else E1 실패 또는 비활성
        E1-->>C: ConversionError
        Note over C: attempts=[{E1,good,failure}]

        C->>E2: convert(input, output)
        alt E2 성공
            E2-->>C: OK (grade: good)
        else E2 실패
            E2-->>C: ConversionError

            C->>E3: convert(input, output)
            alt E3 성공
                E3-->>C: OK (grade: acceptable)
            else E3 실패
                E3-->>C: ConversionError

                C->>E4: convert(input, output)
                alt E4 성공
                    E4-->>C: OK (grade: fallback)
                else E4 실패
                    E4-->>C: ConversionError

                    C->>E5: convert(input, output)
                    E5-->>C: OK (grade: fallback)
                end
            end
        end
    end

    C->>C: normalizeQualityReport(attempts, warnings)
    C-->>Caller: { pdf, qualityReport }
```

---

## 5. 인증 흐름

### 5.1 Google OAuth 시퀀스

```mermaid
sequenceDiagram
    participant U as 사용자 브라우저
    participant W as Web (Next.js)
    participant A as API (Fastify)
    participant G as Google OAuth

    U->>W: GET /sign-in
    W->>U: 로그인 페이지 렌더

    U->>W: "Google로 로그인" 클릭
    W->>G: 302 redirect (state, nonce 포함)
    G->>U: Google 동의 화면

    U->>G: 자격증명 입력 + 동의
    G->>W: 302 callback?code=AUTH_CODE&state=STATE

    W->>G: token exchange (code → access_token, id_token)
    G-->>W: { access_token, id_token }

    W->>W: Auth.js: 세션 생성, 쿠키 발급
    W->>U: 세션 쿠키 Set-Cookie + 리다이렉트 → /dashboard

    U->>A: POST /convert (쿠키 포함)
    A->>A: authPlugin: 세션 쿠키 검증
    A-->>U: 변환 결과
```

### 5.2 DEV_AUTH=1 분기

```mermaid
flowchart LR
    START([요청 수신]) --> CHECK{DEV_AUTH=1?}
    CHECK -- 예 --> DEV[고정 개발 계정 주입\ndev@example.com\n인증 생략]
    CHECK -- 아니오 --> PROD[Auth.js 세션 쿠키 검증]
    DEV --> HANDLER[라우트 핸들러]
    PROD --> VALID{유효한 세션?}
    VALID -- 예 --> HANDLER
    VALID -- 아니오 --> 401[401 Unauthorized]
```

---

## 6. CSRF 검증 흐름

```mermaid
flowchart TD
    REQ([HTTP 요청]) --> METHOD{메서드?}
    METHOD -- GET / HEAD / OPTIONS --> SKIP[CSRF 검증 생략]
    METHOD -- POST / PUT / DELETE / PATCH --> ORIGIN{Origin 헤더 존재?}

    ORIGIN -- 없음 --> REJECT[403 Forbidden\nOrigin 헤더 누락]
    ORIGIN -- 있음 --> COMPARE{Origin == WEB_ORIGIN?}

    COMPARE -- 일치 --> PASS[요청 통과]
    COMPARE -- 불일치 --> REJECT2[403 Forbidden\nCSRF 검증 실패]

    SKIP --> HANDLER[라우트 핸들러 실행]
    PASS --> HANDLER
```

`WEB_ORIGIN`은 환경변수 `WEB_ORIGIN`으로 설정되며, 기본값은 `http://localhost:3000`이다. Nginx/로드밸런서 뒤에서 동작 시 `trustProxy: true` 설정이 필요하다.

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|-----------|--------|
| v1.0 | 2026-06-11 | 최초 작성 | 개발팀 |
