import { useState } from "react";
import { ErrorBanner, Modal } from "./ui";

/** Toda decisión sobre una solicitud lleva motivo: queda en la bitácora y lo ve el colaborador si aplica. */
export function DecisionModal({
  title,
  summary,
  reasons,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  summary?: string;
  reasons: string[];
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < 3) return setError("Indica el motivo: toca una opción o escríbelo.");
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy} aria-busy={busy}>
            {busy && <span className="btn-spinner" aria-hidden />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="form">
        {summary && <p className="muted small current">{summary}</p>}
        <div className="field">
          <span className="field-label">
            Motivo <span className="req">obligatorio</span>
          </span>
          <div className="chips">
            {reasons.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={reason === r}
                className={`chip chip-sm${reason === r ? " active" : ""}`}
                onClick={() => {
                  setReason(r);
                  setError(null);
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            rows={2}
            maxLength={300}
            placeholder="Toca una opción o escribe el motivo"
            aria-label="Motivo"
          />
        </div>
        <ErrorBanner error={error} />
      </div>
    </Modal>
  );
}
