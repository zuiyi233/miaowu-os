"use client";

import {
  addEdge,
  type Connection,
  type Edge,
  type Node as RFNode,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  AudioLinesIcon,
  DownloadIcon,
  FileAudioIcon,
  LoaderCircleIcon,
  Mic2Icon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { toast } from "sonner";

import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { Canvas } from "@/components/ai-elements/canvas";
import { Controls } from "@/components/ai-elements/controls";
import {
  Node,
  NodeAction,
  NodeContent,
  NodeDescription,
  NodeFooter,
  NodeHeader,
  NodeTitle,
} from "@/components/ai-elements/node";
import { Panel } from "@/components/ai-elements/panel";
import { Toolbar } from "@/components/ai-elements/toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getBackendBaseURL } from "@/core/config";
import { uploadMediaAsset } from "@/core/media-assets/api";
import { fetchTtsConfig, optimizeTtsStyle, optimizeTtsVoiceDesign } from "@/core/tts/api";
import {
  createTtsStudioWorkspace,
  deleteTtsStudioWorkspace,
  exportTtsStudioWorkspace,
  listTtsStudioWorkspaces,
  runTtsStudioNode,
  saveTtsStudioWorkspace,
  type TtsStudioArtifact,
  type TtsStudioBoard,
  type TtsStudioNode,
  type TtsStudioNodeType,
  type TtsStudioWorkspace,
} from "@/core/tts/studio-api";

type StudioNodeData = Record<string, unknown> & {
  nodeType?: TtsStudioNodeType;
  label?: string;
  text?: string;
  voice_description?: string;
  asset_id?: string;
  filename?: string;
  status?: string;
  artifact?: TtsStudioArtifact;
};

type FlowNode = RFNode<StudioNodeData>;

function toAbsoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${getBackendBaseURL()}${url}`;
  return url;
}

function readStringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toFlowNode(node: TtsStudioNode): FlowNode {
  return {
    id: node.id,
    type: "studioNode",
    position: node.position,
    data: node.data as StudioNodeData,
  };
}

function toBoardNode(node: FlowNode): TtsStudioNode {
  const data = node.data;
  const nodeType = data.nodeType ?? "prompt";
  const rest = { ...data };
  delete rest.nodeType;
  delete rest.type;
  return {
    id: node.id,
    type: nodeType,
    position: { x: node.position.x, y: node.position.y },
    data: rest,
  };
}

function boardToFlow(board: TtsStudioBoard) {
  return {
    nodes: board.nodes.map((node) =>
      toFlowNode({ ...node, data: { ...node.data, nodeType: node.type } }),
    ),
    edges: board.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
  };
}

function flowToBoard(nodes: FlowNode[], edges: Edge[], stash: TtsStudioArtifact[]): TtsStudioBoard {
  return {
    version: 1,
    nodes: nodes.map(toBoardNode),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
    stash,
  };
}

function boardSignature(board: TtsStudioBoard): string {
  return JSON.stringify(board);
}

function nodeTitle(type: TtsStudioNodeType): string {
  switch (type) {
    case "referenceAudio":
      return "参考音频";
    case "voiceStyle":
      return "声音风格";
    case "prompt":
      return "朗读文本";
    case "voiceClone":
      return "声音克隆";
    case "voiceDesign":
      return "声音设计";
    case "artifact":
      return "生成音频";
  }
}

function StudioNodeComponent({ id, data, selected }: { id: string; data: StudioNodeData; selected?: boolean }) {
  const type = data.nodeType ?? "prompt";
  const artifact = data.artifact ?? (type === "artifact" ? data as TtsStudioArtifact : undefined);
  const url = toAbsoluteUrl(artifact?.url ?? artifact?.download_url);
  return (
    <Node handles={{ target: type !== "referenceAudio" && type !== "voiceStyle", source: type !== "artifact" }} className={selected ? "ring-2 ring-primary" : ""}>
      <NodeHeader>
        <div>
          <NodeTitle className="text-sm">{nodeTitle(type)}</NodeTitle>
          <NodeDescription className="text-xs">{id}</NodeDescription>
        </div>
        <NodeAction>
          <Badge variant={data.status === "completed" ? "default" : "secondary"}>{String(data.status ?? "ready")}</Badge>
        </NodeAction>
      </NodeHeader>
      <NodeContent className="space-y-2 text-xs">
        {type === "referenceAudio" ? (
          <div className="truncate text-muted-foreground">{data.filename ? String(data.filename) : "未上传参考音频"}</div>
        ) : null}
        {type === "voiceStyle" ? <div className="line-clamp-3">{readStringField(data, "style_text") ?? readStringField(data, "style") ?? "未设置风格"}</div> : null}
        {type === "prompt" ? <div className="line-clamp-4 whitespace-pre-wrap">{String(data.text ?? "未设置文本")}</div> : null}
        {type === "voiceDesign" ? <div className="line-clamp-3">{String(data.voice_description ?? "未设置声音描述")}</div> : null}
        {type === "voiceClone" ? <div className="text-muted-foreground">连接参考音频、风格和文本后运行</div> : null}
        {url ? <audio className="h-8 w-full" controls src={url} /> : null}
      </NodeContent>
      {(type === "voiceClone" || type === "voiceDesign") ? (
        <Toolbar isVisible={selected}>
          <span className="px-2 text-xs text-muted-foreground">在右侧面板运行</span>
        </Toolbar>
      ) : null}
      {type === "artifact" ? (
        <NodeFooter>
          <a className="text-xs text-primary" href={toAbsoluteUrl(artifact?.download_url) ?? "#"} download>
            下载
          </a>
        </NodeFooter>
      ) : null}
    </Node>
  );
}

const nodeTypes = { studioNode: StudioNodeComponent };

function IconButtonWithTooltip({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} title={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TtsStudioWorkspaceView() {
  const [workspaces, setWorkspaces] = useState<TtsStudioWorkspace[]>([]);
  const [workspace, setWorkspace] = useState<TtsStudioWorkspace | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
  const [optimizingNodeId, setOptimizingNodeId] = useState<string | null>(null);
  const [configSummary, setConfigSummary] = useState("检测中");
  const lastSavedSignatureRef = useRef<string | null>(null);
  const hasLoadedWorkspaceRef = useRef(false);
  const stash = useMemo(() => workspace?.board.stash ?? [], [workspace?.board.stash]);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);

  const applyWorkspace = useCallback((nextWorkspace: TtsStudioWorkspace) => {
    setWorkspace(nextWorkspace);
    const flow = boardToFlow(nextWorkspace.board);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    lastSavedSignatureRef.current = boardSignature(nextWorkspace.board);
    hasLoadedWorkspaceRef.current = true;
  }, [setEdges, setNodes]);

  const refreshWorkspaces = useCallback(async () => {
    const items = await listTtsStudioWorkspaces();
    if (items.length > 0) {
      setWorkspaces(items);
      const current = items[0];
      if (!current) return;
      applyWorkspace(current);
      return;
    }
    const created = await createTtsStudioWorkspace("音频工作站");
    setWorkspaces([created]);
    applyWorkspace(created);
  }, [applyWorkspace]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([refreshWorkspaces(), fetchTtsConfig()])
      .then(([, config]) => {
        if (cancelled) return;
        const mimo = config.providers?.mimo;
        setConfigSummary(mimo?.available ? `MiMo 已配置：${mimo.default_model ?? "backend default"}` : "MiMo 未配置或不可用");
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "音频工作站加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshWorkspaces]);

  const currentBoard = useCallback(() => flowToBoard(nodes, edges, stash), [edges, nodes, stash]);

  const persistWorkspace = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!workspace) return;
    setSaving(true);
    try {
      const saved = await saveTtsStudioWorkspace({ ...workspace, board: currentBoard() });
      setWorkspace(saved);
      setWorkspaces((items) => items.map((item) => item.id === saved.id ? saved : item));
      lastSavedSignatureRef.current = boardSignature(saved.board);
      if (!options.silent) toast.success("已保存");
    } catch (error) {
      if (!options.silent) toast.error(error instanceof Error ? error.message : "保存失败");
      else console.error("TTS studio autosave failed", error);
    } finally {
      setSaving(false);
    }
  }, [currentBoard, workspace]);

  useEffect(() => {
    if (!workspace || !hasLoadedWorkspaceRef.current) return;
    const board = currentBoard();
    const signature = boardSignature(board);
    if (signature === lastSavedSignatureRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void persistWorkspace({ silent: true });
    }, 800);

    return () => window.clearTimeout(timeoutId);
  }, [currentBoard, persistWorkspace, workspace]);

  const updateSelectedData = useCallback((patch: StudioNodeData) => {
    if (!selectedNodeId) return;
    setNodes((items) => items.map((node) => node.id === selectedNodeId ? { ...node, data: { ...node.data, ...patch } } : node));
  }, [selectedNodeId, setNodes]);

  const addNode = useCallback((type: TtsStudioNodeType) => {
    const id = `${type}-${Date.now().toString(36)}`;
    setNodes((items) => [...items, {
      id,
      type: "studioNode",
      position: { x: 120 + items.length * 40, y: 120 + items.length * 30 },
      data: { nodeType: type, status: "ready", ...(type === "prompt" ? { text: "" } : {}), ...(type === "voiceStyle" ? { style_text: "" } : {}) },
    }]);
  }, [setNodes]);

  const uploadReference = useCallback(async (file: File) => {
    const asset = await uploadMediaAsset(file, { purpose: "tts_audio", metadata: { source: "tts_studio_reference" } });
    updateSelectedData({ asset_id: asset.id, filename: asset.filename, status: "completed" });
    toast.success("参考音频已上传");
  }, [updateSelectedData]);

  const runSelectedNode = useCallback(async () => {
    if (!workspace || !selectedNode) return;
    setRunningNodeId(selectedNode.id);
    try {
      const result = await runTtsStudioNode(workspace.id, selectedNode.id, currentBoard());
      applyWorkspace(result.workspace);
      setWorkspaces((items) => items.map((item) => item.id === result.workspace.id ? result.workspace : item));
      toast.success("节点运行完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "节点运行失败");
    } finally {
      setRunningNodeId(null);
    }
  }, [applyWorkspace, currentBoard, selectedNode, workspace]);

  const optimizeSelectedNode = useCallback(async () => {
    if (!selectedNode) return;
    const type = selectedNode.data.nodeType;
    setOptimizingNodeId(selectedNode.id);
    try {
      if (type === "voiceStyle") {
        const styleText = readStringField(selectedNode.data, "style_text") ?? readStringField(selectedNode.data, "style");
        if (!styleText) {
          toast.error("请先填写声音风格");
          return;
        }
        const result = await optimizeTtsStyle({ style_text: styleText });
        updateSelectedData({ style_text: result.text, status: "optimized" });
        toast.success("声音风格已优化");
        return;
      }
      if (type === "voiceDesign") {
        const description = readStringField(selectedNode.data, "voice_description");
        if (!description) {
          toast.error("请先填写声音描述");
          return;
        }
        const result = await optimizeTtsVoiceDesign({ voice_description: description });
        updateSelectedData({ voice_description: result.text, status: "optimized" });
        toast.success("声音描述已优化");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "优化失败");
    } finally {
      setOptimizingNodeId(null);
    }
  }, [selectedNode, updateSelectedData]);

  const exportStash = useCallback(async () => {
    if (!workspace) return;
    try {
      const blob = await exportTtsStudioWorkspace(workspace.id, stash.map((item) => item.asset_id));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `tts-studio-${workspace.id}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    }
  }, [stash, workspace]);

  const deleteCurrentWorkspace = useCallback(async () => {
    if (!workspace) return;
    await deleteTtsStudioWorkspace(workspace.id);
    toast.success("工作区已删除");
    await refreshWorkspaces();
  }, [refreshWorkspaces, workspace]);

  if (loading) {
    return <div className="flex size-full items-center justify-center text-sm text-muted-foreground"><LoaderCircleIcon className="mr-2 size-4 animate-spin" />音频工作站加载中</div>;
  }

  return (
    <div className="grid size-full grid-rows-[minmax(24rem,1fr)_minmax(18rem,42vh)] overflow-hidden lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-none">
      <div className="relative min-h-0 min-w-0">
        <Canvas
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(connection: Connection) => setEdges((items) => addEdge(connection, items))}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
        >
          <Controls />
          <Panel position="top-left" className="flex items-center gap-1">
            <IconButtonWithTooltip label="添加参考音频" size="icon-sm" variant="ghost" onClick={() => addNode("referenceAudio")}><FileAudioIcon className="size-4" /></IconButtonWithTooltip>
            <IconButtonWithTooltip label="添加声音风格" size="icon-sm" variant="ghost" onClick={() => addNode("voiceStyle")}><AudioLinesIcon className="size-4" /></IconButtonWithTooltip>
            <IconButtonWithTooltip label="添加朗读文本" size="icon-sm" variant="ghost" onClick={() => addNode("prompt")}><PlusIcon className="size-4" /></IconButtonWithTooltip>
            <IconButtonWithTooltip label="添加声音克隆" size="icon-sm" variant="ghost" onClick={() => addNode("voiceClone")}><Mic2Icon className="size-4" /></IconButtonWithTooltip>
            <IconButtonWithTooltip label="添加声音设计" size="icon-sm" variant="ghost" onClick={() => addNode("voiceDesign")}><WandSparklesIcon className="size-4" /></IconButtonWithTooltip>
          </Panel>
        </Canvas>
      </div>
      <aside className="flex min-h-0 flex-col border-t bg-background lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div className="min-w-0">
            <Input
              value={workspace?.name ?? ""}
              onChange={(event) => workspace && setWorkspace({ ...workspace, name: event.target.value })}
              className="h-8 border-0 px-0 text-sm font-medium shadow-none focus-visible:ring-0"
            />
            <div className="truncate text-xs text-muted-foreground">{configSummary}</div>
          </div>
          <div className="flex items-center gap-1">
            <IconButtonWithTooltip label="保存工作区" size="icon" variant="ghost" onClick={() => void persistWorkspace()} disabled={saving}><SaveIcon className="size-4" /></IconButtonWithTooltip>
            <IconButtonWithTooltip label="删除工作区" size="icon" variant="ghost" onClick={() => void deleteCurrentWorkspace()}><Trash2Icon className="size-4" /></IconButtonWithTooltip>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-3">
            <div className="space-y-2">
              <Label>工作区</Label>
              <div className="space-y-1">
                {workspaces.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${workspace?.id === item.id ? "bg-accent" : "hover:bg-muted/50"}`}
                    onClick={() => {
                      applyWorkspace(item);
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
              <Button className="w-full" variant="outline" onClick={() => { void createTtsStudioWorkspace("音频工作站").then(refreshWorkspaces); }}>
                <PlusIcon className="size-4" />新建工作区
              </Button>
            </div>

            {selectedNode ? (
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">{nodeTitle(selectedNode.data.nodeType ?? "prompt")}</div>
                  <div className="text-xs text-muted-foreground">{selectedNode.id}</div>
                </div>
                {selectedNode.data.nodeType === "referenceAudio" ? (
                  <Input type="file" accept="audio/*" onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadReference(file);
                  }} />
                ) : null}
                {selectedNode.data.nodeType === "prompt" ? (
                  <Textarea value={String(selectedNode.data.text ?? "")} onChange={(event) => updateSelectedData({ text: event.target.value })} className="min-h-32" />
                ) : null}
                {selectedNode.data.nodeType === "voiceStyle" ? (
                  <>
                    <Textarea value={readStringField(selectedNode.data, "style_text") ?? ""} onChange={(event) => updateSelectedData({ style_text: event.target.value })} className="min-h-24" />
                    <Button variant="outline" className="w-full" onClick={() => void optimizeSelectedNode()} disabled={optimizingNodeId === selectedNode.id}>
                      {optimizingNodeId === selectedNode.id ? <LoaderCircleIcon className="size-4 animate-spin" /> : <WandSparklesIcon className="size-4" />}
                      优化声音风格
                    </Button>
                  </>
                ) : null}
                {selectedNode.data.nodeType === "voiceDesign" ? (
                  <>
                    <Textarea value={String(selectedNode.data.voice_description ?? "")} onChange={(event) => updateSelectedData({ voice_description: event.target.value })} className="min-h-24" />
                    <Button variant="outline" className="w-full" onClick={() => void optimizeSelectedNode()} disabled={optimizingNodeId === selectedNode.id}>
                      {optimizingNodeId === selectedNode.id ? <LoaderCircleIcon className="size-4 animate-spin" /> : <WandSparklesIcon className="size-4" />}
                      润色声音描述
                    </Button>
                  </>
                ) : null}
                {(selectedNode.data.nodeType === "voiceClone" || selectedNode.data.nodeType === "voiceDesign") ? (
                  <Button className="w-full" onClick={() => void runSelectedNode()} disabled={runningNodeId === selectedNode.id}>
                    {runningNodeId === selectedNode.id ? <LoaderCircleIcon className="size-4 animate-spin" /> : <WandSparklesIcon className="size-4" />}
                    运行节点
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">选择一个节点进行编辑</div>
            )}

            <Artifact className="shadow-none">
              <ArtifactHeader>
                <div>
                  <ArtifactTitle>暂存音频</ArtifactTitle>
                  <ArtifactDescription>{stash.length} 个资产</ArtifactDescription>
                </div>
                <ArtifactActions>
                  <ArtifactAction icon={DownloadIcon} tooltip="批量导出" onClick={() => void exportStash()} disabled={stash.length === 0} />
                </ArtifactActions>
              </ArtifactHeader>
              <ArtifactContent className="space-y-3 p-3">
                {stash.map((item) => {
                  const url = toAbsoluteUrl(item.url ?? item.download_url);
                  return (
                    <div key={item.asset_id} className="space-y-2 rounded-md border p-2">
                      <div className="truncate text-xs font-medium">{item.asset_id}</div>
                      {url ? <audio className="h-8 w-full" controls src={url} /> : null}
                      <Button size="sm" variant="outline" className="w-full" asChild>
                        <a href={toAbsoluteUrl(item.download_url) ?? "#"} download><DownloadIcon className="size-3.5" />下载</a>
                      </Button>
                    </div>
                  );
                })}
                {stash.length === 0 ? <div className="text-sm text-muted-foreground">运行声音克隆或声音设计节点后会自动暂存。</div> : null}
              </ArtifactContent>
            </Artifact>
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}
