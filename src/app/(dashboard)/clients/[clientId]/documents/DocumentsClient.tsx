'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Folder,
  FileText,
  Upload,
  MoreHorizontal,
  ExternalLink,
  Download,
  Pencil,
  Link2,
  Trash2,
  ChevronDown,
  AlertCircle,
  X,
  Check,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import {
  getGoogleEditorUrl,
  isInternalRole,
  canUploadToFolder,
  buildFolderTree,
  formatShortDate,
  getFolderDisplayName,
} from '@/lib/documents/utils';
import type { FolderTreeNode } from '@/lib/documents/utils';
import type { DocumentFolderItem, UserRole, Campaign } from '@/types';

// =============================================================================
// Types
// =============================================================================

interface BrowseFile {
  documentId: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  size: number;
  folderCategory: string;
  visibility: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  campaignRef: string | null;
  status: string;
}

interface BrowseFolder {
  folderCategory: string;
  folderName: string;
  folderId: string | null;
  visibility: string;
  files: BrowseFile[];
}

interface BrowseResponse {
  success: boolean;
  mode: string;
  data: {
    folders: BrowseFolder[];
    totalFiles: number;
    totalFolders: number;
    hasUnregisteredContent: boolean;
    visibilityFilter: string;
    campaignFilter: string | null;
  };
}

interface DocumentsClientProps {
  clientId: string;
  clientName: string;
  folderTemplate: DocumentFolderItem[];
  campaigns: Pick<Campaign, 'id' | 'campaignName' | 'status'>[];
}

// =============================================================================
// Constants
// =============================================================================

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// =============================================================================
// Skeleton Components
// =============================================================================

function FolderTreeSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-3.5 w-3.5 rounded bg-gray-200 animate-pulse" />
          <div className="h-3.5 rounded bg-gray-200 animate-pulse" style={{ width: `${60 + i * 12}px` }} />
        </div>
      ))}
      {[1, 2].map((i) => (
        <div key={`child-${i}`} className="flex items-center gap-2 pl-4">
          <div className="h-3 w-3 rounded bg-gray-100 animate-pulse" />
          <div className="h-3 rounded bg-gray-100 animate-pulse" style={{ width: `${50 + i * 10}px` }} />
        </div>
      ))}
    </div>
  );
}

function FileListSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
          <div className="h-5 w-5 rounded bg-gray-200 animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-40 rounded bg-gray-200 animate-pulse" />
            <div className="h-3 w-24 rounded bg-gray-100 animate-pulse" />
          </div>
          <div className="h-5 w-16 rounded-full bg-gray-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Folder Tree Component
// =============================================================================

