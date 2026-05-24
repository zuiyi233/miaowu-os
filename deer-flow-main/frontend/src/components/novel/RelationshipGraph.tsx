"use client";

import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
} from "@xyflow/react";
import dagre from "dagre";
import {
  Network,
  User,
  Building2,
  X,
  Trophy,
  Save,
  RotateCcw,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import "@xyflow/react/dist/style.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { fetch as authFetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { browserStorageQuotaService } from "@/core/storage/browser-quota";
import { cn } from "@/lib/utils";

interface GraphNode {
  id: string;
  name: string;
  type: string;
  role_type?: string;
  is_organization?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  intimacy: number;
  status: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}

interface CharacterDetail {
  id: string;
  name: string;
  age?: string;
  gender?: string;
  appearance?: string;
  personality?: string;
  motivation?: string;
  backstory?: string;
  role_type?: string;
  is_organization?: boolean;
  avatar?: string;
}

interface CareerItem {
  id: string;
  name: string;
  type: "main" | "sub";
  maxStage: number;
}

interface CareerListResponse {
  main_careers?: CareerItem[];
  sub_careers?: CareerItem[];
}

interface RelationshipGraphProps {
  projectId: string;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 70;
const ORG_WIDTH = 160;
const ORG_HEIGHT = 60;
const CAREER_NODE_WIDTH = 130;
const CAREER_NODE_HEIGHT = 52;
const CAREER_GROUP_WIDTH = 120;
const CAREER_GROUP_HEIGHT = 40;

type EdgeCategory =
  | "organization"
  | "career_main"
  | "career_sub"
  | "career_group"
  | "family"
  | "hostile"
  | "professional"
  | "social"
  | "default";

const EDGE_CATEGORY_COLORS: Record<
  EdgeCategory,
  { color: string; order: number }
> = {
  organization: { color: "#3b82f6", order: 1 },
  career_main: { color: "#f59e0b", order: 2 },
  career_sub: { color: "#06b6d4", order: 3 },
  career_group: { color: "#9ca3af", order: 4 },
  family: { color: "#f59e0b", order: 5 },
  hostile: { color: "#ef4444", order: 6 },
  professional: { color: "#06b6d4", order: 7 },
  social: { color: "#22c55e", order: 8 },
  default: { color: "#9ca3af", order: 99 },
};

const RELATIONSHIP_KEYWORDS: Record<EdgeCategory, string[]> = {
  organization: ["组织成员·"],
  career_main: ["主职业·"],
  career_sub: ["副职业·"],
  career_group: ["职业分类·"],
  family: ["父", "母", "子", "兄", "姐", "弟", "妹", "配偶", "亲属"],
  hostile: ["敌", "仇", "对立"],
  professional: ["同事", "上级", "下属", "师", "徒"],
  social: ["友", "朋", "邻居", "熟人"],
  default: [],
};

function getEdgeCategory(relationship: string): EdgeCategory {
  for (const [category, keywords] of Object.entries(RELATIONSHIP_KEYWORDS)) {
    if (keywords.length === 0) continue;
    const isPrefixMatch = keywords.some((kw) => relationship.startsWith(kw));
    const isIncludeMatch = keywords.some((kw) =>
      relationship.toLowerCase().includes(kw.toLowerCase()),
    );
    if (isPrefixMatch || isIncludeMatch) return category as EdgeCategory;
  }
  return "default";
}

const LAYOUT_STORAGE_KEY = (projectId: string) =>
  `relgraph-layout-${projectId}`;

function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: "LR",
    nodesep: 100,
    ranksep: 120,
    marginx: 50,
    marginy: 50,
  });

  nodes.forEach((node) => {
    let w = NODE_WIDTH;
    let h = NODE_HEIGHT;
    if (node.data?.isOrganization) {
      w = ORG_WIDTH;
      h = ORG_HEIGHT;
    } else if (node.data?.isCareerGroup) {
      w = CAREER_GROUP_WIDTH;
      h = CAREER_GROUP_HEIGHT;
    } else if (node.data?.isCareerNode) {
      w = CAREER_NODE_WIDTH;
      h = CAREER_NODE_HEIGHT;
    }
    dagreGraph.setNode(node.id, { width: w, height: h });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });
  dagre.layout(dagreGraph);

  return nodes.map((node) => {
    const n = dagreGraph.node(node.id);
    let hw = NODE_WIDTH / 2;
    let hh = NODE_HEIGHT / 2;
    if (node.data?.isOrganization) {
      hw = ORG_WIDTH / 2;
      hh = ORG_HEIGHT / 2;
    } else if (node.data?.isCareerGroup) {
      hw = CAREER_GROUP_WIDTH / 2;
      hh = CAREER_GROUP_HEIGHT / 2;
    } else if (node.data?.isCareerNode) {
      hw = CAREER_NODE_WIDTH / 2;
      hh = CAREER_NODE_HEIGHT / 2;
    }
    return { ...node, position: { x: n.x - hw, y: n.y - hh } };
  });
}

