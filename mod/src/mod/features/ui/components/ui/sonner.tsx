import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Уведомления мода — всегда в тёмной теме панели. */
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="dark"
    className="toaster group"
    style={
      {
        "--normal-bg": "var(--ms-surface-4)",
        "--normal-text": "var(--ms-text-strong)",
        "--normal-border": "var(--ms-surface-5)",
        fontFamily: "var(--ms-font)",
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
