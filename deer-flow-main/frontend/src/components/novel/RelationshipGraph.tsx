'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Network, User, Building2, X, Trophy, Save, RotateCcw,
} from 'lucide-react';
import dagre from 'dagre';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { getBackendBaseURL } from '@/core/config';

interface GraphNode {
  id: string; name: string; type: string; role_type?: string; is_organization?: boolean;
}

interface GraphEdge {
  source: string; target: string; relationship: string; intimacy: number; status: string;
}

interface GraphData {
  nodes: GraphNode[]; links: GraphEdge[];
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
  id: string; name: string; type: 'main' | 'sub'; maxStage: number;
}

interface CareerListResponse {
  main_careers?: CareerItem[];
  sub_careers?: CareerItem[];
}

interface RelationshipGraphProps {
  projectId: string;
}

const roleLabels: Record<string, string> = { protagonist: '主角', supporting: '配角', antagonist: '反派' };

const NODE_WIDTH = 140;
const NODE_HEIGHT = 70;
const ORG_WIDTH = 160;
const ORG_HEIGHT = 60;
const CAREER_NODE_WIDTH = 130;
const CAREER_NODE_HEIGHT = 52;
const CAREER_GROUP_WIDTH = 120;
const CAREER_GROUP_HEIGHT = 40;

type EdgeCategory =
  | 'organization'
  | 'career_main'
  | 'career_sub'
  | 'career_group'
  | 'family'
  | 'hostile'
  | 'professional'
  | 'social'
  | 'default';

const EDGE_CATEGORY_META: Record<EdgeCategory, { label: string; color: string; order: number }> = {
  organization: { label: '组织成员', color: '#3b82f6', order: 1 },
  career_main: { label: '主职业关联', color: '#f59e0b', order: 2 },
  career_sub: { label: '副职业关联', color: '#06b6d4', order: 3 },
  career_group: { label: '职业分类', color: '#9ca3af', order: 4 },
  family: { label: '亲属关系', color: '#f59e0b', order: 5 },
  hostile: { label: '敌对关系', color: '#ef4444', order: 6 },
  professional: { label: '职业关系', color: '#06b6d4', order: 7 },
  social: { label: '社交关系', color: '#22c55e', order: 8 },
  default: { label: '其他关系', color: '#9ca3af', order: 99 },
};

const RELATIONSHIP_KEYWORDS: Record<EdgeCategory, string[]> = {
  organization: ['组织成员·'],
  career_main: ['主职业·'],
  career_sub: ['副职业·'],
  career_group: ['职业分类·'],
  family: ['父', '母', '子', '兄', '姐', '弟', '妹', '配偶', '亲属'],
  hostile: ['敌', '仇', '对立'],
  professional: ['同事', '上级', '下属', '师', '徒'],
  social: ['友', '朋', '邻居', '熟人'],
  default: [],
};

function getEdgeCategory(relationship: string): EdgeCategory {
  for (const [category, keywords] of Object.entries(RELATIONSHIP_KEYWORDS)) {
    if (keywords.length === 0) continue;
    const isPrefixMatch = keywords.some((kw) => relationship.startsWith(kw));
    const isIncludeMatch = keywords.some((kw) => relationship.toLowerCase().includes(kw.toLowerCase()));
    if (isPrefixMatch || isIncludeMatch) return category as EdgeCategory;
  }
  return 'default';
}

const LAYOUT_STORAGE_KEY = (projectId: string) => `relgraph-layout-${projectId}`;

function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 120, marginx: 50, marginy: 50 });

  nodes.forEach((node) => {
    let w = NODE_WIDTH;
    let h = NODE_HEIGHT;
    if (node.data?.isOrganization) { w = ORG_WIDTH; h = ORG_HEIGHT; }
    else if (node.data?.isCareerGroup) { w = CAREER_GROUP_WIDTH; h = CAREER_GROUP_HEIGHT; }
    else if (node.data?.isCareerNode) { w = CAREER_NODE_WIDTH; h = CAREER_NODE_HEIGHT; }
    dagreGraph.setNode(node.id, { width: w, height: h });
  });

  edges.forEach((edge) => { dagreGraph.setEdge(edge.source, edge.target); });
  dagre.layout(dagreGraph);

  return nodes.map((node) => {
    const n = dagreGraph.node(node.id);
    let hw = NODE_WIDTH / 2;
    let hh = NODE_HEIGHT / 2;
    if (node.data?.isOrganization) { hw = ORG_WIDTH / 2; hh = ORG_HEIGHT / 2; }
    else if (node.data?.isCareerGroup) { hw = CAREER_GROUP_WIDTH / 2; hh = CAREER_GROUP_HEIGHT / 2; }
    else if (node.data?.isCareerNode) { hw = CAREER_NODE_WIDTH / 2; hh = CAREER_NODE_HEIGHT / 2; }
    return { ...node, position: { x: n.x - hw, y: n.y - hh } };
  });
}

