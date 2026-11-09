import { AppShell } from "@/components/shell/AppShell";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
