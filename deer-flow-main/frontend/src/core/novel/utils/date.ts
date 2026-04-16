import { formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";

const getLocale = (language?: string) => (language === "zh-CN" ? zhCN : enUS);

export const formatDateFromNow = (timestamp: Date, language?: string): string =>
  formatDistanceToNow(timestamp, { addSuffix: true, locale: getLocale(language) });

export const formatDateString = (date: Date): string => date.toISOString().split("T")[0];

export const formatDateTimeString = (date: Date): string => {
  const y = date.getFullYear(), mo = String(date.getMonth() + 1).padStart(2, "0"),
    d = String(date.getDate()).padStart(2, "0"), h = String(date.getHours()).padStart(2, "0"),
    mi = String(date.getMinutes()).padStart(2, "0"), s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
};

export const isToday = (date: Date): boolean => {
  const today = new Date();
  return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
};

export const isYesterday = (date: Date): boolean => {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return date.getDate() === y.getDate() && date.getMonth() === y.getMonth() && date.getFullYear() === y.getFullYear();
};
