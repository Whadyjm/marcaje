import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const DISMISS_KEY = "marcaje.installDismissed";

// El navegador dispara este evento una sola vez y puede ser antes de montar la pantalla.
let deferredPrompt: InstallPromptEvent | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e as InstallPromptEvent;
});

function isDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Invita a instalar la app. En iPhone es más que una comodidad: Safari puede borrar
 * los datos de un sitio sin instalar tras 7 días sin uso, y con ellos la cola.
 */
export function InstallHint() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const [canPrompt, setCanPrompt] = useState(!!deferredPrompt);
  const [hidden, setHidden] = useState(isDismissed);

  useEffect(() => {
    const on = () => setCanPrompt(true);
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);

  if (standalone || hidden || (!ios && !canPrompt)) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* volverá a aparecer: es inofensivo */
    }
  };

  return (
    <div className="card install-hint">
      <div className="grow">
        <strong>Instala Marcaje en tu teléfono</strong>
        <div className="muted small">{ios ? "Toca Compartir y luego “Agregar a inicio” para marcar aunque no tengas señal." : "Ábrelo como una app y marca aunque no tengas señal."}</div>
      </div>
      {!ios && (
        <button
          className="btn btn-primary btn-sm"
          onClick={async () => {
            await deferredPrompt?.prompt();
            deferredPrompt = null;
            setCanPrompt(false);
          }}
        >
          Instalar
        </button>
      )}
      <button className="icon-btn" onClick={dismiss} aria-label="Ocultar">
        ×
      </button>
    </div>
  );
}
