import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { api } from "../lib/api";
import { useAdmin } from "../lib/auth";
import { Logo } from "./Logo";
import { LogoutButton } from "./LogoutButton";

const PIN_POLL_MS = 60_000;
/** Lo dispara Equipo al atender una solicitud, para que la campana se actualice de una vez. */
export const PIN_REQUESTS_CHANGED = "marcaje:pin-requests-changed";

function usePinRequestCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = () => {
      Promise.all([api.pinRequests(), api.shiftChanges()])
        .then(([pins, changes]) => setCount(pins.requests.length + changes.requests.length))
        .catch(() => {}); // es un aviso: se reintenta en el siguiente ciclo
    };
    load();
    const id = setInterval(load, PIN_POLL_MS);
    window.addEventListener(PIN_REQUESTS_CHANGED, load);
    return () => {
      clearInterval(id);
      window.removeEventListener(PIN_REQUESTS_CHANGED, load);
    };
  }, []);
  return count;
}

const NAV = [
  { to: "/admin", label: "Hoy", end: true },
  { to: "/admin/marcajes", label: "Marcajes" },
  { to: "/admin/periodo", label: "Período" },
  { to: "/admin/colaboradores", label: "Equipo" },
];

export function AdminLayout() {
  const info = useAdmin();
  const pinRequests = usePinRequestCount();
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
          <Link className={`bell${pinRequests ? " has-alerts" : ""}`} to="/admin/colaboradores" aria-label={pinRequests ? `${pinRequests} solicitudes pendientes` : "Sin solicitudes pendientes"} title={pinRequests ? "Solicitudes pendientes" : "Sin solicitudes pendientes"}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {pinRequests > 0 && <span className="bell-count">{pinRequests}</span>}
          </Link>
          <LogoutButton />
        </div>
      </header>
      {offline && <div className="sync-bar is-offline flat">Sin conexión. RRHH necesita internet para ver datos actualizados, corregir y exportar.</div>}
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
