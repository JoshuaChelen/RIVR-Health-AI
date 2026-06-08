import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "RIVR Health",
  description: "Your personal health record.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