export function RelationshipGraph({ projectId }: RelationshipGraphProps) {
  const backendBase = getBackendBaseURL();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'character' | 'organization'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [edgeVisibilityMap, setEdgeVisibilityMap] = useState<Record<string, boolean>>({});
  const [characterDetailMap, setCharacterDetailMap] = useState<Record<string, CharacterDetail>>({});
  const [selectedDetail, setSelectedDetail] = useState<CharacterDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [careers, setCareers] = useState<CareerListResponse>({ main_careers: [], sub_careers: [] });
  const [hasSavedLayout, setHasSavedLayout] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      const savedLayout = loadSavedLayout();
      setHasSavedLayout(!!savedLayout);

      const [graphRes, careerRes] = await Promise.all([
        fetch(`${backendBase}/api/relationships/graph?project_id=${projectId}`, { credentials: 'include' }),
        fetch(`${backendBase}/api/careers?project_id=${projectId}`, { ...getAuthHeaders() }).catch(() => null),
      ]);

      if (!graphRes.ok) return;

      const data: GraphData = await graphRes.json();
      setGraphData(data);

      let careerData: CareerListResponse = { main_careers: [], sub_careers: [] };
      if (careerRes?.ok) careerData = await careerRes.json();
      setCareers(careerData);

      buildFlowElements(data, careerData, savedLayout);
    } catch (err) {
      console.error('加载关系图谱失败:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, backendBase]);

  function getAuthHeaders(): Record<string, string> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function loadSavedLayout(): Record<string, { x: number; y: number }> | null {
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY(projectId));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  const saveCurrentLayout = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n) => { positions[n.id] = n.position; });
    localStorage.setItem(LAYOUT_STORAGE_KEY(projectId), JSON.stringify(positions));
    setHasSavedLayout(true);
    toast.success('布局已保存');
  }, [nodes, projectId]);

  const resetLayout = useCallback(() => {
    localStorage.removeItem(LAYOUT_STORAGE_KEY(projectId));
    setHasSavedLayout(false);
    if (graphData) buildFlowElements(graphData, careers, null);
    toast.info('布局已重置');
  }, [projectId, graphData, careers]);

  const buildFlowElements = useCallback((
    data: GraphData,
    careerData: CareerListResponse,
    savedPositions: Record<string, { x: number; y: number }> | null,
  ) => {
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];

    data.nodes.forEach((n) => {
      flowNodes.push({
        id: n.id,
        type: n.is_organization ? 'organizationNode' : 'characterNode',
        position: savedPositions?.[n.id] || { x: 0, y: 0 },
        data: { label: n.name, roleType: n.role_type || '', isOrganization: n.is_organization ?? false },
      });
    });

    const allCareers = [...(careerData.main_careers || []), ...(careerData.sub_careers || [])];
    const careerNameMap: Record<string, CareerItem> = {};
    allCareers.forEach((c) => { careerNameMap[c.id] = c; });

    const hasMainCareers = (careerData.main_careers?.length || 0) > 0;
    const hasSubCareers = (careerData.sub_careers?.length || 0) > 0;

    if (hasMainCareers) {
      flowNodes.push({ id: '__cg_main__', type: 'careerGroupNode', position: { x: 0, y: 0 }, data: { label: '主职业分组', careerType: 'main' as const } });
    }
    if (hasSubCareers) {
      flowNodes.push({ id: '__cg_sub__', type: 'careerGroupNode', position: { x: 0, y: 0 }, data: { label: '副职业分组', careerType: 'sub' as const } });
    }

    (careerData.main_careers || []).forEach((c) => {
      flowNodes.push({ id: `career-main-${c.id}`, type: 'careerNode', position: savedPositions?.[`career-main-${c.id}`] || { x: 0, y: 0 }, data: { label: c.name, careerType: 'main' as const } });
      if (hasMainCareers) {
        flowEdges.push(buildCategoryEdge(`__cg_main__-career-main-${c.id}`, '__cg_main__', `career-main-${c.id}`, `职业分类·${c.name}`));
      }
    });

    (careerData.sub_careers || []).forEach((c) => {
      flowNodes.push({ id: `career-sub-${c.id}`, type: 'careerNode', position: savedPositions?.[`career-sub-${c.id}`] || { x: 0, y: 0 }, data: { label: c.name, careerType: 'sub' as const } });
      if (hasSubCareers) {
        flowEdges.push(buildCategoryEdge(`__cg_sub__-career-sub-${c.id}`, '__cg_sub__', `career-sub-${c.id}`, `职业分类·${c.name}`));
      }
    });

    data.links.forEach((link, i) => {
      flowEdges.push(buildRelationEdge(`edge-${i}`, link.source, link.target, link.relationship, link.status, link.intimacy));
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
      const cat = String(e.data?.category || 'default');
      categoryCounter[cat] = (categoryCounter[cat] || 0) + 1;
    });
    setEdgeVisibilityMap((prev) => {
      const next: Record<string, boolean> = {};
      Object.keys(categoryCounter).forEach((cat) => { next[cat] = prev[cat] !== false; });
      return next;
    });
  }, [setNodes, setEdges]);

  function buildRelationEdge(id: string, source: string, target: string, relationship: string, status: string, intimacy: number): Edge {
    const category = getEdgeCategory(relationship);
    const meta = EDGE_CATEGORY_META[category] || EDGE_CATEGORY_META.default;
    const isActive = status === 'active';
    return {
      id, source, target, label: relationship, type: 'smoothstep',
      animated: isActive && !relationship.startsWith('职业'),
      style: { stroke: meta.color, strokeWidth: relationship.startsWith('职业分类') ? 1.5 : 2, strokeOpacity: isActive ? 1 : 0.5, strokeDasharray: relationship.startsWith('组织成员') || relationship.startsWith('副职业') ? '6 3' : undefined },
      labelStyle: { fontSize: 10, fill: '#6b7280', fontWeight: relationship.startsWith('主职业') ? 600 : 500 },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
      markerEnd: { type: MarkerType.ArrowClosed, color: meta.color },
      data: { intimacy, status, category },
    };
  }

  function buildCategoryEdge(id: string, source: string, target: string, label: string): Edge {
    const category = getEdgeCategory(label);
    const meta = EDGE_CATEGORY_META[category] || EDGE_CATEGORY_META.default;
    return {
      id, source, target, label, type: 'smoothstep',
      style: { stroke: meta.color, strokeWidth: 1.5, strokeOpacity: 0.5, strokeDasharray: '6 3' },
      labelStyle: { fontSize: 9, fill: '#9ca3af' },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.8 },
      markerEnd: { type: MarkerType.ArrowClosed, color: meta.color },
      data: { intimacy: 0, status: 'active', category },
    };
  }

  const edgeCategories = useMemo(() =>
    Object.entries(edgeVisibilityMap)
      .map(([cat, visible]) => ({ cat, visible, ...(EDGE_CATEGORY_META[cat as EdgeCategory] || EDGE_CATEGORY_META.default) }))
      .sort((a, b) => a.order - b.order),
    [edgeVisibilityMap]
  );

  const toggleEdgeCategory = useCallback((category: string) => {
    setEdgeVisibilityMap((prev) => ({ ...prev, [category]: !(prev[category] !== false) }));
  }, []);

  const filteredNodes = useMemo(() =>
    graphData?.nodes.filter((n) => {
      if (filterType === 'character' && n.is_organization) return false;
      if (filterType === 'organization' && !n.is_organization) return false;
      if (searchTerm && !n.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    }) || [], [graphData, filterType, searchTerm]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const visibleEdges = useMemo(() =>
    edges.filter((e) => {
      const cat = String(e.data?.category || 'default');
      if (edgeVisibilityMap[cat] === false) return false;
      if (filteredNodeIds.size === 0) return true;
      const isCareerEdge = e.source.startsWith('__cg_') || e.source.startsWith('career-') || e.target.startsWith('__cg_') || e.target.startsWith('career-');
      if (isCareerEdge) return true;
      return filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target);
    }),
    [edges, edgeVisibilityMap, filteredNodeIds]
  );

  const selectedNode = selectedNodeId ? graphData?.nodes.find((n) => n.id === selectedNodeId) : null;
  const connectedEdges = selectedNodeId ? (graphData?.links || []).filter((l) => l.source === selectedNodeId || l.target === selectedNodeId) : [];

  const loadCharacterDetail = useCallback(async (nodeId: string) => {
    if (nodeId.startsWith('__cg_') || nodeId.startsWith('career-')) return;
    const cached = characterDetailMap[nodeId];
    if (cached) { setSelectedDetail(cached); return; }
    setDetailLoading(true);
    try {
      const res = await fetch(`${backendBase}/api/characters/${nodeId}`, { ...getAuthHeaders() });
      if (res.ok) {
        const detail: CharacterDetail = await res.json();
        setCharacterDetailMap((prev) => ({ ...prev, [nodeId]: detail }));
        setSelectedDetail(detail);
      }
    } catch { console.error('加载角色详情失败'); }
    finally { setDetailLoading(false); }
  }, [backendBase, characterDetailMap]);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setSelectedDetail(null);
    if (!node.id.startsWith('__cg_') && !node.id.startsWith('career-')) void loadCharacterDetail(node.id);
  }, [loadCharacterDetail]);

  const handlePaneClick = useCallback(() => { setSelectedNodeId(null); setSelectedDetail(null); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Network className="w-5 h-5" /> 角色关系图谱</h2>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{graphData?.nodes.length || 0} 节点</Badge>
          <Badge variant="outline">{graphData?.links.length || 0} 关系</Badge>
          {(careers.main_careers?.length || 0) > 0 && <Badge variant="outline" className="text-yellow-600">{careers.main_careers?.length || 0} 主职业</Badge>}
          {(careers.sub_careers?.length || 0) > 0 && <Badge variant="outline" className="text-cyan-600">{careers.sub_careers?.length || 0} 副职业</Badge>}
          <Button size="sm" variant="outline" onClick={saveCurrentLayout} title="保存当前节点位置"><Save className="w-3.5 h-3.5 mr-1" />保存</Button>
          {hasSavedLayout && <Button size="sm" variant="ghost" onClick={resetLayout}><RotateCcw className="w-3.5 h-3.5 mr-1" />重置</Button>}
          <Button size="sm" variant="outline" onClick={loadAll}>刷新</Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="character">仅角色</SelectItem>
            <SelectItem value="organization">仅组织</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="搜索名称..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="max-w-[200px]" />

        {edgeCategories.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">连线:</span>
            {edgeCategories.map(({ cat, visible, label, color }) => (
              <button key={cat} onClick={() => toggleEdgeCategory(cat)}
                className={cn("text-[11px] px-2 py-0.5 rounded-full border transition-colors", visible ? "border-current shadow-sm" : "border-muted opacity-40")}
                style={{ color, backgroundColor: visible ? `${color}12` : 'transparent' }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className={cn("lg:col-span-3 min-h-[520px]", loading && "animate-pulse")}>
          <CardContent className="pt-4 p-0 h-full relative overflow-hidden" style={{ minHeight: 520 }}>
            {loading ? (
              <div className="flex items-center justify-center h-[520px] text-muted-foreground">加载中...</div>
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
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
                <Controls position="top-right" showInteractive={false} />
              </ReactFlow>
            ) : (
              <div className="flex items-center justify-center h-[520px] text-muted-foreground text-sm">暂无关系数据</div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">节点详情</CardTitle>
            {selectedNodeId && <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setSelectedNodeId(null); setSelectedDetail(null); }}><X className="h-3.5 w-3.5" /></Button>}
          </CardHeader>
          <CardContent>
            {selectedDetail ? (
              <ScrollArea className="max-h-[480px]">
                <DetailPanel detail={selectedDetail} connectedEdges={connectedEdges} graphData={graphData} careers={careers} />
              </ScrollArea>
            ) : selectedNode ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {selectedNode.is_organization ? <Building2 className="w-5 h-5 text-green-600" /> : <User className="w-5 h-5 text-primary" />}
                  <span className="font-semibold">{selectedNode.name}</span>
                  <Badge variant={selectedNode.is_organization ? 'default' : 'secondary'}>{selectedNode.is_organization ? '组织' : roleLabels[selectedNode.role_type || ''] || '角色'}</Badge>
                </div>
                <Separator />
                <p className="text-sm font-medium mb-2">关联关系 ({connectedEdges.length})</p>
                <div className="space-y-2">
                  {connectedEdges.map((edge, i) => {
                    const otherId = edge.source === selectedNodeId ? edge.target : edge.source;
                    const otherName = graphData?.nodes.find((n) => n.id === otherId)?.name || otherId;
                    const cat = getEdgeCategory(edge.relationship);
                    const catMeta = EDGE_CATEGORY_META[cat] || EDGE_CATEGORY_META.default;
                    return (
                      <div key={i} className="text-xs p-2 rounded bg-muted/50 space-y-1 hover:bg-muted transition-colors">
                        <p className="font-medium"><User className="w-3 h-3 inline mr-1" />{otherName}</p>
                        <span className="inline-block text-[10px] px-1.5 py-0 rounded" style={{ color: catMeta.color, backgroundColor: `${catMeta.color}14` }}>{catMeta.label}</span>
                        <p className="text-muted-foreground mt-0.5">{edge.relationship}</p>
                        <div className="flex gap-2 pt-0.5">
                          <Badge variant="outline" className="text-[10px]">亲密度: {edge.intimacy}%</Badge>
                          <Badge variant="outline" className={cn("text-[10px]", edge.status === 'active' ? "text-green-600" : "text-muted-foreground")}>{edge.status}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Network className="w-10 h-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">点击节点查看详情</p>
                <p className="text-xs text-muted-foreground/60 mt-1">拖拽可调整位置 · 支持保存布局</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailPanel({ detail, connectedEdges, graphData, careers }: {
  detail: CharacterDetail; connectedEdges: GraphEdge[]; graphData: GraphData | null; careers: CareerListResponse;
}) {
  const isOrg = detail.is_organization;
  return (
    <div className="space-y-3 pr-2">
      <div className="flex items-center gap-2">
        {isOrg ? <Building2 className="w-6 h-6 text-green-600" /> : <User className="w-6 h-6 text-primary" />}
        <div>
          <p className="font-bold text-base leading-tight">{detail.name}</p>
          <p className="text-[11px] text-muted-foreground">{isOrg ? '组织' : roleLabels[detail.role_type || ''] || '角色'}</p>
        </div>
      </div>

      {!isOrg && (
        <div className="flex flex-wrap gap-1.5">
          {detail.role_type && <Badge variant={detail.role_type === 'protagonist' ? 'default' : 'secondary'} className="text-[10px]">{roleLabels[detail.role_type]}</Badge>}
          {detail.gender && <Badge variant="outline" className="text-[10px]">{detail.gender}</Badge>}
          {detail.age && <Badge variant="outline" className="text-[10px]">{detail.age}岁</Badge>}
        </div>
      )}

      <Separator />

      {!isOrg && (
        <>
          {detail.personality && <InfoField label="性格特点" value={detail.personality} rows={2} />}
          {detail.appearance && <InfoField label="外貌特征" value={detail.appearance} rows={2} />}
          {detail.motivation && <InfoField label="行动动机" value={detail.motivation} rows={2} />}
          {detail.backstory && <InfoField label="背景故事" value={detail.backstory} rows={3} />}
        </>
      )}

      {isOrg && (
        <>
          {detail.motivation && <InfoField label="组织目的" value={detail.motivation} rows={2} />}
          {detail.backstory && <InfoField label="组织背景" value={detail.backstory} rows={3} />}
        </>
      )}

      <Separator />

      <div>
        <p className="text-sm font-medium mb-2">关联关系 ({connectedEdges.length})</p>
        {connectedEdges.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无关联关系</p>
        ) : (
          <div className="space-y-1.5">
            {connectedEdges.map((edge, i) => {
              const otherId = edge.source === detail.id ? edge.target : edge.source;
              const otherName = graphData?.nodes.find((n) => n.id === otherId)?.name || otherId;
              const cat = getEdgeCategory(edge.relationship);
              const catMeta = EDGE_CATEGORY_META[cat] || EDGE_CATEGORY_META.default;
              return (
                <div key={i} className="text-xs p-1.5 rounded bg-muted/50 space-y-0.5 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-1">
                    <User className="w-3 h-3 shrink-0" /><span className="font-medium truncate">{otherName}</span>
                    <span className="shrink-0 text-[9px] px-1 py-0 rounded" style={{ color: catMeta.color, backgroundColor: `${catMeta.color}14` }}>{catMeta.label}</span>
                  </div>
                  <p className="text-muted-foreground pl-4">{edge.relationship}</p>
                  <div className="flex gap-1.5 pl-4 pt-0.5">
                    <Badge variant="outline" className="text-[10px]">{edge.intimacy}%</Badge>
                    <Badge variant="outline" className={cn("text-[10px]", edge.status === 'active' ? "text-green-600" : "text-muted-foreground")}>{edge.status}</Badge>
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

function InfoField({ label, value, rows = 2 }: { label: string; value?: string | null; rows?: number }) {
  if (!value) return null;
  return (
    <div className="rounded-md bg-muted/50 p-2 space-y-0.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="text-xs leading-relaxed" style={{ display: '-webkit-box', WebkitLineClamp: rows, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{value}</p>
    </div>
  );
}

function CharacterNode({ data }: { data: { label: string; roleType: string; isOrganization: boolean } }) {
  const colorMap: Record<string, string> = { protagonist: '#ef4444', antagonist: '#8b5cf6', supporting: '#3b82f6' };
  const baseColor = colorMap[data.roleType] || '#3b82f6';
  return (
    <div className="px-3 py-2 rounded-xl border shadow-sm cursor-pointer transition-all hover:shadow-md"
      style={{ background: `linear-gradient(135deg, white, ${baseColor}08)`, borderColor: baseColor, minWidth: NODE_WIDTH, minHeight: NODE_HEIGHT, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <User className="w-5 h-5" style={{ color: baseColor }} />
      <span className="font-semibold text-sm leading-tight text-center max-w-full truncate">{data.label}</span>
      <span className="text-[10px] opacity-70">{roleLabels[data.roleType] || ''}</span>
    </div>
  );
}

function OrganizationNode(_data: { data: { label: string; roleType: string; isOrganization: boolean } }) {
  return (
    <div className="px-3 py-2 rounded-lg border shadow-sm cursor-pointer transition-all hover:shadow-md"
      style={{ background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', borderColor: '#22c55e', minWidth: ORG_WIDTH, minHeight: ORG_HEIGHT, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <Building2 className="w-4 h-4 text-green-600" />
      <span className="font-semibold text-sm leading-tight text-center max-w-full truncate">Organization</span>
      <span className="text-[10px] opacity-70">组织</span>
    </div>
  );
}

function CareerGroupNode({ data }: { data: { label: string; careerType: 'main' | 'sub' } }) {
  const color = data.careerType === 'main' ? '#f59e0b' : '#06b6d4';
  return (
    <div className="px-2 py-1 rounded-full border-2 border-dashed shadow-sm"
      style={{ borderColor: color, backgroundColor: `${color}08`, minWidth: CAREER_GROUP_WIDTH, minHeight: CAREER_GROUP_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Trophy className="w-3 h-3 mr-1" style={{ color }} />
      <span className="font-semibold text-[11px]" style={{ color }}>{data.label}</span>
    </div>
  );
}

function CareerNode({ data }: { data: { label: string; careerType: 'main' | 'sub' } }) {
  const color = data.careerType === 'main' ? '#f59e0b' : '#06b6d4';
  return (
    <div className="px-2 py-1 rounded-md border shadow-sm"
      style={{ borderColor: color, backgroundColor: `${color}06`, minWidth: CAREER_NODE_WIDTH, minHeight: CAREER_NODE_HEIGHT, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
      <span className="text-[9px]" style={{ color, opacity: 0.7 }}>{data.careerType === 'main' ? '主职业' : '副职业'}</span>
      <span className="font-semibold text-[11px] text-center leading-tight" style={{ color }}>{data.label}</span>
    </div>
  );
}
