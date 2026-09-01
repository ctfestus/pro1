"use client";

import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Download,
  FileCheck2,
  History,
  Layers3,
  ShieldAlert,
  LayoutDashboard,
  FileSpreadsheet,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Trash2,
  Star,
  Archive,
  Upload,
  UserPlus,
  Users,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  applyPlanContentChanges,
  describePlanContentResult,
  summarizePlanContentOutcomes,
  decideNewPlanActivation,
  type PlanContentChange,
  type PlanContentOutcome,
} from "@/lib/plan-content-request";
import { parseSubscriptionImportText } from "@/lib/subscription-import";
import { LIGHT_C, cardStyle, modalStyle } from "@/lib/theme";

const CONTENT_TYPES = [
  { value: "courses", label: "Course" },
  { value: "virtual_experiences", label: "Virtual Experience" },
  { value: "certifications", label: "Certification" },
  { value: "learning_paths", label: "Learning Path" },
];

const freshPayment = () => ({
  durationMonths: "1",
  amount: "",
  currency: "GHS",
  dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  paymentMethod: "",
  paymentReference: "",
  notes: "",
});

const PLAN_PRICE_DURATIONS = [1, 3, 6, 12] as const;

function freshPlanPrices() {
  return PLAN_PRICE_DURATIONS.map((durationMonths) => ({
    durationMonths: String(durationMonths),
    amount: "",
    currency: "GHS",
    isActive: false,
    sortOrder: durationMonths,
  }));
}

type Tab = "overview" | "subscribers" | "payments" | "plans" | "review";

async function authFetch(url: string, init?: RequestInit) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${session?.access_token}`,
    },
  });
}

function daysRemaining(value?: string | null) {
  return value
    ? Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000)
    : 0;
}

function dateLabel(value?: string | null) {
  return value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "--";
}

function money(currency: string, amount: number | string) {
  return `${currency || "GHS"} ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function Modal({
  title,
  eyebrow,
  onClose,
  C,
  children,
  error,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  C: typeof LIGHT_C;
  children: ReactNode;
  error?: string;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6"
      style={{ background: "rgba(4,8,20,0.68)", backdropFilter: "blur(10px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${wide ? "max-w-4xl" : "max-w-xl"} max-h-[92vh] overflow-hidden rounded-[28px] flex flex-col`}
        style={modalStyle(C)}
      >
        <div
          className="flex items-start justify-between gap-4 px-6 py-5"
          style={{ borderBottom: `1px solid ${C.divider}` }}
        >
          <div>
            {eyebrow && (
              <p
                className="text-[10px] font-bold uppercase tracking-[0.2em] mb-1"
                style={{ color: C.cta }}
              >
                {eyebrow}
              </p>
            )}
            <h3 className="text-lg font-bold" style={{ color: C.text }}>
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ background: C.pill }}
            aria-label="Close"
          >
            <X className="w-4 h-4" style={{ color: C.muted }} />
          </button>
        </div>
      <div className="p-6 overflow-y-auto">
        {error && (
          <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
            {error}
          </div>
        )}
        {children}
      </div>
      </div>
    </div>
  );
}

function StatusPill({ status, C }: { status: string; C: typeof LIGHT_C }) {
  const tone =
    status === "active" || status === "paid" || status === "approved"
      ? "#16a34a"
      : status === "confirmation_submitted" || status === "pending"
        ? "#d97706"
        : status === "cancelled" || status === "rejected"
          ? "#dc2626"
          : C.muted;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold capitalize"
      style={{ background: `${tone}14`, color: tone }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone }} />
      {status.replaceAll("_", " ")}
    </span>
  );
}

