import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { LucideIcon } from "lucide-react";

interface CommandItemProps {
  title: string;
  icon: LucideIcon;
  action: () => void;
}

interface EditorCommandListProps {
  items: CommandItemProps[];
  command: (item: CommandItemProps) => void;
}

export const EditorCommandList = forwardRef<any, EditorCommandListProps>(
  (props, ref) => {
    // 使用函数式初始化器来设置初始状态
    const [selectedIndex, setSelectedIndex] = useState(0);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (!props.items.length) return false;

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSelectedIndex(
            (selectedIndex + props.items.length - 1) % props.items.length
          );
          return true;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSelectedIndex((selectedIndex + 1) % props.items.length);
          return true;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          const item = props.items[selectedIndex];
          if (item) {
            props.command(item);
          }
          return true;
        }

        return false;
      }
    }));

    // 当组件挂载且 items 列表变化时，重置选中索引
    React.useEffect(() => {
      setSelectedIndex(0);
    }, [props.items.length]);

    return (
      <Command className="w-64">
        <CommandList>
          {props.items.length > 0 ? (
            <CommandGroup heading="命令">
              {props.items.map((item, index) => (
                <CommandItem
                  key={item.title}
                  onSelect={() => props.command(item)}
                  className={`flex items-center gap-2 ${
                    index === selectedIndex ? "bg-accent" : ""
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : (
            <CommandEmpty>无匹配命令</CommandEmpty>
          )}
        </CommandList>
      </Command>
    );
  }
);

EditorCommandList.displayName = "EditorCommandList";
