import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** Debe llegar casi al final, y marca al soltar: todavía se puede arrepentir volviendo atrás. */
const CONFIRM_AT = 0.9;
/** Menos que esto al soltar es un toque, no un intento de deslizar. */
const TAP_PX = 6;

/**
 * Deslizar para confirmar: evita marcajes por un toque accidental.
 * Solo se arrastra desde la manija, así el resto de la pantalla sigue haciendo scroll.
 * Con teclado o lector de pantalla se activa con Enter o Espacio.
 */
export function SlideToConfirm({ label, tone, disabled, onConfirm }: { label: string; tone: "in" | "out"; disabled?: boolean; onConfirm: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ startX: number; x: number } | null>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [nudge, setNudge] = useState(false);

  const maxX = () => {
    const track = trackRef.current;
    const handle = handleRef.current;
    return track && handle ? track.clientWidth - handle.offsetWidth - 2 * handle.offsetLeft : 0;
  };

  // Si el marcaje no cambió de estado (por ejemplo, no se pudo guardar), la manija vuelve al inicio.
  useEffect(() => {
    if (!disabled) setX(0);
  }, [disabled]);

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, x: 0 };
    setDragging(true);
    setNudge(false);
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return;
    const next = Math.min(Math.max(e.clientX - drag.current.startX, 0), maxX());
    drag.current.x = next;
    setX(next);
  }

  function finish(confirmable: boolean) {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    if (!current) return;
    const max = maxX();
    if (confirmable && max > 0 && current.x >= max * CONFIRM_AT) {
      setX(max);
      onConfirm();
      return;
    }
    setX(0);
    if (confirmable && current.x < TAP_PX) setNudge(true); // un toque: enseña el gesto
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    onConfirm();
  }

  const progress = maxX() > 0 ? x / maxX() : 0;

  return (
    <div ref={trackRef} className={`slide slide-${tone}${disabled ? " is-disabled" : ""}`}>
      <div className="slide-fill" style={{ width: x > 0 ? `calc(${x}px + var(--slide-handle))` : 0 }} aria-hidden />
      <span className="slide-label" style={{ opacity: Math.max(1 - progress * 1.6, 0) }} aria-hidden>
        {nudge ? "Desliza hasta el final" : label}
      </span>
      <button
        ref={handleRef}
        type="button"
        className={`slide-handle${dragging ? " is-dragging" : ""}${nudge ? " is-nudging" : ""}`}
        style={{ transform: `translateX(${x}px)` }}
        aria-label={`${label}. Desliza hasta el final, o presiona Enter.`}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => finish(true)}
        onPointerCancel={() => finish(false)}
        onKeyDown={onKeyDown}
        onAnimationEnd={() => setNudge(false)}
      >
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}
