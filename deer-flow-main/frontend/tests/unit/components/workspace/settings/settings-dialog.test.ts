import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: {
      settings: {
        title: "Settings",
        description: "Settings description",
        sections: {
          account: "Account",
          appearance: "Appearance",
          memory: "Memory",
          tools: "Tools",
          skills: "Skills",
          notification: "Notification",
          about: "About",
        },
      },
    },
    changeLocale: vi.fn(),
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/workspace/settings/about-settings-page", () => ({
  AboutSettingsPage: () => React.createElement("div", null, "About"),
}));

vi.mock("@/components/workspace/settings/ai-provider-settings-page", () => ({
  AiProviderSettingsPage: () => React.createElement("div", null, "AI providers"),
}));

vi.mock("@/components/workspace/settings/appearance-settings-page", () => ({
  AppearanceSettingsPage: () => React.createElement("div", null, "Appearance"),
}));

vi.mock("@/components/workspace/settings/draft-settings-page", () => ({
  DraftSettingsPage: () => React.createElement("div", null, "Drafts"),
}));

vi.mock("@/components/workspace/settings/memory-settings-page", () => ({
  MemorySettingsPage: () => React.createElement("div", null, "Memory"),
}));

vi.mock("@/components/workspace/settings/notification-settings-page", () => ({
  NotificationSettingsPage: () => React.createElement("div", null, "Notification"),
}));

vi.mock("@/components/workspace/settings/skill-settings-page", () => ({
  SkillSettingsPage: () => React.createElement("div", null, "Skills"),
}));

vi.mock("@/components/workspace/settings/tool-settings-page", () => ({
  ToolSettingsPage: () => React.createElement("div", null, "Tools"),
}));

vi.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: {
      email: "user@example.com",
      system_role: "user",
    },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));

import { SettingsDialog } from "@/components/workspace/settings";

afterEach(() => {
  vi.restoreAllMocks();
});

test("settings dialog renders the account section content", () => {
  const html = renderToStaticMarkup(
    React.createElement(SettingsDialog, {
      open: true,
      defaultSection: "account",
    }),
  );

  expect(html).toContain("Profile");
  expect(html).toContain("Change Password");
  expect(html).toContain("Sign Out");
});
