"use client";

/**
 * Small shared Tailwind building blocks for the back-office pages so each page
 * stays focused on its data/flows rather than repeating class strings.
 */
import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)] md:rounded-md md:py-2";

export const labelCls = "block text-sm font-medium text-gray-700 mb-1";

export function Card({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5 md:rounded-xl md:p-6">{children}</section>
  );
}

export function PageHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-2">
      <h1 className="text-2xl font-bold text-gray-900 md:text-xl">{title}</h1>
      {desc && <p className="mt-1 text-sm text-gray-500">{desc}</p>}
    </div>
  );
}

export function PrimaryButton({
  children,
  type = "button",
  onClick,
  disabled,
}: {
  children: ReactNode;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 sm:w-auto md:rounded-md md:py-2"
      style={{ backgroundColor: "var(--brand)" }}
    >
      {children}
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-sm text-red-600" role="alert">
      {children}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-400">{children}</p>;
}
