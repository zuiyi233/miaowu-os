'use client';

import { useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Download,
  Upload,
  Database,
  FileJson,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { useExportDataMutation, useImportDataMutation } from '@/core/novel/queries';
import { databaseService } from '@/core/novel/database';
import { toast } from 'sonner';

export function DataManagement() {
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [importMessage, setImportMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportMutation = useExportDataMutation();
  const importMutation = useImportDataMutation();

  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const data = await exportMutation.mutateAsync();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `novel-export-${timestamp}.${format}`;

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        downloadBlob(blob, filename);
        toast.success('Data exported successfully');
      } else {
        exportAsCsv(data, filename);
        toast.success('Data exported as CSV');
      }
    } catch (error) {
      toast.error('Failed to export data');
      console.error('Export error:', error);
    }
  };

  const handleImport = async (file: File) => {
    setImportStatus('loading');
    setImportMessage('');

    try {
      const content = await file.text();
      const data = JSON.parse(content);

      if (!data.version || !data.novels) {
        throw new Error('Invalid export file format');
      }

      if (!confirm(`This will import ${data.novels.length} novels and associated data. Continue?`)) {
        setImportStatus('idle');
        return;
      }

      await importMutation.mutateAsync(data);
      setImportStatus('success');
      setImportMessage(`Successfully imported ${data.novels.length} novels`);
      toast.success('Data imported successfully');
      setTimeout(() => setShowImportDialog(false), 2000);
    } catch (error) {
      setImportStatus('error');
      setImportMessage(error instanceof Error ? error.message : 'Import failed');
      toast.error('Failed to import data');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImport(file);
    }
  };

  const handleExportAll = async () => {
    try {
      const data = await exportMutation.mutateAsync();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `novel-full-backup-${timestamp}.json`);
      toast.success('Full backup exported');
    } catch {
      toast.error('Failed to create backup');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Data Management</h2>
        <p className="text-muted-foreground mt-1">Export and import your novel data</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Data
            </CardTitle>
            <CardDescription>Export your novels, characters, and settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full gap-2" onClick={() => handleExport('json')}>
              <FileJson className="h-4 w-4" />
              Export as JSON
            </Button>
            <Button variant="outline" className="w-full gap-2" onClick={() => handleExport('csv')}>
              <FileSpreadsheet className="h-4 w-4" />
              Export as CSV
            </Button>
            <Button variant="secondary" className="w-full gap-2" onClick={handleExportAll}>
              <Database className="h-4 w-4" />
              Full Backup
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Data
            </CardTitle>
            <CardDescription>Import previously exported data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".json"
              onChange={handleFileSelect}
            />
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Import JSON File
            </Button>
            <Button
              variant="destructive"
              className="w-full gap-2"
              onClick={async () => {
                if (confirm('Are you sure? This will delete ALL data.')) {
                  await databaseService.clearAllData();
                  toast.success('All data cleared');
                  window.location.reload();
                }
              }}
            >
              <AlertCircle className="h-4 w-4" />
              Clear All Data
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Status</DialogTitle>
            <DialogDescription>Processing your import request...</DialogDescription>
          </DialogHeader>
          <div className="py-4 text-center">
            {importStatus === 'loading' && (
              <div className="space-y-2">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">Importing data...</p>
              </div>
            )}
            {importStatus === 'success' && (
              <div className="space-y-2">
                <CheckCircle2 className="h-8 w-8 mx-auto text-green-500" />
                <p className="text-sm font-medium">{importMessage}</p>
              </div>
            )}
            {importStatus === 'error' && (
              <div className="space-y-2">
                <AlertCircle className="h-8 w-8 mx-auto text-red-500" />
                <p className="text-sm font-medium text-red-500">{importMessage}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            {importStatus !== 'loading' && (
              <Button onClick={() => setShowImportDialog(false)}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportAsCsv(data: any, filename: string) {
  const rows: string[] = ['Title,Type,ID,Name,Description'];

  for (const novel of data.novels || []) {
    rows.push(`"${novel.title}",novel,${novel.id || ''},"${novel.title}","${novel.outline || ''}"`);
    for (const ch of novel.characters || []) {
      rows.push(`"${novel.title}",character,${ch.id},"${ch.name}","${ch.description || ''}"`);
    }
    for (const s of novel.settings || []) {
      rows.push(`"${novel.title}",setting,${s.id},"${s.name}","${s.description || ''}"`);
    }
    for (const f of novel.factions || []) {
      rows.push(`"${novel.title}",faction,${f.id},"${f.name}","${f.description || ''}"`);
    }
    for (const i of novel.items || []) {
      rows.push(`"${novel.title}",item,${i.id},"${i.name}","${i.description || ''}"`);
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  downloadBlob(blob, filename);
}
