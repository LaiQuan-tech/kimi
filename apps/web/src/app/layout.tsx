import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { TenantBranding } from "@/components/TenantBranding";
import { FloatingAiChat } from "@/components/FloatingAiChat";
import "./globals.css";

/**
 * White-label branding. The server layout injects a safe default, then
 * TenantBranding fetches GET /api/tenant/branding in the browser after the
 * Supabase session is available and updates --brand + document.title globally.
 */
interface Branding {
  brandColor: string;
  title: string;
}

function getBranding(): Branding {
  return {
    brandColor: "#1F4E79",
    title: "HR 差勤系統",
  };
}

const branding = getBranding();

export const metadata: Metadata = {
  title: branding.title,
  description: "多租戶白標 HR 差勤系統",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Inject the tenant brand colour as a CSS custom property on <html> so any
  // component can colour itself with var(--brand) — the proof that white-label
  // theming flows from a single source.
  const brandStyle = { ["--brand" as string]: branding.brandColor } as CSSProperties;

  return (
    <html lang="zh-Hant" style={brandStyle}>
      <body>
        <TenantBranding />
        {children}
        <FloatingAiChat />
      </body>
    </html>
  );
}
