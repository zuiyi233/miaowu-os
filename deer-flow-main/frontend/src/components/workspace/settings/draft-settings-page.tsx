"use client";

import { ClockIcon } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalSettings } from "@/core/settings";

import { SettingsSection } from "./settings-section";

export function DraftSettingsPage() {
  const [settings, setSettings] = useLocalSettings();
  const retention = settings.context.media_draft_retention ?? "7d";

  return (
    <SettingsSection
      title="草稿设置"
      description="控制聊天里生成的图片与音频草稿的默认保留时长。"
    >
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ClockIcon className="size-4" />
              <span>草稿保留时间</span>
            </div>
            <div className="text-muted-foreground mt-1 text-xs">
              过期后草稿会不可访问并被自动清理（仅影响新生成的草稿）。
            </div>
          </div>
          <div className="w-[160px] shrink-0">
            <Select
              value={retention}
              onValueChange={(value) =>
                setSettings("context", {
                  media_draft_retention: value as
                    | "24h"
                    | "7d"
                    | "never",
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择保留时间" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24 小时</SelectItem>
                <SelectItem value="7d">7 天</SelectItem>
                <SelectItem value="never">永不过期</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

