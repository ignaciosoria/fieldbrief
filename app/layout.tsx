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
  title: "Folup — Turn sales visits into clear next steps",
  description: "Turn your field visit recap into clear follow-ups, a CRM note and a Smart Next Step. Try Folup without an account.",
  openGraph: {
    title: "Folup — Clear follow-ups from your voice notes",
    description: "Turn your field visit recap into clear follow-ups, a CRM note and a Smart Next Step. Try Folup without an account.",
    url: "https://folup.app",
    siteName: "Folup",
    images: [{ url: "https://folup.app/og_image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Folup — Clear follow-ups from your voice notes",
    description: "Turn your field visit recap into clear follow-ups, a CRM note and a Smart Next Step. Try Folup without an account.",
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
