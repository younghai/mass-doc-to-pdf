import type { ReactElement } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "./auth/useSession";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Upload } from "./pages/Upload";
import { Jobs } from "./pages/Jobs";
import { JobDetail } from "./pages/JobDetail";

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, isLoading } = useSession();
  if (isLoading) return <div className="app-shell">로딩 중…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/upload"
        element={
          <RequireAuth>
            <Upload />
          </RequireAuth>
        }
      />
      <Route
        path="/jobs"
        element={
          <RequireAuth>
            <Jobs />
          </RequireAuth>
        }
      />
      <Route
        path="/jobs/:id"
        element={
          <RequireAuth>
            <JobDetail />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