function FolderTreeItem({
  node,
  selectedCategory,
  onSelect,
  isChild,
  fileCounts,
  campaignActive,
}: {
  node: FolderTreeNode;
  selectedCategory: string | null;
  onSelect: (category: string | null) => void;
  isChild?: boolean;
  fileCounts: Record<string, number>;
  campaignActive: boolean;
}) {
  const isSelected = selectedCategory === node.folderCategory;
  const count = fileCounts[node.folderCategory] ?? 0;
  const isEmpty = count === 0 && campaignActive;

  return (
    <>
      <button
        onClick={() => onSelect(isSelected ? null : node.folderCategory)}
        className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors
          ${isSelected
            ? 'border-l-[3px] border-l-[#3B7584] bg-[var(--surface-secondary,#F7F9FA)] font-medium'
            : 'border-l-[3px] border-l-transparent hover:bg-gray-50'
          }
          ${isEmpty ? 'opacity-50' : ''}
        `}
        style={{
          paddingLeft: isChild ? '36px' : '20px',
          fontSize: isChild ? '12px' : '13px',
          fontWeight: isSelected ? 500 : 400,
          color: isSelected ? '#1A1A1A' : isEmpty ? '#9CA3AF' : '#6B7280',
        }}
      >
        <Folder className="shrink-0" style={{ width: '14px', height: '14px' }} />
        <span className="truncate">{node.name}</span>
        {node.visibility === 'internal-only' && (
          <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
            internal
          </span>
        )}
      </button>
      {node.children.map((child) => (
        <FolderTreeItem
          key={child.folderCategory}
          node={child}
          selectedCategory={selectedCategory}
          onSelect={onSelect}
          isChild
          fileCounts={fileCounts}
          campaignActive={campaignActive}
        />
      ))}
    </>
  );
}

// =============================================================================
// File Row Component
// =============================================================================

function FileRow({
  file,
  clientId,
  role,
  campaigns,
  onRename,
  onLinkCampaign,
  onDelete,
  onRefresh,
}: {
  file: BrowseFile;
  clientId: string;
  role: UserRole;
  campaigns: Pick<Campaign, 'id' | 'campaignName' | 'status'>[];
  onRename: (docId: string, newName: string) => Promise<void>;
  onLinkCampaign: (docId: string, campaignId: string | null) => Promise<void>;
  onDelete: (docId: string, fileName: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const internal = isInternalRole(role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(file.name);
  const [campaignMenuOpen, setCampaignMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setCampaignMenuOpen(false);
        setDeleteConfirm(false);
      }
    }
    if (menuOpen || campaignMenuOpen || deleteConfirm) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [menuOpen, campaignMenuOpen, deleteConfirm]);

  function handleFileClick(e: React.MouseEvent) {
    e.preventDefault();
    if (internal) {
      // Open in Google editor
      window.open(getGoogleEditorUrl(file.driveFileId, file.mimeType), '_blank');
    } else {
      // Download
      triggerDownload();
    }
  }

  function triggerDownload() {
    const a = document.createElement('a');
    a.href = `/api/clients/${clientId}/documents/download/${file.driveFileId}`;
    a.download = file.name;
    a.click();
  }

  async function handleRenameSubmit() {
    if (!renameValue.trim() || renameValue === file.name) {
      setRenaming(false);
      return;
    }
    setLoading(true);
    try {
      await onRename(file.documentId, renameValue.trim());
    } finally {
      setLoading(false);
      setRenaming(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    try {
      await onDelete(file.documentId, file.name);
    } finally {
      setLoading(false);
      setDeleteConfirm(false);
      setMenuOpen(false);
    }
  }

  const campaignName = file.campaignRef
    ? campaigns.find((c) => c.id === file.campaignRef)?.campaignName
    : null;

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 transition-colors hover:bg-gray-50/50">
      {/* File icon */}
      <FileText className="shrink-0" style={{ width: '18px', height: '18px', color: '#3B7584', strokeWidth: 1.5 }} />

      {/* Name + metadata */}
      <div className="flex-1 min-w-0">
        {renaming ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') { setRenaming(false); setRenameValue(file.name); }
              }}
              className="flex-1 rounded border border-gray-300 px-2 py-0.5 text-sm outline-none focus:border-[#3B7584] focus:ring-1 focus:ring-[#3B7584]/20"
            />
            <button onClick={handleRenameSubmit} disabled={loading} className="text-emerald-600 hover:text-emerald-700">
              <Check className="h-4 w-4" />
            </button>
            <button onClick={() => { setRenaming(false); setRenameValue(file.name); }} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleFileClick}
            className="block truncate text-sm font-medium text-[#0369A1] hover:underline cursor-pointer text-left"
          >
            {file.name}
          </button>
        )}
        <p className="text-xs text-gray-400 mt-0.5">
          {formatShortDate(file.uploadedAt)}
          {file.uploadedByName && <span> by {file.uploadedByName.split('@')[0]}</span>}
        </p>
      </div>

      {/* Campaign pill */}
      {campaignName ? (
        <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: '#E1F5EE', color: '#085041' }}>
          {campaignName}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] italic text-gray-300">No campaign</span>
      )}

      {/* Three-dot menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => { setMenuOpen(!menuOpen); setCampaignMenuOpen(false); setDeleteConfirm(false); }}
          className="rounded p-1 text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600 transition-opacity"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-8 z-50 w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {internal && (
              <button
                onClick={() => { window.open(getGoogleEditorUrl(file.driveFileId, file.mimeType), '_blank'); setMenuOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <ExternalLink className="h-[15px] w-[15px]" /> Open in Google
              </button>
            )}
            <button
              onClick={() => { triggerDownload(); setMenuOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Download className="h-[15px] w-[15px]" /> Download
            </button>

            {internal && (
              <>
                <div className="my-1 border-t border-gray-100" />
                <button
                  onClick={() => { setRenaming(true); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Pencil className="h-[15px] w-[15px]" /> Rename
                </button>
                <button
                  onClick={() => { setCampaignMenuOpen(!campaignMenuOpen); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Link2 className="h-[15px] w-[15px]" /> Link to campaign
                </button>

                {campaignMenuOpen && (
                  <div className="border-t border-gray-100 bg-gray-50 px-2 py-1 max-h-48 overflow-y-auto">
                    {file.campaignRef && (
                      <button
                        onClick={async () => { await onLinkCampaign(file.documentId, null); setCampaignMenuOpen(false); setMenuOpen(false); onRefresh(); }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
                      >
                        Remove link
                      </button>
                    )}
                    {campaigns
                      .filter((c) => c.status !== 'completed')
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={async () => { await onLinkCampaign(file.documentId, c.id); setCampaignMenuOpen(false); setMenuOpen(false); onRefresh(); }}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-white ${file.campaignRef === c.id ? 'font-medium text-[#3B7584]' : 'text-gray-600'}`}
                        >
                          {c.campaignName}
                        </button>
                      ))}
                  </div>
                )}

                <div className="my-1 border-t border-gray-100" />
                {deleteConfirm ? (
                  <div className="px-3 py-2 space-y-2">
                    <p className="text-xs text-gray-600">Delete &ldquo;{file.name}&rdquo;?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDelete}
                        disabled={loading}
                        className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {loading ? 'Deleting...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(false)}
                        className="rounded border px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-[15px] w-[15px]" /> Delete
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main DocumentsClient Component
// =============================================================================

export default function DocumentsClient({
  clientId,
  clientName,
  folderTemplate,
  campaigns,
}: DocumentsClientProps) {
  const { claims } = useAuth();
  const role = claims.role;
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── State ─────────────────────────────────────────────────────────────────
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [campaignFilter, setCampaignFilter] = useState<string>(searchParams.get('campaign') || '');
  const [browseData, setBrowseData] = useState<BrowseResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUnregistered, setShowUnregistered] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const tree = buildFolderTree(folderTemplate, role);

  // ── Fetch documents ─────────────────────────────────────────────────────
  const fetchDocuments = useCallback(async (campaign: string | undefined = undefined) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const filterCampaign = campaign !== undefined ? campaign : campaignFilter;
      if (filterCampaign) params.set('campaign', filterCampaign);

      const res = await fetch(`/api/clients/${clientId}/documents/browse?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Browse failed (${res.status})`);
      }
      const json: BrowseResponse = await res.json();
      setBrowseData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [clientId, campaignFilter]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // ── Campaign filter with debounce ───────────────────────────────────────
  function handleCampaignChange(value: string) {
    setCampaignFilter(value);
    // Update URL
    const url = new URL(window.location.href);
    if (value) {
      url.searchParams.set('campaign', value);
    } else {
      url.searchParams.delete('campaign');
    }
    router.replace(url.pathname + url.search, { scroll: false });

    // Debounced fetch
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchDocuments(value), 200);
  }

  // ── File count per category ─────────────────────────────────────────────
  const fileCounts: Record<string, number> = {};
  if (browseData) {
    for (const folder of browseData.folders) {
      fileCounts[folder.folderCategory] = folder.files.length;
    }
  }

  // ── Selected folder data ────────────────────────────────────────────────
  const selectedFolder = selectedCategory
    ? browseData?.folders.find((f) => f.folderCategory === selectedCategory)
    : null;

  const selectedFolderTemplate = selectedCategory
    ? folderTemplate.find((f) => f.folderCategory === selectedCategory)
    : null;

  const showUpload = selectedCategory && selectedFolderTemplate
    && canUploadToFolder(role, selectedCategory, selectedFolderTemplate.isContainer);

  // ── API Handlers ────────────────────────────────────────────────────────
  async function handleRename(docId: string, newName: string) {
    // Optimistic update — update local state immediately
    const previousData = browseData;
    if (browseData) {
      setBrowseData({
        ...browseData,
        folders: browseData.folders.map((folder) => ({
          ...folder,
          files: folder.files.map((f) =>
            f.documentId === docId ? { ...f, name: newName } : f
          ),
        })),
      });
    }

    const res = await fetch(`/api/clients/${clientId}/documents/${docId}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Rename failed');
      // Revert optimistic update on error
      if (previousData) setBrowseData(previousData);
    }
  }

  async function handleLinkCampaign(docId: string, campaignId: string | null) {
    const res = await fetch(`/api/clients/${clientId}/documents/${docId}/campaign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignRef: campaignId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Link campaign failed');
    }
    fetchDocuments();
  }

  async function handleDelete(docId: string, _fileName: string) {
    const res = await fetch(`/api/clients/${clientId}/documents/${docId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Delete failed');
    }
    fetchDocuments();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      alert(`File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds the 50MB limit`);
      e.target.value = '';
      return;
    }

    if (!selectedFolder?.folderId) {
      alert('Cannot upload — folder not provisioned');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folderId', selectedFolder.folderId);
      if (campaignFilter) formData.append('campaignRef', campaignFilter);

      const res = await fetch(`/api/clients/${clientId}/documents/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Upload failed (${res.status})`);
      }

      fetchDocuments();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleRegister(driveFileId: string, folderCat: string) {
    const res = await fetch(`/api/clients/${clientId}/documents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driveFileId, folderCategory: folderCat }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Register failed');
    }
    fetchDocuments();
  }

  // =====================================================================
  // RENDER
  // =====================================================================

  return (
    <div className="flex flex-col h-full">
      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Documents</h1>
          <p className="text-sm text-gray-500 mt-0.5">{clientName}</p>
        </div>

        {/* Campaign filter dropdown */}
        <div className="relative">
          <select
            value={campaignFilter}
            onChange={(e) => handleCampaignChange(e.target.value)}
            className="appearance-none rounded-full border border-gray-200 bg-white pl-4 pr-8 py-2 text-sm text-gray-600 outline-none focus:border-[#3B7584] focus:ring-1 focus:ring-[#3B7584]/20 cursor-pointer"
          >
            <option value="">All campaigns</option>
            {campaigns
              .filter((c) => c.status !== 'completed')
              .map((c) => (
                <option key={c.id} value={c.id}>{c.campaignName}</option>
              ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        </div>
      </div>

      {/* ── Error state ──────────────────────────────────────────────────── */}
      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Unprovisioned state ──────────────────────────────────────────── */}
      {!loading && browseData && browseData.totalFolders === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 px-6 py-16">
          <Folder className="h-12 w-12 text-gray-300 mb-4" />
          <p className="text-base font-medium text-gray-500">No document folders provisioned yet</p>
          {isInternalRole(role) && (
            <p className="text-sm text-gray-400 mt-1">Provision this client&apos;s Drive folders from Settings to get started.</p>
          )}
        </div>
      )}

      {/* ── Two-panel layout ─────────────────────────────────────────────── */}
      {(loading || (browseData && browseData.totalFolders > 0)) && (
        <div className="flex flex-1 min-h-0">
          {/* Left: Folder tree */}
          <div className="w-[210px] shrink-0 border-r border-gray-100 overflow-y-auto py-2">
            {loading ? (
              <FolderTreeSkeleton />
            ) : (
              <div className="space-y-0.5 px-1">
                {/* "All" button */}
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`w-full flex items-center gap-2 rounded-md px-5 py-1.5 text-left text-[13px] transition-colors
                    ${!selectedCategory
                      ? 'border-l-[3px] border-l-[#3B7584] bg-[var(--surface-secondary,#F7F9FA)] font-medium text-gray-900'
                      : 'border-l-[3px] border-l-transparent text-gray-500 hover:bg-gray-50'
                    }
                  `}
                >
                  All folders
                </button>

                {tree.map((node) => (
                  <FolderTreeItem
                    key={node.folderCategory}
                    node={node}
                    selectedCategory={selectedCategory}
                    onSelect={setSelectedCategory}
                    fileCounts={fileCounts}
                    campaignActive={!!campaignFilter}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right: File list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <FileListSkeleton />
            ) : selectedCategory && selectedFolder ? (
              /* ── Folder Selected View ──────────────────────────────────── */
              <div className="p-4">
                {/* Folder header bar */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      {getFolderDisplayName(selectedCategory, folderTemplate)}
                      {selectedFolderTemplate?.visibility === 'internal-only' && (
                        <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 align-middle">
                          internal
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {selectedFolder.files.length} file{selectedFolder.files.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  {showUpload && (
                    <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-full bg-[#3B7584] px-4 py-[7px] text-[13px] font-medium text-white hover:bg-[#2D5D6B] transition-colors">
                      {uploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {uploading ? 'Uploading...' : 'Upload'}
                      <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
                    </label>
                  )}
                </div>

                {/* Unregistered banner */}
                {isInternalRole(role) && browseData?.hasUnregisteredContent && (
                  <div className="mb-4 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5">
                    <div className="flex items-center gap-2 text-sm text-blue-700">
                      <AlertCircle className="h-4 w-4" />
                      Unregistered files found in Drive
                    </div>
                    <button
                      onClick={() => setShowUnregistered(!showUnregistered)}
                      className="text-xs font-medium text-blue-700 hover:text-blue-800 underline"
                    >
                      {showUnregistered ? 'Hide' : 'View unregistered'}
                    </button>
                  </div>
                )}

                {/* File list */}
                {selectedFolder.files.length === 0 ? (
                  <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-12">
                    <p className="text-sm italic text-gray-400">No documents in this folder</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {selectedFolder.files.map((file) => (
                      <FileRow
                        key={file.documentId}
                        file={file}
                        clientId={clientId}
                        role={role}
                        campaigns={campaigns}
                        onRename={handleRename}
                        onLinkCampaign={handleLinkCampaign}
                        onDelete={handleDelete}
                        onRefresh={() => fetchDocuments()}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* ── Grouped (All Folders) View ──────────────────────────── */
              <div className="p-4 space-y-5">
                {browseData?.folders.map((folder) => {
                  const tmpl = folderTemplate.find((f) => f.folderCategory === folder.folderCategory);
                  // Skip container folders — show children directly
                  if (tmpl?.isContainer) return null;

                  const isEmpty = folder.files.length === 0;
                  const displayName = getFolderDisplayName(folder.folderCategory, folderTemplate);

                  return (
                    <div key={folder.folderCategory}>
                      {/* Folder group header */}
                      <div className={`flex items-center gap-2 mb-2 ${isEmpty ? 'opacity-50' : ''}`}>
                        <Folder className="shrink-0" style={{ width: '14px', height: '14px', color: isEmpty ? '#9CA3AF' : '#6B7280' }} />
                        <span className={`text-sm font-medium ${isEmpty ? 'text-gray-400' : 'text-gray-700'}`}>
                          {displayName}
                        </span>
                        {folder.visibility === 'internal-only' && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                            internal
                          </span>
                        )}
                      </div>

                      {/* Files or empty message */}
                      {isEmpty ? (
                        <p className="ml-5 text-xs italic text-gray-300">No documents</p>
                      ) : (
                        <div className="ml-5 space-y-1">
                          {folder.files.map((file) => (
                            <div key={file.documentId} className="flex items-center gap-2.5 py-1">
                              <FileText className="shrink-0" style={{ width: '14px', height: '14px', color: '#3B7584', strokeWidth: 1.5 }} />
                              <button
                                onClick={() => {
                                  if (isInternalRole(role)) {
                                    window.open(getGoogleEditorUrl(file.driveFileId, file.mimeType), '_blank');
                                  } else {
                                    const a = document.createElement('a');
                                    a.href = `/api/clients/${clientId}/documents/download/${file.driveFileId}`;
                                    a.download = file.name;
                                    a.click();
                                  }
                                }}
                                className="truncate text-sm text-[#0369A1] hover:underline cursor-pointer text-left"
                              >
                                {file.name}
                              </button>
                              <span className="shrink-0 text-xs text-gray-400">{formatShortDate(file.uploadedAt)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
