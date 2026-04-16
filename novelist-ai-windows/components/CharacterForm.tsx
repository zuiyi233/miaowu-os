import React from "react";
import { useAddCharacterMutation } from "../lib/react-query/db-queries";
import { useMutationForm } from "../hooks/useMutationForm";
import { useMentionOptions } from "../hooks/useMentionOptions"; // ✅ 引入统一的提及选项 Hook
import { createCharacterSchema } from "../lib/schemas";
import { Input } from "./ui/input";
// ❌ 移除 Textarea
// import { Textarea } from "./ui/textarea";
// ✅ 引入 MiniEditor
import { MiniEditor } from "./common/MiniEditor";
import { ImageUpload } from "./common/ImageUpload";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { LoadingButton } from "./common/LoadingButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useNovelDataSelector } from "../lib/react-query/db-queries";

interface CharacterFormProps {
  onSubmitSuccess: () => void;
  onClose: () => void;
}

/**
 * 角色创建表单组件
 * 重构后使用统一的 useMutationForm Hook，大幅简化代码
 * 遵循单一职责原则，仅负责角色创建的表单UI
 *
 * 重构收益：
 * - DRY: 消除了表单模板代码的重复，使用通用Hook
 * - KISS: 组件实现更简洁，只需关注UI渲染
 * - SOLID (SRP): 组件专注于UI渲染，表单逻辑由Hook处理
 * - 自动日志: 集成了 useFormWithLogging 的日志功能
 */
export const CharacterForm: React.FC<CharacterFormProps> = ({
  onSubmitSuccess,
  onClose,
}): React.ReactElement => {
  // ✅ 使用统一 Hook 获取所有实体类型的提及数据
  const mentionOptions = useMentionOptions();
  
  // ✅ 使用 selector 高效获取势力列表
  const factions = useNovelDataSelector((novel) => novel?.factions || []);

  // ✅ 一行代码完成所有状态管理、验证、API绑定和日志
  const { form, onSubmit, isPending } = useMutationForm({
    context: "CharacterForm",
    schema: createCharacterSchema,
    mutation: useAddCharacterMutation(),
    defaultValues: {
      name: "",
      description: "",
      avatar: "",
      age: "",
      gender: "",
      appearance: "",
      personality: "",
      motivation: "",
      backstory: "",
      factionId: "none",
    },
    onSuccess: () => {
      onSubmitSuccess();
      onClose();
    },
    // 处理表单数据转换，将"none"转换为空字符串
    onSubmit: (data) => {
      // 转换factionId：将"none"转换为空字符串，以匹配数据库期望的空值
      if (data.factionId === "none") {
        data.factionId = "";
      }
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>角色名</FormLabel>
              <FormControl><Input placeholder="例如：艾拉" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 角色头像 */}
        <FormField
          control={form.control}
          name="avatar"
          render={({ field }) => (
            <FormItem>
              <FormLabel>角色头像</FormLabel>
              <FormControl>
                <ImageUpload value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="age"
            render={({ field }) => (
              <FormItem>
                <FormLabel>年龄</FormLabel>
                <FormControl>
                  <Input placeholder="例如：青年" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="gender"
            render={({ field }) => (
              <FormItem>
                <FormLabel>性别</FormLabel>
                <FormControl>
                  <Input placeholder="例如：男" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* 所属势力 */}
        <FormField
            control={form.control}
            name="factionId"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>所属势力</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="选择所属势力" />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="none">无</SelectItem>
                            {factions.data?.map((faction) => (
                                <SelectItem key={faction.id} value={faction.id}>
                                    {faction.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormItem>
            )}
        />

        {/* 角色简介 */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>角色简介</FormLabel>
              <FormControl>
                {/* ✅ 3. 传递统一的提及选项 */}
                <MiniEditor
                  content={field.value || ""}
                  onChange={field.onChange}
                  mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 外貌描述 */}
        <FormField
          control={form.control}
          name="appearance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>外貌描述</FormLabel>
              <FormControl>
                <MiniEditor
                    content={field.value || ""}
                    onChange={field.onChange}
                    mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 性格特点 */}
        <FormField
          control={form.control}
          name="personality"
          render={({ field }) => (
            <FormItem>
              <FormLabel>性格特点</FormLabel>
              <FormControl>
                <MiniEditor
                    content={field.value || ""}
                    onChange={field.onChange}
                    mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 动机与目标 */}
        <FormField
          control={form.control}
          name="motivation"
          render={({ field }) => (
            <FormItem>
              <FormLabel>动机与目标</FormLabel>
              <FormControl>
                <MiniEditor
                    content={field.value || ""}
                    onChange={field.onChange}
                    mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 背景故事 */}
        <FormField
          control={form.control}
          name="backstory"
          render={({ field }) => (
            <FormItem>
              <FormLabel>背景故事</FormLabel>
              <FormControl>
                <MiniEditor
                    content={field.value || ""}
                    onChange={field.onChange}
                    mentionItems={mentionOptions}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <LoadingButton type="submit" className="w-full" isLoading={isPending}>
          保存角色
        </LoadingButton>
      </form>
    </Form>
  );
};
