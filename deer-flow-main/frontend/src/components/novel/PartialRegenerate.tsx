"use client";

import {
  Wand2,
  Loader2,
  RotateCcw,
  Sparkles,
  Target,
  PenLine,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface PartialRegenerateConfig {
  instruction: string;
  mode: "rewrite" | "expand" | "compress" | "polish" | "continue";
}

interface PartialRegenerateToolbarProps {
  selectedText: string;
  onOpenModal: (config: PartialRegenerateConfig) => void;
  disabled?: boolean;
  className?: string;
}

const MODE_OPTIONS: Array<{
  value: PartialRegenerateConfig["mode"];
  label: string;
  icon: React.ReactNode;
  desc: string;
}> = [
  {
    value: "rewrite",
    label: "AI重写",
    icon: <Wand2 className="h-3.5 w-3.5" />,
    desc: "保持原意，重新表达",
  },
  {
    value: "expand",
    label: "扩写",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    desc: "增加细节和描写",
  },
  {
    value: "compress",
    label: "精简",
    icon: <Target className="h-3.5 w-3.5" />,
    desc: "删除冗余，保留核心",
  },
  {
    value: "polish",
    label: "润色",
    icon: <PenLine className="h-3.5 w-3.5" />,
    desc: "优化文风和表达",
  },
  {
    value: "continue",
    label: "续写",
    icon: <RotateCcw className="h-3.5 w-3.5" />,
    desc: "基于选段继续创作",
  },
];

export function PartialRegenerateToolbar({
  selectedText,
  onOpenModal,
  disabled = false,
  className,
}: PartialRegenerateToolbarProps) {
  const [showModes, setShowModes] = useState(false);

  if (!selectedText || disabled) return null;

  const textPreview =
    selectedText.length > 60 ? `${selectedText.slice(0, 60)}...` : selectedText;

  return (
    <div
      className={cn(
        "bg-background inline-flex items-center gap-1 rounded-lg border px-2 py-1 shadow-sm",
        showModes && "rounded-b-none border-b-0",
        className,
      )}
      onMouseLeave={() => setShowModes(false)}
    >
      <Badge
        variant="secondary"
        className="max-w-[200px] shrink-0 truncate text-xs font-normal"
      >
        已选 {selectedText.length} 字
      </Badge>
      <span
        className="text-muted-foreground hidden max-w-[180px] truncate text-xs sm:inline"
        title={selectedText}
      >
        {textPreview}
      </span>

      <Button
        size="sm"
        variant="ghost"
        className="h-6 gap-1 px-2 text-xs"
        onMouseEnter={() => setShowModes(true)}
        onClick={() => setShowModes((v) => !v)}
      >
        <Wand2 className="h-3 w-3" />
        AI处理
      </Button>

      {showModes && (
        <div className="bg-background absolute top-full right-0 left-0 z-50 flex gap-1 rounded-b-lg border border-t-0 p-2 shadow-lg">
          {MODE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant="outline"
              className="h-auto flex-col gap-0.5 px-2.5 py-1.5 text-[11px]"
              onClick={() => {
                setShowModes(false);
                onOpenModal({ instruction: "", mode: opt.value });
              }}
            >
              {opt.icon}
              <span>{opt.label}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

interface PartialRegenerateModalProps {
  open: boolean;
  onClose: () => void;
  config: PartialRegenerateConfig | null;
  originalText: string;
  onSubmit: (config: PartialRegenerateConfig) => Promise<void>;
}

export function PartialRegenerateModal({
  open,
  onClose,
  config,
  originalText,
  onSubmit,
}: PartialRegenerateModalProps) {
  const [loading, setLoading] = useState(false);
  const [instruction, setInstruction] = useState("");

  if (!config) return null;

  const modeLabel =
    MODE_OPTIONS.find((m) => m.value === config.mode)?.label || config.mode;

  const handleSubmit = async () => {
    try {
      setLoading(true);
      await onSubmit({ ...config, instruction });
      toast.success("文本已更新");
      setInstruction("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>AI{modeLabel}</DialogTitle>
          <DialogDescription>对选中的文本进行智能处理</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">原始文本</Label>
            <div className="bg-muted/50 max-h-[120px] overflow-y-auto rounded-md p-2.5 text-sm whitespace-pre-wrap">
              {originalText}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="instruction" className="text-xs">
              处理指令（可选）
            </Label>
            <Textarea
              id="instruction"
              placeholder={`请输入${modeLabel}的具体要求...`}
              rows={3}
              maxLength={500}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <p className="text-muted-foreground text-[11px]">
              {instruction.length}/500
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            开始{modeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
