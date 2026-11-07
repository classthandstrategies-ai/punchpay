import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "PunchPay | Every fix reviewed. Every payment decided.", description: "Evidence-led renovation closeout, AI-assisted review, PayPal sandbox payment decisions." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