function PlanPriceFields({
  prices,
  setPrices,
  C,
  fieldClass,
  inputStyle,
}: {
  prices: ReturnType<typeof freshPlanPrices>;
  setPrices: Dispatch<SetStateAction<ReturnType<typeof freshPlanPrices>>>;
  C: typeof LIGHT_C;
  fieldClass: string;
  inputStyle: CSSProperties;
}) {
  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-bold" style={{ color: C.text }}>
            Purchase options
          </p>
          <p className="text-xs mt-1" style={{ color: C.faint }}>
            Turn on the durations learners can choose.
          </p>
        </div>
        <span className="text-[11px] font-bold rounded-full px-2.5 py-1" style={{ background: `${C.cta}12`, color: C.cta }}>
          {prices.filter((price) => price.isActive).length} active
        </span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {prices.map((price, index) => (
          <div
            key={price.durationMonths}
            className="rounded-2xl p-3.5 transition-all"
            style={{
              background: price.isActive ? `${C.cta}0c` : C.page,
              boxShadow: price.isActive ? `inset 0 0 0 1.5px ${C.cta}` : "none",
            }}
          >
            <label className="flex items-center justify-between gap-3 text-sm font-bold cursor-pointer" style={{ color: C.text }}>
              <span>{price.durationMonths} month{price.durationMonths === "1" ? "" : "s"}</span>
              <input
                type="checkbox"
                checked={price.isActive}
                onChange={(e) => setPrices((current) => current.map((row, i) => i === index ? { ...row, isActive: e.target.checked } : row))}
                className="sr-only peer"
              />
              <span
                className="relative w-10 h-6 rounded-full transition-colors after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
                style={{ background: price.isActive ? C.cta : C.divider }}
              />
            </label>
            <div className="grid grid-cols-[1fr_82px] gap-2 mt-3">
              <input
                type="number"
                min="0"
                step="0.01"
                value={price.amount}
                onChange={(e) => setPrices((current) => current.map((row, i) => i === index
                  ? { ...row, amount: e.target.value, isActive: Number(e.target.value) > 0 ? true : row.isActive }
                  : row))}
                placeholder="0.00"
                aria-label={`${price.durationMonths} month price`}
                className={fieldClass}
                style={inputStyle}
              />
              <input
                value={price.currency}
                onChange={(e) => setPrices((current) => current.map((row, i) => i === index ? { ...row, currency: e.target.value.toUpperCase() } : row))}
                aria-label={`${price.durationMonths} month currency`}
                className={fieldClass}
                style={inputStyle}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SubscriptionsSection({ C }: { C: typeof LIGHT_C }) {
  const dark = C.page === "#17181E";
  const [tab, setTab] = useState<Tab>("overview");
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [eligibleStudents, setEligibleStudents] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<any[]>([]);
  // Unfinished checkouts: a learner's cart. No payment request behind one, so it appears in no
  // receivables list, yet it blocks them from paying any other way until it closes.
  const [openCarts, setOpenCarts] = useState<any[]>([]);
  // Paystack items waiting on a person, and whether the job that revokes expired access is still
  // running. Neither has any other surface: until this list existed the only signal was an email.
  const [reviewQueue, setReviewQueue] = useState<any[]>([]);
  const [sweepHeartbeat, setSweepHeartbeat] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [assignMenuOpen, setAssignMenuOpen] = useState(false);
  const [assignMenuPosition, setAssignMenuPosition] = useState({
    top: 0,
    right: 12,
  });
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [enrolMode, setEnrolMode] = useState<"request" | "paid">("request");
  const [learnerMode, setLearnerMode] = useState<"existing" | "new">("existing");
  const [newLearnerName, setNewLearnerName] = useState("");
  const [newLearnerEmail, setNewLearnerEmail] = useState("");
  const [manageSub, setManageSub] = useState<any>(null);
  const [manageAction, setManageAction] = useState<
    "change-plan" | "request-payment" | "extend-access" | null
  >(null);
  const [subscriberMenu, setSubscriberMenu] = useState<{
    sub: any;
    top: number;
    right: number;
  } | null>(null);
  const [studentId, setStudentId] = useState("");
  const [planId, setPlanId] = useState("");
  const [payment, setPayment] = useState(freshPayment);
  const [paidAttemptKey, setPaidAttemptKey] = useState("");
  const [changePlanId, setChangePlanId] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{
    request: any;
    decision: "approve" | "reject";
  } | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [planContent, setPlanContent] = useState<any[]>([]);
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanDescription, setNewPlanDescription] = useState("");
  const [newPlanPrices, setNewPlanPrices] = useState(freshPlanPrices);
  const [newPlanContentKeys, setNewPlanContentKeys] = useState<string[]>([]);
  const [newPlanContentSearch, setNewPlanContentSearch] = useState("");
  const [planBuilderStep, setPlanBuilderStep] = useState<0 | 1 | 2>(0);
  const [unsavedPlanDialog, setUnsavedPlanDialog] = useState<"create" | "edit" | null>(null);
  const [planCardMenuId, setPlanCardMenuId] = useState<string | null>(null);
  const [showArchivedPlans, setShowArchivedPlans] = useState(false);
  /**
   * A batch waiting on an answer about open access, and the resolver that answer goes to. Held
   * as a promise so both save flows can simply await the person, rather than each growing its
   * own half of a modal.
   */
  const [closePublicAsk, setClosePublicAsk] = useState<
    { titles: string[]; resolve: (yes: boolean) => void } | null
  >(null);
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<any>(null);
  const [editPlanName, setEditPlanName] = useState("");
  const [editPlanDescription, setEditPlanDescription] = useState("");
  const [editPlanPrices, setEditPlanPrices] = useState(freshPlanPrices);
  const [contentOptions, setContentOptions] = useState<any[]>([]);
  const [selectedContentKeys, setSelectedContentKeys] = useState<string[]>([]);
  const [contentSearch, setContentSearch] = useState("");
  const [bulkPlan, setBulkPlan] = useState<any>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkRows, setBulkRows] = useState<any[]>([]);
  const [bulkMode, setBulkMode] = useState<"request" | "paid">("request");
  const [bulkAttemptKey, setBulkAttemptKey] = useState("");
  const [bulkDefaults, setBulkDefaults] = useState(freshPayment);
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [bulkError, setBulkError] = useState("");

  async function loadPlanContent(id: string) {
    const res = await authFetch(
      `/api/payments?action=subscription-plan-content&planId=${id}`,
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load plan content");
    setPlanContent(data.content ?? []);
    setSelectedContentKeys(
      (data.content ?? []).map(
        (item: any) => `${item.content_table}:${item.content_id}`,
      ),
    );
  }

  async function load(preferredPlanId?: string) {
    setLoading(true);
    setError("");
    try {
      const [listRes, plansRes, requestsRes, reviewRes] = await Promise.all([
        authFetch("/api/payments?action=subscription-list"),
        // Archived plans come down with the rest and are filtered for display, so the toggle
        // does not need a round trip and the counts stay honest.
        authFetch("/api/payments?action=subscription-plans&includeArchived=true"),
        authFetch("/api/payments?action=subscription-payment-requests"),
        authFetch("/api/payments?action=payment-review"),
      ]);
      const [listData, plansData, requestsData, reviewData] = await Promise.all([
        listRes.json(),
        plansRes.json(),
        requestsRes.json(),
        reviewRes.json(),
      ]);
      // Deliberately not fatal. The review list is a safety net, and failing to load it must not
      // take down the page an admin uses to run subscriptions.
      if (reviewRes.ok) {
        setReviewQueue(reviewData.items ?? []);
        setSweepHeartbeat(reviewData.heartbeat ?? null);
      }
      if (!listRes.ok)
        throw new Error(listData.error || "Failed to load subscriptions");
      if (!plansRes.ok)
        throw new Error(plansData.error || "Failed to load plans");
      if (!requestsRes.ok)
        throw new Error(
          requestsData.error || "Failed to load payment requests",
        );
      setSubscriptions(listData.subscriptions ?? []);
      setEligibleStudents(listData.eligibleStudents ?? []);
      setPlans(plansData.plans ?? []);
      setPaymentRequests(requestsData.requests ?? []);
      setOpenCarts(requestsData.carts ?? []);
      const next =
        (plansData.plans ?? []).find((p: any) => p.id === preferredPlanId) ??
        (selectedPlan &&
          (plansData.plans ?? []).find((p: any) => p.id === selectedPlan.id)) ??
        plansData.plans?.[0] ??
        null;
      setSelectedPlan(next);
      if (next) await loadPlanContent(next.id);
      else setPlanContent([]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function resolveIncident(item: any) {
    const resolutionNote = window.prompt("Optional resolution note", "");
    if (resolutionNote === null) return;
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve-paystack-incident",
          incidentId: item.id,
          resolutionNote,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to resolve payment incident");
      setReviewQueue((current) => current.filter((row) => row.id !== item.id));
      setSuccess("Payment incident marked as resolved.");
    } catch (err: any) {
      setError(err.message || "Failed to resolve payment incident");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // This initial load intentionally uses the mount-time selection state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (tab !== "plans") return;
    Promise.all(
      CONTENT_TYPES.map((type) =>
        supabase
          .from(type.value)
          // available_to_everyone comes too. Without it this screen cannot tell which items are
          // open to everyone, so it could not warn before closing that, and could not ask.
          .select("id,title,available_to_everyone")
          .eq("status", "published")
          .order("title"),
      ),
    ).then((results) =>
      setContentOptions(
        results.flatMap((result, index) =>
          (result.data ?? []).map((item) => ({
            ...item,
            content_table: CONTENT_TYPES[index].value,
          })),
        ),
      ),
    );
  }, [tab]);

  const activePlans = plans.filter((p) => p.status === "active");
  const active = subscriptions.filter(
    (s) => s.status === "active" && daysRemaining(s.current_period_end) >= 0,
  );
  const awaitingReview = paymentRequests.filter(
    (r) => r.status === "confirmation_submitted",
  );
  const awaitingStudent = paymentRequests.filter((r) => r.status === "pending");
  const overdue = paymentRequests.filter(
    (r) =>
      ["pending", "confirmation_submitted"].includes(r.status) &&
      new Date(`${r.due_date}T23:59:59`).getTime() < Date.now(),
  );
  const expiring = active
    .filter((s) => daysRemaining(s.current_period_end) <= 30)
    .sort(
      (a, b) =>
        +new Date(a.current_period_end) - +new Date(b.current_period_end),
    );
  const collectedByCurrency = paymentRequests
    .filter((r) => r.status === "paid")
    .reduce((totals: Record<string, number>, row) => {
      const currency = String(row.currency || "GHS").toUpperCase();
      totals[currency] = (totals[currency] || 0) + Number(row.amount);
      return totals;
    }, {});
  const collectedEntries = Object.entries(collectedByCurrency);
  const collectedValue = collectedEntries.length === 1
    ? money(collectedEntries[0][0], collectedEntries[0][1])
    : collectedEntries.length > 1 ? `${collectedEntries.length} currencies` : money("GHS", 0);
  const collectedDetail = collectedEntries.length > 1
    ? collectedEntries.map(([currency, amount]) => money(currency, amount)).join(" | ")
    : "Approved requests";
  const filtered = useMemo(
    () =>
      subscriptions.filter((sub) => {
        const term =
          `${sub.students?.full_name || ""} ${sub.students?.email || ""}`.toLowerCase();
        return (
          (!search || term.includes(search.toLowerCase())) &&
          (statusFilter === "all" || sub.status === statusFilter) &&
          (planFilter === "all" || sub.plan_id === planFilter)
        );
      }),
    [subscriptions, search, statusFilter, planFilter],
  );

  const inputStyle = {
    background: C.input,
    color: C.text,
    border: `1px solid ${C.cardBorder}`,
  };
  const fieldClass =
    "w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-shadow focus:ring-2";
  const primary =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0";

  function resetPayment() {
    setPayment(freshPayment());
    setPaidAttemptKey("");
  }
  function updatePayment(update: (value: ReturnType<typeof freshPayment>) => ReturnType<typeof freshPayment>) {
    setPayment(update);
    setPaidAttemptKey("");
  }
  function openEnrol() {
    setAssignMenuOpen(false);
    setLearnerMode("existing");
    setNewLearnerName("");
    setNewLearnerEmail("");
    setStudentId("");
    setPlanId(activePlans[0]?.id ?? "");
    resetPayment();
    setEnrolMode("request");
    setError("");
    setEnrolOpen(true);
  }

  function toggleAssignMenu(event: React.MouseEvent<HTMLButtonElement>) {
    if (assignMenuOpen) {
      setAssignMenuOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setAssignMenuPosition({
      top: rect.bottom + 8,
      right: Math.max(12, window.innerWidth - rect.right),
    });
    setAssignMenuOpen(true);
  }

  async function assignNewLearner() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const attemptKey = paidAttemptKey || crypto.randomUUID();
      if (enrolMode === "paid" && !paidAttemptKey) setPaidAttemptKey(attemptKey);
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign-new-subscription-student",
          mode: enrolMode,
          fullName: newLearnerName,
          email: newLearnerEmail,
          planId,
          durationMonths: Number(payment.durationMonths),
          amount: Number(payment.amount),
          currency: payment.currency,
          dueDate: payment.dueDate,
          paymentMethod: payment.paymentMethod || null,
          paymentReference: payment.paymentReference || null,
          notes: payment.notes || null,
          idempotencyKey: enrolMode === "paid" ? attemptKey : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create and assign learner");

      const warnings = [data.notificationWarning, data.activationWarning].filter(Boolean);
      setSuccess(
        enrolMode === "paid"
          ? `Account ready and subscription activated.${warnings.length ? ` ${warnings.join(" ")}` : ""}`
          : `Account ready and plan assigned. Access begins after payment approval.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
      );
      setEnrolOpen(false);
      resetPayment();
      setTab(enrolMode === "request" ? "payments" : "subscribers");
      await load(planId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  function openSubscriberAction(
    sub: any,
    action: "change-plan" | "request-payment" | "extend-access",
  ) {
    setError("");
    setManageSub(sub);
    setChangePlanId(sub.plan_id);
    setManageAction(action);
    setSubscriberMenu(null);
    resetPayment();
  }

  function toggleSubscriberMenu(event: React.MouseEvent<HTMLElement>, sub: any) {
    event.stopPropagation();
    if (subscriberMenu?.sub.id === sub.id) {
      setSubscriberMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setSubscriberMenu({
      sub,
      top:
        rect.bottom + 310 > window.innerHeight
          ? Math.max(12, rect.top - 300)
          : rect.bottom + 6,
      right: Math.max(12, window.innerWidth - rect.right),
    });
  }

  function openBulkImport(plan?: any) {
    const nextPlan = plan?.id ? plan : activePlans[0];
    if (!nextPlan) {
      setError("Create or activate a subscription plan before adding learners.");
      return;
    }
    setAssignMenuOpen(false);
    setPlanCardMenuId(null);
    setBulkPlan(nextPlan);
    setBulkText("");
    setBulkRows([]);
    setBulkMode("request");
    setBulkAttemptKey(crypto.randomUUID());
    setBulkDefaults(freshPayment());
    setBulkResult(null);
    setBulkError("");
  }

  function updateBulkText(value: string) {
    setBulkText(value);
    setBulkRows(parseSubscriptionImportText(value));
    setBulkResult(null);
    setBulkError("");
  }

  function readBulkFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateBulkText(String(reader.result ?? ""));
    reader.onerror = () => setBulkError("Could not read this CSV file.");
    reader.readAsText(file);
  }

  function downloadBulkTemplate() {
    const content = [
      "email,full_name",
      "learner@example.com,Ama Mensah",
    ].join("\r\n");
    const blob = new Blob([`\uFEFF${content}\r\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "subscription-learners-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importBulkStudents() {
    if (!bulkPlan) return;
    setBusy(true);
    setBulkError("");
    setBulkResult(null);
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk-subscription-payment-requests",
          mode: bulkMode,
          batchId: bulkAttemptKey,
          planId: bulkPlan.id,
          rows: bulkRows,
          defaults: {
            durationMonths: Number(bulkDefaults.durationMonths),
            amount: Number(bulkDefaults.amount),
            currency: bulkDefaults.currency,
            dueDate: bulkDefaults.dueDate,
            paymentMethod: bulkDefaults.paymentMethod,
            paymentReference: bulkDefaults.paymentReference,
            notes: bulkDefaults.notes,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to import students");
      setBulkResult(data);
      setSuccess(
        bulkMode === "request"
          ? `${data.requested} payment request${data.requested === 1 ? "" : "s"} created for ${bulkPlan.name}.`
          : `${data.activated} learner${data.activated === 1 ? "" : "s"} activated on ${bulkPlan.name}.`,
      );
      await load(bulkPlan.id);
    } catch (err: any) {
      setBulkError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePaid(subscription?: any) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const attemptKey = paidAttemptKey || crypto.randomUUID();
      if (!paidAttemptKey) setPaidAttemptKey(attemptKey);
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: subscription ? "renew-subscription" : "create-subscription",
          studentId: subscription?.student_id ?? studentId,
          planId: subscription?.plan_id ?? planId,
          durationMonths: Number(payment.durationMonths),
          amount: Number(payment.amount),
          currency: payment.currency,
          paymentMethod: payment.paymentMethod || null,
          paymentReference: payment.paymentReference || null,
          notes: payment.notes || null,
          idempotencyKey: attemptKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save subscription");
      const paidWarning = data.activationWarning
        ? ` The learner email could not be sent: ${data.activationWarning}`
        : "";
      setSuccess(
        (subscription
          ? "Renewal recorded and access extended."
          : "Payment recorded and access activated.") + paidWarning,
      );
      setEnrolOpen(false);
      setManageSub(null);
      setManageAction(null);
      resetPayment();
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function assignRequest(subscription?: any) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-subscription-payment-request",
          studentId: subscription?.student_id ?? studentId,
          planId: subscription?.plan_id ?? planId,
          durationMonths: Number(payment.durationMonths),
          amount: Number(payment.amount),
          currency: payment.currency,
          dueDate: payment.dueDate,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to assign payment request");
      setSuccess(
        data.notificationWarning
          ? `Payment request created, but the learner email could not be sent: ${data.notificationWarning}`
          : subscription
          ? "Renewal request sent to the student."
          : "Payment request assigned. Access begins after approval.",
      );
      setEnrolOpen(false);
      setManageSub(null);
      setManageAction(null);
      resetPayment();
      setTab("payments");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReview() {
    if (!reviewTarget) return;
    const confirmation =
      reviewTarget.request.subscription_payment_confirmations?.find(
        (r: any) => r.status === "pending",
      );
    if (!confirmation) return;
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: `${reviewTarget.decision}-subscription-confirmation`,
          confirmationId: confirmation.id,
          adminNotes: reviewNotes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to review confirmation");
      setSuccess(
        reviewTarget.decision === "approve"
          ? "Payment approved. Subscription access is now updated."
          : "Confirmation rejected. The student can submit again.",
      );
      setReviewTarget(null);
      setReviewNotes("");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(id: string) {
    if (
      !confirm(
        "Cancel this payment request and close any pending confirmation?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel-subscription-payment-request",
          requestId: id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel request");
      setSuccess("Payment request cancelled.");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Clearing a learner's unfinished checkout for them. The server asks Paystack whether anything
  // was collected before it clears anything, so this cannot free somebody to pay a second time for
  // what they already bought.
  async function clearCart(cart: any) {
    if (
      !confirm(
        `Clear the unfinished ${cart.plan_name} checkout for ${cart.students?.full_name || "this learner"}? They will be free to start a new payment.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clear-student-cart",
          reference: cart.reference,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to clear checkout");
      setSuccess("Unfinished checkout cleared.");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changePlan() {
    if (!manageSub || changePlanId === manageSub.plan_id) return;
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change-subscription-plan",
          subscriptionId: manageSub.id,
          planId: changePlanId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change plan");
      setSuccess(
        "Access plan changed. Billing terms and deadline were preserved.",
      );
      setManageSub(null);
      setManageAction(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelSubscription(subscriptionOverride?: any) {
    const subscription = subscriptionOverride?.id ? subscriptionOverride : manageSub;
    if (
      !subscription ||
      !confirm("Cancel this subscription and revoke access immediately?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel-subscription",
          subscriptionId: subscription.id,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to cancel subscription");
      setSuccess("Subscription cancelled and access revoked.");
      setManageSub(null);
      setManageAction(null);
      setSubscriberMenu(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSubscriberAccount(subscriptionOverride?: any) {
    const subscription = subscriptionOverride?.id ? subscriptionOverride : manageSub;
    if (!subscription?.student_id) return;
    const label =
      subscription.students?.full_name || subscription.students?.email || "this learner";
    if (
      !confirm(
        `Permanently delete "${label}"? This removes their login and student account, cancels open subscription access and payment requests, and cannot be undone. Completed financial history will be retained without the student identity.`,
      )
    )
      return;

    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/admin/delete-user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: subscription.student_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete student account");
      setManageSub(null);
      setManageAction(null);
      setSubscriberMenu(null);
      setSuccess(`${label} was permanently deleted.`);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function showHistory(sub: any) {
    setSubscriberMenu(null);
    const res = await authFetch(
      `/api/payments?action=subscription-history&studentId=${sub.student_id}`,
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to load history");
      return;
    }
    setHistory(data.payments ?? []);
    setHistoryOpen(true);
  }

  function openPlanBuilder() {
    setError("");
    setNewPlanName("");
    setNewPlanDescription("");
    setNewPlanPrices(freshPlanPrices());
    setNewPlanContentKeys([]);
    setNewPlanContentSearch("");
    setPlanBuilderStep(0);
    setCreatePlanOpen(true);
  }

  function planBuilderIsDirty() {
    return Boolean(
      newPlanName.trim() ||
      newPlanDescription.trim() ||
      newPlanContentKeys.length ||
      newPlanPrices.some((price) => price.amount || price.isActive || price.currency !== "GHS"),
    );
  }

  function requestClosePlanBuilder() {
    if (busy) return;
    if (planBuilderIsDirty()) {
      setUnsavedPlanDialog("create");
      return;
    }
    setCreatePlanOpen(false);
    setError("");
  }

  function editPlanIsDirty() {
    if (!editPlan) return false;
    if (editPlanName.trim() !== String(editPlan.name ?? "").trim()) return true;
    if (editPlanDescription.trim() !== String(editPlan.description ?? "").trim()) return true;
    const existing = new Map((editPlan.subscription_plan_prices ?? []).map((price: any) => [Number(price.duration_months), price]));
    return editPlanPrices.some((price) => {
      const original: any = existing.get(Number(price.durationMonths));
      return (
        String(price.amount || "") !== (original?.amount == null ? "" : String(original.amount)) ||
        price.currency !== (original?.currency || "GHS") ||
        price.isActive !== (original?.is_active === true)
      );
    });
  }

  function requestCloseEditPlan() {
    if (busy) return;
    if (editPlanIsDirty()) {
      setUnsavedPlanDialog("edit");
      return;
    }
    setEditPlan(null);
    setError("");
  }

  async function createPlan(status: "active" | "inactive" = "active") {
    setUnsavedPlanDialog(null);
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-subscription-plan",
          name: newPlanName,
          description: newPlanDescription,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create plan");

      // Keep a new plan off sale while its prices and content are being attached. The creation
      // RPC predates drafts and may return an active plan, so make the multi-request setup safe.
      const draftRes = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-subscription-plan",
          planId: data.planId,
          status: "inactive",
        }),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData.error || "Failed to prepare plan draft");

      const priceRes = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-subscription-plan-prices",
          planId: data.planId,
          prices: newPlanPrices.map((price) => ({
            durationMonths: Number(price.durationMonths),
            amount: Number(price.amount),
            currency: price.currency,
            isActive: price.isActive,
            sortOrder: price.sortOrder,
          })),
        }),
      });
      const priceData = await priceRes.json();
      if (!priceRes.ok) throw new Error(priceData.error || "Failed to save plan prices");

      // Through the same path as every other caller, so this flow asks about open access rather
      // than being refused by the server for not asking.
      const requested = newPlanContentKeys.map((key) => {
        const separator = key.indexOf(":");
        const contentTable = key.slice(0, separator) as PlanContentChange["contentTable"];
        const contentId = key.slice(separator + 1);
        return { contentTable, contentId, title: titleFor(contentTable, contentId) };
      });
      const contentResult = await runPlanContentChanges(
        requested.map(({ contentTable, contentId }) => ({
          planId: data.planId,
          contentTable,
          contentId,
          add: true,
        })),
      );

      // A plan is put on sale by activating it, and the public pricing view asks for an active
      // plan with a live price -- not for any content behind it. Activating one whose content
      // did not attach publishes something buyable and empty, so it stays a draft instead.
      const decision = decideNewPlanActivation({
        requested,
        outcomes: contentResult ? contentResult.outcomes : null,
        wantActive: status === "active",
      });

      if (decision.activate) {
        const statusRes = await authFetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update-subscription-plan",
            planId: data.planId,
            status: "active",
          }),
        });
        const statusData = await statusRes.json();
        if (!statusRes.ok) throw new Error(statusData.error || "Failed to activate plan");
      }
      setNewPlanName("");
      setNewPlanDescription("");
      setNewPlanPrices(freshPlanPrices());
      setNewPlanContentKeys([]);
      setNewPlanContentSearch("");
      setPlanBuilderStep(0);
      setCreatePlanOpen(false);
      // One message, from one decision. Setting a success line after an error line is how a
      // partial result came to read as a finished one.
      if (decision.tone === "success") setSuccess(decision.message);
      else setError(decision.message);
      await load(data.planId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openEditPlan(plan: any) {
    setError("");
    setPlanCardMenuId(null);
    setEditPlan(plan);
    setEditPlanName(plan.name ?? "");
    setEditPlanDescription(plan.description ?? "");
    const existing = new Map((plan.subscription_plan_prices ?? []).map((price: any) => [Number(price.duration_months), price]));
    setEditPlanPrices(PLAN_PRICE_DURATIONS.map((durationMonths) => {
      const price: any = existing.get(durationMonths);
      return {
        durationMonths: String(durationMonths),
        amount: price?.amount == null ? "" : String(price.amount),
        currency: price?.currency || "GHS",
        isActive: price?.is_active === true,
        sortOrder: durationMonths,
      };
    }));
  }

  async function savePlanDetails() {
    if (!editPlan || !editPlanName.trim()) return;
    setUnsavedPlanDialog(null);
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-subscription-plan",
          planId: editPlan.id,
          name: editPlanName.trim(),
          description: editPlanDescription.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update plan");
      const priceRes = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-subscription-plan-prices",
          planId: editPlan.id,
          prices: editPlanPrices.map((price) => ({
            durationMonths: Number(price.durationMonths),
            amount: Number(price.amount),
            currency: price.currency,
            isActive: price.isActive,
            sortOrder: price.sortOrder,
          })),
        }),
      });
      const priceData = await priceRes.json();
      if (!priceRes.ok) throw new Error(priceData.error || "Failed to update plan prices");
      const updatedPlanId = editPlan.id;
      setEditPlan(null);
      setSuccess("Plan details updated.");
      await load(updatedPlanId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function togglePlan(planOverride?: any) {
    const plan = planOverride?.id ? planOverride : selectedPlan;
    if (!plan) return;
    const status = plan.status === "active" ? "inactive" : "active";
    if (
      status === "inactive" &&
      !confirm("Deactivate this plan? Existing access continues.")
    )
      return;
    setBusy(true);
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-subscription-plan",
          planId: plan.id,
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update plan");
      setPlanCardMenuId(null);
      await load(plan.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Puts a finished plan out of the way, or brings it back.
   *
   * A plan with any history cannot be deleted -- that would orphan the record of what people
   * paid -- so archiving is the only way this list ever gets shorter.
   */
  async function setPlanArchived(plan: any, archived: boolean) {
    if (!plan) return;
    setBusy(true);
    setError("");
    setSuccess("");
    setPlanCardMenuId(null);
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-subscription-plan-archived",
          planId: plan.id,
          archived,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to archive plan");
      setSuccess(
        archived
          ? `"${plan.name}" archived. Its history is kept, and you can bring it back at any time.`
          : `"${plan.name}" is back in the list, still switched off.`,
      );
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const askToClosePublic = (titles: string[]) =>
    new Promise<boolean>((resolve) => setClosePublicAsk({ titles, resolve }));

  const titleFor = (contentTable: string, contentId: string) =>
    contentOptions.find(
      (item: any) => item.content_table === contentTable && item.id === contentId,
    )?.title ?? "this item";

  /**
   * Runs a set of plan-content changes, asking once about anything that would stop being open to
   * everyone.
   *
   * Asked twice over, deliberately. What this screen has loaded says which items are open now,
   * which is what lets it warn before anything happens. The server has the last word, and if it
   * turns something back as still public -- another tab, another person, a list loaded a while
   * ago -- that refusal becomes the same question rather than an error.
   *
   * Not all-or-nothing. Each item is its own request with its own side effects: adding to an
   * active plan emails that plan's learners, and a later failure cannot unsend that. So every
   * change comes back with what happened to it, and the caller says exactly what landed.
   */
  async function runPlanContentChanges(
    changes: PlanContentChange[],
  ): Promise<{
    summary: ReturnType<typeof summarizePlanContentOutcomes>;
    total: number;
    outcomes: PlanContentOutcome[];
  } | null> {
    if (!changes.length) return { summary: summarizePlanContentOutcomes([]), total: 0, outcomes: [] };
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    const knownPublic = changes.filter(
      (change) =>
        change.add &&
        contentOptions.some(
          (item: any) =>
            item.content_table === change.contentTable &&
            item.id === change.contentId &&
            item.available_to_everyone === true,
        ),
    );
    let clearPublicAccess = false;
    if (knownPublic.length) {
      const agreed = await askToClosePublic(
        knownPublic.map((change) => titleFor(change.contentTable, change.contentId)),
      );
      if (!agreed) return null;
      clearPublicAccess = true;
    }

    let outcomes: PlanContentOutcome[] = await applyPlanContentChanges(changes, {
      token,
      clearPublicAccess,
    });

    const stale = outcomes.filter((outcome) => outcome.kind === "needs_private");
    if (stale.length) {
      const agreed = await askToClosePublic(
        stale.map((outcome) => titleFor(outcome.change.contentTable, outcome.change.contentId)),
      );
      if (agreed) {
        const retried = await applyPlanContentChanges(
          stale.map((outcome) => outcome.change),
          { token, clearPublicAccess: true },
        );
        outcomes = [
          ...outcomes.filter((outcome) => outcome.kind !== "needs_private"),
          ...retried,
        ];
      }
    }

    return { summary: summarizePlanContentOutcomes(outcomes), total: changes.length, outcomes };
  }

  /**
   * Which plan the pricing page puts in front of visitors: first after the free tier, badged,
   * and led with in the hero. At most one, so marking a new one clears the old.
   */
  async function setPlanRecommended(plan: any, recommended: boolean) {
    if (!plan) return;
    setBusy(true);
    setError("");
    setSuccess("");
    setPlanCardMenuId(null);
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-subscription-plan-recommended",
          planId: plan.id,
          recommended,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update the recommended plan");
      setSuccess(
        recommended
          ? `"${plan.name}" is now the best value plan on the pricing page.`
          : `"${plan.name}" is no longer marked best value.`,
      );
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deletePlan(planOverride?: any) {
    const plan = planOverride?.id ? planOverride : selectedPlan;
    if (!plan) return;
    if (
      !confirm(
        `Permanently delete "${plan.name}"? This is only allowed when the plan has never been used.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete-subscription-plan",
          planId: plan.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete plan");
      setPlanCardMenuId(null);
      if (selectedPlan?.id === plan.id) {
        setSelectedPlan(null);
        setPlanContent([]);
        setSelectedContentKeys([]);
      }
      setSuccess("Unused subscription plan permanently deleted.");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePlanContentSelection() {
    if (!selectedPlan) return;
    setBusy(true);
    try {
      const current = new Set(
        planContent.map((item) => `${item.content_table}:${item.content_id}`),
      );
      const desired = new Set(selectedContentKeys);
      // Which endpoint action each of these becomes is the shared module's business, not this
      // screen's. Naming it here is what let one caller carry a rule the others did not.
      const toChange = (key: string, add: boolean): PlanContentChange => {
        const separator = key.indexOf(":");
        return {
          planId: selectedPlan.id,
          contentTable: key.slice(0, separator) as PlanContentChange["contentTable"],
          contentId: key.slice(separator + 1),
          add,
        };
      };
      const result = await runPlanContentChanges([
        ...selectedContentKeys.filter((key) => !current.has(key)).map((key) => toChange(key, true)),
        ...[...current].filter((key) => !desired.has(key)).map((key) => toChange(key, false)),
      ]);
      // Cancelled at the confirmation. Nothing was sent, so say nothing happened.
      if (!result) return;

      // Re-read before reporting. Each change was its own request, so the stored answer is the
      // only honest account of where this plan ended up.
      await loadPlanContent(selectedPlan.id);
      const message = describePlanContentResult(result.summary, result.total);
      if (result.summary.failed.length || result.summary.needsPrivate.length) {
        setError(message);
      } else {
        setSuccess(
          result.summary.warnings.length
            ? `${message} Some learners could not be emailed.`
            : "Plan content updated for every subscriber.",
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleContentKey(key: string) {
    setSelectedContentKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  const TermsFields = (showDeadline: boolean) => (
    <div className={`grid ${showDeadline ? "sm:grid-cols-2" : "sm:grid-cols-3"} gap-3`}>
      <label className="text-xs font-bold" style={{ color: C.muted }}>
        Access duration
        <select
          value={payment.durationMonths}
          onChange={(e) =>
            updatePayment((v) => ({ ...v, durationMonths: e.target.value }))
          }
          className={`${fieldClass} mt-1.5`}
          style={inputStyle}
        >
          {[1, 3, 6, 12].map((m) => (
            <option key={m} value={m}>
              {m} month{m > 1 ? "s" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-bold" style={{ color: C.muted }}>
        Amount
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={payment.amount}
          onChange={(e) =>
            updatePayment((v) => ({ ...v, amount: e.target.value }))
          }
          placeholder="0.00"
          className={`${fieldClass} mt-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
          style={inputStyle}
        />
      </label>
      <label className="text-xs font-bold" style={{ color: C.muted }}>
        Currency
        <input
          value={payment.currency}
          onChange={(e) =>
            updatePayment((v) => ({ ...v, currency: e.target.value }))
          }
          className={`${fieldClass} mt-1.5`}
          style={inputStyle}
        />
      </label>
      {showDeadline && (
        <label className="text-xs font-bold" style={{ color: C.muted }}>
          Payment deadline
          <input
            type="date"
            value={payment.dueDate}
            onChange={(e) =>
              updatePayment((v) => ({ ...v, dueDate: e.target.value }))
            }
            className={`${fieldClass} mt-1.5`}
            style={inputStyle}
          />
        </label>
      )}
    </div>
  );

  const ReferenceFields = () => (
    <div className="grid sm:grid-cols-2 gap-3">
      <label className="text-xs font-bold" style={{ color: C.muted }}>
        Payment method
        <input
          value={payment.paymentMethod}
          onChange={(e) =>
            updatePayment((v) => ({ ...v, paymentMethod: e.target.value }))
          }
          placeholder="Mobile Money, bank transfer..."
          className={`${fieldClass} mt-1.5`}
          style={inputStyle}
        />
      </label>
      <label className="text-xs font-bold" style={{ color: C.muted }}>
        Reference
        <input
          value={payment.paymentReference}
          onChange={(e) =>
            updatePayment((v) => ({ ...v, paymentReference: e.target.value }))
          }
          placeholder="Transaction ID"
          className={`${fieldClass} mt-1.5`}
          style={inputStyle}
        />
      </label>
      <label
        className="sm:col-span-2 text-xs font-bold"
        style={{ color: C.muted }}
      >
        Internal notes
        <textarea
          value={payment.notes}
          onChange={(e) => updatePayment((v) => ({ ...v, notes: e.target.value }))}
          className={`${fieldClass} mt-1.5 min-h-20`}
          style={inputStyle}
        />
      </label>
    </div>
  );

  const heroStyle = {
    background: dark
      ? `radial-gradient(circle at 85% 15%, ${C.cta}33, transparent 32%), linear-gradient(135deg, #20232d 0%, #17181e 75%)`
      : `radial-gradient(circle at 88% 12%, ${C.cta}2b, transparent 30%), linear-gradient(135deg, #0b1220 0%, #14243d 100%)`,
  };

  return (
    <div className="subscription-typography space-y-6 pb-12">
      <style>{`.subscription-typography .font-black{font-weight:700!important}.subscription-typography .font-bold{font-weight:600!important}`}</style>
      <section
        className="relative overflow-hidden rounded-[28px] px-5 py-6 sm:px-8 sm:py-8 text-white"
        style={heroStyle}
      >
        <div className="absolute right-[-70px] bottom-[-100px] w-64 h-64 rounded-full border border-white/10" />
        <div className="absolute right-8 top-5 w-24 h-24 rounded-full border border-white/10" />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div>
            <h2
              className="text-2xl sm:text-3xl font-black tracking-tight"
              style={{ color: "#ffffff" }}
            >
              Access, revenue and renewals.
              <br />
              <span style={{ color: dark ? "#83b9ff" : "#7ef0b5" }}>
                One clear operating view.
              </span>
            </h2>
            <p
              className="mt-3 text-sm max-w-xl"
              style={{ color: "rgba(255,255,255,0.72)" }}
            >
              Build reusable access plans, assign flexible durations, verify
              payments and keep every learner on schedule.
            </p>
          </div>
          <div className="relative self-start lg:self-auto">
            <button
              onClick={toggleAssignMenu}
              className={primary}
              style={{
                background: "#fff",
                color: "#101828",
                boxShadow: "0 16px 40px rgba(0,0,0,0.22)",
              }}
              aria-expanded={assignMenuOpen}
              aria-haspopup="menu"
            >
              <UserPlus className="w-4 h-4" />
              Assign subscription
              <ChevronRight
                className={`w-4 h-4 transition-transform ${assignMenuOpen ? "rotate-90" : ""}`}
              />
            </button>
          </div>
        </div>
      </section>

      <nav
        className="grid grid-cols-5 gap-1 p-1.5 rounded-2xl w-full"
        style={{ background: C.card }}
      >
        {(
          [
            ["overview", "Command center", LayoutDashboard],
            ["subscribers", "Subscribers", Users],
            ["payments", "Payments", WalletCards],
            ["plans", "Plans", Layers3],
            ["review", "Review", ShieldAlert],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="relative min-w-0 inline-flex items-center justify-center gap-1.5 sm:gap-2 rounded-xl px-1.5 sm:px-4 py-2.5 text-[10px] sm:text-sm font-bold transition-all"
            style={{
              background: tab === id ? C.pill : "transparent",
              color: tab === id ? C.text : C.muted,
            }}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{label}</span>
            {id === "review" && reviewQueue.length > 0 && (
              <span
                className="grid place-items-center min-w-5 h-5 px-1 rounded-full text-[10px] text-white"
                style={{ background: "#dc2626" }}
              >
                {reviewQueue.length}
              </span>
            )}
            {id === "payments" && awaitingReview.length > 0 && (
              <span
                className="grid place-items-center min-w-5 h-5 px-1 rounded-full text-[10px] text-white"
                style={{ background: "#f97316" }}
              >
                {awaitingReview.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {error && (
        <div
          className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={{
            background: C.errorBg,
            color: C.errorText,
            border: `1px solid ${C.errorBorder}`,
          }}
        >
          <XCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div
          className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={{
            background: C.successBg,
            color: C.successText,
            border: `1px solid ${C.successBorder}`,
          }}
        >
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-32 rounded-2xl animate-pulse"
              style={{ background: C.card }}
            />
          ))}
        </div>
      ) : (
        <>
          {tab === "overview" && (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  [
                    "Active access",
                    active.length,
                    "Learners with live access",
                    BadgeCheck,
                    C.cta,
                  ],
                  [
                    "Review queue",
                    awaitingReview.length,
                    "Confirmations need action",
                    FileCheck2,
                    "#f97316",
                  ],
                  [
                    "Due soon",
                    expiring.length,
                    "Expiring within 30 days",
                    CalendarClock,
                    "#0284c7",
                  ],
                  [
                    "Collected",
                    collectedValue,
                    collectedDetail,
                    CircleDollarSign,
                    "#0ea5e9",
                  ],
                ].map(([label, value, sub, Icon, tone]: any) => (
                  <div
                    key={label}
                    className="group rounded-2xl p-5 transition-transform hover:-translate-y-0.5"
                    style={cardStyle(C)}
                  >
                    <div className="flex items-start justify-between">
                      <div
                        className="w-10 h-10 rounded-xl grid place-items-center"
                        style={{ background: `${tone}14`, color: tone }}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <ArrowRight
                        className="w-4 h-4 opacity-0 group-hover:opacity-50 transition-opacity"
                        style={{ color: C.muted }}
                      />
                    </div>
                    <p
                      className="text-2xl font-black mt-5"
                      style={{ color: C.text }}
                    >
                      {value}
                    </p>
                    <p
                      className="text-xs font-bold mt-1"
                      style={{ color: C.text }}
                    >
                      {label}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: C.faint }}>
                      {sub}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid xl:grid-cols-[1.15fr_0.85fr] gap-5">
                <div
                  className="rounded-2xl overflow-hidden"
                  style={cardStyle(C)}
                >
                  <div
                    className="px-5 py-4 flex items-center justify-between"
                    style={{ borderBottom: `1px solid ${C.divider}` }}
                  >
                    <div>
                      <p className="font-bold" style={{ color: C.text }}>
                        Action queue
                      </p>
                      <p className="text-xs mt-1" style={{ color: C.faint }}>
                        Payments that need your attention
                      </p>
                    </div>
                    <button
                      onClick={() => setTab("payments")}
                      className="text-xs font-bold"
                      style={{ color: C.cta }}
                    >
                      View all
                    </button>
                  </div>
                  <div className="p-3 space-y-2">
                    {awaitingReview.slice(0, 5).map((request) => (
                      <button
                        key={request.id}
                        onClick={() =>
                          setReviewTarget({ request, decision: "approve" })
                        }
                        className="w-full flex items-center gap-3 rounded-xl p-3 text-left transition-colors"
                        style={{ background: C.page }}
                      >
                        <div
                          className="w-10 h-10 rounded-full grid place-items-center font-bold text-sm"
                          style={{ background: `${C.cta}16`, color: C.cta }}
                        >
                          {(
                            request.students?.full_name ||
                            request.students?.email ||
                            "?"
                          ).charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-sm font-bold truncate"
                            style={{ color: C.text }}
                          >
                            {request.students?.full_name ||
                              request.students?.email}
                          </p>
                          <p
                            className="text-xs truncate"
                            style={{ color: C.faint }}
                          >
                            {request.plan_name} -{" "}
                            {money(request.currency, request.amount)}
                          </p>
                        </div>
                        <span
                          className="text-[11px] font-bold"
                          style={{ color: "#f97316" }}
                        >
                          Review
                        </span>
                        <ChevronRight
                          className="w-4 h-4"
                          style={{ color: C.faint }}
                        />
                      </button>
                    ))}
                    {awaitingReview.length === 0 && (
                      <div className="py-12 text-center">
                        <CheckCircle2
                          className="w-8 h-8 mx-auto mb-3"
                          style={{ color: C.green }}
                        />
                        <p
                          className="text-sm font-bold"
                          style={{ color: C.text }}
                        >
                          You are all caught up
                        </p>
                        <p className="text-xs mt-1" style={{ color: C.faint }}>
                          No payment confirmations need review.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div
                  className="rounded-2xl overflow-hidden"
                  style={cardStyle(C)}
                >
                  <div
                    className="px-5 py-4"
                    style={{ borderBottom: `1px solid ${C.divider}` }}
                  >
                    <p className="font-bold" style={{ color: C.text }}>
                      Renewal radar
                    </p>
                    <p className="text-xs mt-1" style={{ color: C.faint }}>
                      Closest access deadlines
                    </p>
                  </div>
                  <div className="p-4 space-y-4">
                    {expiring.slice(0, 5).map((sub) => {
                      const days = daysRemaining(sub.current_period_end);
                      return (
                        <button
                          key={sub.id}
                          onClick={() => {
                            setTab("subscribers");
                            setSearch(
                              sub.students?.email || sub.students?.full_name || "",
                            );
                          }}
                          className="w-full flex items-center gap-3 text-left"
                        >
                          <div
                            className="relative w-11 h-11 rounded-xl grid place-items-center"
                            style={{
                              background:
                                days <= 7
                                  ? "rgba(220,38,38,0.10)"
                                  : `${C.cta}12`,
                              color: days <= 7 ? "#dc2626" : C.cta,
                            }}
                          >
                            <span className="font-black text-sm">{days}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className="text-sm font-bold truncate"
                              style={{ color: C.text }}
                            >
                              {sub.students?.full_name || sub.students?.email}
                            </p>
                            <p className="text-xs" style={{ color: C.faint }}>
                              {dateLabel(sub.current_period_end)} -{" "}
                              {sub.subscription_plans?.name}
                            </p>
                          </div>
                          <ChevronRight
                            className="w-4 h-4"
                            style={{ color: C.faint }}
                          />
                        </button>
                      );
                    })}
                    {expiring.length === 0 && (
                      <p
                        className="text-sm text-center py-10"
                        style={{ color: C.faint }}
                      >
                        No subscriptions expire in the next 30 days.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "subscribers" && (
            <div className="space-y-4">
              <div
                className="flex flex-col lg:flex-row lg:items-center gap-3 rounded-2xl p-3"
                style={cardStyle(C)}
              >
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1"
                  style={{ background: C.input }}
                >
                  <Search className="w-4 h-4" style={{ color: C.faint }} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name or email"
                    className="bg-transparent outline-none text-sm w-full"
                    style={{ color: C.text }}
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-xl px-3 py-2 text-sm"
                  style={inputStyle}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <select
                  value={planFilter}
                  onChange={(e) => setPlanFilter(e.target.value)}
                  className="rounded-xl px-3 py-2 text-sm"
                  style={inputStyle}
                >
                  <option value="all">All plans</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div
                className="hidden md:block rounded-2xl overflow-x-auto"
                style={cardStyle(C)}
              >
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr
                      style={{
                        color: C.faint,
                        borderBottom: `1px solid ${C.divider}`,
                      }}
                    >
                      {[
                        "Learner",
                        "Access plan",
                        "Status",
                        "Access window",
                        "Remaining",
                        "Current terms",
                        "",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((sub) => (
                      <tr
                        key={sub.id}
                        className="group"
                        style={{ borderBottom: `1px solid ${C.divider}` }}
                      >
                        <td className="px-5 py-4">
                          <div>
                            <p
                              className="font-bold"
                              style={{ color: C.text }}
                            >
                              {sub.students?.full_name || "--"}
                            </p>
                            <p className="text-xs" style={{ color: C.faint }}>
                              {sub.students?.email}
                            </p>
                          </div>
                        </td>
                        <td
                          className="px-5 py-4 font-semibold"
                          style={{ color: C.text }}
                        >
                          {sub.subscription_plans?.name}
                        </td>
                        <td className="px-5 py-4">
                          <StatusPill status={sub.status} C={C} />
                        </td>
                        <td className="px-5 py-4">
                          <p style={{ color: C.text }}>
                            {dateLabel(sub.current_period_start)}
                          </p>
                          <p className="text-xs" style={{ color: C.faint }}>
                            to {dateLabel(sub.current_period_end)}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className="font-bold"
                            style={{
                              color:
                                daysRemaining(sub.current_period_end) <= 7
                                  ? "#dc2626"
                                  : C.text,
                            }}
                          >
                            {sub.status === "active"
                              ? `${Math.max(0, daysRemaining(sub.current_period_end))} days`
                              : "--"}
                          </span>
                        </td>
                        <td className="px-5 py-4" style={{ color: C.muted }}>
                          {sub.duration_months} months
                          <br />
                          <span className="text-xs">
                            {money(sub.currency, sub.amount)}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <button
                            onClick={(event) => toggleSubscriberMenu(event, sub)}
                            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold"
                            style={{ background: C.pill, color: C.cta }}
                            aria-label={`Actions for ${sub.students?.full_name || sub.students?.email}`}
                          >
                            Actions
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <p
                    className="p-12 text-center text-sm"
                    style={{ color: C.faint }}
                  >
                    No subscribers match these filters.
                  </p>
                )}
              </div>
              <div className="md:hidden space-y-3">
                {filtered.map((sub) => (
                  <div
                    key={sub.id}
                    className="w-full rounded-2xl p-4 text-left"
                    style={cardStyle(C)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold" style={{ color: C.text }}>
                          {sub.students?.full_name || sub.students?.email}
                        </p>
                        <p className="text-xs mt-1" style={{ color: C.faint }}>
                          {sub.subscription_plans?.name}
                        </p>
                      </div>
                      <StatusPill status={sub.status} C={C} />
                    </div>
                    <div
                      className="grid grid-cols-2 gap-3 mt-4 pt-4"
                      style={{ borderTop: `1px solid ${C.divider}` }}
                    >
                      <div>
                        <p
                          className="text-[10px] uppercase font-bold"
                          style={{ color: C.faint }}
                        >
                          Expires
                        </p>
                        <p className="text-sm mt-1" style={{ color: C.text }}>
                          {dateLabel(sub.current_period_end)}
                        </p>
                      </div>
                      <div>
                        <p
                          className="text-[10px] uppercase font-bold"
                          style={{ color: C.faint }}
                        >
                          Terms
                        </p>
                        <p className="text-sm mt-1" style={{ color: C.text }}>
                          {sub.duration_months} mo -{" "}
                          {money(sub.currency, sub.amount)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(event) => toggleSubscriberMenu(event, sub)}
                      className={`${primary} w-full mt-4`}
                      style={{ background: C.pill, color: C.cta }}
                      aria-label={`Actions for ${sub.students?.full_name || sub.students?.email}`}
                    >
                      Actions
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "review" && (
            <div className="space-y-5">
              {sweepHeartbeat?.stale && (
                <div
                  className="rounded-2xl p-4 flex items-start gap-3"
                  style={{ background: "rgba(220,38,38,0.10)", border: "1px solid rgba(220,38,38,0.20)", color: "#b91c1c" }}
                >
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold">Subscription expiry has not run recently</p>
                    <p className="text-xs mt-1 opacity-80">
                      {sweepHeartbeat.lastSuccessAt
                        ? `Last completed ${Math.round(sweepHeartbeat.staleHours)} hours ago. `
                        : "It has never completed on this environment. "}
                      Expired subscriptions keep their access until it runs. Check the hourly
                      schedule for /api/cron/subscription-expiry-sweep in the Upstash console.
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-2xl p-5 sm:p-6" style={cardStyle(C)}>
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <p className="font-black" style={{ color: C.text }}>
                      Payments needing a person
                    </p>
                    <p className="text-xs mt-1" style={{ color: C.faint }}>
                      Refunds, disputes, payments that could not be applied, and checkouts that
                      were never completed. The platform does not act on these on its own.
                    </p>
                  </div>
                  <ShieldAlert className="w-5 h-5" style={{ color: C.cta }} />
                </div>

                {reviewQueue.length === 0 ? (
                  <div className="rounded-2xl py-14 text-center" style={{ background: C.page }}>
                    <BadgeCheck className="w-8 h-8 mx-auto" style={{ color: "#16a34a" }} />
                    <p className="text-sm font-bold mt-3" style={{ color: C.text }}>
                      Nothing needs attention
                    </p>
                    <p className="text-xs mt-1" style={{ color: C.faint }}>
                      Every Paystack payment is either applied or still in progress.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {reviewQueue.map((item: any) => (
                      <div
                        key={`${item.kind}-${item.id}`}
                        className="rounded-2xl p-4"
                        style={{ background: C.page, border: `1px solid ${C.cardBorder}` }}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
                                style={{
                                  background:
                                    item.kind === "stalled" ? "#d97706" : "#0ea5e9",
                                }}
                              >
                                {item.kind === "stalled" ? "Never completed" : "Needs review"}
                              </span>
                              <p className="text-sm font-black truncate" style={{ color: C.text }}>
                                {item.studentName || item.studentEmail || item.reference || "Unmatched payment"}
                              </p>
                            </div>
                            <p className="text-xs mt-1.5" style={{ color: C.muted }}>
                              {(item.reason || "review required").replaceAll("_", " ")}
                              {item.planName ? ` on ${item.planName}` : ""}
                            </p>
                            <p className="text-[11px] mt-1 font-mono truncate" style={{ color: C.faint }}>
                              {item.reference || "no reference"}
                            </p>
                            {item.notificationError && (
                              <p className="text-[11px] mt-1" style={{ color: "#b91c1c" }}>
                                Alert email failed: {item.notificationError}
                              </p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            {item.amount != null && (
                              <p className="text-sm font-black" style={{ color: C.text }}>
                                {item.currency ? `${item.currency} ` : ""}
                                {Number(item.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </p>
                            )}
                            <p className="text-[11px] mt-1" style={{ color: C.faint }}>
                              {new Date(item.occurredAt).toLocaleDateString("en-GB", {
                                day: "numeric", month: "short", year: "numeric",
                              })}
                            </p>
                            {!item.notifiedAt && item.kind !== "stalled" && (
                              <p className="text-[10px] mt-1 uppercase tracking-wider font-bold" style={{ color: "#d97706" }}>
                                Not yet emailed
                              </p>
                            )}
                            {item.kind === "incident" && (
                              <button
                                onClick={() => resolveIncident(item)}
                                disabled={busy}
                                className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-50"
                                style={{ background: C.pill, color: C.cta }}
                              >
                                <Check className="w-3.5 h-3.5" />
                                Mark resolved
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "payments" && (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  [
                    "Awaiting learner",
                    awaitingStudent.length,
                    Clock3,
                    "#0ea5e9",
                  ],
                  [
                    "Ready to review",
                    awaitingReview.length,
                    FileCheck2,
                    "#f97316",
                  ],
                  ["Past deadline", overdue.length, CalendarClock, "#dc2626"],
                ].map(([label, value, Icon, tone]: any) => (
                  <div
                    key={label}
                    className="rounded-2xl p-5 flex items-center gap-4"
                    style={cardStyle(C)}
                  >
                    <div
                      className="w-11 h-11 rounded-xl grid place-items-center"
                      style={{ background: `${tone}14`, color: tone }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p
                        className="text-2xl font-black"
                        style={{ color: C.text }}
                      >
                        {value}
                      </p>
                      <p
                        className="text-xs font-bold"
                        style={{ color: C.muted }}
                      >
                        {label}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {openCarts.length > 0 && (
                <section className="rounded-2xl p-5" style={cardStyle(C)}>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <p className="font-black" style={{ color: C.text }}>
                        Unfinished checkouts
                      </p>
                      <p
                        className="text-xs mt-1"
                        style={{ color: C.faint }}
                      >
                        Started online and never completed, or left behind when a
                        payment request closed. Nothing is owed, but the learner
                        cannot pay another way until one is cleared.
                      </p>
                    </div>
                    <WalletCards
                      className="w-5 h-5 flex-shrink-0"
                      style={{ color: C.cta }}
                    />
                  </div>
                  <div className="grid xl:grid-cols-2 gap-3">
                    {openCarts.map((cart) => (
                      <div
                        key={cart.reference}
                        className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                        style={{
                          background: C.page,
                          border: `1px solid ${C.cardBorder}`,
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p
                            className="font-bold truncate"
                            style={{ color: C.text }}
                          >
                            {cart.students?.full_name || "Unnamed learner"}
                          </p>
                          <p
                            className="text-xs mt-0.5 truncate"
                            style={{ color: C.faint }}
                          >
                            {cart.students?.email}
                          </p>
                          <p
                            className="text-xs mt-1.5"
                            style={{ color: C.muted }}
                          >
                            {cart.plan_name} - {cart.duration_months} month
                            {cart.duration_months === 1 ? "" : "s"} -{" "}
                            {money(cart.currency, cart.amount)}
                          </p>
                          <p
                            className="text-[11px] mt-1"
                            style={{ color: C.faint }}
                          >
                            Started {dateLabel(cart.created_at)} -{" "}
                            {cart.request_id
                              ? "left behind by a closed payment request"
                              : cart.reminder_count === 0
                                ? "no reminders sent"
                                : `${cart.reminder_count} reminder${cart.reminder_count === 1 ? "" : "s"} sent`}
                          </p>
                        </div>
                        <button
                          onClick={() => clearCart(cart)}
                          disabled={busy}
                          className="text-xs font-bold px-3 py-2 rounded-xl flex-shrink-0 disabled:opacity-50"
                          style={{ background: C.pill, color: C.muted }}
                        >
                          Clear checkout
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <div className="grid xl:grid-cols-2 gap-4">
                {paymentRequests.map((request) => {
                  const conf =
                    request.subscription_payment_confirmations?.find(
                      (r: any) => r.status === "pending",
                    ) ?? request.subscription_payment_confirmations?.[0];
                  const isOverdue =
                    ["pending", "confirmation_submitted"].includes(
                      request.status,
                    ) &&
                    new Date(`${request.due_date}T23:59:59`).getTime() <
                      Date.now();
                  return (
                    <article
                      key={request.id}
                      className="rounded-2xl p-5"
                      style={cardStyle(C)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-11 h-11 rounded-full grid place-items-center font-black"
                            style={{ background: `${C.cta}15`, color: C.cta }}
                          >
                            {(
                              request.students?.full_name ||
                              request.students?.email ||
                              "?"
                            ).charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p
                              className="font-bold truncate"
                              style={{ color: C.text }}
                            >
                              {request.students?.full_name || "--"}
                            </p>
                            <p
                              className="text-xs truncate"
                              style={{ color: C.faint }}
                            >
                              {request.students?.email}
                            </p>
                          </div>
                        </div>
                        <StatusPill status={request.status} C={C} />
                      </div>
                      <div
                        className="grid grid-cols-3 gap-3 mt-5 rounded-xl p-3"
                        style={{ background: C.page }}
                      >
                        <div>
                          <p
                            className="text-[10px] font-bold uppercase"
                            style={{ color: C.faint }}
                          >
                            Plan
                          </p>
                          <p
                            className="text-xs font-bold mt-1 truncate"
                            style={{ color: C.text }}
                          >
                            {request.plan_name}
                          </p>
                        </div>
                        <div>
                          <p
                            className="text-[10px] font-bold uppercase"
                            style={{ color: C.faint }}
                          >
                            Amount
                          </p>
                          <p
                            className="text-xs font-bold mt-1"
                            style={{ color: C.text }}
                          >
                            {money(request.currency, request.amount)}
                          </p>
                        </div>
                        <div>
                          <p
                            className="text-[10px] font-bold uppercase"
                            style={{ color: C.faint }}
                          >
                            Deadline
                          </p>
                          <p
                            className="text-xs font-bold mt-1"
                            style={{ color: isOverdue ? "#dc2626" : C.text }}
                          >
                            {dateLabel(request.due_date)}
                          </p>
                        </div>
                      </div>
                      {conf && (
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <div className="text-xs" style={{ color: C.muted }}>
                            <p>{conf.method || "Payment method not stated"}</p>
                            <p style={{ color: C.faint }}>
                              {conf.reference || "No transaction reference"}
                              {conf.receipt_url && (
                                <>
                                  {" "}
                                  -{" "}
                                  <a
                                    href={conf.receipt_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: C.cta }}
                                  >
                                    Receipt
                                  </a>
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                      <div
                        className="flex items-center justify-end gap-2 mt-5 pt-4"
                        style={{ borderTop: `1px solid ${C.divider}` }}
                      >
                        {request.status === "confirmation_submitted" && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => {
                                setReviewNotes("");
                                setReviewTarget({
                                  request,
                                  decision: "reject",
                                });
                              }}
                              className={`${primary} px-3 py-2`}
                              style={{
                                background: C.deleteBg,
                                color: C.deleteText,
                              }}
                            >
                              <X className="w-3.5 h-3.5" />
                              Reject
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => {
                                setReviewNotes("");
                                setReviewTarget({
                                  request,
                                  decision: "approve",
                                });
                              }}
                              className={`${primary} px-3 py-2`}
                              style={{ background: C.cta, color: C.ctaText }}
                            >
                              <Check className="w-3.5 h-3.5" />
                              Review payment
                            </button>
                          </>
                        )}
                        {["pending", "confirmation_submitted"].includes(
                          request.status,
                        ) && (
                          <button
                            onClick={() => cancelRequest(request.id)}
                            className="text-xs font-bold px-2"
                            style={{ color: C.faint }}
                          >
                            Cancel request
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {paymentRequests.length === 0 && (
                <div
                  className="rounded-2xl py-16 text-center"
                  style={cardStyle(C)}
                >
                  <WalletCards
                    className="w-9 h-9 mx-auto"
                    style={{ color: C.faint }}
                  />
                  <p className="font-bold mt-3" style={{ color: C.text }}>
                    No payment activity yet
                  </p>
                  <p className="text-sm mt-1" style={{ color: C.faint }}>
                    Assigned payment requests will appear here.
                  </p>
                </div>
              )}
            </div>
          )}

          {tab === "plans" && (
            <div className="space-y-5">
              <section
                className="relative overflow-hidden rounded-[24px] p-5 sm:p-6"
                style={{
                  background: dark
                    ? `linear-gradient(135deg, ${C.card} 0%, ${C.pill} 100%)`
                    : `linear-gradient(135deg, ${C.cta}12 0%, ${C.card} 62%)`,
                }}
              >
                <div className="absolute -right-10 -top-14 w-40 h-40 rounded-full" style={{ background: `${C.cta}0d` }} />
                <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
                  <div className="flex items-start gap-4">
                    <span className="w-11 h-11 rounded-2xl grid place-items-center flex-shrink-0" style={{ background: C.cta, color: C.ctaText }}>
                      <Sparkles className="w-5 h-5" />
                    </span>
                    <div>
                      <p className="text-lg font-black" style={{ color: C.text }}>Build an offer learners understand</p>
                      <p className="text-sm mt-1 max-w-2xl" style={{ color: C.muted }}>
                        Bring the plan story, included learning and purchase options together in one guided flow.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={openPlanBuilder}
                    className={`${primary} self-start lg:self-auto px-5 py-3`}
                    style={{ background: C.cta, color: C.ctaText }}
                  >
                    <Plus className="w-4 h-4" />
                    Create plan
                  </button>
                </div>
              </section>
              <section className="rounded-2xl p-4 sm:p-5" style={cardStyle(C)}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <p className="font-black" style={{ color: C.text }}>
                      Your plans
                    </p>
                    <p className="text-xs mt-1" style={{ color: C.faint }}>
                      Select a plan to manage its content, pricing and availability.
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 text-xs font-bold" style={{ color: C.faint }}>
                    <span className="rounded-full px-2.5 py-1" style={{ background: C.page }}>{plans.length} total</span>
                    <span className="rounded-full px-2.5 py-1" style={{ background: C.page }}>{activePlans.length} active</span>
                  </div>
                </div>
                {(() => {
                  const archivedCount = plans.filter((p: any) => p.archived_at).length;
                  if (!archivedCount) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => setShowArchivedPlans((v) => !v)}
                      className="mb-3 text-xs font-bold underline"
                      style={{ color: C.muted }}
                    >
                      {showArchivedPlans
                        ? "Hide archived plans"
                        : `Show ${archivedCount} archived plan${archivedCount === 1 ? "" : "s"}`}
                    </button>
                  );
                })()}
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {plans
                    .filter((plan: any) => showArchivedPlans || !plan.archived_at)
                    .map((plan) => (
                    <div
                      key={plan.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setPlanCardMenuId(null);
                        setSelectedPlan(plan);
                        loadPlanContent(plan.id).catch((err) =>
                          setError(err.message),
                        );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedPlan(plan);
                          loadPlanContent(plan.id).catch((err) =>
                            setError(err.message),
                          );
                        }
                      }}
                      className="group relative overflow-visible rounded-[22px] p-5 text-left transition-all cursor-pointer hover:-translate-y-0.5"
                      style={{
                        background:
                          selectedPlan?.id === plan.id ? `${C.cta}0c` : C.page,
                        boxShadow:
                          selectedPlan?.id === plan.id
                            ? `inset 0 0 0 2px ${C.cta}, 0 12px 30px ${C.cta}12`
                            : `0 8px 24px ${dark ? "rgba(0,0,0,0.12)" : "rgba(15,23,42,0.05)"}`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div
                          className="w-10 h-10 rounded-2xl grid place-items-center"
                          style={{ background: `${C.cta}14`, color: C.cta }}
                        >
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <StatusPill status={plan.status} C={C} />
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPlanCardMenuId((current) =>
                                  current === plan.id ? null : plan.id,
                                );
                              }}
                              className="w-8 h-8 rounded-lg grid place-items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity"
                              style={{ background: C.card, color: C.text }}
                              aria-label={`Actions for ${plan.name}`}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {planCardMenuId === plan.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-10 z-30 w-52 rounded-xl p-2"
                                style={modalStyle(C)}
                              >
                                <button
                                  onClick={() => openEditPlan(plan)}
                                  disabled={busy}
                                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold"
                                  style={{ color: C.text }}
                                >
                                  <span
                                    className="w-8 h-8 rounded-lg grid place-items-center"
                                    style={{
                                      background: `${C.cta}14`,
                                      color: C.cta,
                                    }}
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </span>
                                  Edit plan details
                                </button>
                                <button
                                  onClick={() => togglePlan(plan)}
                                  // Archived means put away. Switching it back on here would
                                  // put it on sale while it stays hidden from this list.
                                  disabled={busy || !!plan.archived_at}
                                  title={
                                    plan.archived_at
                                      ? "Restore this plan before switching it back on."
                                      : undefined
                                  }
                                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold disabled:opacity-50"
                                  style={{ color: C.text }}
                                >
                                  <span
                                    className="w-8 h-8 rounded-lg grid place-items-center"
                                    style={{
                                      background: `${C.cta}14`,
                                      color: C.cta,
                                    }}
                                  >
                                    <ShieldCheck className="w-4 h-4" />
                                  </span>
                                  {plan.status === "active"
                                    ? "Deactivate plan"
                                    : "Activate plan"}
                                </button>
                                <button
                                  onClick={() => openBulkImport(plan)}
                                  disabled={busy || plan.status !== "active"}
                                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold disabled:opacity-50"
                                  style={{ color: C.text }}
                                >
                                  <span
                                    className="w-8 h-8 rounded-lg grid place-items-center"
                                    style={{
                                      background: `${C.cta}14`,
                                      color: C.cta,
                                    }}
                                  >
                                    <FileSpreadsheet className="w-4 h-4" />
                                  </span>
                                  Bulk add students
                                </button>
                                <button
                                  onClick={() => setPlanRecommended(plan, !plan.recommended)}
                                  disabled={busy || !!plan.archived_at}
                                  title={
                                    plan.archived_at
                                      ? "An archived plan is not shown to visitors."
                                      : undefined
                                  }
                                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold disabled:opacity-50"
                                  style={{ color: C.text }}
                                >
                                  <span
                                    className="w-8 h-8 rounded-lg grid place-items-center"
                                    style={{ background: `${C.cta}14`, color: C.cta }}
                                  >
                                    <Star className="w-4 h-4" />
                                  </span>
                                  {plan.recommended ? "Remove best value" : "Mark as best value"}
                                </button>
                                <button
                                  onClick={() => setPlanArchived(plan, !plan.archived_at)}
                                  disabled={busy || (!plan.archived_at && plan.status === "active")}
                                  title={
                                    !plan.archived_at && plan.status === "active"
                                      ? "Deactivate this plan first, so nobody loses a plan that is still on sale."
                                      : undefined
                                  }
                                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold disabled:opacity-50"
                                  style={{ color: C.text }}
                                >
                                  <span
                                    className="w-8 h-8 rounded-lg grid place-items-center"
                                    style={{ background: C.pill, color: C.muted }}
                                  >
                                    <Archive className="w-4 h-4" />
                                  </span>
                                  {plan.archived_at ? "Restore plan" : "Archive plan"}
                                </button>
                                <button
                                  onClick={() => deletePlan(plan)}
                                  disabled={busy}
                                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold"
                                  style={{ color: C.deleteText }}
                                >
                                  <span
                                    className="w-8 h-8 rounded-lg grid place-items-center"
                                    style={{ background: C.deleteBg }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </span>
                                  Delete plan
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4">
                        <p className="text-base font-black" style={{ color: C.text }}>
                          {plan.name}
                        </p>
                        <p
                          className="text-xs mt-1.5 leading-relaxed line-clamp-2 min-h-9"
                          style={{ color: C.faint }}
                        >
                          {plan.description ||
                            "Reusable subscription access plan"}
                        </p>
                        <div className="mt-4 rounded-2xl p-3.5" style={{ background: C.card }}>
                        {(plan.subscription_plan_prices ?? []).filter((price: any) => price.is_active).length ? (
                          <>
                            <p className="text-[10px] uppercase tracking-[0.14em] font-bold" style={{ color: C.faint }}>Starting price</p>
                            <div className="flex items-end justify-between gap-3 mt-1">
                              <p className="text-xl font-black" style={{ color: C.text }}>
                                {money(
                                  [...(plan.subscription_plan_prices ?? [])].filter((price: any) => price.is_active).sort((a: any, b: any) => Number(a.amount) - Number(b.amount))[0]?.currency,
                                  [...(plan.subscription_plan_prices ?? [])].filter((price: any) => price.is_active).sort((a: any, b: any) => Number(a.amount) - Number(b.amount))[0]?.amount,
                                )}
                              </p>
                              <p className="text-[11px] font-bold" style={{ color: C.cta }}>
                                {(plan.subscription_plan_prices ?? []).filter((price: any) => price.is_active).length} option{(plan.subscription_plan_prices ?? []).filter((price: any) => price.is_active).length === 1 ? "" : "s"}
                              </p>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-start gap-2" style={{ color: "#b45309" }}>
                            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-bold">Pricing needed</p>
                              <p className="text-[10px] mt-0.5">Add a price before publishing.</p>
                            </div>
                          </div>
                        )}
                        </div>
                      </div>
                      <div
                        className="grid grid-cols-2 gap-2 mt-3"
                      >
                        <div className="rounded-xl px-3 py-2.5" style={{ background: C.card }}>
                          <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: C.faint }}>Subscribers</p>
                          <p className="text-sm font-black mt-0.5" style={{ color: C.text }}>
                            {
                            subscriptions.filter((s) => s.plan_id === plan.id)
                              .length
                            }
                          </p>
                        </div>
                        <div className="rounded-xl px-3 py-2.5" style={{ background: C.card }}>
                          <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: C.faint }}>Readiness</p>
                          <p className="text-sm font-black mt-0.5" style={{ color: (plan.subscription_plan_prices ?? []).some((price: any) => price.is_active) ? C.green : "#b45309" }}>
                            {(plan.subscription_plan_prices ?? []).some((price: any) => price.is_active) ? "Ready" : "Needs setup"}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedPlan(plan);
                          loadPlanContent(plan.id).catch((err) => setError(err.message));
                        }}
                        className={`${primary} w-full mt-3`}
                        style={{
                          background: selectedPlan?.id === plan.id ? C.cta : C.card,
                          color: selectedPlan?.id === plan.id ? C.ctaText : C.text,
                        }}
                      >
                        {selectedPlan?.id === plan.id ? "Managing plan" : "Manage plan"}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {plans.length === 0 && (
                    <button
                      onClick={openPlanBuilder}
                      className="sm:col-span-2 xl:col-span-3 rounded-2xl py-10 text-center"
                      style={{ background: C.page }}
                    >
                      <Plus
                        className="w-7 h-7 mx-auto"
                        style={{ color: C.cta }}
                      />
                      <p
                        className="text-sm font-bold mt-3"
                        style={{ color: C.text }}
                      >
                        Create your first subscription plan
                      </p>
                    </button>
                  )}
                </div>
              </section>
              <section
                className="rounded-2xl min-h-[520px]"
                style={cardStyle(C)}
              >
                {selectedPlan ? (
                  <>
                    <div
                      className="p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
                      style={{ borderBottom: `1px solid ${C.divider}` }}
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <StatusPill status={selectedPlan.status} C={C} />
                          <span
                            className="text-[10px] uppercase tracking-widest font-bold"
                            style={{ color: C.faint }}
                          >
                            Reusable access blueprint
                          </span>
                        </div>
                        <h3
                          className="text-xl font-black"
                          style={{ color: C.text }}
                        >
                          {selectedPlan.name}
                        </h3>
                        <p
                          className="text-sm mt-2 max-w-xl"
                          style={{ color: C.muted }}
                        >
                          {selectedPlan.description ||
                            "No description has been added yet."}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 self-start">
                        <button
                          onClick={() => openEditPlan(selectedPlan)}
                          disabled={busy}
                          className={primary}
                          style={{ background: C.pill, color: C.text }}
                        >
                          <Pencil className="w-4 h-4" />
                          Edit details and pricing
                        </button>
                        <button
                          onClick={togglePlan}
                          disabled={busy || !!selectedPlan.archived_at}
                          title={
                            selectedPlan.archived_at
                              ? "Restore this plan before switching it back on."
                              : undefined
                          }
                          className={primary}
                          style={{
                            background:
                              selectedPlan.status === "active"
                                ? C.deleteBg
                                : C.successBg,
                            color:
                              selectedPlan.status === "active"
                                ? C.deleteText
                                : C.successText,
                          }}
                        >
                          {selectedPlan.status === "active"
                            ? "Deactivate plan"
                            : "Activate plan"}
                        </button>
                      </div>
                    </div>
                    <div className="p-6">
                      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
                        <div>
                          <p className="font-bold" style={{ color: C.text }}>
                            Included experiences
                          </p>
                          <p
                            className="text-xs mt-1"
                            style={{ color: C.faint }}
                          >
                            Select multiple items, then save once. Changes apply
                            to every subscriber.
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className="text-xs font-bold px-3 py-1.5 rounded-full"
                            style={{ background: `${C.cta}12`, color: C.cta }}
                          >
                            {selectedContentKeys.length} selected
                          </span>
                          <button
                            onClick={savePlanContentSelection}
                            disabled={
                              busy ||
                              new Set(selectedContentKeys).size !==
                                selectedContentKeys.length ||
                              (selectedContentKeys.length ===
                                planContent.length &&
                                selectedContentKeys.every((key) =>
                                  planContent.some(
                                    (item) =>
                                      `${item.content_table}:${item.content_id}` ===
                                      key,
                                  ),
                                ))
                            }
                            className={primary}
                            style={{ background: C.cta, color: C.ctaText }}
                          >
                            <Check
                              className="w-4 h-4"
                              style={{ color: "#ffffff" }}
                            />
                            {busy ? "Saving..." : "Save selection"}
                          </button>
                        </div>
                      </div>
                      <div className="relative mb-5">
                        <Search
                          className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2"
                          style={{ color: C.faint }}
                        />
                        <input
                          value={contentSearch}
                          onChange={(e) => setContentSearch(e.target.value)}
                          placeholder="Search published content..."
                          className={`${fieldClass} pl-10`}
                          style={inputStyle}
                        />
                      </div>
                      <div className="space-y-6">
                        {CONTENT_TYPES.map((type) => {
                          const items = contentOptions.filter(
                            (item) =>
                              item.content_table === type.value &&
                              (!contentSearch ||
                                item.title
                                  .toLowerCase()
                                  .includes(contentSearch.toLowerCase())),
                          );
                          if (!items.length) return null;
                          const groupKeys = items.map(
                            (item) => `${item.content_table}:${item.id}`,
                          );
                          const allSelected = groupKeys.every((key) =>
                            selectedContentKeys.includes(key),
                          );
                          return (
                            <div key={type.value}>
                              <div className="flex items-center justify-between mb-2">
                                <div>
                                  <p
                                    className="text-xs font-bold uppercase tracking-[0.16em]"
                                    style={{ color: C.faint }}
                                  >
                                    {type.label}
                                    {type.label.endsWith("s") ? "" : "s"}
                                  </p>
                                  <p
                                    className="text-[10px] mt-0.5"
                                    style={{ color: C.faint }}
                                  >
                                    {
                                      groupKeys.filter((key) =>
                                        selectedContentKeys.includes(key),
                                      ).length
                                    }{" "}
                                    of {items.length} selected
                                  </p>
                                </div>
                                <button
                                  onClick={() =>
                                    setSelectedContentKeys((current) =>
                                      allSelected
                                        ? current.filter(
                                            (key) => !groupKeys.includes(key),
                                          )
                                        : [
                                            ...new Set([
                                              ...current,
                                              ...groupKeys,
                                            ]),
                                          ],
                                    )
                                  }
                                  className="text-xs font-bold"
                                  style={{ color: C.cta }}
                                >
                                  {allSelected ? "Clear group" : "Select all"}
                                </button>
                              </div>
                              <div className="grid md:grid-cols-2 gap-2">
                                {items.map((item) => {
                                  const key = `${item.content_table}:${item.id}`;
                                  const selected =
                                    selectedContentKeys.includes(key);
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => toggleContentKey(key)}
                                      className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all"
                                      style={{
                                        background: selected
                                          ? `${C.cta}10`
                                          : C.page,
                                        boxShadow: selected
                                          ? `inset 0 0 0 1.5px ${C.cta}`
                                          : "none",
                                      }}
                                    >
                                      <span
                                        className="w-5 h-5 rounded-full flex-shrink-0 grid place-items-center"
                                        style={{
                                          background: selected
                                            ? C.cta
                                            : C.card,
                                          border: `1.5px solid ${selected ? C.cta : C.divider}`,
                                        }}
                                      >
                                        {selected && (
                                          <Check
                                            className="w-3 h-3"
                                            style={{ color: "#ffffff" }}
                                          />
                                        )}
                                      </span>
                                      <span
                                        className="text-sm font-semibold truncate"
                                        style={{ color: C.text }}
                                      >
                                        {item.title}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        {contentOptions.length === 0 && (
                          <div
                            className="rounded-2xl py-14 text-center"
                            style={{ background: C.page }}
                          >
                            <Layers3
                              className="w-8 h-8 mx-auto"
                              style={{ color: C.faint }}
                            />
                            <p
                              className="text-sm mt-3"
                              style={{ color: C.muted }}
                            >
                              No published content is available.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-full min-h-[520px] grid place-items-center text-center p-8">
                    <div>
                      <ShieldCheck
                        className="w-10 h-10 mx-auto"
                        style={{ color: C.faint }}
                      />
                      <p className="font-bold mt-3" style={{ color: C.text }}>
                        Select a plan to begin
                      </p>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}

      {assignMenuOpen && (
        <>
          <button
            aria-label="Close subscription assignment menu"
            className="fixed inset-0 z-[70] cursor-default"
            onClick={() => setAssignMenuOpen(false)}
          />
          <div
            role="menu"
            className="fixed z-[75] w-72 max-w-[calc(100vw-24px)] rounded-2xl p-2"
            style={{
              ...modalStyle(C),
              top: assignMenuPosition.top,
              right: assignMenuPosition.right,
              background: dark ? C.pill : C.card,
              border: `1px solid ${C.divider}`,
            }}
          >
            <button
              role="menuitem"
              onClick={openEnrol}
              className="w-full flex items-start gap-3 rounded-xl px-3 py-3 text-left"
              style={{ color: C.text }}
            >
              <UserPlus className="w-4 h-4 mt-0.5" style={{ color: C.cta }} />
              <span>
                <span className="block text-sm font-bold">Single learner</span>
                <span className="block text-xs mt-1" style={{ color: C.faint }}>
                  Select an existing learner or create a new account.
                </span>
              </span>
            </button>
            <button
              role="menuitem"
              onClick={() => openBulkImport()}
              disabled={activePlans.length === 0}
              className="w-full flex items-start gap-3 rounded-xl px-3 py-3 text-left disabled:opacity-50"
              style={{ color: C.text }}
            >
              <FileSpreadsheet className="w-4 h-4 mt-0.5" style={{ color: C.cta }} />
              <span>
                <span className="block text-sm font-bold">Bulk learners</span>
                <span className="block text-xs mt-1" style={{ color: C.faint }}>
                  Upload CSV or paste multiple learner emails.
                </span>
              </span>
            </button>
          </div>
        </>
      )}

      {subscriberMenu && (
        <>
          <button
            aria-label="Close subscriber actions"
            className="fixed inset-0 z-[70] cursor-default"
            onClick={() => setSubscriberMenu(null)}
          />
          <div
            className="fixed z-[75] w-52 rounded-xl p-2"
            style={{
              ...modalStyle(C),
              top: subscriberMenu.top,
              right: subscriberMenu.right,
              background: dark ? C.pill : C.card,
              border: `1px solid ${C.divider}`,
            }}
          >
            {[
              {
                label: "Change plan",
                tooltip: "Switch plans without changing price, duration, or expiry.",
                icon: Layers3,
                onClick: () =>
                  openSubscriberAction(subscriberMenu.sub, "change-plan"),
              },
              {
                label: "Request payment",
                tooltip: "Send a renewal request; access extends after approval.",
                icon: Clock3,
                onClick: () =>
                  openSubscriberAction(subscriberMenu.sub, "request-payment"),
              },
              {
                label: "Extend access",
                tooltip: "Record a verified payment and extend access immediately.",
                icon: CalendarClock,
                onClick: () =>
                  openSubscriberAction(subscriberMenu.sub, "extend-access"),
              },
              {
                label: "History",
                tooltip: "View the learner's subscription payment history.",
                icon: History,
                onClick: () => showHistory(subscriberMenu.sub),
              },
            ].map(({ label, tooltip, icon: Icon, onClick }) => (
              <div key={label} className="group/action relative">
                <button
                  onClick={onClick}
                  title={tooltip}
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold"
                  style={{ color: C.text }}
                >
                  <Icon className="w-4 h-4" style={{ color: C.cta }} />
                  {label}
                </button>
                <span
                  role="tooltip"
                  className="hidden sm:block pointer-events-none absolute right-full top-1/2 z-10 mr-2 w-64 -translate-y-1/2 rounded-lg px-3 py-2 text-xs leading-relaxed opacity-0 transition-opacity group-hover/action:opacity-100 group-focus-within/action:opacity-100"
                  style={{ background: C.text, color: C.card }}
                >
                  {tooltip}
                </span>
              </div>
            ))}
            <div className="my-1" style={{ borderTop: `1px solid ${C.divider}` }} />
            {subscriberMenu.sub.status === "active" && (
              <div className="group/action relative">
                <button
                  onClick={() => cancelSubscription(subscriberMenu.sub)}
                  title="Cancel the subscription but keep the learner account."
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold"
                  style={{ color: C.deleteText }}
                >
                  <XCircle className="w-4 h-4" />
                  Revoke access
                </button>
                <span
                  role="tooltip"
                  className="hidden sm:block pointer-events-none absolute right-full top-1/2 z-10 mr-2 w-64 -translate-y-1/2 rounded-lg px-3 py-2 text-xs leading-relaxed opacity-0 transition-opacity group-hover/action:opacity-100 group-focus-within/action:opacity-100"
                  style={{ background: C.text, color: C.card }}
                >
                  Cancel the subscription but keep the learner account.
                </span>
              </div>
            )}
            <div className="group/action relative">
              <button
                onClick={() => deleteSubscriberAccount(subscriberMenu.sub)}
                title="Permanently delete the learner while retaining anonymized financial history."
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold"
                style={{ color: C.deleteText }}
              >
                <Trash2 className="w-4 h-4" />
                Delete account
              </button>
              <span
                role="tooltip"
                className="hidden sm:block pointer-events-none absolute right-full top-1/2 z-10 mr-2 w-64 -translate-y-1/2 rounded-lg px-3 py-2 text-xs leading-relaxed opacity-0 transition-opacity group-hover/action:opacity-100 group-focus-within/action:opacity-100"
                style={{ background: C.text, color: C.card }}
              >
                Permanently delete the learner while retaining anonymized financial history.
              </span>
            </div>
          </div>
        </>
      )}

      {bulkPlan && (
        <Modal
          title="Bulk add learners"
          eyebrow="CSV or pasted learners"
          onClose={() => setBulkPlan(null)}
          C={C}
          wide
        >
          <div className="space-y-6">
            <label className="text-xs font-bold" style={{ color: C.muted }}>
              Access plan
              <select
                value={bulkPlan.id}
                onChange={(event) => {
                  const nextPlan = activePlans.find(
                    (plan) => plan.id === event.target.value,
                  );
                  if (nextPlan) {
                    setBulkPlan(nextPlan);
                    setBulkResult(null);
                    setBulkError("");
                  }
                }}
                className={`${fieldClass} mt-1.5`}
                style={inputStyle}
              >
                {activePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
              <span className="block font-normal mt-1.5" style={{ color: C.faint }}>
                Every learner in this import will be assigned to this plan.
              </span>
            </label>
            <div className="pt-3">
              <p className="text-sm font-bold mb-3" style={{ color: C.text }}>
                How should payment be handled?
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {([
                  {
                    value: "request" as const,
                    title: "Request payment",
                    description: "Learners confirm payment before an admin approves access.",
                  },
                  {
                    value: "paid" as const,
                    title: "Already paid",
                    description: "Record verified payments and activate access immediately.",
                  },
                ]).map(({ value, title, description }) => {
                  const selected = bulkMode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setBulkMode(value);
                        setBulkResult(null);
                        setBulkError("");
                      }}
                      className="flex items-start gap-3 rounded-2xl p-4 text-left"
                      style={{
                        background: selected ? `${C.cta}12` : C.card,
                        border: `1.5px solid ${selected ? C.cta : C.divider}`,
                      }}
                    >
                      <span
                        className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full"
                        style={{
                          background: selected ? C.cta : C.card,
                          border: `1.5px solid ${selected ? C.cta : C.divider}`,
                        }}
                      >
                        {selected && (
                          <Check
                            className="h-3 w-3"
                            style={{ color: "#ffffff" }}
                          />
                        )}
                      </span>
                      <span>
                        <span className="block text-sm font-bold" style={{ color: C.text }}>
                          {title}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed" style={{ color: C.faint }}>
                          {description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: C.page }}>
              <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: C.cta }} />
              <div>
                <p className="text-sm font-bold" style={{ color: C.text }}>
                  {bulkMode === "request" ? "Payment approval controls access" : "Access begins immediately"}
                </p>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: C.muted }}>
                  {bulkMode === "request"
                    ? "Each learner receives a payment request. Their subscription becomes active only after their payment confirmation is approved."
                    : "Use this only for payments you have already verified. Each learner is activated as soon as the import succeeds."}
                </p>
              </div>
            </div>

            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm font-bold" style={{ color: C.text }}>1. Add learners</p>
                  <p className="text-xs mt-1" style={{ color: C.faint }}>Upload a .csv file or paste CSV rows or one email per line.</p>
                </div>
                <div className="flex flex-wrap gap-2 self-start">
                  <button
                    type="button"
                    onClick={downloadBulkTemplate}
                    className={primary}
                    style={{ background: C.pill, color: C.text }}
                  >
                    <Download className="w-4 h-4" />
                    Download template
                  </button>
                  <label className={`${primary} cursor-pointer`} style={{ background: C.pill, color: C.text }}>
                    <Upload className="w-4 h-4" />Upload CSV
                    <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { readBulkFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                  </label>
                </div>
              </div>
              <textarea
                value={bulkText}
                onChange={(event) => updateBulkText(event.target.value)}
                className={`${fieldClass} min-h-44 font-mono text-xs leading-relaxed`}
                style={inputStyle}
                placeholder={'email,full_name\nada@example.com,Ada Mensah\nkwame@example.com,Kwame Asare'}
              />
              <p className="text-[11px] mt-2" style={{ color: C.faint }}>
                Required: email. Optional: full_name. The payment terms below apply to every learner in this batch.
              </p>
            </div>

            <div>
              <p className="text-sm font-bold mb-3" style={{ color: C.text }}>2. Default payment terms</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="text-xs font-bold" style={{ color: C.muted }}>Duration<select value={bulkDefaults.durationMonths} onChange={(event) => setBulkDefaults(value => ({ ...value, durationMonths: event.target.value }))} className={`${fieldClass} mt-1.5`} style={inputStyle}>{[1, 3, 6, 12].map(months => <option key={months} value={months}>{months} month{months === 1 ? "" : "s"}</option>)}</select></label>
                <label className="text-xs font-bold" style={{ color: C.muted }}>Amount<input type="number" inputMode="decimal" min="0.01" step="0.01" value={bulkDefaults.amount} onChange={(event) => setBulkDefaults(value => ({ ...value, amount: event.target.value }))} placeholder="0.00" className={`${fieldClass} mt-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} style={inputStyle} /></label>
                <label className="text-xs font-bold" style={{ color: C.muted }}>Currency<input value={bulkDefaults.currency} onChange={(event) => setBulkDefaults(value => ({ ...value, currency: event.target.value }))} className={`${fieldClass} mt-1.5`} style={inputStyle} /></label>
                {bulkMode === "request" ? (
                  <label className="text-xs font-bold" style={{ color: C.muted }}>Payment deadline<input type="date" value={bulkDefaults.dueDate} onChange={(event) => setBulkDefaults(value => ({ ...value, dueDate: event.target.value }))} className={`${fieldClass} mt-1.5`} style={inputStyle} /></label>
                ) : (
                  <label className="text-xs font-bold" style={{ color: C.muted }}>Payment method<input value={bulkDefaults.paymentMethod} onChange={(event) => setBulkDefaults(value => ({ ...value, paymentMethod: event.target.value }))} placeholder="Bank transfer" className={`${fieldClass} mt-1.5`} style={inputStyle} /></label>
                )}
              </div>
              {bulkMode === "paid" && (
                <div className="grid sm:grid-cols-2 gap-3 mt-3">
                  <label className="text-xs font-bold" style={{ color: C.muted }}>Payment reference<input value={bulkDefaults.paymentReference} onChange={(event) => setBulkDefaults(value => ({ ...value, paymentReference: event.target.value }))} placeholder="Optional shared reference" className={`${fieldClass} mt-1.5`} style={inputStyle} /></label>
                  <label className="text-xs font-bold" style={{ color: C.muted }}>Notes<input value={bulkDefaults.notes} onChange={(event) => setBulkDefaults(value => ({ ...value, notes: event.target.value }))} placeholder="Optional internal note" className={`${fieldClass} mt-1.5`} style={inputStyle} /></label>
                </div>
              )}
            </div>

            {bulkRows.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.divider}` }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ background: C.page }}><p className="text-sm font-bold" style={{ color: C.text }}>3. Review learners</p><span className="text-xs font-bold rounded-full px-2.5 py-1" style={{ background: `${C.cta}14`, color: C.cta }}>{bulkRows.length} parsed</span></div>
                <div className="max-h-52 overflow-y-auto divide-y" style={{ borderColor: C.divider }}>
                  {bulkRows.slice(0, 12).map((row, index) => <div key={`${row.email}-${index}`} className="grid sm:grid-cols-[36px_1fr_1fr] gap-2 px-4 py-2.5 text-xs"><span style={{ color: C.faint }}>{index + 1}</span><span className="truncate font-bold" style={{ color: C.text }}>{row.email}</span><span className="truncate" style={{ color: C.muted }}>{row.full_name || "Name not provided"}</span></div>)}
                  {bulkRows.length > 12 && <p className="px-4 py-3 text-xs text-center" style={{ color: C.faint }}>And {bulkRows.length - 12} more learners</p>}
                </div>
              </div>
            )}

            {bulkError && <div className="rounded-xl p-3 text-xs" style={{ background: C.errorBg, color: C.errorText }}>{bulkError}</div>}
            {bulkResult && <div className="space-y-3"><div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{[[bulkMode === "request" ? "Requests" : "Activated", bulkMode === "request" ? bulkResult.requested : bulkResult.activated], ["New accounts", bulkResult.newAccounts], ["Existing", bulkResult.existingStudents], ["Emails sent", bulkResult.paymentEmailsSent], ["Errors", bulkResult.errors?.length || 0]].map(([label, value]) => <div key={String(label)} className="rounded-xl p-3" style={{ background: C.page }}><p className="text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>{label}</p><p className="text-xl font-bold mt-1" style={{ color: C.text }}>{value}</p></div>)}</div>{bulkResult.errors?.length > 0 && <div className="rounded-xl p-3" style={{ background: C.errorBg, color: C.errorText }}><p className="text-xs font-bold mb-2">Rows needing attention</p>{bulkResult.errors.map((item: any) => <p key={`${item.row}-${item.email}`} className="text-xs mt-1">Row {item.row}: {item.email || "No email"} - {item.error}</p>)}</div>}{bulkResult.warnings?.length > 0 && <div className="rounded-xl p-3" style={{ background: "rgba(217,119,6,0.10)", color: "#b45309" }}>{bulkResult.warnings.map((item: any) => <p key={`${item.row}-${item.email}`} className="text-xs">Row {item.row}: {item.warning}</p>)}</div>}</div>}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button onClick={() => setBulkPlan(null)} className={primary} style={{ background: C.pill, color: C.text }}>{bulkResult ? "Close" : "Cancel"}</button>
              <button onClick={importBulkStudents} disabled={busy || bulkRows.length === 0 || bulkRows.length > 500 || Number(bulkDefaults.amount) <= 0 || !bulkDefaults.currency.trim() || (bulkMode === "request" && !bulkDefaults.dueDate)} className={primary} style={{ background: C.cta, color: C.ctaText }}><UserPlus className="w-4 h-4" />{busy ? (bulkMode === "request" ? "Creating requests..." : "Activating learners...") : bulkMode === "request" ? `Create ${bulkRows.length || ""} payment request${bulkRows.length === 1 ? "" : "s"}` : `Activate ${bulkRows.length || ""} learner${bulkRows.length === 1 ? "" : "s"}`}</button>
            </div>
          </div>
        </Modal>
      )}

      {createPlanOpen && (
        <Modal
          title="Create a subscription plan"
          eyebrow="Plan builder"
          onClose={requestClosePlanBuilder}
          C={C}
          error={error}
          wide
        >
          <div className="grid lg:grid-cols-[1fr_250px] gap-6">
            <div className="min-w-0">
              <div className="grid grid-cols-3 gap-2 mb-6">
                {[
                  ["Details", "Name your offer"],
                  ["Content", "Choose learning"],
                  ["Pricing", "Set purchase options"],
                ].map(([label, helper], index) => {
                  const complete = index < planBuilderStep;
                  const current = index === planBuilderStep;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        if (index === 0 || newPlanName.trim()) setPlanBuilderStep(index as 0 | 1 | 2);
                      }}
                      className="rounded-2xl p-3 text-left transition-all"
                      style={{
                        background: current ? `${C.cta}12` : C.page,
                        boxShadow: current ? `inset 0 0 0 1.5px ${C.cta}` : "none",
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold"
                          style={{ background: complete || current ? C.cta : C.card, color: complete || current ? C.ctaText : C.faint }}
                        >
                          {complete ? <Check className="w-3.5 h-3.5" /> : index + 1}
                        </span>
                        <span className="text-xs font-bold" style={{ color: current ? C.cta : C.text }}>{label}</span>
                      </span>
                      <span className="hidden sm:block text-[10px] mt-2" style={{ color: C.faint }}>{helper}</span>
                    </button>
                  );
                })}
              </div>

              {planBuilderStep === 0 && (
                <div className="space-y-5">
                  <div>
                    <h4 className="text-lg font-black" style={{ color: C.text }}>Start with a clear promise</h4>
                    <p className="text-sm mt-1" style={{ color: C.muted }}>Help learners quickly understand who the plan is for and what it unlocks.</p>
                  </div>
                  <label className="block text-xs font-bold" style={{ color: C.muted }}>
                    Plan name
                    <input
                      autoFocus
                      value={newPlanName}
                      onChange={(e) => setNewPlanName(e.target.value)}
                      placeholder="For example: Career Accelerator"
                      className={`${fieldClass} mt-1.5`}
                      style={inputStyle}
                    />
                  </label>
                  <label className="block text-xs font-bold" style={{ color: C.muted }}>
                    Short description
                    <textarea
                      value={newPlanDescription}
                      onChange={(e) => setNewPlanDescription(e.target.value)}
                      placeholder="Explain the outcome learners can expect from this plan"
                      className={`${fieldClass} mt-1.5 min-h-28 resize-none`}
                      style={inputStyle}
                      maxLength={240}
                    />
                    <span className="block text-right text-[10px] mt-1.5 font-normal" style={{ color: C.faint }}>{newPlanDescription.length}/240</span>
                  </label>
                  <div className="rounded-2xl p-4" style={{ background: C.page }}>
                    <p className="text-[10px] uppercase tracking-[0.16em] font-bold" style={{ color: C.faint }}>Learner preview</p>
                    <p className="font-black mt-2" style={{ color: C.text }}>{newPlanName.trim() || "Your plan name"}</p>
                    <p className="text-xs mt-1.5" style={{ color: C.muted }}>{newPlanDescription.trim() || "A concise description of the value learners receive."}</p>
                  </div>
                </div>
              )}

              {planBuilderStep === 1 && (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div>
                      <h4 className="text-lg font-black" style={{ color: C.text }}>Build the learning bundle</h4>
                      <p className="text-sm mt-1" style={{ color: C.muted }}>Select everything learners should unlock with this plan.</p>
                    </div>
                    <span className="self-start text-xs font-bold rounded-full px-3 py-1.5" style={{ background: `${C.cta}12`, color: C.cta }}>
                      {newPlanContentKeys.length} selected
                    </span>
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: C.faint }} />
                    <input
                      value={newPlanContentSearch}
                      onChange={(e) => setNewPlanContentSearch(e.target.value)}
                      placeholder="Search your published content"
                      className={`${fieldClass} pl-10`}
                      style={inputStyle}
                    />
                  </div>
                  <div className="max-h-[390px] overflow-y-auto pr-1 space-y-5">
                    {CONTENT_TYPES.map((type) => {
                      const items = contentOptions.filter((item) => item.content_table === type.value && (!newPlanContentSearch || item.title.toLowerCase().includes(newPlanContentSearch.toLowerCase())));
                      if (!items.length) return null;
                      const groupKeys = items.map((item) => `${item.content_table}:${item.id}`);
                      const allSelected = groupKeys.every((key) => newPlanContentKeys.includes(key));
                      return (
                        <div key={type.value}>
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <p className="text-xs font-bold" style={{ color: C.text }}>{type.label}{type.label.endsWith("s") ? "" : "s"}</p>
                              <p className="text-[10px] mt-0.5" style={{ color: C.faint }}>{groupKeys.filter((key) => newPlanContentKeys.includes(key)).length} of {items.length} selected</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setNewPlanContentKeys((current) => allSelected ? current.filter((key) => !groupKeys.includes(key)) : [...new Set([...current, ...groupKeys])])}
                              className="text-xs font-bold"
                              style={{ color: C.cta }}
                            >
                              {allSelected ? "Clear" : "Select all"}
                            </button>
                          </div>
                          <div className="grid sm:grid-cols-2 gap-2">
                            {items.map((item) => {
                              const key = `${item.content_table}:${item.id}`;
                              const selected = newPlanContentKeys.includes(key);
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => setNewPlanContentKeys((current) => selected ? current.filter((value) => value !== key) : [...current, key])}
                                  className="flex items-center gap-3 rounded-2xl p-3 text-left transition-all"
                                  style={{ background: selected ? `${C.cta}10` : C.page, boxShadow: selected ? `inset 0 0 0 1.5px ${C.cta}` : "none" }}
                                >
                                  <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0" style={{ background: selected ? C.cta : C.card, border: `1px solid ${selected ? C.cta : C.divider}` }}>
                                    {selected && <Check className="w-3 h-3" style={{ color: "#ffffff" }} />}
                                  </span>
                                  <span className="text-xs font-bold truncate" style={{ color: C.text }}>{item.title}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {contentOptions.length === 0 && (
                      <div className="rounded-2xl py-12 text-center" style={{ background: C.page }}>
                        <Layers3 className="w-7 h-7 mx-auto" style={{ color: C.faint }} />
                        <p className="text-sm font-bold mt-3" style={{ color: C.text }}>No published content yet</p>
                        <p className="text-xs mt-1" style={{ color: C.faint }}>Publish content first, or save this plan as a draft.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {planBuilderStep === 2 && (
                <div className="space-y-5">
                  <div>
                    <h4 className="text-lg font-black" style={{ color: C.text }}>Make pricing easy to choose</h4>
                    <p className="text-sm mt-1" style={{ color: C.muted }}>Add one or more purchase options. Entering an amount turns that option on automatically.</p>
                  </div>
                  <PlanPriceFields prices={newPlanPrices} setPrices={setNewPlanPrices} C={C} fieldClass={fieldClass} inputStyle={inputStyle} />
                  <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: C.page }}>
                    <ShieldCheck className="w-5 h-5 flex-shrink-0" style={{ color: C.cta }} />
                    <div>
                      <p className="text-sm font-bold" style={{ color: C.text }}>You control when it goes live</p>
                      <p className="text-xs mt-1" style={{ color: C.faint }}>Save a draft to finish later, or create and activate once content and at least one valid price are ready.</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-7 pt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
                <button
                  type="button"
                  onClick={() => planBuilderStep === 0 ? requestClosePlanBuilder() : setPlanBuilderStep((planBuilderStep - 1) as 0 | 1)}
                  disabled={busy}
                  className={primary}
                  style={{ background: C.pill, color: C.text }}
                >
                  {planBuilderStep === 0 ? "Cancel" : "Back"}
                </button>
                {planBuilderStep < 2 ? (
                  <button
                    type="button"
                    onClick={() => setPlanBuilderStep((planBuilderStep + 1) as 1 | 2)}
                    disabled={!newPlanName.trim()}
                    className={primary}
                    style={{ background: C.cta, color: C.ctaText }}
                  >
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={() => createPlan("inactive")}
                      disabled={busy || !newPlanName.trim()}
                      className={primary}
                      style={{ background: C.pill, color: C.text }}
                    >
                      Save draft
                    </button>
                    <button
                      type="button"
                      onClick={() => createPlan("active")}
                      disabled={busy || !newPlanName.trim() || newPlanContentKeys.length === 0 || !newPlanPrices.some((price) => price.isActive && Number(price.amount) > 0)}
                      className={primary}
                      style={{ background: C.cta, color: C.ctaText }}
                    >
                      <Sparkles className="w-4 h-4" />
                      {busy ? "Creating..." : "Create and activate"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <aside className="rounded-2xl p-4 self-start lg:sticky lg:top-0" style={{ background: C.page }}>
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4" style={{ color: C.cta }} />
                <p className="text-sm font-black" style={{ color: C.text }}>Plan readiness</p>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  [Boolean(newPlanName.trim()), "Plan details", newPlanName.trim() || "Name still needed"],
                  [newPlanContentKeys.length > 0, "Included content", newPlanContentKeys.length ? `${newPlanContentKeys.length} items selected` : "Add at least one item"],
                  [newPlanPrices.some((price) => price.isActive && Number(price.amount) > 0), "Purchase options", `${newPlanPrices.filter((price) => price.isActive && Number(price.amount) > 0).length} active prices`],
                ].map(([ready, label, detail]) => (
                  <div key={String(label)} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0 mt-0.5" style={{ background: ready ? C.successBg : C.card, color: ready ? C.successText : C.faint }}>
                      {ready ? <Check className="w-3 h-3" /> : <span className="text-[10px]">!</span>}
                    </span>
                    <div>
                      <p className="text-xs font-bold" style={{ color: C.text }}>{label}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
                <div className="flex items-center justify-between text-[11px] font-bold" style={{ color: C.muted }}>
                  <span>Setup progress</span>
                  <span>{[Boolean(newPlanName.trim()), newPlanContentKeys.length > 0, newPlanPrices.some((price) => price.isActive && Number(price.amount) > 0)].filter(Boolean).length}/3</span>
                </div>
                <div className="h-2 rounded-full mt-2 overflow-hidden" style={{ background: C.card }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${([Boolean(newPlanName.trim()), newPlanContentKeys.length > 0, newPlanPrices.some((price) => price.isActive && Number(price.amount) > 0)].filter(Boolean).length / 3) * 100}%`,
                      background: C.cta,
                    }}
                  />
                </div>
              </div>
            </aside>
          </div>
        </Modal>
      )}

      {editPlan && (
        <Modal
          title="Edit plan details"
          eyebrow="Reusable access blueprint"
          onClose={requestCloseEditPlan}
          C={C}
          error={error}
        >
          <div className="space-y-4">
            <label className="text-xs font-bold" style={{ color: C.muted }}>
              Plan name
              <input
                autoFocus
                value={editPlanName}
                onChange={(e) => setEditPlanName(e.target.value)}
                placeholder="For example: Professional"
                className={`${fieldClass} mt-1.5`}
                style={inputStyle}
              />
            </label>
            <label className="text-xs font-bold" style={{ color: C.muted }}>
              Description
              <textarea
                value={editPlanDescription}
                onChange={(e) => setEditPlanDescription(e.target.value)}
                placeholder="Describe who this plan is for"
                className={`${fieldClass} mt-1.5 min-h-24`}
                style={inputStyle}
              />
            </label>
            <div>
              <PlanPriceFields
                prices={editPlanPrices}
                setPrices={setEditPlanPrices}
                C={C}
                fieldClass={fieldClass}
                inputStyle={inputStyle}
              />
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                onClick={requestCloseEditPlan}
                disabled={busy}
                className={primary}
                style={{ background: C.pill, color: C.text }}
              >
                Cancel
              </button>
              <button
                onClick={savePlanDetails}
                disabled={busy || !editPlanName.trim()}
                className={primary}
                style={{ background: C.cta, color: C.ctaText }}
              >
                <Check className="w-4 h-4" style={{ color: "#ffffff" }} />
                {busy ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {unsavedPlanDialog && (
        <Modal
          title="Save your changes?"
          eyebrow="Unsaved plan setup"
          onClose={() => setUnsavedPlanDialog(null)}
          C={C}
        >
          <div>
            <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: C.page }}>
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "#d97706" }} />
              <div>
                <p className="text-sm font-bold" style={{ color: C.text }}>
                  You have unsaved changes
                </p>
                <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.muted }}>
                  {unsavedPlanDialog === "create"
                    ? "Save this setup as a draft so you can continue later, or discard it permanently."
                    : "Save the updates to this plan, or discard the changes you just made."}
                </p>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => {
                  if (unsavedPlanDialog === "create") setCreatePlanOpen(false);
                  else setEditPlan(null);
                  setUnsavedPlanDialog(null);
                  setError("");
                }}
                disabled={busy}
                className={primary}
                style={{ background: C.deleteBg, color: C.deleteText }}
              >
                Discard changes
              </button>
              <button
                type="button"
                onClick={() => setUnsavedPlanDialog(null)}
                disabled={busy}
                className={primary}
                style={{ background: C.pill, color: C.text }}
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => unsavedPlanDialog === "create" ? createPlan("inactive") : savePlanDetails()}
                disabled={busy || (unsavedPlanDialog === "create" ? !newPlanName.trim() : !editPlanName.trim())}
                className={primary}
                style={{ background: C.cta, color: C.ctaText }}
              >
                <Check className="w-4 h-4" />
                {unsavedPlanDialog === "create" ? "Save draft" : "Save changes"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {enrolOpen && (
        <Modal
          title="Assign a subscription"
          eyebrow="New learner access"
          onClose={() => setEnrolOpen(false)}
          C={C}
          error={error}
          wide
        >
          <div className="space-y-6">
            <div>
              <p className="text-xs font-bold mb-2" style={{ color: C.muted }}>
                Learner account
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {(
                  [
                    ["existing", "Existing learner", "Choose an unassigned student", Users],
                    ["new", "New learner", "Create the account and assign the plan", UserPlus],
                  ] as const
                ).map(([id, title, body, Icon]) => (
                  <button
                    key={id}
                    onClick={() => {
                      setLearnerMode(id);
                      setPaidAttemptKey("");
                      setError("");
                    }}
                    className="rounded-2xl p-4 text-left"
                    style={{
                      background: learnerMode === id ? `${C.cta}10` : C.page,
                      outline: learnerMode === id ? `2px solid ${C.cta}` : "2px solid transparent",
                    }}
                  >
                    <Icon className="w-5 h-5 mb-3" style={{ color: learnerMode === id ? C.cta : C.faint }} />
                    <p className="text-sm font-bold" style={{ color: C.text }}>{title}</p>
                    <p className="text-xs mt-1" style={{ color: C.faint }}>{body}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {learnerMode === "existing" ? (
                <label className="text-xs font-bold" style={{ color: C.muted }}>
                  Learner
                  <select
                    value={studentId}
                    onChange={(e) => { setStudentId(e.target.value); setPaidAttemptKey(""); }}
                    className={`${fieldClass} mt-1.5`}
                    style={inputStyle}
                  >
                    <option value="">Choose an eligible student</option>
                    {eligibleStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name || s.email} ({s.email})
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3 sm:col-span-2">
                  <label className="text-xs font-bold" style={{ color: C.muted }}>
                    Full name
                    <input
                      autoFocus
                      value={newLearnerName}
                      onChange={(e) => setNewLearnerName(e.target.value)}
                      placeholder="Learner's full name"
                      className={`${fieldClass} mt-1.5`}
                      style={inputStyle}
                    />
                  </label>
                  <label className="text-xs font-bold" style={{ color: C.muted }}>
                    Email address
                    <input
                      type="email"
                      value={newLearnerEmail}
                      onChange={(e) => setNewLearnerEmail(e.target.value)}
                      placeholder="learner@example.com"
                      className={`${fieldClass} mt-1.5`}
                      style={inputStyle}
                    />
                  </label>
                </div>
              )}
              <label className="text-xs font-bold" style={{ color: C.muted }}>
                Access plan
                <select
                  value={planId}
                  onChange={(e) => { setPlanId(e.target.value); setPaidAttemptKey(""); }}
                  className={`${fieldClass} mt-1.5`}
                  style={inputStyle}
                >
                  <option value="">Choose an active plan</option>
                  {activePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <p className="text-xs font-bold mb-2" style={{ color: C.muted }}>
                Payment workflow
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {(
                  [
                    [
                      "request",
                      "Request payment",
                      "Student submits confirmation before access starts",
                      Clock3,
                    ],
                    [
                      "paid",
                      "Already paid",
                      "Record verified payment and activate now",
                      BadgeCheck,
                    ],
                  ] as const
                ).map(([id, title, body, Icon]) => (
                  <button
                    key={id}
                    onClick={() => { setEnrolMode(id); setPaidAttemptKey(""); }}
                    className="rounded-2xl p-4 text-left"
                    style={{
                      background: enrolMode === id ? `${C.cta}10` : C.page,
                      outline:
                        enrolMode === id
                          ? `2px solid ${C.cta}`
                          : "2px solid transparent",
                    }}
                  >
                    <Icon
                      className="w-5 h-5 mb-3"
                      style={{ color: enrolMode === id ? C.cta : C.faint }}
                    />
                    <p className="text-sm font-bold" style={{ color: C.text }}>
                      {title}
                    </p>
                    <p className="text-xs mt-1" style={{ color: C.faint }}>
                      {body}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            {TermsFields(enrolMode === "request")}
            {enrolMode === "paid" && ReferenceFields()}
            {learnerMode === "existing" && eligibleStudents.length === 0 && (
              <p
                className="rounded-xl p-3 text-xs"
                style={{ background: C.page, color: C.muted }}
              >
                No eligible students. The student must be unassigned from any
                bootcamp cohort first.
              </p>
            )}
            <button
              onClick={() =>
                learnerMode === "new"
                  ? assignNewLearner()
                  : enrolMode === "request"
                    ? assignRequest()
                    : savePaid()
              }
              disabled={
                busy ||
                (learnerMode === "existing"
                  ? !studentId
                  : !newLearnerName.trim() || !/^\S+@\S+\.\S+$/.test(newLearnerEmail.trim())) ||
                !planId ||
                Number(payment.amount) <= 0 ||
                (enrolMode === "request" && !payment.dueDate)
              }
              className={`${primary} w-full py-3`}
              style={{ background: C.cta, color: C.ctaText }}
            >
              {busy
                ? "Saving..."
                : learnerMode === "new" && enrolMode === "request"
                  ? "Create account and assign plan"
                  : learnerMode === "new"
                    ? "Create account and activate"
                : enrolMode === "request"
                  ? "Assign payment request"
                  : "Activate subscription"}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </Modal>
      )}

      {manageSub && manageAction && (
        <Modal
          title={
            manageAction === "change-plan"
              ? "Change plan"
              : manageAction === "request-payment"
                ? "Request renewal payment"
                : "Record payment and extend"
          }
          eyebrow={manageSub.students?.full_name || manageSub.students?.email}
          onClose={() => {
            setManageSub(null);
            setManageAction(null);
            setError("");
          }}
          C={C}
          error={error}
        >
          {manageAction === "change-plan" ? (
            <div className="space-y-5">
              <div className="rounded-2xl p-4" style={{ background: C.page }}>
                <p className="text-xs" style={{ color: C.faint }}>Current plan</p>
                <p className="font-bold mt-1" style={{ color: C.text }}>
                  {manageSub.subscription_plans?.name}
                </p>
              </div>
              <p className="font-bold" style={{ color: C.text }}>
                Select the new plan
              </p>
              <p className="text-xs -mt-4" style={{ color: C.faint }}>
                Price, duration and expiry remain unchanged.
              </p>
              <select
                value={changePlanId}
                onChange={(e) => setChangePlanId(e.target.value)}
                className={fieldClass}
                style={inputStyle}
              >
                {activePlans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={changePlan}
                disabled={busy || changePlanId === manageSub.plan_id}
                className={`${primary} w-full`}
                style={{ background: C.cta, color: C.ctaText }}
              >
                {busy ? "Saving..." : "Apply plan"}
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-2xl p-4" style={{ background: C.page }}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs" style={{ color: C.faint }}>Current expiry</p>
                    <p className="font-bold mt-1" style={{ color: C.text }}>
                      {dateLabel(manageSub.current_period_end)}
                    </p>
                  </div>
                  <StatusPill status={manageSub.status} C={C} />
                </div>
              </div>
              {TermsFields(manageAction === "request-payment")}
              {manageAction === "extend-access" && ReferenceFields()}
              <p className="text-xs" style={{ color: C.faint }}>
                {manageAction === "request-payment"
                  ? "Access extends only after the learner submits payment confirmation and it is approved."
                  : "This records a verified payment and extends access immediately."}
              </p>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  onClick={() => {
                    setManageSub(null);
                    setManageAction(null);
                    setError("");
                  }}
                  disabled={busy}
                  className={primary}
                  style={{ background: C.pill, color: C.text }}
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    manageAction === "request-payment"
                      ? assignRequest(manageSub)
                      : savePaid(manageSub)
                  }
                  disabled={
                    busy ||
                    Number(payment.amount) <= 0 ||
                    (manageAction === "request-payment" && !payment.dueDate)
                  }
                  className={primary}
                  style={{ background: C.cta, color: C.ctaText }}
                >
                  {busy
                    ? "Saving..."
                    : manageAction === "request-payment"
                      ? "Send payment request"
                      : "Record and extend"}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {reviewTarget && (
        <Modal
          title={
            reviewTarget.decision === "approve"
              ? "Approve payment confirmation"
              : "Reject payment confirmation"
          }
          eyebrow="Financial review"
          onClose={() => setReviewTarget(null)}
          C={C}
          error={error}
        >
          <div className="space-y-5">
            <div className="rounded-2xl p-5" style={{ background: C.page }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs" style={{ color: C.faint }}>
                    {reviewTarget.request.students?.full_name ||
                      reviewTarget.request.students?.email}
                  </p>
                  <p
                    className="text-2xl font-black mt-1"
                    style={{ color: C.text }}
                  >
                    {money(
                      reviewTarget.request.currency,
                      reviewTarget.request.amount,
                    )}
                  </p>
                </div>
                <CreditCard className="w-7 h-7" style={{ color: C.cta }} />
              </div>
              <div
                className="grid grid-cols-2 gap-3 mt-4 pt-4 text-xs"
                style={{ borderTop: `1px solid ${C.divider}`, color: C.muted }}
              >
                <span>{reviewTarget.request.plan_name}</span>
                <span className="text-right">
                  {reviewTarget.request.duration_months} months
                </span>
              </div>
            </div>
            <label className="text-xs font-bold" style={{ color: C.muted }}>
              {reviewTarget.decision === "reject"
                ? "Reason for rejection"
                : "Optional message to learner"}
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                className={`${fieldClass} mt-1.5 min-h-24`}
                style={inputStyle}
                placeholder={
                  reviewTarget.decision === "reject"
                    ? "Explain what needs to be corrected"
                    : "Add a short confirmation note"
                }
              />
            </label>
            <button
              onClick={submitReview}
              disabled={
                busy ||
                (reviewTarget.decision === "reject" && !reviewNotes.trim())
              }
              className={`${primary} w-full py-3`}
              style={{
                background:
                  reviewTarget.decision === "approve" ? C.cta : C.deleteText,
                color: "#fff",
              }}
            >
              {reviewTarget.decision === "approve" ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Approve and activate access
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4" />
                  Reject confirmation
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {historyOpen && (
        <Modal
          title="Subscription payment history"
          eyebrow="Immutable ledger"
          onClose={() => setHistoryOpen(false)}
          C={C}
          error={error}
        >
          <div className="relative pl-5">
            {history.map((row, index) => (
              <div key={row.id} className="relative pb-6">
                <span
                  className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full"
                  style={{
                    background: C.cta,
                    boxShadow: `0 0 0 4px ${C.page}`,
                  }}
                />
                {index < history.length - 1 && (
                  <span
                    className="absolute -left-[16px] top-4 h-full w-px"
                    style={{ background: C.divider }}
                  />
                )}
                <div className="rounded-xl p-4" style={{ background: C.page }}>
                  <div className="flex justify-between gap-3">
                    <p className="font-black" style={{ color: C.text }}>
                      {money(row.currency, row.amount)}
                    </p>
                    <p className="text-xs" style={{ color: C.faint }}>
                      {dateLabel(row.paid_at)}
                    </p>
                  </div>
                  <p
                    className="text-xs mt-2 capitalize"
                    style={{ color: C.muted }}
                  >
                    {row.plan_name} - {row.duration_months} months - {row.kind}
                  </p>
                  {row.payment_reference && (
                    <p className="text-xs mt-1" style={{ color: C.faint }}>
                      Reference: {row.payment_reference}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {history.length === 0 && (
              <p
                className="text-sm text-center py-8"
                style={{ color: C.faint }}
              >
                No payments recorded.
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* Asked before anything is closed, and again if the server turns something back. Closing
          open access is not a detail of saving a plan: it takes the content away from every
          learner who is not in a cohort and not a subscriber, part-way through included. */}
      {closePublicAsk && (
        <Modal
          title="Some of this is open to everyone"
          onClose={() => {
            closePublicAsk.resolve(false);
            setClosePublicAsk(null);
          }}
          C={C}
        >
          <div className="space-y-4">
            <p className="text-sm" style={{ color: C.text }}>
              {closePublicAsk.titles.length === 1
                ? "This is public. Make it available to this plan and your cohorts instead?"
                : "These are public. Make them available to this plan and your cohorts instead?"}
            </p>
            <ul className="space-y-1.5">
              {closePublicAsk.titles.map((title, index) => (
                <li key={`${title}-${index}`} className="text-sm font-bold" style={{ color: C.text }}>
                  {title}
                </li>
              ))}
            </ul>
            <p className="text-xs" style={{ color: C.muted }}>
              Everyone else loses access.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  closePublicAsk.resolve(true);
                  setClosePublicAsk(null);
                }}
                className="rounded-xl px-4 py-2.5 text-sm font-bold"
                style={{ background: C.cta, color: C.ctaText }}
              >
                Make plan-only
              </button>
              <button
                type="button"
                onClick={() => {
                  closePublicAsk.resolve(false);
                  setClosePublicAsk(null);
                }}
                className="rounded-xl px-4 py-2.5 text-sm font-bold"
                style={{ background: C.pill, color: C.text }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
