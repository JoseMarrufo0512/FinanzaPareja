import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata = {
  title: 'NuestrasFinanzas — Gastos Compartidos',
  description: 'Gastos compartidos con congelamiento USDT y tasas BCV/Binance en tiempo real',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
