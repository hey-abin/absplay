import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "AbsPlay - Video & Audio Playlist Downloader",
  description: "Analyze and download media URLs from YouTube, Vimeo, SoundCloud, Spotify, and more. Support high-resolution MP4 downloads, MP3 extraction, and full playlist ZIP packaging.",
};

import ExtensionErrorHandler from "../components/ExtensionErrorHandler";

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ExtensionErrorHandler />
        {children}
      </body>
    </html>
  );
}
