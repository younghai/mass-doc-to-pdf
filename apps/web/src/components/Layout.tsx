import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/useSession";

const NAV = [
  { to: "/", label: "대시보드" },
  { to: "/upload", label: "업로드" },
  { to: "/jobs", label: "변환 내역" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { pathname } = useLocation();
  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/" className="brand">
          hwptopdf
        </Link>
        <nav>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={pathname === n.to ? "active" : ""}>
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
