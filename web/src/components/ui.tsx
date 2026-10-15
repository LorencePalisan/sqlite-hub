import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger" | "default";

export function Button({
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-accent text-accent-fg hover:opacity-90",
    danger: "bg-danger text-white hover:opacity-90",
    ghost: "text-muted hover:text-fg hover:bg-raised",
    default: "bg-raised text-fg border border-line hover:border-muted",
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium transition disabled:opacity-50 disabled:pointer-events-none ${styles[variant]} ${className}`}
    />
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-line bg-panel p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-[15px] font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-danger">
      {message}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent";
