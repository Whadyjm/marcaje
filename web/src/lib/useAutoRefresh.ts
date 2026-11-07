import { useEffect, useRef } from "react";

/** RRHH mira datos que cambian seguido. */
export const ADMIN_REFRESH_MS = 30_000;
/** El colaborador consulta menos y suele estar con datos móviles. */
export const EMPLOYEE_REFRESH_MS = 60_000;

/**
 * Refresca cada cierto tiempo solo con la app visible y con conexión, y de inmediato
 * al volver a la app o recuperar la señal. Oculta no gasta datos ni invocaciones.
 */
export function useAutoRefresh(refresh: () => unknown, { intervalMs = ADMIN_REFRESH_MS, paused = false }: { intervalMs?: number; paused?: boolean } = {}) {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (paused) return;
    const tick = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void latest.current();
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("online", tick);
    };
  }, [intervalMs, paused]);
}
