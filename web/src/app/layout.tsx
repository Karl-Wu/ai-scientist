import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ProjectProvider } from "@/lib/use-projects";
import { ApiTokenGate } from "@/components/api-token-gate";
import { I18nProvider } from "@/components/i18n-provider";
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
  title: "AI Scientist",
  description: "A research workspace for scientists, biologists, and research experts.",
  icons: { icon: "/brand/ai-scientist.svg?v=2" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <I18nProvider>
            <ProjectProvider>
              <TooltipProvider delayDuration={350}>{children}</TooltipProvider>
            </ProjectProvider>
          </I18nProvider>
          <Toaster />
          <ApiTokenGate />
        </ThemeProvider>
      </body>
    </html>
  );
}
