import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/useSession";

const NAV = [
  { to: "/service", label: "운영 현황" },
  { to: "/service/upload", label: "문서 업로드" },
  { to: "/service/batch", label: "폴더 일괄 변환" },
  { to: "/service/jobs", label: "작업 큐" },
] as const;

function isActivePath(pathname: string, to: string): boolean {
  if (to === "/service") return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { pathname } = useLocation();
  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">h</span>
          <span>hwptopdf</span>
        </Link>
        <nav>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={isActivePath(pathname, n.to) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="user">
          {user?.email && <span className="email">{user.email}</span>}
          <a href={api.signOutUrl()} className="signout">
            로그아웃
          </a>
        </div>
      </header>
      <main className="app-shell">{children}</main>
    </div>
  );
}
