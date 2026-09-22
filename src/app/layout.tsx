import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Creative Agents",
  description: "Agent scaffold for creative-agents-v2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
