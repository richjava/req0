import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConfigureAmplify } from "@/components/ConfigureAmplify";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Invoice approval",
  description:
    "Department managers approve supplier invoices for their own department.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-zinc-50 text-zinc-900 antialiased`}
      >
        <ConfigureAmplify>{children}</ConfigureAmplify>
      </body>
    </html>
  );
}
