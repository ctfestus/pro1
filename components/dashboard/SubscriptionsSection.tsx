"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  Download,
  History,
  Layers3,
  LayoutDashboard,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { durationLabel } from "@/lib/pricing-offer";
import {
  applyPlanContentChanges,
  describePlanContentResult,
  summarizePlanContentOutcomes,
  decideNewPlanActivation,
  type PlanContentChange,
  type PlanContentOutcome,
} from "@/lib/plan-content-request";
import { parseSubscriptionImportText } from "@/lib/subscription-import";
import { DARK_C, LIGHT_C, modalStyle } from "@/lib/theme";
import { effectiveSubscriptionPrice } from "@/lib/subscription-discount";
import { OverviewTab } from "@/components/dashboard/subscriptions/OverviewTab";
import { SubscribersTab } from "@/components/dashboard/subscriptions/SubscribersTab";
import { PaymentsTab } from "@/components/dashboard/subscriptions/PaymentsTab";
import { PlansTab } from "@/components/dashboard/subscriptions/PlansTab";
import type { PlanSummary, SubsTab } from "@/components/dashboard/subscriptions/types";
import { MenuSelect } from "@/components/MenuSelect";
import { PlanDiscountFields, PlanPriceFields, planDiscountStatus, type PlanDiscountDraft, type PlanPriceDraft } from "@/components/dashboard/subscriptions/PlanForm";
import {
  Count, DISPLAY_FONT, IconChip, OptionCard, btnClass, btnStyle, learnerName, dateLabel, daysRemaining, isLive, money, palette, pastDeadline,
  shortDate, subscriberBucket,
} from "@/components/dashboard/subscriptions/ui";

const CONTENT_TYPES = [
  { value: "courses", label: "Course" },
  { value: "virtual_experiences", label: "Virtual Experience" },
  { value: "certifications", label: "Certification" },
  { value: "learning_paths", label: "Learning Path" },
];

// The server refuses a payment deadline earlier than today, and a rejected save is a poor way
// to learn that -- a mistyped year or a reused date reads as valid until it is submitted. This
// is the same UTC day the server compares against, so the calendar cannot offer a date it will
// turn down. Spreadsheet imports carry their own dates and cannot be guarded here, which is why
// the server keeps the rule.
const earliestDeadline = () => new Date().toISOString().slice(0, 10);

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
const DURATION_OPTIONS = PLAN_PRICE_DURATIONS.map((months) => ({ value: String(months), label: durationLabel(months) }));

function freshPlanPrices(): PlanPriceDraft[] {
  return PLAN_PRICE_DURATIONS.map((durationMonths) => ({
    durationMonths: String(durationMonths),
    amount: "",
    currency: "GHS",
    isActive: false,
    sortOrder: durationMonths,
  }));
}

const freshPlanDiscount = (): PlanDiscountDraft => ({
  type: "",
  value: "",
  startsAt: "",
  endsAt: "",
  label: "",
});

function planDiscountFromRow(plan: any): PlanDiscountDraft {
  return {
    type: plan?.discount_type === "percentage" || plan?.discount_type === "fixed" ? plan.discount_type : "",
    value: plan?.discount_value == null ? "" : String(plan.discount_value),
    startsAt: plan?.discount_starts_at ? String(plan.discount_starts_at).slice(0, 16) : "",
    endsAt: plan?.discount_ends_at ? String(plan.discount_ends_at).slice(0, 16) : "",
    label: plan?.discount_label ?? "",
  };
}

function planDiscountPayload(discount: PlanDiscountDraft) {
  return {
    type: discount.type,
    value: discount.type ? Number(discount.value) : null,
    startsAt: discount.type && discount.startsAt ? `${discount.startsAt}:00.000Z` : null,
    endsAt: discount.type && discount.endsAt ? `${discount.endsAt}:00.000Z` : null,
    label: discount.type ? discount.label.trim() || null : null,
  };
}

function startingPlanPrice(plan: any) {
  const price = [...(plan?.subscription_plan_prices ?? [])]
    .filter((row: any) => row.is_active)
    .sort((a: any, b: any) => Number(a.amount) - Number(b.amount))[0];
  if (!price) return null;
  return { ...price, ...effectiveSubscriptionPrice(price.amount, plan) };
}

type Tab = SubsTab;

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

