import type { ReactElement } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "./auth/useSession";
import { Layout } from "./components/Layout";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Upload } from "./pages/Upload";
import { BatchUpload } from "./pages/BatchUpload";
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
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/service"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/service/upload"
        element={
          <RequireAuth>
            <Upload />
          </RequireAuth>
        }
      />
      <Route
        path="/service/batch"
        element={
          <RequireAuth>
            <BatchUpload />
          </RequireAuth>
        }
      />
      <Route
        path="/service/jobs"
        element={
          <RequireAuth>
            <Jobs />
          </RequireAuth>
        }
      />
      <Route
        path="/service/jobs/:id"
        element={
          <RequireAuth>
            <JobDetail />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
