import { useLayoutEffect, useState, type ReactNode } from "react";

import { ShadowPortal } from "@ui/lib/shadow";

/**
 * Элемент мода в конце body, закреплённый поверх отведённого ему места окна,
 * со своим shadow-корнем. Клиентский DOM при этом не меняется: место под
 * панели освобождает тема (modrinth.css), а рисуются они здесь.
 */
export function FixedHost(props: { id: string; style: Partial<CSSStyleDeclaration>; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const element = document.createElement("div");
    element.id = props.id;
    document.body.appendChild(element);
    setHost(element);
    return () => element.remove();
  }, [props.id]);

  useLayoutEffect(() => {
    if (host) Object.assign(host.style, { position: "fixed", ...props.style });
  });

  if (!host) return null;
  return <ShadowPortal host={host}>{props.children}</ShadowPortal>;
}
