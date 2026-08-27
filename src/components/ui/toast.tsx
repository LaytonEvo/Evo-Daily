"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Toast = {
  id: number;
  message: string;
  tone: "default" | "error";
  action?: { label: string; onClick: () => void };
};

type ToastContextValue = {
  toast: (message: string, options?: { tone?: Toast["tone"]; action?: Toast["action"] }) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(1);

  const toast = React.useCallback<ToastContextValue["toast"]>((message, options) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message, tone: options?.tone ?? "default", action: options?.action }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 safe-bottom">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm shadow-lg animate-slide-up",
              t.tone === "error"
                ? "bg-destructive text-destructive-foreground"
                : "bg-foreground text-background",
            )}
          >
            <span>{t.message}</span>
            {t.action ? (
              <button
                type="button"
                className="shrink-0 font-semibold underline underline-offset-2"
                onClick={() => {
                  t.action?.onClick();
                  setToasts((current) => current.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
