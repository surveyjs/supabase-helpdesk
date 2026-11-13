import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { connection } from "next/server";
import { runtimeConfigScript } from "@/lib/runtime-config";
import "./globals.css";
import "survey-core/survey-core.css";
import "@/styles/surveyjs-tailwind-adapter.css";
import "@/styles/surveyjs-bridge.css";
import "@/styles/markdown-editor.css";

export const metadata: Metadata = {
  title: "HelpDesk",
  description: "Customer support ticket system",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the instance config per request, never at build time (also keeps
  // not-found/error pages dynamic so they carry the config too).
  await connection();
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: runtimeConfigScript() }} />
      </head>
      <body className="min-h-full flex flex-col bg-gray-50 font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:p-2 focus:rounded focus:ring-2 focus:ring-blue-500 focus:text-blue-700 focus:shadow-lg"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
