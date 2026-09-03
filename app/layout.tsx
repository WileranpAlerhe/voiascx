import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ViaRegistro — documentos sem complicação",
  description: "Solicite certidões, pesquisas e serviços documentais em um fluxo organizado e seguro.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
