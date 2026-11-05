import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAdmin, useAuth } from "../lib/auth";
import { Logo } from "./Logo";

const NAV = [
  { to: "/admin", label: "Hoy", end: true },
  { to: "/admin/marcajes", label: "Marcajes" },
  { to: "/admin/periodo", label: "Período" },
  { to: "/admin/colaboradores", label: "Equipo" },
];

export function AdminLayout() {
  const info = useAdmin();
  const { logout } = useAuth();
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Logo />
          <nav className="tabs" aria-label="Secciones">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-company">
            <span className="avatar" aria-hidden>
              {info.company.name.charAt(0).toUpperCase()}
            </span>
            <span className="topbar-company-name">{info.company.name}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Salir
          </button>
        </div>
      </header>
      {offline && <div className="sync-bar is-offline flat">Sin conexión. RRHH necesita internet para ver datos actualizados, corregir y exportar.</div>}
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
