'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, Folder, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/AuthContext';
import {
  getGoogleEditorUrl,
  isInternalRole,
  formatShortDate,
  getFolderDisplayName,
} from '@/lib/documents/utils';
import type { DocumentFolderItem } from '@/types';

// =============================================================================
// Types
// =============================================================================

interface BrowseFile {
  documentId: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  uploadedAt: string;
  folderCategory: string;
  visibility: string;
}

interface BrowseFolder {
  folderCategory: string;
  folderName: string;
  visibility: string;
  files: BrowseFile[];
}

interface CampaignDocumentsCardProps {
  clientId: string;
  campaignId: string;
  folderTemplate?: DocumentFolderItem[];
}

// =============================================================================
// CampaignDocumentsCard
// =============================================================================

export default function CampaignDocumentsCard({
  clientId,
  campaignId,
  folderTemplate,
}: CampaignDocumentsCardProps) {
  const { claims } = useAuth();
  const role = claims.role;
  const internal = isInternalRole(role);

  const [folders, setFolders] = useState<BrowseFolder[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDocs() {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/documents/browse?campaign=${campaignId}`
        );
        if (!res.ok) return;
        const json = await res.json();
        const data = json.data;

        // Filter by role visibility
        const visibleFolders = (data.folders || []).filter((f: BrowseFolder) => {
          if (!internal && f.visibility === 'internal-only') return false;
          return true;
        });

        setFolders(visibleFolders);

        // Count files (only in visible folders)
        const count = visibleFolders.reduce(
          (sum: number, f: BrowseFolder) => sum + f.files.length,
          0
        );
        setTotalFiles(count);
      } catch {
        // Silently fail — card shows empty state
      } finally {
        setLoading(false);
      }
    }
    fetchDocs();
  }, [clientId, campaignId, internal]);

  function handleFileClick(file: BrowseFile) {
    if (internal) {
      window.open(getGoogleEditorUrl(file.driveFileId, file.mimeType), '_blank');
    } else {
      const a = document.createElement('a');
      a.href = `/api/clients/${clientId}/documents/download/${file.driveFileId}`;
      a.download = file.name;
      a.click();
    }
  }

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 rounded bg-gray-200 animate-pulse" />
                <div className="h-3 rounded bg-gray-200 animate-pulse" style={{ width: `${80 + i * 20}px` }} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (totalFiles === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Documents</CardTitle>
          <Link
            href={`/clients/${clientId}/documents?campaign=${campaignId}`}
            className="flex items-center gap-1 text-xs font-medium text-[#3B7584] hover:text-[#2D5D6B]"
          >
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-8">
            <p className="text-sm text-gray-400">No documents linked to this campaign</p>
            {internal && (
              <p className="mt-1 text-xs text-gray-300">Link documents from the Documents page</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Populated state ─────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Documents</CardTitle>
        <Link
          href={`/clients/${clientId}/documents?campaign=${campaignId}`}
          className="flex items-center gap-1 text-xs font-medium text-[#3B7584] hover:text-[#2D5D6B]"
        >
          View all <ChevronRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {folders.map((folder) => {
          const tmpl = folderTemplate?.find((f) => f.folderCategory === folder.folderCategory);
          if (tmpl?.isContainer) return null;
          if (folder.files.length === 0) return null;

          const displayName = folderTemplate?.length
    ? getFolderDisplayName(folder.folderCategory, folderTemplate)
    : folder.folderName || folder.folderCategory;

          return (
            <div key={folder.folderCategory}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Folder className="shrink-0" style={{ width: '13px', height: '13px', color: '#6B7280' }} />
                <span className="text-xs font-medium text-gray-500">{displayName}</span>
                {folder.visibility === 'internal-only' && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                    internal
                  </span>
                )}
              </div>
              <div className="ml-4 space-y-1">
                {folder.files.map((file) => (
                  <div key={file.documentId} className="flex items-center gap-2 py-0.5">
                    <FileText className="shrink-0" style={{ width: '14px', height: '14px', color: '#3B7584', strokeWidth: 1.5 }} />
                    <button
                      onClick={() => handleFileClick(file)}
                      className="truncate text-sm text-[#0369A1] hover:underline cursor-pointer text-left"
                    >
                      {file.name}
                    </button>
                    <span className="shrink-0 text-xs text-gray-400">{formatShortDate(file.uploadedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>

      {/* Footer count */}
      <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-2.5 rounded-b-xl">
        <p className="text-xs text-gray-400">
          {totalFiles} document{totalFiles !== 1 ? 's' : ''} linked to this campaign
        </p>
      </div>
    </Card>
  );
}
