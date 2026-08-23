import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Letterboard — the live board for newsletters", description: "The first 100 newsletters get a free public place on Letterboard.", icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }

