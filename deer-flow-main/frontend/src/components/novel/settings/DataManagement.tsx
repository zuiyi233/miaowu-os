'use client';

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
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/core/i18n/hooks';
import { databaseService } from '@/core/novel/database';
import { useExportDataMutation, useImportDataMutation } from '@/core/novel/queries';

export function DataManagement() {
  const { t } = useI18n();
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
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: 'application/json',
        });
        downloadBlob(blob, filename);
      } else {
        exportAsCsv(data, filename);
      }

      toast.success(t.novel.exportSuccess);
    } catch (error) {
      toast.error(t.novel.exportFailed);
      console.error('Export error:', error);
    }
  };

  const handleImport = async (file: File) => {
    setShowImportDialog(true);
    setImportStatus('loading');
    setImportMessage('');

    try {
      const content = await file.text();
      const data = JSON.parse(content);

      if (!data.version || !data.novels) {
        throw new Error(t.novel.importFailed);
      }

      if (!confirm(t.novel.importDataDescription)) {
        setImportStatus('idle');
        return;
      }

      await importMutation.mutateAsync(data);
      setImportStatus('success');
      setImportMessage(`${t.novel.importSuccess} (${data.novels.length})`);
      toast.success(t.novel.importSuccess);
      setTimeout(() => setShowImportDialog(false), 2000);
    } catch (error) {
      setImportStatus('error');
      setImportMessage(error instanceof Error ? error.message : t.novel.importFailed);
      toast.error(t.novel.importFailed);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleImport(file);
    }
  };

  const handleExportAll = async () => {
    try {
      const data = await exportMutation.mutateAsync();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      downloadBlob(blob, `novel-full-backup-${timestamp}.json`);
      toast.success(t.novel.exportSuccess);
    } catch {
      toast.error(t.novel.exportFailed);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t.novel.dataManagement}</h2>
        <p className="text-muted-foreground mt-1">{t.novel.exportDataDescription}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t.novel.exportData}
            </CardTitle>
            <CardDescription>{t.novel.exportDataDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full gap-2" onClick={() => void handleExport('json')}>
              <FileJson className="h-4 w-4" />
              {t.novel.exportJson}
            </Button>
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => void handleExport('csv')}
            >
              <FileSpreadsheet className="h-4 w-4" />
              {t.novel.exportCsv}
            </Button>
            <Button variant="secondary" className="w-full gap-2" onClick={() => void handleExportAll()}>
              <Database className="h-4 w-4" />
              {t.novel.fullBackup}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {t.novel.importData}
            </CardTitle>
            <CardDescription>{t.novel.importDataDescription}</CardDescription>
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
              {t.novel.importJsonFile}
            </Button>
            <Button
              variant="destructive"
              className="w-full gap-2"
              onClick={async () => {
                if (confirm(t.novel.clearAllDataConfirm)) {
                  await databaseService.clearAllData();
                  toast.success(t.novel.clearAllDataSuccess);
                  window.location.reload();
                }
              }}
            >
              <AlertCircle className="h-4 w-4" />
              {t.novel.clearAllData}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.novel.importStatusTitle}</DialogTitle>
            <DialogDescription>{t.novel.importStatusDescription}</DialogDescription>
          </DialogHeader>
          <div className="py-4 text-center">
            {importStatus === 'loading' && (
              <div className="space-y-2">
                <Loader2 className="text-primary mx-auto h-8 w-8 animate-spin" />
                <p className="text-muted-foreground text-sm">{t.novel.importProcessing}</p>
              </div>
            )}
            {importStatus === 'success' && (
              <div className="space-y-2">
                <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />
                <p className="text-sm font-medium">{importMessage}</p>
              </div>
            )}
            {importStatus === 'error' && (
              <div className="space-y-2">
                <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
                <p className="text-sm font-medium text-red-500">{importMessage}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            {importStatus !== 'loading' && (
              <Button onClick={() => setShowImportDialog(false)}>{t.common.close}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function exportAsCsv(data: any, filename: string) {
  const rows: string[] = ['Title,Type,ID,Name,Description'];

  for (const novel of data.novels || []) {
    rows.push(`"${novel.title}",novel,${novel.id || ''},"${novel.title}","${novel.outline || ''}"`);
    for (const ch of novel.characters || []) {
      rows.push(`"${novel.title}",character,${ch.id},"${ch.name}","${ch.description || ''}"`);
    }
    for (const setting of novel.settings || []) {
      rows.push(`"${novel.title}",setting,${setting.id},"${setting.name}","${setting.description || ''}"`);
    }
    for (const faction of novel.factions || []) {
      rows.push(`"${novel.title}",faction,${faction.id},"${faction.name}","${faction.description || ''}"`);
    }
    for (const item of novel.items || []) {
      rows.push(`"${novel.title}",item,${item.id},"${item.name}","${item.description || ''}"`);
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  downloadBlob(blob, filename);
}
