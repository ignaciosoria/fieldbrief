import type { Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Folup",
  description: "Never forget a follow-up after a client visit.",
  icons: {
    icon: [{ url: "/favicon.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icon_128.png", sizes: "128x128", type: "image/png" }],
    shortcut: "/favicon.png",
  },
  openGraph: {
    title: "Folup — Voice note → next steps + calendar in seconds",
    description: "Never forget a follow-up after a client visit.",
    url: "https://folup.app",
    siteName: "Folup",
    images: [{ url: "https://folup.app/og_image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Folup — Voice note → next steps + calendar in seconds",
    description: "Never forget a follow-up after a client visit.",
    images: ["https://folup.app/og_image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#4F46E5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
