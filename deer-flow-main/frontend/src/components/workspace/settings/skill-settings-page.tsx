"use client";

import { SparklesIcon } from "lucide-react";
import { useMemo } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemTitle,
  ItemContent,
  ItemDescription,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";
import { useEnableSkill, useSkills } from "@/core/skills/hooks";
import type { Skill } from "@/core/skills/type";
import { env } from "@/env";

import { SettingsSection } from "./settings-section";

export function SkillSettingsPage({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { skills, isLoading, error } = useSkills();
  return (
    <SettingsSection
      title={t.settings.skills.title}
      description={t.settings.skills.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div>Error: {error.message}</div>
      ) : (
        <SkillSettingsList
          skills={skills}
          isAdmin={user?.system_role === "admin"}
          onClose={onClose}
        />
      )}
    </SettingsSection>
  );
}

function SkillSettingsList({
  skills,
  isAdmin,
  onClose,
}: {
  skills: Skill[];
  isAdmin: boolean;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const { mutate: enableSkill } = useEnableSkill();
  const filteredSkills = useMemo(() => skills, [skills]);
  void onClose;
  return (
    <div className="flex w-full flex-col gap-4">
      {filteredSkills.length === 0 && <EmptySkill />}
      {filteredSkills.length > 0 &&
        filteredSkills.map((skill) => (
          <Item className="w-full" variant="outline" key={skill.name}>
            <ItemContent>
              <ItemTitle>
                <div className="flex items-center gap-2">
                  {skill.name}
                  {skill.category !== "public" && (
                    <span className="text-muted-foreground text-xs uppercase">
                      {skill.category}
                    </span>
                  )}
                </div>
              </ItemTitle>
              <ItemDescription className="line-clamp-4">
                {skill.description}
                {skill.system_enabled === false && (
                  <span className="text-muted-foreground mt-1 block text-xs">
                    已被管理员在公共技能库中停用
                  </span>
                )}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                checked={skill.enabled}
                disabled={
                  env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ||
                  skill.system_enabled === false
                }
                onCheckedChange={(checked) =>
                  enableSkill({ skillName: skill.name, enabled: checked })
                }
              />
            </ItemActions>
          </Item>
        ))}
    </div>
  );
}

function EmptySkill() {
  const { t } = useI18n();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SparklesIcon />
        </EmptyMedia>
        <EmptyTitle>{t.settings.skills.emptyTitle}</EmptyTitle>
        <EmptyDescription>
          {t.settings.skills.emptyDescription}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent />
    </Empty>
  );
}
