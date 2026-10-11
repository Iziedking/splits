import type { ReactNode } from "react";
import { Manrope } from "next/font/google";
import "./globals.css";

const body = Manrope({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata = {
  title: "Splits",
  description: "Send once. It lands divided.",
};

export const viewport = { themeColor: "#f3f7f8" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={body.variable}>
      <body>{children}</body>
    </html>
  );
}
