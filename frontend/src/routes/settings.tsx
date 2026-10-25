/**
 * settings.tsx
 *
 * Dedicated Route for Settings — /settings
 * Opens the ReadAble Settings experience within the dashboard layout,
 * keeping sidebar navigation and responsive controls active.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import ReadAbleDashboard from "@/components/ReadAbleDashboard";

export const Route = createFileRoute("/settings")({
  beforeLoad: () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("readable_token") : null;
    if (!token) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Settings — ReadAble" },
      {
        name: "description",
        content: "Configure your reading preferences, accessibility settings, speech synthesis, and account details.",
      },
    ],
  }),
  component: SettingsRouteComponent,
});

function SettingsRouteComponent() {
  return <ReadAbleDashboard initialNav="Settings" />;
}
