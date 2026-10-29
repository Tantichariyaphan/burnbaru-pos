import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grandfa Farm POS",
  description: "Point of sale for Grandfa Farm Cafe & Resort",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
