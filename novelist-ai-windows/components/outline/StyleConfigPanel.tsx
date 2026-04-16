import React, { useState, useEffect } from "react";
import { useStyleStore } from "../../stores/useStyleStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { toast } from "sonner";
import { Save, Trash2, Plus, RotateCcw, PenTool } from "lucide-react";

export const StyleConfigPanel: React.FC = () => {
  const {
    styles,
    activeStyleId,
    setActiveStyleId,
    addCustomStyle,
    updateStyle,
    deleteStyle,
    resetStyles,
    isBuiltInStyle,
  } = useStyleStore();

  const activeStyle = styles.find((s) => s.id === activeStyleId) || styles[0];
  const isBuiltIn = isBuiltInStyle(activeStyle.id);

  // 本地编辑状态
  const [editPrompt, setEditPrompt] = useState(activeStyle.systemPrompt);
  const [newStyleName, setNewStyleName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // 当切换文风时，更新编辑框内容
  useEffect(() => {
    // 使用 setTimeout 避免同步 setState 警告
    const timer = setTimeout(() => {
      setEditPrompt(activeStyle.systemPrompt);
      setIsCreating(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeStyleId, styles]);

  const handleSave = () => {
    if (isBuiltIn) {
      // 如果是内置文风，强制进入"另存为"模式
      setIsCreating(true);
      setNewStyleName(`${activeStyle.name} (修改版)`);
      toast.info("内置文风不可直接修改，请另存为新文风");
    } else {
      // 如果是自定义文风，直接更新
      updateStyle(activeStyle.id, editPrompt);
      toast.success("文风已更新");
    }
  };

  const handleCreateConfirm = () => {
    if (!newStyleName.trim()) {
      toast.error("请输入文风名称");
      return;
    }
    addCustomStyle(newStyleName, editPrompt);
    setIsCreating(false);
    toast.success("新文风已创建");
  };

  return (
    <div className="space-y-3 p-1">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <PenTool className="w-3 h-3" /> 选择预设
          </Label>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-destructive"
            title="重置所有预设"
            onClick={() => {
              if (confirm("确认重置所有文风设置吗？自定义文风将丢失。"))
                resetStyles();
            }}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <Select value={activeStyleId} onValueChange={setActiveStyleId}>
          <SelectTrigger className="h-8 text-xs bg-background">
            <SelectValue placeholder="选择文风" />
          </SelectTrigger>
          <SelectContent>
            {styles.map((style) => (
              <SelectItem key={style.id} value={style.id} className="text-xs">
                {style.name} {isBuiltInStyle(style.id) ? "" : "(自定义)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground h-4 truncate px-1">
          {activeStyle.description}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label className="text-xs font-medium text-muted-foreground">
            文风指令 (System Prompt)
          </Label>
          {!isBuiltIn && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10 px-1"
              onClick={() => {
                if (confirm("确认删除此文风？")) deleteStyle(activeStyle.id);
              }}
            >
              <Trash2 className="h-3 w-3 mr-1" /> 删除
            </Button>
          )}
        </div>
        <Textarea
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          className="text-xs min-h-[150px] resize-none leading-relaxed bg-muted/30 focus:bg-background transition-colors font-mono"
          placeholder="在此定义AI的写作风格..."
        />
      </div>

      {isCreating ? (
        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 bg-muted/50 p-2 rounded-md border border-primary/20">
          <Input
            value={newStyleName}
            onChange={(e) => setNewStyleName(e.target.value)}
            placeholder="新文风名称"
            className="h-7 text-xs bg-background"
            autoFocus
          />
          <Button
            size="sm"
            className="h-7 text-xs px-3"
            onClick={handleCreateConfirm}
          >
            确认
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs px-2"
            onClick={() => setIsCreating(false)}
          >
            取消
          </Button>
        </div>
      ) : (
        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={() => {
              setIsCreating(true);
              setNewStyleName("");
            }}
          >
            <Plus className="h-3 w-3 mr-1" /> 另存为
          </Button>
          <Button
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={handleSave}
            disabled={isBuiltIn && editPrompt === activeStyle.systemPrompt}
          >
            <Save className="h-3 w-3 mr-1" />
            {isBuiltIn ? "修改并另存" : "保存修改"}
          </Button>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground/60 text-center pt-1">
        修改 System Prompt 将直接影响大纲与章节的生成风格
      </div>
    </div>
  );
};
