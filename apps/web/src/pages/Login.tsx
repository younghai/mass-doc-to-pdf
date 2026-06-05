import { api } from "../api/client";

export function Login() {
  return (
    <div className="login">
      <div className="login-card">
        <h1>hwptopdf</h1>
        <p>HWP·HWPX·DOCX·XLSX·PPTX 문서를 PDF로 변환하세요</p>
        <a className="btn-google" href={api.signInUrl()}>
          Google로 로그인
        </a>
      </div>
    </div>
  );
}
