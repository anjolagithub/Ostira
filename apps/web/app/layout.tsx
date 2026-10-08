import type { Metadata, Viewport } from "next";
import "../ui/styles.css";
import { BRAND } from "../ui/brand";

export const metadata: Metadata = {
  title: BRAND.name,
  description: "Simulates an AI agent's Solana transaction, compares the real effect with its declared intent, and returns ALLOW, REVIEW or BLOCK with exact reasons.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e12" },
  ],
};

// Applied before paint so a saved theme never flashes.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
