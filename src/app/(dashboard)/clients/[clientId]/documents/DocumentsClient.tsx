'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Folder,
  FileText,
  FilePlus,
  Upload,
  MoreHorizontal,
  ExternalLink,
  Download,
  Pencil,
  Link2,
  FolderInput,
  Trash2,
  ChevronDown,
  AlertCircle,
  X,
  Check,
  Loader2,
  Plus,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import {
  getGoogleEditorUrl,
  isInternalRole,
  canUploadToFolder,
  buildFolderTree,
  formatShortDate,
  getFolderDisplayName,
  looksLikeUid,
} from '@/lib/documents/utils';
import type { FolderTreeNode } from '@/lib/documents/utils';
import type { DocumentFolderItem, UserRole, Campaign, Proposition } from '@/types';

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
  campaignRefs: string[];
  /** @deprecated Legacy single-ref kept for backward compat */
  campaignRef: string | null;
  propositionRefs?: string[];
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
  const isContainer = node.isContainer && node.children.length > 0;
  const [expanded, setExpanded] = useState(true); // containers start expanded
  const isSelected = !isContainer && selectedCategory === node.folderCategory;
  const count = fileCounts[node.folderCategory] ?? 0;
  const isEmpty = count === 0 && campaignActive;

  function handleClick() {
    if (isContainer) {
      // Container folders toggle expand/collapse — never select
      setExpanded(!expanded);
    } else {
      onSelect(isSelected ? null : node.folderCategory);
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
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
        {isContainer && (
          <ChevronDown
            className={`shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`}
            style={{ width: '12px', height: '12px' }}
          />
        )}
        <Folder className="shrink-0" style={{ width: '14px', height: '14px' }} />
        <span className="truncate">{node.name}</span>
        {node.visibility === 'internal-only' && (
          <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
            internal
          </span>
        )}
      </button>
      {expanded && node.children.map((child) => (
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
  propositions,
  folders,
  onRename,
  onLinkCampaign,
  onLinkProposition,
  onMove,
  onDelete,
  onRefresh,
}: {
  file: BrowseFile;
  clientId: string;
  role: UserRole;
  campaigns: Pick<Campaign, 'id' | 'campaignName' | 'status'>[];
  propositions: Proposition[];
  folders: BrowseFolder[];
  onRename: (docId: string, newName: string) => Promise<void>;
  onLinkCampaign: (docId: string, campaignRefs: string[]) => Promise<void>;
  onLinkProposition: (docId: string, propositionRefs: string[]) => Promise<void>;
  onMove: (docId: string, targetFolderId: string) => Promise<void>;
  onDelete: (docId: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const internal = isInternalRole(role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(file.name);
  const [campaignMenuOpen, setCampaignMenuOpen] = useState(false);
  const [propositionMenuOpen, setPropositionMenuOpen] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
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
      await onDelete(file.documentId);
    } finally {
      setLoading(false);
      setDeleteConfirm(false);
      setMenuOpen(false);
    }
  }

  // Resolve campaign refs to display names
  const fileRefs = file.campaignRefs || [];

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
          {file.uploadedByName && !looksLikeUid(file.uploadedByName) && (
            <span> by {file.uploadedByName.split('@')[0]}</span>
          )}
        </p>
      </div>

      {/* Campaign pills — multiple teal pills for multi-tag */}
      {fileRefs.length > 0 ? (
        <div className="flex shrink-0 gap-1 flex-wrap justify-end">
          {fileRefs.map((cid) => {
            const cName = campaigns.find((c) => c.id === cid)?.campaignName || cid;
            return (
              <span key={cid} className="rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: '#E1F5EE', color: '#085041' }}>
                {cName}
              </span>
            );
          })}
        </div>
      ) : (
        <span className="shrink-0 text-[11px] italic text-gray-300">No campaign</span>
      )}

      {/* Proposition pills */}
      {(file.propositionRefs || []).length > 0 && (
        <div className="flex shrink-0 gap-1">
          {file.propositionRefs!.map((propId) => {
            const prop = propositions.find((p) => p.id === propId);
            return (
              <span
                key={propId}
                className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                style={{ background: '#F0E6F0', color: '#5C3D6E' }}
              >
                {prop?.name || propId}
              </span>
            );
          })}
        </div>
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
                    {fileRefs.length > 0 && (
                      <button
                        onClick={async () => { await onLinkCampaign(file.documentId, []); setCampaignMenuOpen(false); setMenuOpen(false); onRefresh(); }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
                      >
                        Remove all links
                      </button>
                    )}
                    {campaigns
                      .filter((c) => c.status !== 'completed')
                      .map((c) => {
                        const isLinked = fileRefs.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            onClick={async () => {
                              const updated = isLinked
                                ? fileRefs.filter((id) => id !== c.id)
                                : [...fileRefs, c.id];
                              await onLinkCampaign(file.documentId, updated);
                              onRefresh();
                            }}
                            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-white ${isLinked ? 'font-medium text-[#3B7584]' : 'text-gray-600'}`}
                          >
                            <span className={`inline-block h-3 w-3 rounded border ${isLinked ? 'bg-[#3B7584] border-[#3B7584]' : 'border-gray-300'}`} />
                            {c.campaignName}
                          </button>
                        );
                      })}
                  </div>
                )}

                <button
                  onClick={() => { setPropositionMenuOpen(!propositionMenuOpen); setCampaignMenuOpen(false); setMoveMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Link2 className="h-[15px] w-[15px]" /> Link to proposition
                </button>

                {propositionMenuOpen && (
                  <div className="border-t border-gray-100 bg-gray-50 px-2 py-1 max-h-48 overflow-y-auto">
                    {(file.propositionRefs || []).length > 0 && (
                      <button
                        onClick={async () => { await onLinkProposition(file.documentId, []); setPropositionMenuOpen(false); setMenuOpen(false); onRefresh(); }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
                      >
                        Remove all links
                      </button>
                    )}
                    {propositions
                      .filter((p) => p.status === 'active')
                      .map((p) => {
                        const isLinked = (file.propositionRefs || []).includes(p.id);
                        return (
                          <button
                            key={p.id}
                            onClick={async () => {
                              const current = file.propositionRefs || [];
                              const updated = isLinked
                                ? current.filter((id) => id !== p.id)
                                : [...current, p.id];
                              await onLinkProposition(file.documentId, updated);
                              onRefresh();
                            }}
                            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-white ${isLinked ? 'font-medium text-[#5C3D6E]' : 'text-gray-600'}`}
                          >
                            <span className={`inline-block h-3 w-3 rounded border ${isLinked ? 'bg-[#5C3D6E] border-[#5C3D6E]' : 'border-gray-300'}`} />
                            {p.name}
                          </button>
                        );
                      })}
                  </div>
                )}

                <button
                  onClick={() => { setMoveMenuOpen(!moveMenuOpen); setCampaignMenuOpen(false); setPropositionMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <FolderInput className="h-[15px] w-[15px]" /> Move to folder
                </button>

                {moveMenuOpen && (
                  <div className="border-t border-gray-100 bg-gray-50 px-2 py-1 max-h-48 overflow-y-auto">
                    {folders
                      .filter((f) => f.folderId && f.folderCategory !== file.folderCategory)
                      .map((f) => (
                        <button
                          key={f.folderCategory}
                          onClick={async () => {
                            if (f.folderId) {
                              await onMove(file.documentId, f.folderId);
                              setMoveMenuOpen(false);
                              setMenuOpen(false);
                            }
                          }}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-white"
                        >
                          <Folder className="h-3 w-3 shrink-0" />
                          {f.folderName}
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
  const [creating, setCreating] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showUnregistered, setShowUnregistered] = useState(false);
  const [propositionFilter, setPropositionFilter] = useState<string>(searchParams.get('proposition') || '');
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const newMenuRef = useRef<HTMLDivElement>(null);

  const internal = isInternalRole(role);
  const tree = buildFolderTree(folderTemplate, role);

  // Close new menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
    }
    if (showNewMenu) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showNewMenu]);

  // ── Fetch documents ─────────────────────────────────────────────────────
  const fetchDocuments = useCallback(async (campaign: string | undefined = undefined, checkUnregistered = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const filterCampaign = campaign !== undefined ? campaign : campaignFilter;
      if (filterCampaign) params.set('campaign', filterCampaign);
      if (checkUnregistered) params.set('includeUnregisteredCheck', 'true');

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

  // ── Client-side proposition filtering ────────────────────────────────────
  function filterFilesByProposition(files: BrowseFile[]): BrowseFile[] {
    if (!propositionFilter) return files;
    return files.filter((f) => (f.propositionRefs || []).includes(propositionFilter));
  }

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

  // ── Fetch propositions ──────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/clients/${clientId}/propositions?status=active`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data) setPropositions(json.data);
      })
      .catch(() => {}); // silent
  }, [clientId]);

  async function handleLinkProposition(docId: string, propRefs: string[]) {
    const res = await fetch(`/api/clients/${clientId}/documents/${docId}/proposition`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propositionRefs: propRefs }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Link proposition failed');
    }
    fetchDocuments();
  }

  async function handleLinkCampaign(docId: string, campaignRefs: string[]) {
    const res = await fetch(`/api/clients/${clientId}/documents/${docId}/campaign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignRefs }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Link campaign failed');
    }
    fetchDocuments();
  }

  async function handleDelete(docId: string) {
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

  // ── Trigger unregistered check when internal user selects a folder ───
  useEffect(() => {
    if (internal && selectedCategory && !loading) {
      // Fire a background check — don't set loading, just update hasUnregisteredContent
      const checkUrl = `/api/clients/${clientId}/documents/browse?includeUnregisteredCheck=true` +
        (campaignFilter ? `&campaign=${campaignFilter}` : '');
      fetch(checkUrl)
        .then((r) => r.json())
        .then((json: BrowseResponse) => {
          if (json.data) {
            setBrowseData((prev) => prev ? { ...prev, hasUnregisteredContent: json.data.hasUnregisteredContent } : prev);
          }
        })
        .catch(() => {}); // silent
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, internal]);

  // ── Create new Google document ────────────────────────────────────────
  async function handleCreateDocument(type: 'document' | 'spreadsheet' | 'presentation') {
    if (!selectedFolder?.folderId) return;
    const typeLabels = { document: 'Document', spreadsheet: 'Spreadsheet', presentation: 'Presentation' };
    const name = prompt(`Name for new Google ${typeLabels[type]}:`);
    if (!name || !name.trim()) return;

    setCreating(true);
    setShowNewMenu(false);
    try {
      const res = await fetch(`/api/clients/${clientId}/documents/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          folderId: selectedFolder.folderId,
          campaignRef: campaignFilter || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Create failed (${res.status})`);
      }
      const json = await res.json();
      // Open the new file in Google editor
      const mimeTypes: Record<string, string> = {
        document: 'application/vnd.google-apps.document',
        spreadsheet: 'application/vnd.google-apps.spreadsheet',
        presentation: 'application/vnd.google-apps.presentation',
      };
      window.open(getGoogleEditorUrl(json.data.id, mimeTypes[type]), '_blank');
      fetchDocuments();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  // ── Move document to different folder ──────────────────────────────────
  async function handleMoveDocument(docId: string, targetFolderId: string) {
    const res = await fetch(`/api/clients/${clientId}/documents/${docId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetFolderId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Move failed');
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

        {/* Filter dropdowns */}
        <div className="flex items-center gap-2">
          {/* Proposition filter dropdown */}
          <div className="relative">
            <select
              value={propositionFilter}
              onChange={(e) => {
                setPropositionFilter(e.target.value);
                const url = new URL(window.location.href);
                if (e.target.value) url.searchParams.set('proposition', e.target.value);
                else url.searchParams.delete('proposition');
                router.replace(url.pathname + url.search, { scroll: false });
              }}
              className="appearance-none rounded-full border border-gray-200 bg-white pl-4 pr-8 py-2 text-sm text-gray-600 outline-none focus:border-[#5C3D6E] focus:ring-1 focus:ring-[#5C3D6E]/20 cursor-pointer"
            >
              <option value="">All propositions</option>
              {propositions
                .filter((p) => p.status === 'active')
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
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
                  <div className="flex items-center gap-2">
                    {/* New document dropdown — internal only */}
                    {internal && showUpload && (
                      <div className="relative" ref={newMenuRef}>
                        <button
                          onClick={() => setShowNewMenu(!showNewMenu)}
                          disabled={creating}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#3B7584] px-3.5 py-[7px] text-[13px] font-medium text-[#3B7584] hover:bg-[#3B7584]/5 transition-colors disabled:opacity-50"
                        >
                          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                          New
                        </button>
                        {showNewMenu && (
                          <div className="absolute right-0 top-10 z-50 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                            <button
                              onClick={() => handleCreateDocument('document')}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <FilePlus className="h-4 w-4 text-blue-600" /> Google Doc
                            </button>
                            <button
                              onClick={() => handleCreateDocument('spreadsheet')}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <FilePlus className="h-4 w-4 text-green-600" /> Google Sheet
                            </button>
                            <button
                              onClick={() => handleCreateDocument('presentation')}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <FilePlus className="h-4 w-4 text-amber-600" /> Google Slides
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Upload button */}
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
                {filterFilesByProposition(selectedFolder.files).length === 0 ? (
                  <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-12">
                    <p className="text-sm italic text-gray-400">{propositionFilter ? 'No documents match the selected proposition' : 'No documents in this folder'}</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {filterFilesByProposition(selectedFolder.files).map((file) => (
                      <FileRow
                        key={file.documentId}
                        file={file}
                        clientId={clientId}
                        role={role}
                        campaigns={campaigns}
                        propositions={propositions}
                        folders={browseData?.folders || []}
                        onRename={handleRename}
                        onLinkCampaign={handleLinkCampaign}
                        onLinkProposition={handleLinkProposition}
                        onMove={handleMoveDocument}
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

                  const filteredFiles = filterFilesByProposition(folder.files);
                  const isEmpty = filteredFiles.length === 0;
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
                          {filteredFiles.map((file) => (
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
