// =============================================================================
// Root layout — app shell.
//
// Structure:
//   <body> = flex column, full viewport height
//     <TopBar>           fixed-height chrome (wordmark + nav)
//     <main flex:1>      page content fills remaining space
//
// Pages that need full-bleed (the audit workspace) use `flex: 1; minHeight: 0`
// so the workspace's left/center/right panes can scroll independently below
// the top bar without overflowing the viewport.
// =============================================================================

import "./globals.css";
import { TopBar } from "@/components/ui/TopBar";

export const metadata = {
  title: "Vendor PIQC",
  description: "Protocol-aware vendor audit workspace",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <TopBar />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
        </div>
      </body>
    </html>
  );
}
