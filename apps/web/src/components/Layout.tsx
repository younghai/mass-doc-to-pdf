import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/useSession";

const PRIMARY_NAV = [
  { to: "/service", label: "운영 현황" },
  { to: "/service/upload", label: "문서 업로드" },
  { to: "/service/batch", label: "폴더 일괄 변환" },
] as const;

const MEETINGS_NAV = { to: "/labs/meetings", label: "회의록 (실험)" } as const;

const SECONDARY_NAV = [
  { to: "/service/jobs", label: "작업 큐" },
] as const;

function isActivePath(pathname: string, to: string): boolean {
  if (to === "/service") return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { pathname } = useLocation();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const meetingsEnabled = import.meta.env.VITE_ENABLE_MEETINGS === "1";
  const nav = meetingsEnabled
    ? [...PRIMARY_NAV, MEETINGS_NAV, ...SECONDARY_NAV]
    : [...PRIMARY_NAV, ...SECONDARY_NAV];
  const navId = "primary-navigation";

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">h</span>
          <span>hwptopdf</span>
        </Link>
        <button
          type="button"
          className="topbar-toggle"
          aria-controls={navId}
          aria-expanded={isMobileNavOpen}
          aria-label="모바일 탐색 메뉴"
          onClick={() => setIsMobileNavOpen((current) => !current)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
        <nav id={navId} className={`topbar-nav${isMobileNavOpen ? " is-open" : ""}`}>
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={isActivePath(pathname, n.to) ? "active" : ""}
              onClick={() => setIsMobileNavOpen(false)}
            >
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
