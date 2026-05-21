import "./styles/globals.scss";
import "./styles/markdown.scss";
import "./styles/highlight.scss";
import type { Metadata, Viewport } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GoogleTagManager, GoogleAnalytics } from "@next/third-parties/google";
import { getServerSideConfig } from "./config/server";
import { getRuntimePublicConfig } from "./config/runtime";
import { Toaster } from "sonner";
export const metadata: Metadata = {
  title: "Chat",
  description: "Your personal ChatGPT Chat Bot.",
  appleWebApp: {
    title: "Chat",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#151515" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.BUILD_MODE !== "export") {
    noStore();
  }
  const serverConfig = getServerSideConfig();
  const clientConfig = getRuntimePublicConfig();

  return (
    <html lang="en">
      <head>
        <meta name="runtime-config" content={JSON.stringify(clientConfig)} />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        <link
          rel="manifest"
          href="/site.webmanifest"
          crossOrigin="use-credentials"
        ></link>
        <script src="/serviceWorkerRegister.js" defer></script>
      </head>
      <body>
        {children}
        <Toaster position="top-right" richColors />
        {serverConfig?.isVercel && (
          <>
            <SpeedInsights />
          </>
        )}
        {serverConfig?.gtmId && (
          <>
            <GoogleTagManager gtmId={serverConfig.gtmId} />
          </>
        )}
        {serverConfig?.gaId && (
          <>
            <GoogleAnalytics gaId={serverConfig.gaId} />
          </>
        )}
      </body>
    </html>
  );
}
