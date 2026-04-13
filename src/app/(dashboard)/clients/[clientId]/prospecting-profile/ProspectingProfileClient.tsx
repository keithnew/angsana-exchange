'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Plus, Edit2, X, Check, ExternalLink, FileText, AlertTriangle, Bot, Link2, CheckCircle } from 'lucide-react';
import type {
  Proposition, ProspectingProfile, ManagedListItem, UserRole, Campaign,
  PropositionStatus, ICP, MarketMessagingEntry, Recommendation,
  RecommendationStatus, CompanySizingEntry, BuyingProcessType,
} from '@/types';
import {
  PROPOSITION_STATUS_CONFIG, RECOMMENDATION_STATUS_CONFIG, BUYING_PROCESS_CONFIG,
} from '@/types';

// ─── Lightweight campaign type (only what we need from server) ────────────
type CampaignSummary = Pick<Campaign, 'id' | 'campaignName' | 'status' | 'propositionRefs'>;

// ─── Props ───────────────────────────────────────────────────────────────────
interface Props {
  clientId: string;
  clientName: string;
  propositions: Proposition[];
  profile: ProspectingProfile;
  managedLists: Record<string, ManagedListItem[]>;
  userRole: UserRole;
  userUid: string;
  userEmail: string;
  /** Change 2: UID→displayName lookup map */
  userMap?: Record<string, string>;
  /** Change 6: Non-completed campaigns for proposition cross-links */
  campaigns?: CampaignSummary[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const isInternal = (role: UserRole) => role === 'internal-admin' || role === 'internal-user';
const isClientApprover = (role: UserRole) => role === 'client-approver';
const canEditPropositions = (role: UserRole) => isInternal(role);
const canSuggestPropositions = (role: UserRole) => isClientApprover(role);
const canEditICP = (role: UserRole) => isInternal(role) || role === 'client-approver';
const canEditMessaging = (role: UserRole) => isInternal(role) || role === 'client-approver';
const canEditRecommendations = (role: UserRole) => isInternal(role);

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Format date with year: "10 Apr 2026" */
function formatDateFull(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Resolve UID to display name, fallback to "Unknown" */
function resolveUser(uid: string, userMap: Record<string, string>): string {
  if (!uid) return 'Unknown';
  return userMap[uid] || 'Unknown';
}

function resolveLabel(id: string, items: ManagedListItem[]): string {
  return items.find((i) => i.id === id)?.label || id;
}

function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 15);
}

// ─── Section Wrapper ─────────────────────────────────────────────────────────
function SectionCard({
  title, count, lastUpdated, lastUpdatedBy, children, defaultOpen = true, badge,
}: {
  title: string; count?: number; lastUpdated?: string; lastUpdatedBy?: string;
  children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-3">
          {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {count !== undefined && (
            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
          )}
          {badge}
        </div>
        {lastUpdated && (
          <span className="text-xs text-gray-400">Updated {formatDate(lastUpdated)}{lastUpdatedBy ? ` by ${lastUpdatedBy}` : ''}</span>
        )}
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-100">{children}</div>}
    </div>
  );
}

// ─── Status Badge ────────────────────────────────────────────────────────────
function StatusBadge({ label, colour, bgColour }: { label: string; colour: string; bgColour: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ color: colour, backgroundColor: bgColour }}>
      {label}
    </span>
  );
}

