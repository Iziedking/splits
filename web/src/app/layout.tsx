import type { ReactNode } from "react";

export const metadata = {
  title: "Splits",
  description: "Send money home with its purpose built in.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
