import { describe, expect, test } from "vitest";

import { userSchema } from "@/core/auth/types";

const baseUser = {
  id: "user-1",
  email: "miaowu@example.com",
  system_role: "user",
  needs_setup: false,
} as const;

describe("userSchema", () => {
  test("accepts non-email NewAPI account metadata without rejecting the session", () => {
    const parsed = userSchema.safeParse({
      ...baseUser,
      newapi_account: {
        user_id: "42",
        newapi_sub: "newapi:42",
        email: "zuiyi",
        username: "zuiyi",
        name: null,
        avatar: null,
        quota: null,
        used_quota: null,
        remain_quota: null,
        balance: null,
        last_synced_at: "2026-05-24T17:39:11Z",
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.newapi_account?.email).toBe("zuiyi");
    }
  });

  test("keeps the primary user email contract strict", () => {
    const parsed = userSchema.safeParse({
      ...baseUser,
      email: "not-an-email",
    });

    expect(parsed.success).toBe(false);
  });
});
