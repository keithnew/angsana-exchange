'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Plus, Edit2, X, Check, ExternalLink, FileText, AlertTriangle, Bot, Link2 } from 'lucide-react';
import type {
  Proposition, ProspectingProfile, ManagedListItem, UserRole,
  PropositionStatus, ICP, MarketMessagingEntry, Recommendation,
  RecommendationStatus, CompanySizingEntry, ICPExclusion, BuyingProcessType,
} from '@/types';
import {
  PROPOSITION_STATUS_CONFIG, RECOMMENDATION_STATUS_CONFIG, BUYING_PROCESS_CONFIG,
} from '@/types';

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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const isInternal = (role: UserRole) => role === 'internal-admin' || role === 'internal-user';
const canEditPropositions = (role: UserRole) => isInternal(role);
const canEditICP = (role: UserRole) => isInternal(role) || role === 'client-approver';
const canEditMessaging = (role: UserRole) => isInternal(role) || role === 'client-approver';
const canEditRecommendations = (role: UserRole) => isInternal(role);

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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
  managedLists, userRole, userUid, userEmail,
}: Props) {
  const router = useRouter();
  const [propositions, setPropositions] = useState(initialPropositions);
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
  const allDates = [
    profile.lastUpdatedAt,
    profile.icp.lastUpdatedAt,
    ...propositions.map((p) => p.lastUpdatedAt),
  ].filter(Boolean);
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

  // ─── ICP ─────────────────────────────────────────────────────────────────
  const [editingICP, setEditingICP] = useState(false);
  const [icpDraft, setIcpDraft] = useState<ICP>(profile.icp);

  const saveICP = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/prospecting-profile/icp`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(icpDraft),
      });
      if (res.ok) {
        // Optimistic update
        setProfile((prev) => ({ ...prev, icp: { ...icpDraft, lastUpdatedBy: userUid, lastUpdatedAt: new Date().toISOString() } }));
        setEditingICP(false);
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
                {props.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`h-2 w-2 rounded-full ${p.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <div>
                        <span className="text-sm font-medium text-gray-900">{p.name}</span>
                        {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge {...PROPOSITION_STATUS_CONFIG[p.status]} />
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
                ))}
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

          {/* Proposition form (create/edit) */}
          {showPropForm && canEditPropositions(userRole) && (
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
        </div>
      </SectionCard>

      {/* ── 2. Ideal Client Profile ────────────────────────────────────── */}
      <SectionCard
        title="Ideal Client Profile"
        lastUpdated={profile.icp.lastUpdatedAt}
      >
        <div className="mt-4 space-y-5">
          {editingICP ? (
            /* ─── ICP EDIT MODE ─── */
            <div className="space-y-5">
              {/* Industries */}
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Industries</label>
                <select
                  multiple
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm min-h-[80px]"
                  value={icpDraft.industries.managedListRefs}
                  onChange={(e) => {
                    const vals = Array.from(e.target.selectedOptions, (o) => o.value);
                    setIcpDraft({ ...icpDraft, industries: { ...icpDraft.industries, managedListRefs: vals } });
                  }}
                >
                  {(managedLists.sectors || []).filter((s) => s.active).map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <textarea
                  className="w-full mt-2 rounded-lg border border-gray-200 bg-[#F5F9FA] px-3 py-2 text-sm italic placeholder:text-gray-400"
                  placeholder="Add details or suggest values not in the list above."
                  rows={2}
                  maxLength={500}
                  value={icpDraft.industries.specifics}
                  onChange={(e) => setIcpDraft({ ...icpDraft, industries: { ...icpDraft.industries, specifics: e.target.value } })}
                />
              </div>

              {/* Company Sizing */}
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Company Sizing</label>
                {icpDraft.companySizing.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 mt-2 rounded-lg border border-gray-200 px-3 py-2">
                    <input
                      className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      placeholder="Label (e.g. Annual Revenue)"
                      value={entry.label}
                      onChange={(e) => {
                        const updated = [...icpDraft.companySizing];
                        const label = e.target.value;
                        let type = entry.type;
                        if (label.toLowerCase().includes('revenue')) type = 'revenue';
                        else if (label.toLowerCase().includes('headcount') || label.toLowerCase().includes('employees')) type = 'headcount';
                        else if (label.toLowerCase().includes('tier')) type = 'tier';
                        else type = 'custom';
                        updated[i] = { ...entry, label, type };
                        setIcpDraft({ ...icpDraft, companySizing: updated });
                      }}
                    />
                    <input
                      className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      placeholder="Values (comma-separated)"
                      value={entry.values.join(', ')}
                      onChange={(e) => {
                        const updated = [...icpDraft.companySizing];
                        updated[i] = { ...entry, values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) };
                        setIcpDraft({ ...icpDraft, companySizing: updated });
                      }}
                    />
                    <button type="button" className="text-red-400 hover:text-red-600" onClick={() => {
                      setIcpDraft({ ...icpDraft, companySizing: icpDraft.companySizing.filter((_, j) => j !== i) });
                    }}><X className="h-4 w-4" /></button>
                  </div>
                ))}
                <button
                  type="button"
                  className="mt-2 text-sm text-[#004156] hover:underline flex items-center gap-1"
                  onClick={() => setIcpDraft({ ...icpDraft, companySizing: [...icpDraft.companySizing, { type: 'custom', label: '', values: [] }] })}
                >
                  <Plus className="h-3.5 w-3.5" /> Add sizing criteria
                </button>
              </div>

              {/* Titles */}
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Target Titles</label>
                <select
                  multiple
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm min-h-[80px]"
                  value={icpDraft.titles.managedListRefs}
                  onChange={(e) => {
                    const vals = Array.from(e.target.selectedOptions, (o) => o.value);
                    setIcpDraft({ ...icpDraft, titles: { ...icpDraft.titles, managedListRefs: vals } });
                  }}
                >
                  {(managedLists.titleBands || []).filter((t) => t.active).map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
                <textarea
                  className="w-full mt-2 rounded-lg border border-gray-200 bg-[#F5F9FA] px-3 py-2 text-sm italic placeholder:text-gray-400"
                  placeholder="Add details or suggest values not in the list above."
                  rows={2} maxLength={500}
                  value={icpDraft.titles.specifics}
                  onChange={(e) => setIcpDraft({ ...icpDraft, titles: { ...icpDraft.titles, specifics: e.target.value } })}
                />
              </div>

              {/* Buying Process */}
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Buying Process</label>
                <select
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  value={icpDraft.buyingProcess.type}
                  onChange={(e) => setIcpDraft({ ...icpDraft, buyingProcess: { ...icpDraft.buyingProcess, type: e.target.value as BuyingProcessType } })}
                >
                  <option value="">Select…</option>
                  {Object.entries(BUYING_PROCESS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <textarea
                  className="w-full mt-2 rounded-lg border border-gray-200 bg-[#F5F9FA] px-3 py-2 text-sm italic placeholder:text-gray-400"
                  placeholder="Notes on buying process"
                  rows={2} maxLength={500}
                  value={icpDraft.buyingProcess.notes}
                  onChange={(e) => setIcpDraft({ ...icpDraft, buyingProcess: { ...icpDraft.buyingProcess, notes: e.target.value } })}
                />
              </div>

              {/* Geographies */}
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Geographies</label>
                <select
                  multiple
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm min-h-[80px]"
                  value={icpDraft.geographies.managedListRefs}
                  onChange={(e) => {
                    const vals = Array.from(e.target.selectedOptions, (o) => o.value);
                    setIcpDraft({ ...icpDraft, geographies: { ...icpDraft.geographies, managedListRefs: vals } });
                  }}
                >
                  {(managedLists.geographies || []).filter((g) => g.active).map((g) => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </select>
                <textarea
                  className="w-full mt-2 rounded-lg border border-gray-200 bg-[#F5F9FA] px-3 py-2 text-sm italic placeholder:text-gray-400"
                  placeholder="Add details or suggest values not in the list above."
                  rows={2} maxLength={500}
                  value={icpDraft.geographies.specifics}
                  onChange={(e) => setIcpDraft({ ...icpDraft, geographies: { ...icpDraft.geographies, specifics: e.target.value } })}
                />
              </div>

              {/* Exclusions */}
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Exclusions</label>
                {icpDraft.exclusions.map((exc, i) => (
                  <div key={i} className="flex items-center gap-2 mt-2">
                    <select
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={exc.category}
                      onChange={(e) => {
                        const updated = [...icpDraft.exclusions];
                        updated[i] = { ...exc, category: e.target.value };
                        setIcpDraft({ ...icpDraft, exclusions: updated });
                      }}
                    >
                      <option value="">Category…</option>
                      <option value="company size">Company Size</option>
                      <option value="sector">Sector</option>
                      <option value="geography">Geography</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      placeholder="Description"
                      maxLength={280}
                      value={exc.description}
                      onChange={(e) => {
                        const updated = [...icpDraft.exclusions];
                        updated[i] = { ...exc, description: e.target.value };
                        setIcpDraft({ ...icpDraft, exclusions: updated });
                      }}
                    />
                    <button type="button" className="text-red-400 hover:text-red-600" onClick={() => {
                      setIcpDraft({ ...icpDraft, exclusions: icpDraft.exclusions.filter((_, j) => j !== i) });
                    }}><X className="h-4 w-4" /></button>
                  </div>
                ))}
                <button
                  type="button"
                  className="mt-2 text-sm text-[#004156] hover:underline flex items-center gap-1"
                  onClick={() => setIcpDraft({ ...icpDraft, exclusions: [...icpDraft.exclusions, { category: '', description: '' }] })}
                >
                  <Plus className="h-3.5 w-3.5" /> Add exclusion
                </button>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving}
                  className="px-4 py-1.5 rounded-full text-sm font-medium text-white bg-[#004156] hover:bg-[#003040] disabled:opacity-50"
                  onClick={saveICP}
                >
                  {saving ? 'Saving…' : 'Save ICP'}
                </button>
                <button
                  type="button"
                  className="px-4 py-1.5 rounded-full text-sm font-medium text-gray-600 bg-gray-200 hover:bg-gray-300"
                  onClick={() => { setEditingICP(false); setIcpDraft(profile.icp); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* ─── ICP READ MODE ─── */
            <div className="space-y-4">
              {profile.icp.industries.managedListRefs.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Industries</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.icp.industries.managedListRefs.map((id) => (
                      <TagPill key={id} label={resolveLabel(id, managedLists.sectors || [])} />
                    ))}
                  </div>
                  {profile.icp.industries.specifics && (
                    <p className="text-sm text-gray-600 mt-1 bg-[#F5F9FA] rounded-lg px-3 py-2 italic">{profile.icp.industries.specifics}</p>
                  )}
                </div>
              )}

              {profile.icp.companySizing.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Company Sizing</h4>
                  {profile.icp.companySizing.map((s, i) => (
                    <div key={i} className="text-sm text-gray-700 mt-1">
                      <span className="font-medium">{s.label}:</span> {s.values.join(', ')}
                    </div>
                  ))}
                </div>
              )}

              {profile.icp.titles.managedListRefs.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Target Titles</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.icp.titles.managedListRefs.map((id) => (
                      <TagPill key={id} label={resolveLabel(id, managedLists.titleBands || [])} />
                    ))}
                  </div>
                  {profile.icp.titles.specifics && (
                    <p className="text-sm text-gray-600 mt-1 bg-[#F5F9FA] rounded-lg px-3 py-2 italic">{profile.icp.titles.specifics}</p>
                  )}
                </div>
              )}

              {profile.icp.buyingProcess.type && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Buying Process</h4>
                  <p className="text-sm text-gray-700">{BUYING_PROCESS_CONFIG[profile.icp.buyingProcess.type as BuyingProcessType]?.label || profile.icp.buyingProcess.type}</p>
                  {profile.icp.buyingProcess.notes && (
                    <p className="text-sm text-gray-600 mt-1 bg-[#F5F9FA] rounded-lg px-3 py-2 italic">{profile.icp.buyingProcess.notes}</p>
                  )}
                </div>
              )}

              {profile.icp.geographies.managedListRefs.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Geographies</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.icp.geographies.managedListRefs.map((id) => (
                      <TagPill key={id} label={resolveLabel(id, managedLists.geographies || [])} />
                    ))}
                  </div>
                  {profile.icp.geographies.specifics && (
                    <p className="text-sm text-gray-600 mt-1 bg-[#F5F9FA] rounded-lg px-3 py-2 italic">{profile.icp.geographies.specifics}</p>
                  )}
                </div>
              )}

              {profile.icp.exclusions.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Exclusions</h4>
                  {profile.icp.exclusions.map((e, i) => (
                    <div key={i} className="text-sm text-gray-700 mt-1">
                      <span className="font-medium capitalize">{e.category}:</span> {e.description}
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {!profile.icp.industries.managedListRefs.length && !profile.icp.companySizing.length &&
               !profile.icp.titles.managedListRefs.length && !profile.icp.buyingProcess.type &&
               !profile.icp.geographies.managedListRefs.length && !profile.icp.exclusions.length && (
                <p className="text-sm text-gray-400 italic">No ICP data defined yet.</p>
              )}

              {canEditICP(userRole) && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-sm font-medium text-[#004156] hover:text-[#003040]"
                  onClick={() => { setIcpDraft(profile.icp); setEditingICP(true); }}
                >
                  <Edit2 className="h-3.5 w-3.5" /> Edit ICP
                </button>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── 3. Market Messaging Library ─────────────────────────────────── */}
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

      {/* ── 4. Angsana Recommendations (internal only) ─────────────────── */}
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

      {/* ── 5. AI Review (internal only, placeholder) ──────────────────── */}
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
