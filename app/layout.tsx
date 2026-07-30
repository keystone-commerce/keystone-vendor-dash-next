import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Keystone Vendor Dashboard",
  description: "Procurement pipeline, catalogues, invoices & purchase orders.",
};

/**
 * Applies the saved (or OS) theme before first paint. Without this the page would
 * render light and then snap to dark once React hydrates.
 */
const themeInitScript = `
(function(){try{
  var t = localStorage.getItem('keystone-theme');
  if(!t){ t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  if(t === 'dark'){ document.documentElement.classList.add('dark'); }
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
