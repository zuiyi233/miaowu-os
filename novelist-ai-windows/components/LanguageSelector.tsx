import React from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/useSettingsStore";
import { changeLanguage } from "../lib/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Languages } from "lucide-react";

export const LanguageSelector: React.FC = () => {
  const { t } = useTranslation();
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);

  const handleLanguageChange = (value: string) => {
    const lang = value as "zh-CN" | "en-US";
    setLanguage(lang);
    changeLanguage(lang);
  };

  return (
    <div className="flex items-center gap-2">
      <Languages className="h-4 w-4 text-muted-foreground" />
      <Select value={language} onValueChange={handleLanguageChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder={t("common.language")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="zh-CN">中文</SelectItem>
          <SelectItem value="en-US">English</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
