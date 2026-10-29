import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BurnBau POS",
  description: "Point of sale for BurnBau",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