// ─── Tag Pill ────────────────────────────────────────────────────────────────
function TagPill({ label, onRemove, variant = 'default' }: { label: string; onRemove?: () => void; variant?: 'default' | 'mauve' }) {
  const bg = variant === 'mauve' ? '#F0E6F0' : '#E8F4F8';
  const text = variant === 'mauve' ? '#5C3D6E' : '#3B7584';
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: bg, color: text }}>
      {label}
      {onRemove && (
        <button type="button" onClick={onRemove} className="hover:opacity-70"><X className="h-3 w-3" /></button>
      )}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export function ProspectingProfileClient({
  clientId, clientName, propositions: initialPropositions, profile: initialProfile,
  managedLists, userRole, userUid, userMap = {}, campaigns = [],
}: Props) {
  const router = useRouter();
  const [propositions, setPropositions] = useState(initialPropositions);
  const [expandedPropIds, setExpandedPropIds] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState(initialProfile);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync state when server re-fetches data after router.refresh()
  useEffect(() => { setPropositions(initialPropositions); }, [initialPropositions]);
  useEffect(() => { setProfile(initialProfile); }, [initialProfile]);

  // Re-fetch propositions from API (for optimistic updates after save)
  const refreshPropositions = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/propositions`);
      if (res.ok) {
        const data = await res.json();
        setPropositions(data.propositions || []);
      }
    } catch { /* non-blocking */ }
  }, [clientId]);

  // Compute global last-updated
  const allDates: string[] = [
    profile.lastUpdatedAt,
    ...propositions.map((p) => p.lastUpdatedAt),
    ...propositions.map((p) => p.icp?.lastUpdatedAt),
  ].filter((d): d is string => !!d);
  const globalLastUpdated = allDates.length > 0
    ? allDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
    : '';

  // ─── Propositions ────────────────────────────────────────────────────────
  const [showPropForm, setShowPropForm] = useState(false);
  const [editingPropId, setEditingPropId] = useState<string | null>(null);
  const [propForm, setPropForm] = useState({ name: '', category: '', description: '' });

  const categories = managedLists.propositionCategories?.filter((c) => c.active) || [];
  const messagingTypes = managedLists.messagingTypes?.filter((t) => t.active) || [];

  const propsByCategory = propositions.reduce<Record<string, Proposition[]>>((acc, p) => {
    const cat = p.category || 'Uncategorised';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  const saveProp = useCallback(async (isEdit: boolean) => {
    setSaving(true);
    setSaveError(null);
    try {
      const url = isEdit
        ? `/api/clients/${clientId}/propositions/${editingPropId}`
        : `/api/clients/${clientId}/propositions`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(propForm),
      });
      if (res.ok) {
        setShowPropForm(false);
        setEditingPropId(null);
        setPropForm({ name: '', category: '', description: '' });
        await refreshPropositions();
        router.refresh();
      } else {
        const errBody = await res.json().catch(() => ({}));
        const msg = `Save proposition failed (${res.status}): ${errBody.error || res.statusText}`;
        console.error(msg, errBody);
        setSaveError(msg);
      }
    } catch (err) {
      const msg = `Save proposition error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg, err);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [clientId, editingPropId, propForm, router, refreshPropositions]);

  const togglePropStatus = useCallback(async (prop: Proposition) => {
    const newStatus: PropositionStatus = prop.status === 'active' ? 'inactive' : 'active';
    if (newStatus === 'inactive' && !confirm('This proposition will be hidden from campaign pickers. Existing campaign links are preserved.')) return;
    const res = await fetch(`/api/clients/${clientId}/propositions/${prop.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      // Optimistic update
      setPropositions((prev) => prev.map((p) => p.id === prop.id ? { ...p, status: newStatus } : p));
      router.refresh();
    }
  }, [clientId, router]);

  // ─── Per-Proposition ICP ─────────────────────────────────────────────────
  const emptyICP: ICP = {
    industries: { managedListRefs: [], specifics: '' },
    companySizing: [],
    titles: { managedListRefs: [], specifics: '' },
    seniority: { managedListRefs: [], specifics: '' },
    buyingProcess: { type: '', notes: '' },
    geographies: { managedListRefs: [], specifics: '' },
    exclusions: [],
    lastUpdatedBy: '',
    lastUpdatedAt: '',
  };
  const [editingIcpPropId, setEditingIcpPropId] = useState<string | null>(null);
  const [icpDraft, setIcpDraft] = useState<ICP>(emptyICP);

  const savePropositionICP = useCallback(async (propId: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/propositions/${propId}/icp`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(icpDraft),
      });
      if (res.ok) {
        // Optimistic update — set icp on the proposition in local state
        setPropositions((prev) => prev.map((p) =>
          p.id === propId ? { ...p, icp: { ...icpDraft, lastUpdatedBy: userUid, lastUpdatedAt: new Date().toISOString() } } : p
        ));
        setEditingIcpPropId(null);
        router.refresh();
      } else {
        const errBody = await res.json().catch(() => ({}));
        const msg = `Save ICP failed (${res.status}): ${errBody.error || res.statusText}`;
        console.error(msg, errBody);
        setSaveError(msg);
      }
    } catch (err) {
      const msg = `Save ICP error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg, err);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [clientId, icpDraft, router, userUid]);

  // ─── Market Messaging ────────────────────────────────────────────────────
  const [showMsgForm, setShowMsgForm] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [msgForm, setMsgForm] = useState({
    title: '', type: '', content: '', documentRef: '', externalUrl: '', notes: '', propositionRefs: [] as string[],
  });

  const saveMessaging = useCallback(async (entries: MarketMessagingEntry[]) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/prospecting-profile/market-messaging`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketMessaging: entries }),
      });
      if (res.ok) {
        // Optimistic update
        setProfile((prev) => ({ ...prev, marketMessaging: entries }));
        router.refresh();
      } else {
        const errBody = await res.json().catch(() => ({}));
        const msg = `Save messaging failed (${res.status}): ${errBody.error || res.statusText}`;
        console.error(msg, errBody);
        setSaveError(msg);
      }
    } catch (err) {
      const msg = `Save messaging error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg, err);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [clientId, router]);

  const addMessagingEntry = useCallback(async () => {
    const newEntry: MarketMessagingEntry = {
      id: generateId(),
      ...msgForm,
      createdBy: userUid,
      createdAt: new Date().toISOString(),
    };
    const updated = [...profile.marketMessaging, newEntry];
    await saveMessaging(updated);
    setShowMsgForm(false);
    setMsgForm({ title: '', type: '', content: '', documentRef: '', externalUrl: '', notes: '', propositionRefs: [] });
  }, [msgForm, profile.marketMessaging, saveMessaging, userUid]);

  const removeMessagingEntry = useCallback(async (id: string) => {
    if (!confirm('Remove this messaging entry?')) return;
    const updated = profile.marketMessaging.filter((e) => e.id !== id);
    await saveMessaging(updated);
  }, [profile.marketMessaging, saveMessaging]);

  const startEditMsg = useCallback((entry: MarketMessagingEntry) => {
    setEditingMsgId(entry.id);
    setMsgForm({
      title: entry.title,
      type: entry.type,
      content: entry.content || '',
      documentRef: entry.documentRef || '',
      externalUrl: entry.externalUrl || '',
      notes: entry.notes || '',
      propositionRefs: entry.propositionRefs || [],
    });
  }, []);

  const saveEditedMsg = useCallback(async () => {
    if (!editingMsgId) return;
    const updated = profile.marketMessaging.map((e) =>
      e.id === editingMsgId ? { ...e, ...msgForm } : e
    );
    await saveMessaging(updated);
    setEditingMsgId(null);
    setMsgForm({ title: '', type: '', content: '', documentRef: '', externalUrl: '', notes: '', propositionRefs: [] });
  }, [editingMsgId, msgForm, profile.marketMessaging, saveMessaging]);

  const cancelEditMsg = useCallback(() => {
    setEditingMsgId(null);
    setMsgForm({ title: '', type: '', content: '', documentRef: '', externalUrl: '', notes: '', propositionRefs: [] });
  }, []);

  // ─── Recommendations ─────────────────────────────────────────────────────
  const [showRecForm, setShowRecForm] = useState(false);
  const [editingRecId, setEditingRecId] = useState<string | null>(null);
  const [recForm, setRecForm] = useState({ recommendation: '', rationale: '', propositionRefs: [] as string[] });

  const saveRecommendations = useCallback(async (recs: Recommendation[]) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/prospecting-profile/recommendations`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendations: recs }),
      });
      if (res.ok) {
        // Optimistic update
        setProfile((prev) => ({ ...prev, recommendations: recs }));
        router.refresh();
      } else {
        const errBody = await res.json().catch(() => ({}));
        const msg = `Save recommendations failed (${res.status}): ${errBody.error || res.statusText}`;
        console.error(msg, errBody);
        setSaveError(msg);
      }
    } catch (err) {
      const msg = `Save recommendations error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg, err);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [clientId, router]);

  const addRecommendation = useCallback(async () => {
    const newRec: Recommendation = {
      id: generateId(),
      ...recForm,
      status: 'proposed',
      createdBy: userUid,
      createdAt: new Date().toISOString(),
      lastUpdatedBy: userUid,
      lastUpdatedAt: new Date().toISOString(),
    };
    await saveRecommendations([...profile.recommendations, newRec]);
    setShowRecForm(false);
    setRecForm({ recommendation: '', rationale: '', propositionRefs: [] });
  }, [recForm, profile.recommendations, saveRecommendations, userUid]);

  const updateRecStatus = useCallback(async (id: string, status: RecommendationStatus) => {
    const updated = profile.recommendations.map((r) =>
      r.id === id ? { ...r, status, lastUpdatedBy: userUid, lastUpdatedAt: new Date().toISOString() } : r
    );
    await saveRecommendations(updated);
  }, [profile.recommendations, saveRecommendations, userUid]);

  const startEditRec = useCallback((rec: Recommendation) => {
    setEditingRecId(rec.id);
    setRecForm({
      recommendation: rec.recommendation,
      rationale: rec.rationale || '',
      propositionRefs: rec.propositionRefs || [],
    });
  }, []);

  const saveEditedRec = useCallback(async () => {
    if (!editingRecId) return;
    const updated = profile.recommendations.map((r) =>
      r.id === editingRecId ? { ...r, ...recForm, lastUpdatedBy: userUid, lastUpdatedAt: new Date().toISOString() } : r
    );
    await saveRecommendations(updated);
    setEditingRecId(null);
    setRecForm({ recommendation: '', rationale: '', propositionRefs: [] });
  }, [editingRecId, recForm, profile.recommendations, saveRecommendations, userUid]);

  const cancelEditRec = useCallback(() => {
    setEditingRecId(null);
    setRecForm({ recommendation: '', rationale: '', propositionRefs: [] });
  }, []);

  // ─── AI Review ───────────────────────────────────────────────────────────
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState('');

  const triggerAIReview = useCallback(async () => {
    setAiLoading(true);
    setAiMessage('');
    try {
      const res = await fetch(`/api/clients/${clientId}/prospecting-profile/ai-review`, { method: 'POST' });
      const data = await res.json();
      setAiMessage(data.error || 'Review triggered');
    } finally {
      setAiLoading(false);
    }
  }, [clientId]);

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Prospecting Profile</h1>
          <p className="text-sm text-gray-500 mt-1">{clientName}</p>
        </div>
        {globalLastUpdated && (
          <span className="text-xs text-gray-400 mt-2">Last updated {formatDate(globalLastUpdated)}</span>
        )}
      </div>

      {/* Error banner */}
      {saveError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-500" />
          <div className="flex-1">
            <p className="font-medium">Save failed</p>
            <p className="text-xs mt-0.5">{saveError}</p>
          </div>
          <button type="button" onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── 1. Propositions ────────────────────────────────────────────── */}
      <SectionCard
        title="Propositions"
        count={propositions.filter((p) => p.status === 'active').length}
        lastUpdated={propositions.reduce((latest, p) => p.lastUpdatedAt > latest ? p.lastUpdatedAt : latest, '')}
      >
        <div className="mt-4 space-y-6">
          {Object.entries(propsByCategory).map(([cat, props]) => (
            <div key={cat}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-3">
                {resolveLabel(cat, categories)}
              </h3>
              <div className="space-y-2">
                {props.map((p) => {
                  const linkedCampaigns = campaigns.filter((c) => c.propositionRefs?.includes(p.id));
                  const isEditingThisProp = editingPropId === p.id && showPropForm;
                  return (
                  <div key={p.id} className="rounded-lg border border-gray-200 px-4 py-3">
                    {isEditingThisProp && canEditPropositions(userRole) ? (
                      /* ─── INLINE PROPOSITION EDIT FORM ─── */
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-gray-600">Name</label>
                          <div className="flex items-center gap-2">
                            <input className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                              value={propForm.name} maxLength={80}
                              onChange={(e) => setPropForm({ ...propForm, name: e.target.value })}
                              placeholder="E.g. MedEd/MedComms, Performance Marketing" />
                            <span className="text-xs text-gray-400">{propForm.name.length}/80</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600">Category</label>
                          <select className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                            value={propForm.category}
                            onChange={(e) => setPropForm({ ...propForm, category: e.target.value })}>
                            <option value="">Select category…</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600">Description</label>
                          <div className="flex items-center gap-2">
                            <textarea className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm" rows={2}
                              value={propForm.description} maxLength={280}
                              onChange={(e) => setPropForm({ ...propForm, description: e.target.value })}
                              placeholder="Additional context" />
                            <span className="text-xs text-gray-400">{propForm.description.length}/280</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" disabled={saving || !propForm.name.trim()}
                            className="px-4 py-1.5 rounded-full text-sm font-medium text-white bg-[#004156] hover:bg-[#003040] disabled:opacity-50"
                            onClick={() => saveProp(true)}>
                            {saving ? 'Saving…' : 'Update'}
                          </button>
                          <button type="button" className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-600 bg-gray-200 hover:bg-gray-300"
                            onClick={() => { setShowPropForm(false); setEditingPropId(null); setPropForm({ name: '', category: '', description: '' }); }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                    <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`h-2 w-2 rounded-full ${p.status === 'active' ? 'bg-green-500' : p.status === 'draft' ? 'bg-amber-400' : 'bg-gray-300'}`} />
                        <div>
                          <span className="text-sm font-medium text-gray-900">{p.name}</span>
                          {p.status === 'draft' && p.suggestedCategory && (
                            <span className="ml-2 text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
                              Suggested: {resolveLabel(p.suggestedCategory, categories)}
                            </span>
                          )}
                          {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}
                          {/* Change 2: UID resolution metadata */}
                          {p.createdBy && (
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              Added by {resolveUser(p.createdBy, userMap)}{p.createdAt ? ` on ${formatDateFull(p.createdAt)}` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge {...PROPOSITION_STATUS_CONFIG[p.status]} />
                        {/* Change 3: Promote draft to active (internal only) */}
                        {p.status === 'draft' && canEditPropositions(userRole) && (
                          <button type="button" className="p-1 text-green-500 hover:text-green-700" title="Promote to Active"
                            onClick={() => togglePropStatus({ ...p, status: 'inactive' })}>
                            <CheckCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canEditPropositions(userRole) && (
                        <>
                          <button
                            type="button"
                            className="p-1 text-gray-400 hover:text-gray-600"
                            onClick={() => {
                              setEditingPropId(p.id);
                              setPropForm({ name: p.name, category: p.category, description: p.description });
                              setShowPropForm(true);
                            }}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="p-1 text-gray-400 hover:text-gray-600"
                            onClick={() => togglePropStatus(p)}
                          >
                            {p.status === 'active' ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                          </button>
                        </>
                      )}
                      </div>
                    </div>
                    {/* Change 6: Campaign cross-link chips (expandable) */}
                    {/* ICP Summary Line (collapsed view) */}
                    {(() => {
                      const icp = p.icp || emptyICP;
                      const dims: string[] = [];
                      const maxPerDim = 2;
                      if (icp.industries.managedListRefs.length > 0) {
                        const labels = icp.industries.managedListRefs.slice(0, maxPerDim).map((id: string) => resolveLabel(id, managedLists.sectors || []));
                        if (icp.industries.managedListRefs.length > maxPerDim) labels.push(`+${icp.industries.managedListRefs.length - maxPerDim}`);
                        dims.push(labels.join(', '));
                      }
                      if (icp.titles.managedListRefs.length > 0) {
                        const labels = icp.titles.managedListRefs.slice(0, maxPerDim).map((id: string) => resolveLabel(id, managedLists.titleBands || []));
                        if (icp.titles.managedListRefs.length > maxPerDim) labels.push(`+${icp.titles.managedListRefs.length - maxPerDim}`);
                        dims.push(labels.join(', '));
                      }
                      if (icp.geographies.managedListRefs.length > 0) {
                        const labels = icp.geographies.managedListRefs.slice(0, maxPerDim).map((id: string) => resolveLabel(id, managedLists.geographies || []));
                        if (icp.geographies.managedListRefs.length > maxPerDim) labels.push(`+${icp.geographies.managedListRefs.length - maxPerDim}`);
                        dims.push(labels.join(', '));
                      }
                      if (icp.companySizing.length > 0) {
                        dims.push(icp.companySizing.map((s: CompanySizingEntry) => s.label).slice(0, 1).join(', '));
                      }
                      const hasIcpData = dims.length > 0;
                      const isExpanded = expandedPropIds.has(p.id);
                      const icpStatusDot = p.icpStatus === 'active' ? 'bg-green-500' : p.icpStatus === 'draft' ? 'bg-amber-400' : 'bg-gray-300';
                      const icpStatusLabel = p.icpStatus === 'active' ? 'ICP: Active' : p.icpStatus === 'draft' ? 'ICP: Draft' : 'No ICP defined';
                      return (
                        <>
                          {/* ICP status dot + summary */}
                          <div className="flex items-center gap-2 mt-2 ml-5">
                            <span className={`h-2 w-2 rounded-full ${icpStatusDot}`} title={icpStatusLabel} />
                            {p.icpStatus && (
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${p.icpStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                ICP {p.icpStatus === 'active' ? 'Active' : 'Draft'}
                              </span>
                            )}
                            {hasIcpData ? (
                              <span className="text-xs text-gray-500 truncate">{dims.join(' · ')}</span>
                            ) : (
                              <span className="text-xs text-gray-400 italic">
                                No ICP defined —{' '}
                                <button type="button" className="text-[#004156] hover:underline font-medium"
                                  onClick={() => setExpandedPropIds((prev) => { const next = new Set(prev); next.add(p.id); return next; })}>
                                  Define ICP
                                </button>
                              </span>
                            )}
                            {linkedCampaigns.length > 0 && (
                              <button type="button"
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#E1F5EE] text-[#085041] hover:bg-[#C9EDE0] transition-colors ml-auto"
                                onClick={() => setExpandedPropIds((prev) => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}>
                                <Link2 className="h-3 w-3" /> {linkedCampaigns.length} campaign{linkedCampaigns.length > 1 ? 's' : ''}
                              </button>
                            )}
                            <button type="button" className="ml-auto text-gray-400 hover:text-gray-600 p-0.5"
                              onClick={() => setExpandedPropIds((prev) => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}>
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </div>

                          {/* ─── EXPANDED: ICP Details + Campaigns ─── */}
                          {isExpanded && (
                            <div className="mt-3 ml-5 border-t border-gray-100 pt-3 space-y-4">
                              {/* ICP Section */}
                              {editingIcpPropId === p.id ? (
                                /* ICP EDIT MODE — inline */
                                <div className="space-y-4">
                                  <div>
                                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Industries</label>
                                    <select multiple className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm min-h-[80px]"
                                      value={icpDraft.industries.managedListRefs}
                                      onChange={(e) => { const vals = Array.from(e.target.selectedOptions, (o: HTMLOptionElement) => o.value); setIcpDraft({ ...icpDraft, industries: { ...icpDraft.industries, managedListRefs: vals } }); }}>
                                      {(managedLists.sectors || []).filter((s: ManagedListItem) => s.active).map((s: ManagedListItem) => (
                                        <option key={s.id} value={s.id}>{s.label}</option>
                                      ))}
                                    </select>
                                    <textarea className="w-full mt-2 rounded-lg border border-gray-200 bg-[#F5F9FA] px-3 py-2 text-sm italic placeholder:text-gray-400"
                                      placeholder="Add details or suggest values not in the list above." rows={2} maxLength={500}
                                      value={icpDraft.industries.specifics}
                                      onChange={(e) => setIcpDraft({ ...icpDraft, industries: { ...icpDraft.industries, specifics: e.target.value } })} />
                                  </div>
                                  <div>
                                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Target Titles</label>
                                    <select multiple className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm min-h-[80px]"
                                      value={icpDraft.titles.managedListRefs}
                                      onChange={(e) => { const vals = Array.from(e.target.selectedOptions, (o: HTMLOptionElement) => o.value); setIcpDraft({ ...icpDraft, titles: { ...icpDraft.titles, managedListRefs: vals } }); }}>
                                      {(managedLists.titleBands || []).filter((t: ManagedListItem) => t.active).map((t: ManagedListItem) => (
                                        <option key={t.id} value={t.id}>{t.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Geographies</label>
                                    <select multiple className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm min-h-[80px]"
                                      value={icpDraft.geographies.managedListRefs}
                                      onChange={(e) => { const vals = Array.from(e.target.selectedOptions, (o: HTMLOptionElement) => o.value); setIcpDraft({ ...icpDraft, geographies: { ...icpDraft.geographies, managedListRefs: vals } }); }}>
                                      {(managedLists.geographies || []).filter((g: ManagedListItem) => g.active).map((g: ManagedListItem) => (
                                        <option key={g.id} value={g.id}>{g.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Buying Process</label>
                                    <select className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                                      value={icpDraft.buyingProcess.type}
                                      onChange={(e) => setIcpDraft({ ...icpDraft, buyingProcess: { ...icpDraft.buyingProcess, type: e.target.value as BuyingProcessType } })}>
                                      <option value="">Select…</option>
                                      {Object.entries(BUYING_PROCESS_CONFIG).map(([k, v]) => (
                                        <option key={k} value={k}>{v.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="flex gap-2 pt-2">
                                    <button type="button" disabled={saving}
                                      className="px-4 py-1.5 rounded-full text-sm font-medium text-white bg-[#004156] hover:bg-[#003040] disabled:opacity-50"
                                      onClick={() => savePropositionICP(p.id)}>
                                      {saving ? 'Saving…' : 'Save ICP'}
                                    </button>
                                    <button type="button" className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-600 bg-gray-200 hover:bg-gray-300"
                                      onClick={() => { setEditingIcpPropId(null); setIcpDraft(emptyICP); }}>
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                /* ICP READ MODE — inline */
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Ideal Client Profile</h4>
                                    {p.icpStatus && isInternal(userRole) && (
                                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${p.icpStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                        ICP {p.icpStatus}
                                      </span>
                                    )}
                                  </div>
                                  {icp.industries.managedListRefs.length > 0 && (
                                    <div>
                                      <h5 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Industries</h5>
                                      <div className="flex flex-wrap gap-1.5">
                                        {icp.industries.managedListRefs.map((id: string) => <TagPill key={id} label={resolveLabel(id, managedLists.sectors || [])} />)}
                                      </div>
                                    </div>
                                  )}
                                  {icp.titles.managedListRefs.length > 0 && (
                                    <div>
                                      <h5 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Target Titles</h5>
                                      <div className="flex flex-wrap gap-1.5">
                                        {icp.titles.managedListRefs.map((id: string) => <TagPill key={id} label={resolveLabel(id, managedLists.titleBands || [])} />)}
                                      </div>
                                    </div>
                                  )}
                                  {icp.geographies.managedListRefs.length > 0 && (
                                    <div>
                                      <h5 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Geographies</h5>
                                      <div className="flex flex-wrap gap-1.5">
                                        {icp.geographies.managedListRefs.map((id: string) => <TagPill key={id} label={resolveLabel(id, managedLists.geographies || [])} />)}
                                      </div>
                                    </div>
                                  )}
                                  {icp.companySizing.length > 0 && (
                                    <div>
                                      <h5 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Company Sizing</h5>
                                      {icp.companySizing.map((s: CompanySizingEntry, i: number) => (
                                        <div key={i} className="text-sm text-gray-700"><span className="font-medium">{s.label}:</span> {s.values.join(', ')}</div>
                                      ))}
                                    </div>
                                  )}
                                  {icp.buyingProcess.type && (
                                    <div>
                                      <h5 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Buying Process</h5>
                                      <p className="text-sm text-gray-700">{BUYING_PROCESS_CONFIG[icp.buyingProcess.type as BuyingProcessType]?.label || icp.buyingProcess.type}</p>
                                    </div>
                                  )}
                                  {!hasIcpData && <p className="text-sm text-gray-400 italic">No ICP data defined yet.</p>}
                                  {canEditICP(userRole) && (
                                    <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-[#004156] hover:text-[#003040]"
                                      onClick={() => { setIcpDraft(p.icp || emptyICP); setEditingIcpPropId(p.id); }}>
                                      <Edit2 className="h-3.5 w-3.5" /> {hasIcpData ? 'Edit ICP' : 'Define ICP'}
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Campaigns Section */}
                              <div className="border-t border-gray-100 pt-3">
                                <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                                  Campaigns {linkedCampaigns.length > 0 && <span className="text-gray-400 normal-case">({linkedCampaigns.length})</span>}
                                </h4>
                                {linkedCampaigns.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {linkedCampaigns.map((c) => (
                                      <a key={c.id} href={`/clients/${clientId}/campaigns/${c.id}`}
                                        className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-gray-50 transition-colors group">
                                        <span className="text-sm text-gray-700 group-hover:text-[#004156]">{c.campaignName}</span>
                                        <StatusBadge {...(PROPOSITION_STATUS_CONFIG[c.status as keyof typeof PROPOSITION_STATUS_CONFIG] || { label: c.status, colour: '#666', bgColour: '#f0f0f0' })} />
                                      </a>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-400 italic">No campaigns linked to this proposition</p>
                                )}
                                <a href={`/clients/${clientId}/campaigns/new?proposition=${p.id}`}
                                  className="flex items-center gap-1.5 text-sm font-medium text-[#004156] hover:text-[#003040] mt-2">
                                  <Plus className="h-4 w-4" /> Create Campaign
                                </a>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                    </>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}

          {propositions.length === 0 && !showPropForm && (
            <p className="text-sm text-gray-400 italic">No propositions defined yet.</p>
          )}

          {propositions.length >= 5 && (
            <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-4 py-3 text-xs text-blue-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              Most clients define 3–5 propositions. Consider whether these could be grouped at a higher level.
            </div>
          )}

          {/* Proposition form (create only — edits now happen inline) */}
          {showPropForm && !editingPropId && canEditPropositions(userRole) && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Name</label>
                <div className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                    value={propForm.name}
                    maxLength={80}
                    onChange={(e) => setPropForm({ ...propForm, name: e.target.value })}
                    placeholder="E.g. MedEd/MedComms, Performance Marketing"
                  />
                  <span className="text-xs text-gray-400">{propForm.name.length}/80</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Category</label>
                <select
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  value={propForm.category}
                  onChange={(e) => setPropForm({ ...propForm, category: e.target.value })}
                >
                  <option value="">Select category…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Description</label>
                <div className="flex items-center gap-2">
                  <textarea
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                    rows={2}
                    value={propForm.description}
                    maxLength={280}
                    onChange={(e) => setPropForm({ ...propForm, description: e.target.value })}
                    placeholder="Additional context"
                  />
                  <span className="text-xs text-gray-400">{propForm.description.length}/280</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving || !propForm.name.trim()}
                  className="px-4 py-1.5 rounded-full text-sm font-medium text-white bg-[#004156] hover:bg-[#003040] disabled:opacity-50"
                  onClick={() => saveProp(!!editingPropId)}
                >
                  {saving ? 'Saving…' : editingPropId ? 'Update' : 'Create'}
                </button>
                <button
                  type="button"
                  className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-600 bg-gray-200 hover:bg-gray-300"
                  onClick={() => { setShowPropForm(false); setEditingPropId(null); setPropForm({ name: '', category: '', description: '' }); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!showPropForm && canEditPropositions(userRole) && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm font-medium text-[#004156] hover:text-[#003040]"
              onClick={() => { setShowPropForm(true); setEditingPropId(null); setPropForm({ name: '', category: '', description: '' }); }}
            >
              <Plus className="h-4 w-4" /> Add Proposition
            </button>
          )}

          {/* Change 3: Client-approver can suggest a proposition (creates as draft) */}
          {!showPropForm && canSuggestPropositions(userRole) && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm font-medium text-[#004156] hover:text-[#003040]"
              onClick={() => { setShowPropForm(true); setEditingPropId(null); setPropForm({ name: '', category: '', description: '' }); }}
            >
              <Plus className="h-4 w-4" /> Suggest Proposition
            </button>
          )}
          {showPropForm && canSuggestPropositions(userRole) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3">
              <p className="text-xs text-amber-700 font-medium">Suggest a new proposition — it will be created as a draft for the Angsana team to review.</p>
              <div>
                <label className="text-xs font-medium text-gray-600">Proposition Name</label>
                <div className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                    value={propForm.name}
                    maxLength={80}
                    onChange={(e) => setPropForm({ ...propForm, name: e.target.value })}
                    placeholder="What would you like to call this proposition?"
                  />
                  <span className="text-xs text-gray-400">{propForm.name.length}/80</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Suggested Category <span className="text-gray-400">(optional)</span></label>
                <select
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  value={propForm.category}
                  onChange={(e) => setPropForm({ ...propForm, category: e.target.value })}
                >
                  <option value="">Select category…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Description / Rationale</label>
                <div className="flex items-center gap-2">
                  <textarea
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                    rows={2}
                    value={propForm.description}
                    maxLength={280}
                    onChange={(e) => setPropForm({ ...propForm, description: e.target.value })}
                    placeholder="Why should this be a proposition?"
                  />
                  <span className="text-xs text-gray-400">{propForm.description.length}/280</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving || !propForm.name.trim()}
                  className="px-4 py-1.5 rounded-full text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                  onClick={async () => {
                    setSaving(true);
                    setSaveError(null);
                    try {
                      const res = await fetch(`/api/clients/${clientId}/propositions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...propForm, status: 'draft', suggestedCategory: propForm.category }),
                      });
                      if (res.ok) {
                        setShowPropForm(false);
                        setPropForm({ name: '', category: '', description: '' });
                        await refreshPropositions();
                        router.refresh();
                      } else {
                        const errBody = await res.json().catch(() => ({}));
                        setSaveError(`Suggest failed: ${errBody.error || res.statusText}`);
                      }
                    } catch (err) {
                      setSaveError(`Suggest error: ${err instanceof Error ? err.message : String(err)}`);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? 'Submitting…' : 'Submit Suggestion'}
                </button>
                <button
                  type="button"
                  className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-600 bg-gray-200 hover:bg-gray-300"
                  onClick={() => { setShowPropForm(false); setPropForm({ name: '', category: '', description: '' }); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── 2. Market Messaging Library ─────────────────────────────────── */}
      <SectionCard
        title="Market Messaging Library"
        count={profile.marketMessaging.length}
      >
        <div className="mt-4 space-y-3">
          {profile.marketMessaging.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-gray-200 px-4 py-3">
              {editingMsgId === entry.id ? (
                /* ─── Messaging INLINE EDIT ─── */
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600">Title</label>
                    <input className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" maxLength={120}
                      value={msgForm.title} onChange={(e) => setMsgForm({ ...msgForm, title: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">Type</label>
                    <select className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                      value={msgForm.type} onChange={(e) => setMsgForm({ ...msgForm, type: e.target.value })}>
                      <option value="">Select…</option>
                      {messagingTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">Content</label>
                    <textarea className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" rows={3} maxLength={500}
                      value={msgForm.content} onChange={(e) => setMsgForm({ ...msgForm, content: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">External URL</label>
                    <input className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                      value={msgForm.externalUrl} onChange={(e) => setMsgForm({ ...msgForm, externalUrl: e.target.value })} placeholder="https://…" />
                  </div>
                  {isInternal(userRole) && (
                    <div>
                      <label className="text-xs font-medium text-gray-600">Internal Notes</label>
                      <textarea className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" rows={2} maxLength={280}
                        value={msgForm.notes} onChange={(e) => setMsgForm({ ...msgForm, notes: e.target.value })} />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button type="button" disabled={saving || !msgForm.title.trim()}
                      className="px-4 py-1.5 rounded-full text-sm font-medium text-white bg-[#004156] hover:bg-[#003040] disabled:opacity-50"
                      onClick={saveEditedMsg}>
                      {saving ? 'Saving…' : 'Update'}
                    </button>
                    <button type="button" className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-600 bg-gray-200 hover:bg-gray-300"
                      onClick={cancelEditMsg}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* ─── Messaging READ ─── */
                <>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        {resolveLabel(entry.type, messagingTypes)}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{entry.title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.externalUrl && (
                        <a href={entry.externalUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {entry.documentRef && (
                        <span className="text-gray-400"><FileText className="h-3.5 w-3.5" /></span>
                      )}
                      {canEditMessaging(userRole) && (
                        <>
                          <button type="button" className="text-gray-400 hover:text-gray-600" onClick={() => startEditMsg(entry)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" className="text-red-400 hover:text-red-600" onClick={() => removeMessagingEntry(entry.id)}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {entry.content && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">{entry.content}</p>
                  )}
                  {entry.propositionRefs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {entry.propositionRefs.map((pId) => {
                        const prop = propositions.find((p) => p.id === pId);
                        return prop ? <TagPill key={pId} label={prop.name} variant="mauve" /> : null;
                      })}
                    </div>
                  )}
                  {isInternal(userRole) && entry.notes && (
                    <p className="text-xs text-gray-500 mt-2 border-t border-gray-100 pt-2 italic">{entry.notes}</p>
                  )}
                </>
              )}
            </div>
          ))}

          {profile.marketMessaging.length === 0 && !showMsgForm && (
            <p className="text-sm text-gray-400 italic">No messaging entries yet.</p>
          )}

          {profile.marketMessaging.length >= 8 && (
            <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-4 py-3 text-xs text-blue-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              The Market Messaging Library works best as a focused set of reference material. For bulk document storage, use the Documents module.
            </div>
          )}

          {showMsgForm && canEditMessaging(userRole) && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Title</label>
                <input className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" maxLength={120}
                  value={msgForm.title} onChange={(e) => setMsgForm({ ...msgForm, title: e.target.value })} placeholder="E.g. Elevator Pitch — MedComms" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Type</label>
                <select className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  value={msgForm.type} onChange={(e) => setMsgForm({ ...msgForm, type: e.target.value })}>
                  <option value="">Select…</option>
                  {messagingTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Content</label>
                <textarea className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" rows={3} maxLength={500}
                  value={msgForm.content} onChange={(e) => setMsgForm({ ...msgForm, content: e.target.value })} placeholder="Message text (for short items)" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">External URL</label>
                <input className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  value={msgForm.externalUrl} onChange={(e) => setMsgForm({ ...msgForm, externalUrl: e.target.value })} placeholder="https://…" />
              </div>
              {isInternal(userRole) && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Internal Notes</label>
                  <textarea className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" rows={2} maxLength={280}
                    value={msgForm.notes} onChange={(e) => setMsgForm({ ...msgForm, notes: e.target.value })} placeholder="Internal annotation" />
                </div>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={saving || !msgForm.title.trim()}
                  className="px-4 py-1.5 rounded-full text-sm font-medium text-white bg-[#004156] hover:bg-[#003040] disabled:opacity-50"
                  onClick={addMessagingEntry}>
                  {saving ? 'Saving…' : 'Add Entry'}
                </button>
                <button type="button" className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-600 bg-gray-200 hover:bg-gray-300"
                  onClick={() => { setShowMsgForm(false); setMsgForm({ title: '', type: '', content: '', documentRef: '', externalUrl: '', notes: '', propositionRefs: [] }); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!showMsgForm && canEditMessaging(userRole) && (
            <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-[#004156] hover:text-[#003040]"
              onClick={() => setShowMsgForm(true)}>
              <Plus className="h-4 w-4" /> Add Messaging Entry
            </button>
          )}
        </div>
      </SectionCard>

      {/* ── 3. Angsana Recommendations (internal only) ─────────────────── */}
      {isInternal(userRole) && (
        <SectionCard
          title="Angsana Recommendations"
          count={profile.recommendations.length}
          badge={<span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">Internal</span>}
        >
          <div className="mt-4 space-y-3">
            {profile.recommendations.map((rec) => (
              <div key={rec.id} className="rounded-lg border border-gray-200 px-4 py-3">
                {editingRecId === rec.id ? (
                  /* ─── Recommendation INLINE EDIT ─── */
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600">Recommendation</label>
                      <textarea className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" rows={2} maxLength={280}
                        value={recForm.recommendation} onChange={(e) => setRecForm({ ...recForm, recommendation: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Rationale</label>
                      <textarea className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" rows={2} maxLength={500}
                        value={recForm.rationale} onChange={(e) => setRecForm({ ...recForm, rationale: e.target.value })} />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" disabled={saving || !recForm.recommendation.trim()}
                        className="px-4 py-1.5 rounded-full text-sm font-medium text-white bg-[#004156] hover:bg-[#003040] disabled:opacity-50"
                        onClick={saveEditedRec}>
                        {saving ? 'Saving…' : 'Update'}
                      </button>
                      <button type="button" className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-600 bg-gray-200 hover:bg-gray-300"
                        onClick={cancelEditRec}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ─── Recommendation READ ─── */
                  <>
                    <div className="flex items-start justify-between">
                      <p className="text-sm text-gray-900 font-medium flex-1">{rec.recommendation}</p>
                      <div className="flex items-center gap-2 ml-3">
                        <StatusBadge {...RECOMMENDATION_STATUS_CONFIG[rec.status]} />
                        <select
                          className="text-xs rounded border border-gray-200 px-1 py-0.5"
                          value={rec.status}
                          onChange={(e) => updateRecStatus(rec.id, e.target.value as RecommendationStatus)}
                        >
                          <option value="proposed">Proposed</option>
                          <option value="accepted">Accepted</option>
                          <option value="superseded">Superseded</option>
                        </select>
                        {canEditRecommendations(userRole) && (
                          <button type="button" className="text-gray-400 hover:text-gray-600" onClick={() => startEditRec(rec)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {rec.rationale && (
                      <p className="text-sm text-gray-500 mt-2 italic">{rec.rationale}</p>
                    )}
                    {rec.propositionRefs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {rec.propositionRefs.map((pId) => {
                          const prop = propositions.find((p) => p.id === pId);
                          return prop ? <TagPill key={pId} label={prop.name} variant="mauve" /> : null;
                        })}
                      </div>
                    )}
                    {/* Change 5: UID resolution on recommendation metadata */}
                    {rec.createdBy && (
                      <p className="text-[11px] text-gray-400 mt-2 border-t border-gray-100 pt-2">
                        Added by {resolveUser(rec.createdBy, userMap)}{rec.createdAt ? ` on ${formatDateFull(rec.createdAt)}` : ''}
                        {rec.lastUpdatedBy && rec.lastUpdatedAt && rec.lastUpdatedAt !== rec.createdAt && (
                          <> · Updated by {resolveUser(rec.lastUpdatedBy, userMap)} on {formatDateFull(rec.lastUpdatedAt)}</>
                        )}
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}

            {profile.recommendations.length === 0 && !showRecForm && (
              <p className="text-sm text-gray-400 italic">No recommendations yet.</p>
            )}

            {showRecForm && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Recommendation</label>
                  <textarea className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" rows={2} maxLength={280}
                    value={recForm.recommendation} onChange={(e) => setRecForm({ ...recForm, recommendation: e.target.value })}
                    placeholder="Specific, actionable statement" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Rationale</label>
                  <textarea className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" rows={2} maxLength={500}
                    value={recForm.rationale} onChange={(e) => setRecForm({ ...recForm, rationale: e.target.value })}
                    placeholder="Why Angsana believes this" />
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={saving || !recForm.recommendation.trim()}
                    className="px-4 py-1.5 rounded-full text-sm font-medium text-white bg-[#004156] hover:bg-[#003040] disabled:opacity-50"
                    onClick={addRecommendation}>
                    {saving ? 'Saving…' : 'Add Recommendation'}
                  </button>
                  <button type="button" className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-600 bg-gray-200 hover:bg-gray-300"
                    onClick={() => { setShowRecForm(false); setRecForm({ recommendation: '', rationale: '', propositionRefs: [] }); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!showRecForm && canEditRecommendations(userRole) && (
              <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-[#004156] hover:text-[#003040]"
                onClick={() => setShowRecForm(true)}>
                <Plus className="h-4 w-4" /> Add Recommendation
              </button>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── 4. AI Review (internal only, placeholder) ──────────────────── */}
      {isInternal(userRole) && (
        <SectionCard
          title="AI Review"
          badge={<span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">Internal</span>}
        >
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={aiLoading}
                className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
                onClick={triggerAIReview}
              >
                <Bot className="h-4 w-4" />
                {aiLoading ? 'Requesting…' : 'Request AI Review'}
              </button>
              <span className="text-xs text-gray-400">
                {profile.aiReview.lastReviewDate
                  ? `Last reviewed: ${formatDate(profile.aiReview.lastReviewDate)}`
                  : 'No reviews yet'}
              </span>
            </div>
            {aiMessage && (
              <div className="text-sm text-amber-700 bg-amber-100 rounded-lg px-3 py-2">{aiMessage}</div>
            )}
            {profile.aiReview.findings.length > 0 && (
              <div className="space-y-1">
                {profile.aiReview.findings.map((f, i) => (
                  <p key={i} className="text-sm text-gray-700">{f}</p>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