function planIsReady(plan: any) {
  return (
    (plan?.subscription_plan_prices ?? []).some((price: any) => price.is_active && Number(price.amount) > 0) &&
    (plan?.subscription_plan_content ?? []).length > 0
  );
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
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? "max-w-4xl" : "max-w-xl"} max-h-[92vh] overflow-hidden rounded-[20px] flex flex-col`}
        style={modalStyle(C)}
      >
        <div
          className="flex items-start justify-between gap-4 px-6 py-5"
          style={{ borderBottom: `1px solid ${C.divider}` }}
        >
          <div className="min-w-0">
            <h3 className="text-[22px] font-bold leading-7" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>
              {title}
            </h3>
            {eyebrow && (
              <p className="text-sm mt-1" style={{ color: C.muted }}>
                {eyebrow}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0 transition-opacity hover:opacity-70"
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
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold capitalize"
      style={{ background: `${tone}14`, color: tone }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone }} />
      {status === "inactive" ? "Draft" : status.replaceAll("_", " ")}
    </span>
  );
}


export function SubscriptionsSection({ C: theme }: { C: typeof LIGHT_C }) {
  // This page uses the dark-mode blue for buttons and selection controls in both modes. Text and
  // icons never use it: they stay in the neutral text colours.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
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
  const [newPlanDiscount, setNewPlanDiscount] = useState(freshPlanDiscount);
  const [newPlanContentKeys, setNewPlanContentKeys] = useState<string[]>([]);
  const [newPlanContentSearch, setNewPlanContentSearch] = useState("");
  const [newPlanDraftId, setNewPlanDraftId] = useState<string | null>(null);
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
  const [editPlanDiscount, setEditPlanDiscount] = useState(freshPlanDiscount);
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
  const planContentTicket = useRef(0);
  const [collected, setCollected] = useState<{ currency: string; online: number; recorded: number }[]>([]);

  async function loadPlanContent(id: string) {
    const ticket = ++planContentTicket.current;
    const res = await authFetch(
      `/api/payments?action=subscription-plan-content&planId=${id}`,
    );
    const data = await res.json();
    // Clicking between plans quickly: only the latest plan's answer may fill the picker.
    if (ticket !== planContentTicket.current) return;
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
        reviewRes.json().catch(() => null),
      ]);
      // Deliberately not fatal. The review list is a safety net, and failing to load it must not
      // take down the page an admin uses to run subscriptions.
      if (reviewRes.ok && reviewData) {
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
      setCollected(listData.collected ?? []);
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
    setSuccess("");
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
    ).then((results) => {
      const failed = results.find((result) => result.error);
      if (failed) setError(`Could not load the content list: ${failed.error?.message}`);
      setContentOptions(
        results.flatMap((result, index) =>
          (result.data ?? []).map((item) => ({
            ...item,
            content_table: CONTENT_TYPES[index].value,
          })),
        ),
      );
    });
  }, [tab]);

  const activePlans = plans.filter((p) => p.status === "active");
  const active = subscriptions.filter(isLive);
  const awaitingReview = paymentRequests.filter(
    (r) => r.status === "confirmation_submitted",
  );
  const awaitingStudent = paymentRequests.filter((r) => r.status === "pending");
  const expiring = active
    .filter((s) => daysRemaining(s.current_period_end) <= 30)
    .sort(
      (a, b) =>
        +new Date(a.current_period_end) - +new Date(b.current_period_end),
    );
  const filtered = useMemo(
    () =>
      subscriptions.filter((sub) => {
        const term =
          `${sub.students?.full_name || ""} ${sub.students?.email || ""}`.toLowerCase();
        return (
          (!search || term.includes(search.toLowerCase())) &&
          (statusFilter === "all" || subscriberBucket(sub) === statusFilter) &&
          (planFilter === "all" || sub.plan_id === planFilter)
        );
      }),
    [subscriptions, search, statusFilter, planFilter],
  );

  const inputStyle = {
    background: C.input,
    color: C.text,
    border: `1px solid ${C.inputBorder}`,
  };
  const fieldClass =
    "w-full rounded-[10px] px-3 py-3 text-sm outline-none transition-shadow focus:ring-2";
  const primary =
    "inline-flex items-center justify-center gap-2 h-10 rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-50";

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
    setChangePlanId("");
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
        rect.bottom + 400 > window.innerHeight
          ? Math.max(12, rect.top - 390)
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
    if (!confirmation) {
      setError("This payment has no confirmation waiting for review. Reload the page to see its current state.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
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
    setSuccess("");
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
    setSuccess("");
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
    if (!manageSub || !changePlanId || changePlanId === manageSub.plan_id) return;
    setBusy(true);
    setError("");
    setSuccess("");
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
    setSuccess("");
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
    setSuccess("");
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
    setError("");
    try {
      const res = await authFetch(
        `/api/payments?action=subscription-history&studentId=${sub.student_id}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load history");
      setHistory(data.payments ?? []);
      setHistoryOpen(true);
    } catch (err: any) {
      setError(err.message || "Could not load the payment history. Check your connection and try again.");
    }
  }

  function openPlanBuilder() {
    setError("");
    setNewPlanName("");
    setNewPlanDescription("");
    setNewPlanPrices(freshPlanPrices());
    setNewPlanDiscount(freshPlanDiscount());
    setNewPlanContentKeys([]);
    setNewPlanContentSearch("");
    setNewPlanDraftId(null);
    setPlanBuilderStep(0);
    setCreatePlanOpen(true);
  }

  function planBuilderIsDirty() {
    return Boolean(
      newPlanName.trim() ||
      newPlanDescription.trim() ||
      newPlanContentKeys.length ||
      newPlanDraftId ||
      newPlanPrices.some((price) => price.amount || price.isActive || price.currency !== "GHS") ||
      JSON.stringify(newPlanDiscount) !== JSON.stringify(freshPlanDiscount()),
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

  async function discardPlanBuilder() {
    if (!newPlanDraftId) {
      setCreatePlanOpen(false);
      setUnsavedPlanDialog(null);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete-subscription-plan",
          planId: newPlanDraftId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to discard plan draft");
      setNewPlanDraftId(null);
      setCreatePlanOpen(false);
      setUnsavedPlanDialog(null);
      await load();
    } catch (err: any) {
      setUnsavedPlanDialog(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function editPlanIsDirty() {
    if (!editPlan) return false;
    if (editPlanName.trim() !== String(editPlan.name ?? "").trim()) return true;
    if (editPlanDescription.trim() !== String(editPlan.description ?? "").trim()) return true;
    if (JSON.stringify(planDiscountPayload(editPlanDiscount)) !== JSON.stringify(planDiscountPayload(planDiscountFromRow(editPlan)))) return true;
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
    setSuccess("");
    let planId = newPlanDraftId;
    const resumingDraft = Boolean(planId);
    try {
      if (!planId) {
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
        planId = data.planId;
        setNewPlanDraftId(planId);
      }
      if (!planId) throw new Error("Plan draft was not created");
      const savedPlanId = planId;

      if (resumingDraft) {
        const detailRes = await authFetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update-subscription-plan",
            planId: savedPlanId,
            name: newPlanName.trim(),
            description: newPlanDescription.trim(),
            status: "inactive",
          }),
        });
        const detailData = await detailRes.json();
        if (!detailRes.ok) throw new Error(detailData.error || "Failed to update plan draft");
      }

      const priceRes = await authFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-subscription-plan-prices",
          planId: savedPlanId,
          prices: newPlanPrices.map((price) => ({
            durationMonths: Number(price.durationMonths),
            amount: Number(price.amount),
            currency: price.currency,
            isActive: price.isActive,
            sortOrder: price.sortOrder,
          })),
          discount: planDiscountPayload(newPlanDiscount),
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
          planId: savedPlanId,
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

      if (decision.tone === "error") {
        setError(`${decision.message} Fix the issue and try again to continue this same plan.`);
        await load(savedPlanId);
        return;
      }

      if (decision.activate) {
        const statusRes = await authFetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update-subscription-plan",
            planId: savedPlanId,
            status: "active",
          }),
        });
        const statusData = await statusRes.json();
        if (!statusRes.ok) throw new Error(statusData.error || "Failed to activate plan");
      }
      setNewPlanName("");
      setNewPlanDescription("");
      setNewPlanPrices(freshPlanPrices());
      setNewPlanDiscount(freshPlanDiscount());
      setNewPlanContentKeys([]);
      setNewPlanContentSearch("");
      setNewPlanDraftId(null);
      setPlanBuilderStep(0);
      setCreatePlanOpen(false);
      // One message, from one decision. Setting a success line after an error line is how a
      // partial result came to read as a finished one.
      setSuccess(decision.message);
      await load(savedPlanId);
    } catch (err: any) {
      setError(planId
        ? `The plan is safely saved as a draft. ${err.message} Fix the issue and try again to continue this same plan.`
        : err.message);
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
    setEditPlanDiscount(planDiscountFromRow(plan));
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
    setSuccess("");
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
          discount: planDiscountPayload(editPlanDiscount),
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
    if (status === "active" && !planIsReady(plan)) {
      setError("Add at least one active price and one published content item before activating this plan.");
      return;
    }
    if (
      status === "inactive" &&
      !confirm("Deactivate this plan? Existing access continues.")
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
    setError("");
    setSuccess("");
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
        <div className="mt-2">
          <MenuSelect
            field
            label="Access duration"
            value={payment.durationMonths}
            options={DURATION_OPTIONS}
            onChange={(value) => updatePayment((v) => ({ ...v, durationMonths: value }))}
            C={C}
          />
        </div>
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
          className={`${fieldClass} mt-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
          style={inputStyle}
        />
      </label>
      <label className="text-xs font-bold" style={{ color: C.muted }}>
        Currency
        <input
          value={payment.currency}
          onChange={(e) =>
            updatePayment((v) => ({ ...v, currency: e.target.value.toUpperCase() }))
          }
          className={`${fieldClass} mt-2`}
          style={inputStyle}
        />
      </label>
      {showDeadline && (
        <label className="text-xs font-bold" style={{ color: C.muted }}>
          Payment deadline
          <input
            type="date"
            min={earliestDeadline()}
            value={payment.dueDate}
            onChange={(e) =>
              updatePayment((v) => ({ ...v, dueDate: e.target.value }))
            }
            className={`${fieldClass} mt-2`}
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
          className={`${fieldClass} mt-2`}
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
          className={`${fieldClass} mt-2`}
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
          className={`${fieldClass} mt-2 min-h-20`}
          style={inputStyle}
        />
      </label>
    </div>
  );

  const lateRequests = awaitingStudent.filter((r) => pastDeadline(r.due_date));
  const actionCount = reviewQueue.length + awaitingReview.length + lateRequests.length;
  const paymentHistory = paymentRequests.filter((r) => !["pending", "confirmation_submitted"].includes(r.status));
  const planSummaries: PlanSummary[] = plans.map((plan) => {
    const prices = (plan.subscription_plan_prices ?? [])
      .filter((price: any) => price.is_active)
      .sort((a: any, b: any) => Number(a.duration_months) - Number(b.duration_months));
    const start = startingPlanPrice(plan);
    const status = planDiscountStatus(planDiscountFromRow(plan));
    const label = plan.discount_label || "Promotion";
    const off = plan.discount_type === "percentage"
      ? `${Number(plan.discount_value)}% off`
      : plan.discount_type === "fixed" && prices[0] ? `${money(prices[0].currency, plan.discount_value)} off` : "";
    const when = status === "Live"
      ? plan.discount_ends_at && `ends ${shortDate(plan.discount_ends_at)}`
      : status === "Scheduled" ? `starts ${shortDate(plan.discount_starts_at)}` : null;
    const offerOn = status === "Live" || status === "Scheduled";
    return {
      plan,
      priceCount: prices.length,
      priceText: !start ? "No price yet" : `${prices.length > 1 ? "From " : ""}${money(start.currency, start.amount)}`,
      prices: prices.map((price: any) => {
        const effective = effectiveSubscriptionPrice(price.amount, plan);
        return {
          id: price.id,
          duration: durationLabel(Number(price.duration_months)),
          now: money(price.currency, effective.amount),
          list: effective.discountActive ? money(price.currency, effective.listAmount) : null,
        };
      }),
      live: subscriptions.filter((sub) => sub.plan_id === plan.id && isLive(sub)).length,
      offer: offerOn ? [label, when].filter(Boolean).join(", ") : null,
      offerDetail: offerOn ? [label, off, when].filter(Boolean).join(", ") : null,
    };
  });
  const selectPlan = (plan: any) => {
    setPlanCardMenuId(null);
    setSelectedPlan(plan);
    loadPlanContent(plan.id).catch((err) => setError(err.message));
  };

  return (
    <div className="subscription-typography space-y-6 pb-12">
      <style>{`.subscription-typography .font-black{font-weight:700!important}.subscription-typography .font-bold{font-weight:600!important}`}</style>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* The dashboard hides its own section title here, so this is the page heading. */}
          <h1 className="text-[28px] leading-9 font-bold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>
            Subscriptions
          </h1>
          <p className="text-sm mt-1" style={{ color: C.muted }}>
            Plans, subscribers and payments in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={openPlanBuilder} className={btnClass} style={btnStyle("sec", C)}>
            <Plus className="w-4 h-4" />
            Create plan
          </button>
          <button
            type="button"
            onClick={toggleAssignMenu}
            className={btnClass}
            style={{ ...btnStyle("pri", C), boxShadow: `0 6px 16px ${C.cta}24` }}
            aria-expanded={assignMenuOpen}
            aria-haspopup="menu"
          >
            <UserPlus className="w-4 h-4" />
            Assign subscription
            <ChevronDown className={`w-4 h-4 transition-transform ${assignMenuOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      <nav
        role="tablist"
        aria-label="Subscriptions sections"
        className="flex gap-1 overflow-x-auto"
        style={{ borderBottom: `1px solid ${C.divider}` }}
      >
        {(
          [
            ["overview", "Overview", LayoutDashboard, null, false],
            ["subscribers", "Subscribers", Users, subscriptions.length, false],
            ["payments", "Payments", WalletCards, actionCount, true],
            ["plans", "Plans", Layers3, plans.filter((plan) => !plan.archived_at).length, false],
          ] as const
        ).map(([id, label, Icon, count, alert]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="inline-flex items-center gap-2 px-4 py-3 -mb-px text-sm font-semibold whitespace-nowrap"
            style={{
              color: tab === id ? C.text : C.muted,
              borderBottom: `2px solid ${tab === id ? palette(C).sel : "transparent"}`,
            }}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
            {count !== null && (!alert || count > 0) && <Count n={count} alert={alert} C={C} />}
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
            <OverviewTab
              C={C}
              subscriptionCount={subscriptions.length}
              activeCount={active.length}
              expiring={expiring}
              collected={collected}
              reviewQueue={reviewQueue}
              awaitingReview={awaitingReview}
              lateRequests={lateRequests}
              planSummaries={planSummaries}
              busy={busy}
              onGo={setTab}
              onReview={(request) => {
                setReviewNotes("");
                setReviewTarget({ request, decision: "approve" });
              }}
              onResolve={resolveIncident}
              onEnding={(sub) => {
                setTab("subscribers");
                setPlanFilter("all");
                setStatusFilter(sub ? "all" : "soon");
                setSearch(sub ? sub.students?.email || sub.students?.full_name || "" : "");
              }}
            />
          )}

          {tab === "subscribers" && (
            <SubscribersTab
              C={C}
              subscriptions={subscriptions}
              rows={filtered}
              plans={plans}
              search={search}
              setSearch={setSearch}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              planFilter={planFilter}
              setPlanFilter={setPlanFilter}
              onMenu={toggleSubscriberMenu}
            />
          )}

          {tab === "payments" && (
            <PaymentsTab
              C={C}
              reviewQueue={reviewQueue}
              awaitingReview={awaitingReview}
              awaitingStudent={awaitingStudent}
              openCarts={openCarts}
              history={paymentHistory}
              sweepHeartbeat={sweepHeartbeat}
              busy={busy}
              onResolve={resolveIncident}
              onReview={(request, decision) => {
                setReviewNotes("");
                setReviewTarget({ request, decision });
              }}
              onCancelRequest={cancelRequest}
              onClearCart={clearCart}
            />
          )}

          {tab === "plans" && (
            <PlansTab
              C={C}
              summaries={planSummaries}
              selectedPlan={selectedPlan}
              onSelect={selectPlan}
              showArchived={showArchivedPlans}
              setShowArchived={setShowArchivedPlans}
              busy={busy}
              menuOpen={!!selectedPlan && planCardMenuId === selectedPlan.id}
              setMenuOpen={(open) => setPlanCardMenuId(open && selectedPlan ? selectedPlan.id : null)}
              onCreate={openPlanBuilder}
              onEdit={openEditPlan}
              onToggle={togglePlan}
              onBulk={openBulkImport}
              onRecommend={setPlanRecommended}
              onArchive={setPlanArchived}
              onDelete={deletePlan}
              planContent={planContent}
              contentOptions={contentOptions}
              selectedContentKeys={selectedContentKeys}
              setSelectedContentKeys={setSelectedContentKeys}
              toggleContentKey={toggleContentKey}
              contentSearch={contentSearch}
              setContentSearch={setContentSearch}
              onSaveContent={savePlanContentSelection}
            />
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
            {[
              { label: "One learner", sub: "Give access now or send a payment request", icon: UserPlus, onClick: openEnrol, disabled: false },
              { label: "Many learners", sub: "Paste emails or a CSV for one plan", icon: Upload, onClick: () => openBulkImport(), disabled: activePlans.length === 0 },
            ].map(({ label, sub, icon: Icon, onClick, disabled }) => (
              <button
                key={label}
                role="menuitem"
                onClick={onClick}
                disabled={disabled}
                className="w-full flex items-center gap-3 rounded-xl p-2 text-left disabled:opacity-50"
                style={{ color: C.text }}
              >
                <IconChip color={C.text} background={C.pill}><Icon className="w-4 h-4" /></IconChip>
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs" style={{ color: C.muted }}>{sub}</span>
                </span>
              </button>
            ))}
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
            role="menu"
            className="fixed z-[75] w-72 max-w-[calc(100vw-24px)] rounded-2xl p-2 grid"
            style={{ ...modalStyle(C), top: subscriberMenu.top, right: subscriberMenu.right }}
          >
            {[
              { label: "Change plan", sub: "Keeps the dates and price", icon: ArrowLeftRight, onClick: () => openSubscriberAction(subscriberMenu.sub, "change-plan") },
              { label: "Request payment", sub: "Send a renewal request", icon: Send, onClick: () => openSubscriberAction(subscriberMenu.sub, "request-payment") },
              { label: "Extend access", sub: "Add time, paid or free", icon: CalendarClock, onClick: () => openSubscriberAction(subscriberMenu.sub, "extend-access") },
              { label: "Payment history", sub: "Every payment and request", icon: History, onClick: () => showHistory(subscriberMenu.sub) },
              null,
              subscriberMenu.sub.status === "active"
                ? { label: "Revoke access", sub: "Ends access today", icon: XCircle, onClick: () => cancelSubscription(subscriberMenu.sub), danger: true }
                : undefined,
              { label: "Delete account", sub: "Removes the learner for good", icon: Trash2, onClick: () => deleteSubscriberAccount(subscriberMenu.sub), danger: true },
            ].map((item, index) => {
              if (item === undefined) return null;
              if (item === null) return <div key={index} className="my-1 mx-2" style={{ borderTop: `1px solid ${C.divider}` }} />;
              const { label, sub, icon: Icon, onClick, danger } = item;
              const P = palette(C);
              return (
                <button
                  key={label}
                  role="menuitem"
                  onClick={onClick}
                  className="w-full flex items-center gap-3 rounded-xl p-2 text-left"
                  style={{ color: danger ? P.bad : C.text }}
                >
                  <IconChip color={danger ? P.bad : C.text} background={danger ? P.badSoft : P.ctaSoft}><Icon className="w-4 h-4" /></IconChip>
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="block text-xs" style={{ color: C.muted }}>{sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {bulkPlan && (
        <Modal
          title="Bulk add learners"
          eyebrow="Paste emails or a CSV for one plan"
          onClose={() => setBulkPlan(null)}
          C={C}
          wide
        >
          <div className="space-y-6">
            <label className="text-xs font-bold" style={{ color: C.muted }}>
              Access plan
              <div className="mt-2">
                <MenuSelect
                  field
                  label="Access plan"
                  value={bulkPlan.id as string}
                  options={activePlans.map((plan) => ({ value: plan.id as string, label: plan.name as string }))}
                  onChange={(id) => {
                    const nextPlan = activePlans.find((plan) => plan.id === id);
                    if (nextPlan) {
                      setBulkPlan(nextPlan);
                      setBulkResult(null);
                      setBulkError("");
                    }
                  }}
                  C={C}
                />
              </div>
              <span className="block font-normal mt-2" style={{ color: C.faint }}>
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
                ]).map(({ value, title, description }) => (
                  <OptionCard
                    key={value}
                    selected={bulkMode === value}
                    onClick={() => {
                      setBulkMode(value);
                      setBulkResult(null);
                      setBulkError("");
                    }}
                    icon={value === "request" ? <Clock3 className="w-4 h-4" /> : <BadgeCheck className="w-4 h-4" />}
                    title={title}
                    sub={description}
                    C={C}
                  />
                ))}
              </div>
            </div>
            <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: C.page }}>
              <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: C.muted }} />
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
                <label className="text-xs font-bold" style={{ color: C.muted }}>Duration<div className="mt-2"><MenuSelect field label="Duration" value={bulkDefaults.durationMonths} options={DURATION_OPTIONS} onChange={(months) => setBulkDefaults(value => ({ ...value, durationMonths: months }))} C={C} /></div></label>
                <label className="text-xs font-bold" style={{ color: C.muted }}>Amount<input type="number" inputMode="decimal" min="0.01" step="0.01" value={bulkDefaults.amount} onChange={(event) => setBulkDefaults(value => ({ ...value, amount: event.target.value }))} placeholder="0.00" className={`${fieldClass} mt-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} style={inputStyle} /></label>
                <label className="text-xs font-bold" style={{ color: C.muted }}>Currency<input value={bulkDefaults.currency} onChange={(event) => setBulkDefaults(value => ({ ...value, currency: event.target.value.toUpperCase() }))} className={`${fieldClass} mt-2`} style={inputStyle} /></label>
                {bulkMode === "request" ? (
                  <label className="text-xs font-bold" style={{ color: C.muted }}>Payment deadline<input type="date" min={earliestDeadline()} value={bulkDefaults.dueDate} onChange={(event) => setBulkDefaults(value => ({ ...value, dueDate: event.target.value }))} className={`${fieldClass} mt-2`} style={inputStyle} /></label>
                ) : (
                  <label className="text-xs font-bold" style={{ color: C.muted }}>Payment method<input value={bulkDefaults.paymentMethod} onChange={(event) => setBulkDefaults(value => ({ ...value, paymentMethod: event.target.value }))} placeholder="Bank transfer" className={`${fieldClass} mt-2`} style={inputStyle} /></label>
                )}
              </div>
              {bulkMode === "paid" && (
                <div className="grid sm:grid-cols-2 gap-3 mt-3">
                  <label className="text-xs font-bold" style={{ color: C.muted }}>Payment reference<input value={bulkDefaults.paymentReference} onChange={(event) => setBulkDefaults(value => ({ ...value, paymentReference: event.target.value }))} placeholder="Optional shared reference" className={`${fieldClass} mt-2`} style={inputStyle} /></label>
                  <label className="text-xs font-bold" style={{ color: C.muted }}>Notes<input value={bulkDefaults.notes} onChange={(event) => setBulkDefaults(value => ({ ...value, notes: event.target.value }))} placeholder="Optional internal note" className={`${fieldClass} mt-2`} style={inputStyle} /></label>
                </div>
              )}
            </div>

            {bulkRows.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.divider}` }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ background: C.page }}><p className="text-sm font-bold" style={{ color: C.text }}>3. Review learners</p><span className="text-xs font-bold rounded-full px-3 py-1" style={{ background: C.pill, color: C.text }}>{bulkRows.length} parsed</span></div>
                <div className="max-h-52 overflow-y-auto divide-y" style={{ borderColor: C.divider }}>
                  {bulkRows.slice(0, 12).map((row, index) => <div key={`${row.email}-${index}`} className="grid sm:grid-cols-[36px_1fr_1fr] gap-2 px-4 py-3 text-xs"><span style={{ color: C.faint }}>{index + 1}</span><span className="truncate font-bold" style={{ color: C.text }}>{row.email}</span><span className="truncate" style={{ color: C.muted }}>{row.full_name || "Name not provided"}</span></div>)}
                  {bulkRows.length > 12 && <p className="px-4 py-3 text-xs text-center" style={{ color: C.faint }}>And {bulkRows.length - 12} more learners</p>}
                </div>
              </div>
            )}

            {bulkError && <div className="rounded-xl p-3 text-xs" style={{ background: C.errorBg, color: C.errorText }}>{bulkError}</div>}
            {bulkResult && <div className="space-y-3"><div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{[[bulkMode === "request" ? "Requests" : "Activated", bulkMode === "request" ? bulkResult.requested : bulkResult.activated], ["New accounts", bulkResult.newAccounts], ["Existing", bulkResult.existingStudents], ["Emails sent", bulkResult.paymentEmailsSent], ["Errors", bulkResult.errors?.length || 0]].map(([label, value]) => <div key={String(label)} className="rounded-xl p-3" style={{ background: C.page }}><p className="text-[11px] uppercase tracking-wider" style={{ color: C.faint }}>{label}</p><p className="text-[22px] font-bold mt-1 leading-7" style={{ color: C.text }}>{value}</p></div>)}</div>{bulkResult.errors?.length > 0 && <div className="rounded-xl p-3" style={{ background: C.errorBg, color: C.errorText }}><p className="text-xs font-bold mb-2">Rows needing attention</p>{bulkResult.errors.map((item: any) => <p key={`${item.row}-${item.email}`} className="text-xs mt-1">Row {item.row}: {item.email || "No email"} - {item.error}</p>)}</div>}{bulkResult.warnings?.length > 0 && <div className="rounded-xl p-3" style={{ background: "rgba(217,119,6,0.10)", color: "#b45309" }}>{bulkResult.warnings.map((item: any) => <p key={`${item.row}-${item.email}`} className="text-xs">Row {item.row}: {item.warning}</p>)}</div>}</div>}

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
          eyebrow="Name it, choose its content, then set its prices"
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
                        background: C.page,
                        boxShadow: current ? `inset 0 0 0 2px ${palette(C).sel}` : "none",
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold"
                          style={{ background: complete || current ? palette(C).sel : C.card, color: complete || current ? palette(C).onSel : C.faint }}
                        >
                          {complete ? <Check className="w-3.5 h-3.5" /> : index + 1}
                        </span>
                        <span className="text-xs font-bold" style={{ color: C.text }}>{label}</span>
                      </span>
                      <span className="hidden sm:block text-[11px] mt-2" style={{ color: C.faint }}>{helper}</span>
                    </button>
                  );
                })}
              </div>

              {planBuilderStep === 0 && (
                <div className="space-y-5">
                  <div>
                    <h4 className="text-base font-black leading-6" style={{ color: C.text }}>Start with a clear promise</h4>
                    <p className="text-sm mt-1" style={{ color: C.muted }}>Help learners quickly understand who the plan is for and what it unlocks.</p>
                  </div>
                  <label className="block text-xs font-bold" style={{ color: C.muted }}>
                    Plan name
                    <input
                      autoFocus
                      value={newPlanName}
                      onChange={(e) => setNewPlanName(e.target.value)}
                      placeholder="For example: Career Accelerator"
                      className={`${fieldClass} mt-2`}
                      style={inputStyle}
                    />
                  </label>
                  <label className="block text-xs font-bold" style={{ color: C.muted }}>
                    Short description
                    <textarea
                      value={newPlanDescription}
                      onChange={(e) => setNewPlanDescription(e.target.value)}
                      placeholder="Explain the outcome learners can expect from this plan"
                      className={`${fieldClass} mt-2 min-h-28 resize-none`}
                      style={inputStyle}
                      maxLength={240}
                    />
                    <span className="block text-right text-[11px] mt-2 font-normal" style={{ color: C.faint }}>{newPlanDescription.length}/240</span>
                  </label>
                  <div className="rounded-2xl p-4" style={{ background: C.page }}>
                    <p className="text-[11px] uppercase tracking-[0.16em] font-bold" style={{ color: C.faint }}>Learner preview</p>
                    <p className="font-black mt-2" style={{ color: C.text }}>{newPlanName.trim() || "Your plan name"}</p>
                    <p className="text-xs mt-2" style={{ color: C.muted }}>{newPlanDescription.trim() || "A concise description of the value learners receive."}</p>
                  </div>
                </div>
              )}

              {planBuilderStep === 1 && (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                    <div>
                      <h4 className="text-base font-black leading-6" style={{ color: C.text }}>Build the learning bundle</h4>
                      <p className="text-sm mt-1" style={{ color: C.muted }}>Select everything learners should unlock with this plan.</p>
                    </div>
                    <span className="self-start text-xs font-bold rounded-full px-3 py-2" style={{ background: C.pill, color: C.text }}>
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
                              <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{groupKeys.filter((key) => newPlanContentKeys.includes(key)).length} of {items.length} selected</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setNewPlanContentKeys((current) => allSelected ? current.filter((key) => !groupKeys.includes(key)) : [...new Set([...current, ...groupKeys])])}
                              className="text-xs font-bold"
                              style={{ color: C.text }}
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
                                  style={{ background: C.page, boxShadow: selected ? `inset 0 0 0 2px ${palette(C).sel}` : "none" }}
                                >
                                  <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0" style={{ background: selected ? palette(C).sel : C.card, border: `1px solid ${selected ? palette(C).sel : C.divider}` }}>
                                    {selected && <Check className="w-3 h-3" style={{ color: palette(C).onSel }} />}
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
                <div>
                  <PlanPriceFields prices={newPlanPrices} setPrices={setNewPlanPrices} discount={newPlanDiscount} C={C} />
                  <PlanDiscountFields discount={newPlanDiscount} setDiscount={setNewPlanDiscount} prices={newPlanPrices} C={C} />
                  <div className="rounded-2xl p-4 mt-5 flex items-start gap-3" style={{ background: C.page }}>
                    <ShieldCheck className="w-5 h-5 flex-shrink-0" style={{ color: C.muted }} />
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
                <SlidersHorizontal className="w-4 h-4" style={{ color: C.muted }} />
                <p className="text-sm font-black" style={{ color: C.text }}>Plan readiness</p>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  [Boolean(newPlanName.trim()), "Plan details", newPlanName.trim() || "Name still needed"],
                  [newPlanContentKeys.length > 0, "Included content", newPlanContentKeys.length ? `${newPlanContentKeys.length} items selected` : "Add at least one item"],
                  [newPlanPrices.some((price) => price.isActive && Number(price.amount) > 0), "Purchase options", `${newPlanPrices.filter((price) => price.isActive && Number(price.amount) > 0).length} active prices`],
                ].map(([ready, label, detail]) => (
                  <div key={String(label)} className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0 mt-0.5" style={{ background: ready ? C.successBg : C.card, color: ready ? C.successText : C.faint }}>
                      {ready ? <Check className="w-3 h-3" /> : <span className="text-[11px]">!</span>}
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
                      background: palette(C).sel,
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
          title="Plan details"
          eyebrow="Name, prices and offer"
          onClose={requestCloseEditPlan}
          C={C}
          error={error}
          wide
        >
          <div>
            <section>
              <h4 className="text-base font-bold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>About this plan</h4>
              <p className="text-xs mt-1 mb-4" style={{ color: C.muted }}>What learners see on the pricing page.</p>
              <label className="block text-xs font-semibold" style={{ color: C.muted }}>
                Plan name
                <input
                  autoFocus
                  value={editPlanName}
                  onChange={(e) => setEditPlanName(e.target.value)}
                  placeholder="For example: Professional"
                  className={`${fieldClass} mt-2 font-semibold`}
                  style={inputStyle}
                />
              </label>
              <label className="block text-xs font-semibold mt-4" style={{ color: C.muted }}>
                Description
                <textarea
                  value={editPlanDescription}
                  onChange={(e) => setEditPlanDescription(e.target.value)}
                  maxLength={240}
                  placeholder="Describe who this plan is for"
                  className={`${fieldClass} mt-2 min-h-20 resize-none`}
                  style={inputStyle}
                />
                <span className="block text-right text-xs mt-1 font-normal" style={{ color: C.faint }}>{editPlanDescription.length}/240</span>
              </label>
            </section>

            <PlanPriceFields prices={editPlanPrices} setPrices={setEditPlanPrices} discount={editPlanDiscount} C={C} />

            <PlanDiscountFields discount={editPlanDiscount} setDiscount={setEditPlanDiscount} prices={editPlanPrices} C={C} />

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-5 mt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
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
          eyebrow="This plan has changes that are not saved yet"
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
                <p className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
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
                  if (unsavedPlanDialog === "create") {
                    void discardPlanBuilder();
                    return;
                  }
                  setEditPlan(null);
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
          eyebrow="Give access now or send a payment request"
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
                  <OptionCard
                    key={id}
                    selected={learnerMode === id}
                    onClick={() => {
                      setLearnerMode(id);
                      setPaidAttemptKey("");
                      setError("");
                    }}
                    icon={<Icon className="w-4 h-4" />}
                    title={title}
                    sub={body}
                    C={C}
                  />
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {learnerMode === "existing" ? (
                <label className="text-xs font-bold" style={{ color: C.muted }}>
                  Learner
                  <div className="mt-2">
                    <MenuSelect
                      field
                      label="Learner"
                      placeholder="Choose an eligible student"
                      value={studentId}
                      options={eligibleStudents.map((s) => ({ value: s.id as string, label: `${s.full_name || s.email} (${s.email})` }))}
                      onChange={(id) => { setStudentId(id); setPaidAttemptKey(""); }}
                      C={C}
                    />
                  </div>
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
                      className={`${fieldClass} mt-2`}
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
                      className={`${fieldClass} mt-2`}
                      style={inputStyle}
                    />
                  </label>
                </div>
              )}
              <label className="text-xs font-bold" style={{ color: C.muted }}>
                Access plan
                <div className="mt-2">
                  <MenuSelect
                    field
                    label="Access plan"
                    placeholder="Choose an active plan"
                    value={planId}
                    options={activePlans.map((p) => ({ value: p.id as string, label: p.name as string }))}
                    onChange={(id) => { setPlanId(id); setPaidAttemptKey(""); }}
                    C={C}
                  />
                </div>
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
                  <OptionCard
                    key={id}
                    selected={enrolMode === id}
                    onClick={() => { setEnrolMode(id); setPaidAttemptKey(""); }}
                    icon={<Icon className="w-4 h-4" />}
                    title={title}
                    sub={body}
                    C={C}
                  />
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
              <MenuSelect
                field
                label="New plan"
                placeholder={`Choose a plan (now on ${manageSub.subscription_plans?.name || "another plan"})`}
                value={changePlanId}
                options={activePlans.filter((p) => p.id !== manageSub.plan_id).map((p) => ({ value: p.id as string, label: p.name as string }))}
                onChange={setChangePlanId}
                C={C}
              />
              <button
                onClick={changePlan}
                disabled={busy || !changePlanId || changePlanId === manageSub.plan_id}
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
          eyebrow={learnerName(reviewTarget.request.students)}
          onClose={() => {
            setReviewTarget(null);
            setReviewNotes("");
          }}
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
                <CreditCard className="w-7 h-7" style={{ color: C.muted }} />
              </div>
              <div
                className="grid grid-cols-2 gap-3 mt-4 pt-4 text-xs"
                style={{ borderTop: `1px solid ${C.divider}`, color: C.muted }}
              >
                <span>{reviewTarget.request.plan_name}</span>
                <span className="text-right">
                  {durationLabel(Number(reviewTarget.request.duration_months))}
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
                className={`${fieldClass} mt-2 min-h-24`}
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
          eyebrow="Every payment and request, kept as recorded"
          onClose={() => setHistoryOpen(false)}
          C={C}
          error={error}
        >
          {history.length ? (
            <div className="rounded-xl overflow-hidden" style={{ background: C.page }}>
              {history.map((row, index) => (
                <div
                  key={row.id}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                  style={index ? { borderTop: `1px solid ${C.divider}` } : undefined}
                >
                  <div className="min-w-0">
                    <p className="text-base font-bold tabular-nums" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>
                      {money(row.currency, row.amount)}
                    </p>
                    <p className="text-xs mt-1" style={{ color: C.muted }}>
                      {[row.plan_name, durationLabel(Number(row.duration_months)), row.kind && String(row.kind).replaceAll("_", " ")]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                    {row.payment_reference && (
                      <p className="text-xs mt-1" style={{ color: C.faint }}>
                        Reference {row.payment_reference}
                      </p>
                    )}
                  </div>
                  <p className="text-xs whitespace-nowrap" style={{ color: C.muted }}>
                    {dateLabel(row.paid_at)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-center py-8" style={{ color: C.muted }}>
              No payments recorded.
            </p>
          )}
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
            <ul className="space-y-2">
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
                className="rounded-xl px-4 py-3 text-sm font-bold"
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
                className="rounded-xl px-4 py-3 text-sm font-bold"
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
