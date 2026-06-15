import "./globals.css";

export const metadata = {
  title: "Event Review Tracker",
  description: "Manager-led banquet and event review tracking",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
