import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { configError } from "./lib/supabase";
import { EmployeeHome } from "./pages/EmployeeHome";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Decisions } from "./pages/admin/Decisions";
import { Employees } from "./pages/admin/Employees";
import { Period } from "./pages/admin/Period";
import { Shifts } from "./pages/admin/Shifts";
import { Today } from "./pages/admin/Today";

function Guard({ role, children }: { role: "admin" | "employee"; children: ReactNode }) {
  const { session, info, error } = useAuth();
  const location = useLocation();
  if (session === undefined || (session && !info && !error)) return <Spinner label="Validando sesión…" />;
  if (!session || !info) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  if (info.role !== role) return <Navigate to={info.role === "admin" ? "/admin" : "/marcar"} replace />;
  return <>{children}</>;
}

function Home() {
  const { session, info, error } = useAuth();
  if (session === undefined || (session && !info && !error)) return <Spinner />;
  if (!info) return <Navigate to="/entrar" replace />;
  return <Navigate to={info.role === "admin" ? "/admin" : "/marcar"} replace />;
}

export function App() {
  if (configError) {
    return (
      <div className="center-page">
        <div className="card">
          <h1>Configuración incompleta</h1>
          <p>{configError}</p>
        </div>
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/entrar" element={<Login />} />
      <Route path="/c/:code" element={<Login />} />
      <Route path="/registro" element={<Register />} />
      <Route
        path="/marcar"
        element={
          <Guard role="employee">
            <EmployeeHome />
          </Guard>
        }
      />
      <Route
        path="/admin"
        element={
          <Guard role="admin">
            <AdminLayout />
          </Guard>
        }
      >
        <Route index element={<Today />} />
        <Route path="colaboradores" element={<Employees />} />
        <Route path="marcajes" element={<Shifts />} />
        <Route path="periodo" element={<Period />} />
        <Route path="decisiones" element={<Decisions />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
