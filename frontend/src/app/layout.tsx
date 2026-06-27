import type { Metadata, Viewport } from "next";
import { AccessibilityProvider } from "@/components/AccessibilityProvider";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "SignBuddy AI — Sign Language Translator",
  description: "Real-time sign language translation connecting deaf and hearing communities.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // never block pinch-zoom — accessibility requirement
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AccessibilityProvider>{children}</AccessibilityProvider>
      </body>
    </html>
  );
}
