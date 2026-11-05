import { useState } from "react";
import { useAuth } from "../lib/auth";

/** Cerrar sesión llama al servidor y con mala señal tarda: se muestra que está en curso. */
export function LogoutButton({ canLeave }: { canLeave?: () => boolean }) {
  const { logout } = useAuth();
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    if (canLeave && !canLeave()) return;
    setLeaving(true);
    try {
      await logout();
    } finally {
      setLeaving(false);
    }
  }

  return (
    <button className="btn btn-ghost btn-sm" onClick={leave} disabled={leaving} aria-busy={leaving}>
      {leaving && <span className="btn-spinner" aria-hidden />}
      {leaving ? "Saliendo…" : "Salir"}
    </button>
  );
}
