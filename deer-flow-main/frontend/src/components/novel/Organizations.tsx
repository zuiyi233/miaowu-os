'use client';

import { Plus, Building2, Users, Edit, Trash2, ChevronRight } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { getBackendBaseURL } from '@/core/config';
import { cn } from '@/lib/utils';

interface Organization {
  id: string; name: string; type: string; purpose: string;
  member_count: number; power_level: number; location?: string; motto?: string;
}

interface OrgMember {
  id: string; character_name: string; position: string; rank: number; loyalty: number; status: string;
}

interface OrganizationsProps {
  projectId: string;
}

export function Organizations({ projectId }: OrganizationsProps) {
  const backendBase = getBackendBaseURL();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [form, setForm] = useState({ name: '', type: '', purpose: '', power_level: 50, location: '', motto: '', color: '' });

  const selectedOrg = orgs.find((o) => o.id === selectedOrgId) || null;

  const loadOrgs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${backendBase}/api/organizations/project/${projectId}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setOrgs(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length > 0 && !selectedOrgId) { setSelectedOrgId(data[0].id); loadMembers(data[0].id); }
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [projectId, backendBase]);

  const loadMembers = async (orgId: string) => {
    try {
      const res = await fetch(`${backendBase}/api/organizations/${orgId}/members`, { credentials: 'include' });
      if (res.ok) setMembers(await res.json());
    } catch {}
  };

  useEffect(() => { loadOrgs(); }, [loadOrgs]);
  useEffect(() => { if (selectedOrgId) loadMembers(selectedOrgId); }, [selectedOrgId]);

  const handleSelect = (orgId: string) => { setSelectedOrgId(orgId); loadMembers(orgId); };

  const handleCreate = async () => {
    try {
      const res = await fetch(`${backendBase}/api/organizations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ...form, project_id: projectId }),
      });
      if (!res.ok) throw new Error('创建失败');
      toast.success('组织已创建'); setIsCreateOpen(false); setForm({ name: '', type: '', purpose: '', power_level: 50, location: '', motto: '', color: '' }); loadOrgs();
    } catch (err) { toast.error(err instanceof Error ? err.message : '创建失败'); }
  };

  const handleDelete = async () => {
    if (!selectedOrgId || !window.confirm('确定删除该组织吗？')) return;
    try {
      const res = await fetch(`${backendBase}/api/organizations/${selectedOrgId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('删除失败');
      toast.success('已删除'); setSelectedOrgId(null); loadOrgs();
    } catch (err) { toast.error(err instanceof Error ? err.message : '删除失败'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Building2 className="w-5 h-5" /> 势力/组织管理</h2>
        <Button size="sm" onClick={() => setIsCreateOpen(true)}><Plus className="w-4 h-4 mr-1" />新建组织</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: List */}
        <div className="lg:col-span-2 space-y-1.5">
          {loading && <p className="text-sm text-muted-foreground py-4">加载中...</p>}
          {orgs.map((org) => (
            <button key={org.id} onClick={() => handleSelect(org.id)}
              className={cn("w-full text-left p-3 rounded-lg border transition-colors flex items-center justify-between",
                selectedOrgId === org.id ? "border-primary bg-primary/5" : "hover:bg-accent")}>
              <div className="min-w-0">
                <p className="font-medium truncate text-sm">{org.name}</p>
                <p className="text-xs text-muted-foreground">{org.type} · {org.member_count}人</p>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {!loading && orgs.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">暂无组织，点击上方按钮创建</p>}
        </div>

        {/* Right: Detail */}
        <Card className="lg:col-span-3">
          {selectedOrg ? (
            <>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{selectedOrg.name}</CardTitle>
                  <Badge>{selectedOrg.type}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Info label="目的" value={selectedOrg.purpose} />
                <Info label="势力等级" value={`${selectedOrg.power_level}`} />
                {selectedOrg.location && <Info label="所在地" value={selectedOrg.location} />}
                {selectedOrg.motto && <Info label="格言" value={selectedOrg.motto} />}
                <Separator />
                <div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4" /><span className="font-medium text-sm">成员列表 ({members.length})</span></div>
                {members.length > 0 ? (
                  <Table>
                    <TableHeader><TableRow><TableHead className="text-xs">姓名</TableHead><TableHead className="text-xs">职位</TableHead><TableHead className="text-xs">等级</TableHead><TableHead className="text-xs">忠诚度</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {members.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="text-sm">{m.character_name}</TableCell>
                          <TableCell className="text-sm">{m.position}</TableCell>
                          <TableCell className="text-sm">{m.rank}</TableCell>
                          <TableCell className="text-sm">{m.loyalty}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-xs text-muted-foreground">暂无成员</p>}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => { setForm({ name: selectedOrg.name, type: selectedOrg.type, purpose: selectedOrg.purpose, power_level: selectedOrg.power_level, location: selectedOrg.location || '', motto: selectedOrg.motto || '', color: '' }); setIsEditOpen(true); }}><Edit className="w-3.5 h-3.5 mr-1" />编辑</Button>
                  <Button size="sm" variant="destructive" onClick={handleDelete}><Trash2 className="w-3.5 h-3.5 mr-1" />删除</Button>
                </div>
              </CardContent>
            </>
          ) : (
            <CardContent className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              选择一个组织查看详情
            </CardContent>
          )}
        </Card>
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>新建组织</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>名称</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>类型</Label><Input value={form.type} placeholder="如：宗门、商会、朝廷..." onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} /></div>
            <div><Label>目的</Label><Textarea rows={2} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>势力等级</Label><Input type="number" min={0} max={100} value={form.power_level} onChange={(e) => setForm((f) => ({ ...f, power_level: Number(e.target.value) }))} /></div>
              <div><Label>所在地</Label><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></div>
            </div>
            <div><Label>格言</Label><Input value={form.motto} onChange={(e) => setForm((f) => ({ ...f, motto: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>编辑组织</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>名称</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>类型</Label><Input value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} /></div>
            <div><Label>目的</Label><Textarea rows={2} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>势力等级</Label><Input type="number" min={0} max={100} value={form.power_level} onChange={(e) => setForm((f) => ({ ...f, power_level: Number(e.target.value) }))} /></div>
              <div><Label>所在地</Label><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></div>
            </div>
            <div><Label>格言</Label><Input value={form.motto} onChange={(e) => setForm((f) => ({ ...f, motto: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>取消</Button>
            <Button onClick={async () => {
              if (!selectedOrgId) return;
              try {
                const res = await fetch(`${backendBase}/api/organizations/${selectedOrgId}`, {
                  method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                  body: JSON.stringify(form),
                });
                if (!res.ok) throw new Error('更新失败');
                toast.success('已更新'); setIsEditOpen(false); loadOrgs();
              } catch (err) { toast.error(err instanceof Error ? err.message : '更新失败'); }
            }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="flex gap-2 text-sm"><span className="shrink-0 text-muted-foreground">{label}：</span><span>{value}</span></div>);
}
