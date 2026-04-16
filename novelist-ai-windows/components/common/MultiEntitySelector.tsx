import React, { useState } from "react";
import { Check, ChevronsUpDown, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useMentionOptions } from "@/hooks/useMentionOptions";
import { cn } from "@/lib/utils";

interface MultiEntitySelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}

/**
 * 多实体选择器
 * 允许用户搜索并选择多个关联实体（角色、场景、势力等）
 *
 * 设计原则：
 * - 复用性：直接使用 useMentionOptions 获取全量实体数据
 * - 交互性：选中即展示为 Badge，点击 Badge 可移除
 * - KISS原则：简洁直观的多选界面，避免复杂操作
 * - DRY原则：复用现有的 mention 选项逻辑
 * - 用户体验：按实体类型分组显示，提升浏览效率
 */
export const MultiEntitySelector: React.FC<MultiEntitySelectorProps> = ({
  selectedIds = [], // 提供默认值防止 undefined 报错
  onChange,
  placeholder = "关联实体...",
}) => {
  const [open, setOpen] = useState(false);
  // ✅ 复用已有的 Hook，获取带有图标和类型的标准化数据
  const options = useMentionOptions();

  // 🎯 KISS原则：将选项按类型分组，提升用户体验
  const groupedOptions = {
    character: options.filter(o => o.type === 'character'),
    setting: options.filter(o => o.type === 'setting'),
    faction: options.filter(o => o.type === 'faction'),
    item: options.filter(o => o.type === 'item')
  };

  const handleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((item) => item !== id));
    } else {
      onChange([...selectedIds, id]);
    }
    // 多选通常不自动关闭 Popover，方便连续选择
  };

  const handleRemove = (id: string) => {
    onChange(selectedIds.filter((item) => item !== id));
  };

  // 获取当前选中的完整对象以便渲染
  const selectedOptions = options.filter((opt) => selectedIds.includes(opt.id));

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between h-auto min-h-[2.5rem] px-3 py-2"
          >
            <div className="flex flex-wrap gap-1.5 items-center w-full">
              {selectedOptions.length > 0 ? (
                selectedOptions.map((item) => (
                  <Badge
                    key={item.id}
                    variant="secondary"
                    className="pl-2 pr-1 py-0.5 flex items-center gap-1 cursor-default hover:bg-secondary/80"
                    onClick={(e) => {
                      e.stopPropagation(); // 防止触发 Popover
                    }}
                  >
                    {item.icon && <item.icon className="w-3 h-3 opacity-70" />}
                    <span>{item.label}</span>
                    <div
                      role="button"
                      className="ml-1 rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5 cursor-pointer transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(item.id);
                      }}
                    >
                      <X className="w-3 h-3" />
                    </div>
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground text-sm font-normal">
                  {placeholder}
                </span>
              )}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command>
            <CommandInput placeholder="搜索角色、场景、势力..." />
            <CommandList>
              <CommandEmpty>未找到相关实体</CommandEmpty>
              
              {/* 🎯 DRY原则：使用分组显示，提升可浏览性 */}
              {groupedOptions.character.length > 0 && (
                <CommandGroup heading="👥 角色">
                  {groupedOptions.character.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={`${option.label}-${option.type}`}
                      onSelect={() => handleSelect(option.id)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center flex-1 gap-2">
                        <Check
                          className={cn(
                            "h-4 w-4 transition-opacity",
                            selectedIds.includes(option.id)
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        {option.icon && (
                          <option.icon className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span>{option.label}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {groupedOptions.setting.length > 0 && (
                <CommandGroup heading="🏛️ 场景">
                  {groupedOptions.setting.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={`${option.label}-${option.type}`}
                      onSelect={() => handleSelect(option.id)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center flex-1 gap-2">
                        <Check
                          className={cn(
                            "h-4 w-4 transition-opacity",
                            selectedIds.includes(option.id)
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        {option.icon && (
                          <option.icon className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span>{option.label}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {groupedOptions.faction.length > 0 && (
                <CommandGroup heading="⚔️ 势力">
                  {groupedOptions.faction.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={`${option.label}-${option.type}`}
                      onSelect={() => handleSelect(option.id)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center flex-1 gap-2">
                        <Check
                          className={cn(
                            "h-4 w-4 transition-opacity",
                            selectedIds.includes(option.id)
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        {option.icon && (
                          <option.icon className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span>{option.label}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {groupedOptions.item.length > 0 && (
                <CommandGroup heading="💎 物品">
                  {groupedOptions.item.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={`${option.label}-${option.type}`}
                      onSelect={() => handleSelect(option.id)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center flex-1 gap-2">
                        <Check
                          className={cn(
                            "h-4 w-4 transition-opacity",
                            selectedIds.includes(option.id)
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        {option.icon && (
                          <option.icon className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span>{option.label}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};