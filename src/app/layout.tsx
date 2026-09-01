import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

// Horizon's face. Self-hosted by next/font, so there is no third-party
// request on the critical path and no flash of a fallback.
const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "EvoTasks",
  description: "Recurring operational accountability for Evolution Golf.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays available: capping it fails WCAG 1.4.4, and this gets
  // used on a phone in a stockroom.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F7FE" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1437" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={dmSans.variable}>
      <head>
        {/*
          Apply the stored theme before first paint. Without this the page
          renders light, then snaps to dark once React mounts — worst on a
          phone, which is where this gets opened in the dark.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("evotasks-theme");var d=s==="dark"||(s===null&&matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-dvh">
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
