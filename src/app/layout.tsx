import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const serif = Cormorant_Garamond({
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});
const sans = Inter_Tight({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dinner for Two",
  description: "A concierge for date night — three composed evenings from a short brief.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#F4ECDF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        {/* Mobile-first 390px shell, centered on the matte surround. */}
        <div className="mx-auto min-h-screen w-full max-w-[420px] bg-paper shadow-[0_30px_60px_rgba(0,0,0,0.4)]">
          {children}
        </div>
      </body>
    </html>
  );
}