export function RelationshipGraph({ projectId }: RelationshipGraphProps) {
  const backendBase = getBackendBaseURL();
  const { t } = useI18n();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<
    "all" | "character" | "organization"
  >("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [edgeVisibilityMap, setEdgeVisibilityMap] = useState<
    Record<string, boolean>
  >({});
  const [characterDetailMap, setCharacterDetailMap] = useState<
    Record<string, CharacterDetail>
  >({});
  const [selectedDetail, setSelectedDetail] = useState<CharacterDetail | null>(
    null,
  );
  const [, setDetailLoading] = useState(false);
  const [careers, setCareers] = useState<CareerListResponse>({
    main_careers: [],
    sub_careers: [],
  });
  const [hasSavedLayout, setHasSavedLayout] = useState(false);

  const roleLabels = useMemo<Record<string, string>>(
    () => ({
      protagonist: t.novel.protagonist,
      supporting: t.novel.supporting,
      antagonist: t.novel.antagonist,
    }),
    [t],
  );

  const edgeCategoryLabels = useMemo<Record<EdgeCategory, string>>(
    () => ({
      organization: t.novel.orgMember,
      career_main: t.novel.mainCareerAssoc,
      career_sub: t.novel.subCareerAssoc,
      career_group: t.novel.careerCategoryAssoc,
      family: t.novel.familyRelation,
      hostile: t.novel.hostileRelation,
      professional: t.novel.careerRelation,
      social: t.novel.socialRelation,
      default: t.novel.otherRelation,
    }),
    [t],
  );

  const edgeCategoryMeta = useMemo(() => {
    const result: Record<
      EdgeCategory,
      { label: string; color: string; order: number }
    > = {} as any;
    for (const cat of Object.keys(EDGE_CATEGORY_COLORS) as EdgeCategory[]) {
      result[cat] = {
        label: edgeCategoryLabels[cat],
        ...EDGE_CATEGORY_COLORS[cat],
      };
    }
    return result;
  }, [edgeCategoryLabels]);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      const savedLayout = loadSavedLayout();
      setHasSavedLayout(!!savedLayout);

      const [graphRes, careerRes] = await Promise.all([
        authFetch(
          `${backendBase}/api/relationships/graph?project_id=${projectId}`,
        ),
        authFetch(`${backendBase}/api/careers?project_id=${projectId}`).catch(
          () => null,
        ),
      ]);

      if (!graphRes.ok) return;

      const data: GraphData = await graphRes.json();
      setGraphData(data);

      let careerData: CareerListResponse = {
        main_careers: [],
        sub_careers: [],
      };
      if (careerRes?.ok) careerData = await careerRes.json();
      setCareers(careerData);

      buildFlowElements(data, careerData, savedLayout);
    } catch (err) {
      console.error(t.novel.loadGraphFailed, err);
    } finally {
      setLoading(false);
    }
  }, [projectId, backendBase, t]);

  function loadSavedLayout(): Record<string, { x: number; y: number }> | null {
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY(projectId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  const saveCurrentLayout = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n) => {
      positions[n.id] = n.position;
    });
    void browserStorageQuotaService.setLocalItem(
      LAYOUT_STORAGE_KEY(projectId),
      JSON.stringify(positions),
    );
    setHasSavedLayout(true);
    toast.success(t.novel.layoutSaved);
  }, [nodes, projectId, t]);

  const resetLayout = useCallback(() => {
    browserStorageQuotaService.removeLocalItem(LAYOUT_STORAGE_KEY(projectId));
    setHasSavedLayout(false);
    if (graphData) buildFlowElements(graphData, careers, null);
    toast.info(t.novel.layoutReset);
  }, [projectId, graphData, careers, t]);

  const buildFlowElements = useCallback(
    (
      data: GraphData,
      careerData: CareerListResponse,
      savedPositions: Record<string, { x: number; y: number }> | null,
    ) => {
      const flowNodes: Node[] = [];
      const flowEdges: Edge[] = [];

      data.nodes.forEach((n) => {
        flowNodes.push({
          id: n.id,
          type: n.is_organization ? "organizationNode" : "characterNode",
          position: savedPositions?.[n.id] || { x: 0, y: 0 },
          data: {
            label: n.name,
            roleType: n.role_type || "",
            isOrganization: n.is_organization ?? false,
          },
        });
      });

      const allCareers = [
        ...(careerData.main_careers || []),
        ...(careerData.sub_careers || []),
      ];
      const careerNameMap: Record<string, CareerItem> = {};
      allCareers.forEach((c) => {
        careerNameMap[c.id] = c;
      });

      const hasMainCareers = (careerData.main_careers?.length || 0) > 0;
      const hasSubCareers = (careerData.sub_careers?.length || 0) > 0;

      if (hasMainCareers) {
        flowNodes.push({
          id: "__cg_main__",
          type: "careerGroupNode",
          position: { x: 0, y: 0 },
          data: { label: t.novel.careerGroup, careerType: "main" as const },
        });
      }
      if (hasSubCareers) {
        flowNodes.push({
          id: "__cg_sub__",
          type: "careerGroupNode",
          position: { x: 0, y: 0 },
          data: { label: t.novel.subCareerGroup, careerType: "sub" as const },
        });
      }

      (careerData.main_careers || []).forEach((c) => {
        flowNodes.push({
          id: `career-main-${c.id}`,
          type: "careerNode",
          position: savedPositions?.[`career-main-${c.id}`] || { x: 0, y: 0 },
          data: { label: c.name, careerType: "main" as const },
        });
        if (hasMainCareers) {
          flowEdges.push(
            buildCategoryEdge(
              `__cg_main__-career-main-${c.id}`,
              "__cg_main__",
              `career-main-${c.id}`,
              `${t.novel.careerCategory}·${c.name}`,
            ),
          );
        }
      });

      (careerData.sub_careers || []).forEach((c) => {
        flowNodes.push({
          id: `career-sub-${c.id}`,
          type: "careerNode",
          position: savedPositions?.[`career-sub-${c.id}`] || { x: 0, y: 0 },
          data: { label: c.name, careerType: "sub" as const },
        });
        if (hasSubCareers) {
          flowEdges.push(
            buildCategoryEdge(
              `__cg_sub__-career-sub-${c.id}`,
              "__cg_sub__",
              `career-sub-${c.id}`,
              `${t.novel.careerCategory}·${c.name}`,
            ),
          );
        }
      });

      data.links.forEach((link, i) => {
        flowEdges.push(
          buildRelationEdge(
            `edge-${i}`,
            link.source,
            link.target,
            link.relationship,
            link.status,
            link.intimacy,
          ),
        );
      });

      const layouted = getLayoutedElements(flowNodes, flowEdges);
      const finalNodes = layouted.map((n) => {
        const sp = savedPositions?.[n.id];
        return sp ? { ...n, position: sp } : n;
      });
      setNodes(finalNodes);
      setEdges(flowEdges);

      const categoryCounter: Record<string, number> = {};
      flowEdges.forEach((e) => {
        const cat =
          typeof e.data?.category === "string" ? e.data.category : "default";
        categoryCounter[cat] = (categoryCounter[cat] || 0) + 1;
      });
      setEdgeVisibilityMap((prev) => {
        const next: Record<string, boolean> = {};
        Object.keys(categoryCounter).forEach((cat) => {
          next[cat] = prev[cat] !== false;
        });
        return next;
      });
    },
    [setNodes, setEdges, t],
  );

  function buildRelationEdge(
    id: string,
    source: string,
    target: string,
    relationship: string,
    status: string,
    intimacy: number,
  ): Edge {
    const category = getEdgeCategory(relationship);
    const meta = edgeCategoryMeta[category] || edgeCategoryMeta.default;
    const isActive = status === "active";
    return {
      id,
      source,
      target,
      label: relationship,
      type: "smoothstep",
      animated: isActive && !relationship.startsWith("职业"),
      style: {
        stroke: meta.color,
        strokeWidth: relationship.startsWith("职业分类") ? 1.5 : 2,
        strokeOpacity: isActive ? 1 : 0.5,
        strokeDasharray:
          relationship.startsWith("组织成员") ||
          relationship.startsWith("副职业")
            ? "6 3"
            : undefined,
      },
      labelStyle: {
        fontSize: 10,
        fill: "#6b7280",
        fontWeight: relationship.startsWith("主职业") ? 600 : 500,
      },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
      markerEnd: { type: MarkerType.ArrowClosed, color: meta.color },
      data: { intimacy, status, category },
    };
  }

  function buildCategoryEdge(
    id: string,
    source: string,
    target: string,
    label: string,
  ): Edge {
    const category = getEdgeCategory(label);
    const meta = edgeCategoryMeta[category] || edgeCategoryMeta.default;
    return {
      id,
      source,
      target,
      label,
      type: "smoothstep",
      style: {
        stroke: meta.color,
        strokeWidth: 1.5,
        strokeOpacity: 0.5,
        strokeDasharray: "6 3",
      },
      labelStyle: { fontSize: 9, fill: "#9ca3af" },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.8 },
      markerEnd: { type: MarkerType.ArrowClosed, color: meta.color },
      data: { intimacy: 0, status: "active", category },
    };
  }

  const edgeCategories = useMemo(
    () =>
      Object.entries(edgeVisibilityMap)
        .map(([cat, visible]) => ({
          cat,
          visible,
          ...(edgeCategoryMeta[cat as EdgeCategory] ||
            edgeCategoryMeta.default),
        }))
        .sort((a, b) => a.order - b.order),
    [edgeVisibilityMap, edgeCategoryMeta],
  );

  const toggleEdgeCategory = useCallback((category: string) => {
    setEdgeVisibilityMap((prev) => ({
      ...prev,
      [category]: !(prev[category] !== false),
    }));
  }, []);

  const filteredNodes = useMemo(
    () =>
      graphData?.nodes.filter((n) => {
        if (filterType === "character" && n.is_organization) return false;
        if (filterType === "organization" && !n.is_organization) return false;
        if (
          searchTerm &&
          !n.name.toLowerCase().includes(searchTerm.toLowerCase())
        )
          return false;
        return true;
      }) || [],
    [graphData, filterType, searchTerm],
  );

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes],
  );

  const visibleEdges = useMemo(
    () =>
      edges.filter((e) => {
        const cat =
          typeof e.data?.category === "string" ? e.data.category : "default";
        if (edgeVisibilityMap[cat] === false) return false;
        if (filteredNodeIds.size === 0) return true;
        const isCareerEdge =
          e.source.startsWith("__cg_") ||
          e.source.startsWith("career-") ||
          e.target.startsWith("__cg_") ||
          e.target.startsWith("career-");
        if (isCareerEdge) return true;
        return filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target);
      }),
    [edges, edgeVisibilityMap, filteredNodeIds],
  );

  const selectedNode = selectedNodeId
    ? graphData?.nodes.find((n) => n.id === selectedNodeId)
    : null;
  const connectedEdges = selectedNodeId
    ? (graphData?.links || []).filter(
        (l) => l.source === selectedNodeId || l.target === selectedNodeId,
      )
    : [];

  const loadCharacterDetail = useCallback(
    async (nodeId: string) => {
      if (nodeId.startsWith("__cg_") || nodeId.startsWith("career-")) return;
      const cached = characterDetailMap[nodeId];
      if (cached) {
        setSelectedDetail(cached);
        return;
      }
      setDetailLoading(true);
      try {
        const res = await authFetch(`${backendBase}/api/characters/${nodeId}`);
        if (res.ok) {
          const detail: CharacterDetail = await res.json();
          setCharacterDetailMap((prev) => ({ ...prev, [nodeId]: detail }));
          setSelectedDetail(detail);
        }
      } catch {
        console.error(t.novel.loadCharacterDetailsFailed);
      } finally {
        setDetailLoading(false);
      }
    },
    [backendBase, characterDetailMap, t],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
      setSelectedDetail(null);
      if (!node.id.startsWith("__cg_") && !node.id.startsWith("career-"))
        void loadCharacterDetail(node.id);
    },
    [loadCharacterDetail],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedDetail(null);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Network className="h-5 w-5" /> {t.novel.characterRelationshipGraph}
        </h2>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {graphData?.nodes.length || 0} {t.novel.nodes}
          </Badge>
          <Badge variant="outline">
            {graphData?.links.length || 0} {t.novel.relationshipsLabel}
          </Badge>
          {(careers.main_careers?.length || 0) > 0 && (
            <Badge variant="outline" className="text-yellow-600">
              {careers.main_careers?.length || 0} {t.novel.mainCareer}
            </Badge>
          )}
          {(careers.sub_careers?.length || 0) > 0 && (
            <Badge variant="outline" className="text-cyan-600">
              {careers.sub_careers?.length || 0} {t.novel.subCareer}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={saveCurrentLayout}
            title={t.novel.layoutSaved}
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            {t.common.save}
          </Button>
          {hasSavedLayout && (
            <Button size="sm" variant="ghost" onClick={resetLayout}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              {t.novel.reset}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={loadAll}>
            {t.novel.refresh}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filterType}
          onValueChange={(v) => setFilterType(v as typeof filterType)}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.novel.allLabel}</SelectItem>
            <SelectItem value="character">{t.novel.charactersOnly}</SelectItem>
            <SelectItem value="organization">
              {t.novel.organizationsOnly}
            </SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder={t.novel.searchName}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-[200px]"
        />

        {edgeCategories.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-xs">
              {t.novel.connections}
            </span>
            {edgeCategories.map(({ cat, visible, label, color }) => (
              <button
                key={cat}
                onClick={() => toggleEdgeCategory(cat)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                  visible
                    ? "border-current shadow-sm"
                    : "border-muted opacity-40",
                )}
                style={{
                  color,
                  backgroundColor: visible ? `${color}12` : "transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card
          className={cn(
            "min-h-[520px] lg:col-span-3",
            loading && "animate-pulse",
          )}
        >
          <CardContent
            className="relative h-full overflow-hidden p-0 pt-4"
            style={{ minHeight: 520 }}
          >
            {loading ? (
              <div className="text-muted-foreground flex h-[520px] items-center justify-center">
                {t.novel.loading}
              </div>
            ) : graphData && nodes.length > 0 ? (
              <ReactFlow
                nodes={nodes}
                edges={visibleEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                fitView
                fitViewOptions={{ padding: 0.15 }}
                attributionPosition="bottom-left"
                nodeTypes={{
                  characterNode: CharacterNode,
                  organizationNode: OrganizationNode,
                  careerGroupNode: CareerGroupNode,
                  careerNode: CareerNode,
                }}
                proOptions={{ hideAttribution: true }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={20}
                  size={1}
                />
                <Controls position="top-right" showInteractive={false} />
              </ReactFlow>
            ) : (
              <div className="text-muted-foreground flex h-[520px] items-center justify-center text-sm">
                {t.novel.noRelationshipData}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">{t.novel.nodeDetails}</CardTitle>
            {selectedNodeId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  setSelectedNodeId(null);
                  setSelectedDetail(null);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {selectedDetail ? (
              <ScrollArea className="max-h-[480px]">
                <DetailPanel
                  detail={selectedDetail}
                  connectedEdges={connectedEdges}
                  graphData={graphData}
                  careers={careers}
                  roleLabels={roleLabels}
                  edgeCategoryMeta={edgeCategoryMeta}
                  t={t}
                />
              </ScrollArea>
            ) : selectedNode ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {selectedNode.is_organization ? (
                    <Building2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <User className="text-primary h-5 w-5" />
                  )}
                  <span className="font-semibold">{selectedNode.name}</span>
                  <Badge
                    variant={
                      selectedNode.is_organization ? "default" : "secondary"
                    }
                  >
                    {selectedNode.is_organization
                      ? t.novel.organizations
                      : roleLabels[selectedNode.role_type || ""] ||
                        t.novel.characters}
                  </Badge>
                </div>
                <Separator />
                <p className="mb-2 text-sm font-medium">
                  {t.novel.relatedRelationships} ({connectedEdges.length})
                </p>
                <div className="space-y-2">
                  {connectedEdges.map((edge, i) => {
                    const otherId =
                      edge.source === selectedNodeId
                        ? edge.target
                        : edge.source;
                    const otherName =
                      graphData?.nodes.find((n) => n.id === otherId)?.name ||
                      otherId;
                    const cat = getEdgeCategory(edge.relationship);
                    const catMeta =
                      edgeCategoryMeta[cat] || edgeCategoryMeta.default;
                    return (
                      <div
                        key={i}
                        className="bg-muted/50 hover:bg-muted space-y-1 rounded p-2 text-xs transition-colors"
                      >
                        <p className="font-medium">
                          <User className="mr-1 inline h-3 w-3" />
                          {otherName}
                        </p>
                        <span
                          className="inline-block rounded px-1.5 py-0 text-[10px]"
                          style={{
                            color: catMeta.color,
                            backgroundColor: `${catMeta.color}14`,
                          }}
                        >
                          {catMeta.label}
                        </span>
                        <p className="text-muted-foreground mt-0.5">
                          {edge.relationship}
                        </p>
                        <div className="flex gap-2 pt-0.5">
                          <Badge variant="outline" className="text-[10px]">
                            {t.novel.intimacy} {edge.intimacy}%
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              edge.status === "active"
                                ? "text-green-600"
                                : "text-muted-foreground",
                            )}
                          >
                            {edge.status}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Network className="text-muted-foreground/40 mb-3 h-10 w-10" />
                <p className="text-muted-foreground text-sm">
                  {t.novel.clickNodeForDetails}
                </p>
                <p className="text-muted-foreground/60 mt-1 text-xs">
                  {t.novel.dragToAdjust}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailPanel({
  detail,
  connectedEdges,
  graphData,
  careers: _careers,
  roleLabels,
  edgeCategoryMeta,
  t,
}: {
  detail: CharacterDetail;
  connectedEdges: GraphEdge[];
  graphData: GraphData | null;
  careers: CareerListResponse;
  roleLabels: Record<string, string>;
  edgeCategoryMeta: Record<
    EdgeCategory,
    { label: string; color: string; order: number }
  >;
  t: any;
}) {
  const isOrg = detail.is_organization;
  return (
    <div className="space-y-3 pr-2">
      <div className="flex items-center gap-2">
        {isOrg ? (
          <Building2 className="h-6 w-6 text-green-600" />
        ) : (
          <User className="text-primary h-6 w-6" />
        )}
        <div>
          <p className="text-base leading-tight font-bold">{detail.name}</p>
          <p className="text-muted-foreground text-[11px]">
            {isOrg
              ? t.novel.organizations
              : roleLabels[detail.role_type || ""] || t.novel.characters}
          </p>
        </div>
      </div>

      {!isOrg && (
        <div className="flex flex-wrap gap-1.5">
          {detail.role_type && (
            <Badge
              variant={
                detail.role_type === "protagonist" ? "default" : "secondary"
              }
              className="text-[10px]"
            >
              {roleLabels[detail.role_type]}
            </Badge>
          )}
          {detail.gender && (
            <Badge variant="outline" className="text-[10px]">
              {detail.gender}
            </Badge>
          )}
          {detail.age && (
            <Badge variant="outline" className="text-[10px]">
              {detail.age}
              {t.novel.yearsOld}
            </Badge>
          )}
        </div>
      )}

      <Separator />

      {!isOrg && (
        <>
          {detail.personality && (
            <InfoField
              label={t.novel.personalityTraits}
              value={detail.personality}
              rows={2}
            />
          )}
          {detail.appearance && (
            <InfoField
              label={t.novel.appearanceTraits}
              value={detail.appearance}
              rows={2}
            />
          )}
          {detail.motivation && (
            <InfoField
              label={t.novel.actionMotivation}
              value={detail.motivation}
              rows={2}
            />
          )}
          {detail.backstory && (
            <InfoField
              label={t.novel.backgroundStory}
              value={detail.backstory}
              rows={3}
            />
          )}
        </>
      )}

      {isOrg && (
        <>
          {detail.motivation && (
            <InfoField
              label={t.novel.orgPurpose}
              value={detail.motivation}
              rows={2}
            />
          )}
          {detail.backstory && (
            <InfoField
              label={t.novel.orgBackground}
              value={detail.backstory}
              rows={3}
            />
          )}
        </>
      )}

      <Separator />

      <div>
        <p className="mb-2 text-sm font-medium">
          {t.novel.relatedRelationships} ({connectedEdges.length})
        </p>
        {connectedEdges.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t.novel.noRelatedRelationships}
          </p>
        ) : (
          <div className="space-y-1.5">
            {connectedEdges.map((edge, i) => {
              const otherId =
                edge.source === detail.id ? edge.target : edge.source;
              const otherName =
                graphData?.nodes.find((n) => n.id === otherId)?.name || otherId;
              const cat = getEdgeCategory(edge.relationship);
              const catMeta = edgeCategoryMeta[cat] || edgeCategoryMeta.default;
              return (
                <div
                  key={i}
                  className="bg-muted/50 hover:bg-muted space-y-0.5 rounded p-1.5 text-xs transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <User className="h-3 w-3 shrink-0" />
                    <span className="truncate font-medium">{otherName}</span>
                    <span
                      className="shrink-0 rounded px-1 py-0 text-[9px]"
                      style={{
                        color: catMeta.color,
                        backgroundColor: `${catMeta.color}14`,
                      }}
                    >
                      {catMeta.label}
                    </span>
                  </div>
                  <p className="text-muted-foreground pl-4">
                    {edge.relationship}
                  </p>
                  <div className="flex gap-1.5 pt-0.5 pl-4">
                    <Badge variant="outline" className="text-[10px]">
                      {edge.intimacy}%
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        edge.status === "active"
                          ? "text-green-600"
                          : "text-muted-foreground",
                      )}
                    >
                      {edge.status}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoField({
  label,
  value,
  rows = 2,
}: {
  label: string;
  value?: string | null;
  rows?: number;
}) {
  if (!value) return null;
  return (
    <div className="bg-muted/50 space-y-0.5 rounded-md p-2">
      <p className="text-muted-foreground text-[11px] font-medium">{label}</p>
      <p
        className="text-xs leading-relaxed"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: rows,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function CharacterNode({
  data,
}: {
  data: { label: string; roleType: string; isOrganization: boolean };
}) {
  const colorMap: Record<string, string> = {
    protagonist: "#ef4444",
    antagonist: "#8b5cf6",
    supporting: "#3b82f6",
  };
  const baseColor = colorMap[data.roleType] || "#3b82f6";
  return (
    <div
      className="cursor-pointer rounded-xl border px-3 py-2 shadow-sm transition-all hover:shadow-md"
      style={{
        background: `linear-gradient(135deg, white, ${baseColor}08)`,
        borderColor: baseColor,
        minWidth: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      <User className="h-5 w-5" style={{ color: baseColor }} />
      <span className="max-w-full truncate text-center text-sm leading-tight font-semibold">
        {data.label}
      </span>
    </div>
  );
}

function OrganizationNode(_data: {
  data: { label: string; roleType: string; isOrganization: boolean };
}) {
  return (
    <div
      className="cursor-pointer rounded-lg border px-3 py-2 shadow-sm transition-all hover:shadow-md"
      style={{
        background: "linear-gradient(135deg, #f0fdf4, #dcfce7)",
        borderColor: "#22c55e",
        minWidth: ORG_WIDTH,
        minHeight: ORG_HEIGHT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      <Building2 className="h-4 w-4 text-green-600" />
      <span className="max-w-full truncate text-center text-sm leading-tight font-semibold">
        {_data.data.label}
      </span>
    </div>
  );
}

function CareerGroupNode({
  data,
}: {
  data: { label: string; careerType: "main" | "sub" };
}) {
  const color = data.careerType === "main" ? "#f59e0b" : "#06b6d4";
  return (
    <div
      className="rounded-full border-2 border-dashed px-2 py-1 shadow-sm"
      style={{
        borderColor: color,
        backgroundColor: `${color}08`,
        minWidth: CAREER_GROUP_WIDTH,
        minHeight: CAREER_GROUP_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Trophy className="mr-1 h-3 w-3" style={{ color }} />
      <span className="text-[11px] font-semibold" style={{ color }}>
        {data.label}
      </span>
    </div>
  );
}

function CareerNode({
  data,
}: {
  data: { label: string; careerType: "main" | "sub" };
}) {
  const color = data.careerType === "main" ? "#f59e0b" : "#06b6d4";
  return (
    <div
      className="rounded-md border px-2 py-1 shadow-sm"
      style={{
        borderColor: color,
        backgroundColor: `${color}06`,
        minWidth: CAREER_NODE_WIDTH,
        minHeight: CAREER_NODE_HEIGHT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
      }}
    >
      <span className="text-[9px]" style={{ color, opacity: 0.7 }}>
        {data.label}
      </span>
      <span
        className="text-center text-[11px] leading-tight font-semibold"
        style={{ color }}
      >
        {data.label}
      </span>
    </div>
  );
}
