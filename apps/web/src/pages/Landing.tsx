import { Link } from "react-router-dom";

const FEATURE_ITEMS = [
  { label: "품질 리포트", text: "각 변환 결과를 passed · review · failed로 판정하고 이유를 남깁니다." },
  { label: "엔진 체인", text: "정밀 엔진을 먼저 시도하고 저품질 위험은 fallback 경로와 함께 기록합니다." },
  { label: "검수 워크플로우", text: "review 출력은 자동 분리해 수동 검수와 재시도로 이어집니다." },
] as const;

const WORKFLOW_ITEMS = [
  "문서를 업로드하고 변환 작업을 생성합니다.",
  "엔진별 변환 상태와 실패 사유를 작업 큐에서 확인합니다.",
  "완료된 PDF를 상세 화면에서 다운로드합니다.",
] as const;

export function Landing() {
  return (
    <div className="site">
      <header className="site-nav">
        <Link to="/" className="site-brand">
          <span className="brand-mark">h</span>
          <span>hwptopdf</span>
        </Link>
        <nav>
          <a href="#features">기능</a>
          <a href="#workflow">서비스 흐름</a>
          <Link to="/service">운영 화면</Link>
        </nav>
        <Link to="/service/upload" className="btn">
          문서 변환 시작
        </Link>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Document Conversion Operations</p>
            <h1>hwptopdf</h1>
            <h2>우리는 변환 성공이 아니라 품질을 판정합니다 — passed · review · failed</h2>
            <p>
              저품질(review) 출력은 자동으로 분리해 검수자가 원본과 비교할 수 있게 합니다.
            </p>
            <div className="hero-actions">
              <Link to="/service/upload" className="btn">
                서비스 사용하기
              </Link>
              <Link to="/service/jobs" className="btn btn-secondary">
                작업 큐 보기
              </Link>
            </div>
          </div>

          <div className="hero-preview" aria-label="서비스 운영 화면 미리보기">
            <div className="preview-toolbar">
              <span>
                운영 현황 <span className="mini-pill running">예시</span>
              </span>
              <button type="button">새 변환</button>
            </div>
            <div className="preview-grid">
              <div>
                <small>진행 중</small>
                <strong>12</strong>
                <span className="mini-pill running">처리 중</span>
              </div>
              <div>
                <small>성공률</small>
                <strong>94%</strong>
                <span className="mini-pill success">안정</span>
              </div>
              <div>
                <small>실패</small>
                <strong>3</strong>
                <span className="mini-pill danger">확인 필요</span>
              </div>
            </div>
            <table className="preview-table">
              <tbody>
                <tr>
                  <td>계약서.hwpx</td>
                  <td>HWPX</td>
                  <td>
                    <span className="mini-pill running">진행 중</span>
                  </td>
                </tr>
                <tr>
                  <td>제안서.pptx</td>
                  <td>PPTX</td>
                  <td>
                    <span className="mini-pill success">완료</span>
                  </td>
                </tr>
                <tr>
                  <td>정산표.xlsx</td>
                  <td>XLSX</td>
                  <td>
                    <span className="mini-pill danger">실패</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="landing-section" id="features">
          <div>
            <p className="eyebrow">Service Features</p>
            <h2>결과 품질을 판정하고 검수 흐름으로 연결합니다.</h2>
          </div>
          <div className="feature-row">
            {FEATURE_ITEMS.map((item) => (
              <article key={item.label}>
                <h3>{item.label}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section workflow" id="workflow">
          <div>
            <p className="eyebrow">Workflow</p>
            <h2>업로드에서 다운로드까지 한 메뉴 안에서 끝냅니다.</h2>
          </div>
          <ol>
            {WORKFLOW_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
          <Link to="/service" className="btn">
            서비스 UI 열기
          </Link>
        </section>
      </main>
    </div>
  );
}
