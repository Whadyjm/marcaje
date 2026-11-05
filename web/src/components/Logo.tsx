export function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className={`logo${large ? " logo-lg" : ""}`}>
      <svg viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#7c3aed" />
        <circle cx="32" cy="32" r="18" fill="none" stroke="#fff" strokeWidth="6" />
        <path d="M32 21v11l8 5" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Marcaje
    </span>
  );
}
