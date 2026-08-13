"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileCheck2,
  History,
  Layers3,
  LayoutDashboard,
  FileSpreadsheet,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
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

type Tab = "overview" | "subscribers" | "payments" | "plans";

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
  children: React.ReactNode;
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

export function SubscriptionsSection({ C }: { C: typeof LIGHT_C }) {
  const dark = C.page === "#17181E";
  const [tab, setTab] = useState<Tab>("overview");
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [eligibleStudents, setEligibleStudents] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [enrolMode, setEnrolMode] = useState<"request" | "paid">("request");
  const [learnerMode, setLearnerMode] = useState<"existing" | "new">("existing");
  const [newLearnerName, setNewLearnerName] = useState("");
  const [newLearnerEmail, setNewLearnerEmail] = useState("");
  const [manageSub, setManageSub] = useState<any>(null);
  const [renewMode, setRenewMode] = useState<"request" | "paid">("request");
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
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const [planCardMenuId, setPlanCardMenuId] = useState<string | null>(null);
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<any>(null);
  const [editPlanName, setEditPlanName] = useState("");
  const [editPlanDescription, setEditPlanDescription] = useState("");
  const [contentOptions, setContentOptions] = useState<any[]>([]);
  const [selectedContentKeys, setSelectedContentKeys] = useState<string[]>([]);
  const [contentSearch, setContentSearch] = useState("");
  const [bulkPlan, setBulkPlan] = useState<any>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkRows, setBulkRows] = useState<any[]>([]);
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
      const [listRes, plansRes, requestsRes] = await Promise.all([
        authFetch("/api/payments?action=subscription-list"),
        authFetch("/api/payments?action=subscription-plans"),
        authFetch("/api/payments?action=subscription-payment-requests"),
      ]);
      const [listData, plansData, requestsData] = await Promise.all([
        listRes.json(),
        plansRes.json(),
        requestsRes.json(),
      ]);
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
          .select("id,title")
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

      const warnings = [data.notificationWarning, data.setupWarning].filter(Boolean);
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
  function openManage(sub: any) {
    setError("");
    setManageSub(sub);
    setChangePlanId(sub.plan_id);
    setRenewMode("request");
    resetPayment();
  }

  function openBulkImport(plan: any) {
    setPlanCardMenuId(null);
    setBulkPlan(plan);
    setBulkText("");
    setBulkRows([]);
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
          planId: bulkPlan.id,
          rows: bulkRows,
          defaults: {
            durationMonths: Number(bulkDefaults.durationMonths),
            amount: Number(bulkDefaults.amount),
            currency: bulkDefaults.currency,
            dueDate: bulkDefaults.dueDate,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to import students");
      setBulkResult(data);
      setSuccess(
        `${data.requested} payment request${data.requested === 1 ? "" : "s"} created for ${bulkPlan.name}.`,
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
      setSuccess(
        subscription
          ? "Renewal recorded and access extended."
          : "Payment recorded and access activated.",
      );
      setEnrolOpen(false);
      setManageSub(null);
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
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelSubscription() {
    if (
      !manageSub ||
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
          subscriptionId: manageSub.id,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to cancel subscription");
      setSuccess("Subscription cancelled and access revoked.");
      setManageSub(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function showHistory(sub: any) {
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

  async function createPlan() {
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
      setNewPlanName("");
      setNewPlanDescription("");
      setCreatePlanOpen(false);
      setPlanMenuOpen(false);
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
  }

  async function savePlanDetails() {
    if (!editPlan || !editPlanName.trim()) return;
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
    setPlanMenuOpen(false);
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
      const changes = [
        ...selectedContentKeys
          .filter((key) => !current.has(key))
          .map((key) => ({ action: "add-subscription-plan-content", key })),
        ...[...current]
          .filter((key) => !desired.has(key))
          .map((key) => ({ action: "remove-subscription-plan-content", key })),
      ];
      const results = await Promise.all(
        changes.map(async (change) => {
          const separator = change.key.indexOf(":");
          const contentTable = change.key.slice(0, separator);
          const contentId = change.key.slice(separator + 1);
          const res = await authFetch("/api/admissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: change.action,
              planId: selectedPlan.id,
              contentTable,
              contentId,
            }),
          });
          const data = await res.json();
          if (!res.ok)
            throw new Error(data.error || "Failed to update plan content");
        }),
      );
      void results;
      await loadPlanContent(selectedPlan.id);
      setSuccess("Plan content updated for every subscriber.");
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
          <button
            onClick={openEnrol}
            className={`${primary} self-start lg:self-auto`}
            style={{
              background: "#fff",
              color: "#101828",
              boxShadow: "0 16px 40px rgba(0,0,0,0.22)",
            }}
          >
            <UserPlus className="w-4 h-4" />
            Assign subscription
          </button>
        </div>
      </section>

      <nav
        className="grid grid-cols-4 gap-1 p-1.5 rounded-2xl w-full"
        style={{ background: C.card }}
      >
        {(
          [
            ["overview", "Command center", LayoutDashboard],
            ["subscribers", "Subscribers", Users],
            ["payments", "Payments", WalletCards],
            ["plans", "Plans", Layers3],
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
                          onClick={() => openManage(sub)}
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
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-full grid place-items-center text-xs font-black"
                              style={{ background: `${C.cta}14`, color: C.cta }}
                            >
                              {(sub.students?.full_name || "?").charAt(0)}
                            </div>
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
                            onClick={() => openManage(sub)}
                            className="rounded-lg px-3 py-2 text-xs font-bold"
                            style={{ background: C.pill, color: C.cta }}
                          >
                            Manage
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
                  <button
                    key={sub.id}
                    onClick={() => openManage(sub)}
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
                  </button>
                ))}
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
              <section className="rounded-2xl p-4 sm:p-5" style={cardStyle(C)}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <p className="font-black" style={{ color: C.text }}>
                      Subscription plans
                    </p>
                    <p className="text-xs mt-1" style={{ color: C.faint }}>
                      Choose a plan to manage its shared content and
                      availability.
                    </p>
                  </div>
                  <div className="relative">
                    <button
                      onClick={() => setPlanMenuOpen((open) => !open)}
                      className="w-9 h-9 rounded-xl grid place-items-center"
                      style={{ background: C.pill, color: C.text }}
                      aria-label="Plan actions"
                    >
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                    {planMenuOpen && (
                      <div
                        className="absolute right-0 top-11 z-20 w-56 rounded-xl p-2"
                        style={modalStyle(C)}
                      >
                        <button
                          onClick={() => {
                            setPlanMenuOpen(false);
                            setCreatePlanOpen(true);
                          }}
                          className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold"
                          style={{ color: C.text }}
                        >
                          <span
                            className="w-8 h-8 rounded-lg grid place-items-center"
                            style={{ background: `${C.cta}14`, color: C.cta }}
                          >
                            <Plus className="w-4 h-4" />
                          </span>
                          Create new plan
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {plans.map((plan) => (
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
                      className="group relative rounded-xl p-3.5 text-left transition-all cursor-pointer"
                      style={{
                        background:
                          selectedPlan?.id === plan.id ? `${C.cta}0c` : C.page,
                        boxShadow:
                          selectedPlan?.id === plan.id
                            ? `inset 0 0 0 1.5px ${C.cta}`
                            : "none",
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div
                          className="w-8 h-8 rounded-lg grid place-items-center"
                          style={{ background: C.card, color: C.cta }}
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
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
                      <div className="mt-3">
                        <p className="font-bold" style={{ color: C.text }}>
                          {plan.name}
                        </p>
                        <p
                          className="text-xs mt-0.5 truncate"
                          style={{ color: C.faint }}
                        >
                          {plan.description ||
                            "Reusable subscription access plan"}
                        </p>
                      </div>
                      <div
                        className="flex items-center justify-between mt-3 pt-2 text-[11px]"
                        style={{
                          borderTop: `1px solid ${C.divider}`,
                          color: C.faint,
                        }}
                      >
                        <span>
                          {
                            subscriptions.filter((s) => s.plan_id === plan.id)
                              .length
                          }{" "}
                          subscribers
                        </span>
                        {selectedPlan?.id === plan.id && (
                          <span className="font-bold" style={{ color: C.cta }}>
                            Selected
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {plans.length === 0 && (
                    <button
                      onClick={() => setCreatePlanOpen(true)}
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
                      <button
                        onClick={togglePlan}
                        disabled={busy}
                        className={`${primary} self-start`}
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
                                            : "transparent",
                                          border: `1.5px solid ${selected ? C.cta : C.cardBorder}`,
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

      {bulkPlan && (
        <Modal
          title={`Bulk add to ${bulkPlan.name}`}
          eyebrow="CSV or pasted learners"
          onClose={() => setBulkPlan(null)}
          C={C}
          wide
        >
          <div className="space-y-6">
            <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: C.page }}>
              <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: C.cta }} />
              <div>
                <p className="text-sm font-bold" style={{ color: C.text }}>Payment approval still controls access</p>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: C.muted }}>Each learner receives a payment request for this plan. Their subscription becomes active only after their payment confirmation is approved.</p>
              </div>
            </div>

            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm font-bold" style={{ color: C.text }}>1. Add learners</p>
                  <p className="text-xs mt-1" style={{ color: C.faint }}>Upload a .csv file or paste CSV rows or one email per line.</p>
                </div>
                <label className={`${primary} cursor-pointer self-start`} style={{ background: C.pill, color: C.text }}>
                  <Upload className="w-4 h-4" />Upload CSV
                  <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { readBulkFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                </label>
              </div>
              <textarea
                value={bulkText}
                onChange={(event) => updateBulkText(event.target.value)}
                className={`${fieldClass} min-h-44 font-mono text-xs leading-relaxed`}
                style={inputStyle}
                placeholder={'email,full_name,duration_months,amount,currency,due_date\nada@example.com,Ada Mensah\nkwame@example.com,Kwame Asare,3,300,GHS,2026-09-30'}
              />
              <p className="text-[11px] mt-2" style={{ color: C.faint }}>Required column: email. Optional: full_name, duration_months, amount, currency, due_date. Optional values override the defaults below.</p>
            </div>

            <div>
              <p className="text-sm font-bold mb-3" style={{ color: C.text }}>2. Default payment terms</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="text-xs font-bold" style={{ color: C.muted }}>Duration<select value={bulkDefaults.durationMonths} onChange={(event) => setBulkDefaults(value => ({ ...value, durationMonths: event.target.value }))} className={`${fieldClass} mt-1.5`} style={inputStyle}>{[1, 3, 6, 12].map(months => <option key={months} value={months}>{months} month{months === 1 ? "" : "s"}</option>)}</select></label>
                <label className="text-xs font-bold" style={{ color: C.muted }}>Amount<input type="number" inputMode="decimal" min="0.01" step="0.01" value={bulkDefaults.amount} onChange={(event) => setBulkDefaults(value => ({ ...value, amount: event.target.value }))} placeholder="0.00" className={`${fieldClass} mt-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} style={inputStyle} /></label>
                <label className="text-xs font-bold" style={{ color: C.muted }}>Currency<input value={bulkDefaults.currency} onChange={(event) => setBulkDefaults(value => ({ ...value, currency: event.target.value }))} className={`${fieldClass} mt-1.5`} style={inputStyle} /></label>
                <label className="text-xs font-bold" style={{ color: C.muted }}>Payment deadline<input type="date" value={bulkDefaults.dueDate} onChange={(event) => setBulkDefaults(value => ({ ...value, dueDate: event.target.value }))} className={`${fieldClass} mt-1.5`} style={inputStyle} /></label>
              </div>
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
            {bulkResult && <div className="space-y-3"><div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{[["Requests", bulkResult.requested], ["New accounts", bulkResult.newAccounts], ["Existing", bulkResult.existingStudents], ["Payment emails", bulkResult.paymentEmailsSent], ["Setup emails", bulkResult.setupEmailsSent]].map(([label, value]) => <div key={String(label)} className="rounded-xl p-3" style={{ background: C.page }}><p className="text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>{label}</p><p className="text-xl font-bold mt-1" style={{ color: C.text }}>{value}</p></div>)}</div>{bulkResult.errors?.length > 0 && <div className="rounded-xl p-3" style={{ background: C.errorBg, color: C.errorText }}><p className="text-xs font-bold mb-2">Rows needing attention</p>{bulkResult.errors.map((item: any) => <p key={`${item.row}-${item.email}`} className="text-xs mt-1">Row {item.row}: {item.email || "No email"} - {item.error}</p>)}</div>}{bulkResult.warnings?.length > 0 && <div className="rounded-xl p-3" style={{ background: "rgba(217,119,6,0.10)", color: "#b45309" }}>{bulkResult.warnings.map((item: any) => <p key={`${item.row}-${item.email}`} className="text-xs">Row {item.row}: {item.warning}</p>)}</div>}</div>}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button onClick={() => setBulkPlan(null)} className={primary} style={{ background: C.pill, color: C.text }}>{bulkResult ? "Close" : "Cancel"}</button>
              <button onClick={importBulkStudents} disabled={busy || bulkRows.length === 0 || bulkRows.length > 500 || Number(bulkDefaults.amount) <= 0 || !bulkDefaults.currency.trim() || !bulkDefaults.dueDate} className={primary} style={{ background: C.cta, color: C.ctaText }}><UserPlus className="w-4 h-4" />{busy ? "Creating requests..." : `Create ${bulkRows.length || ""} payment request${bulkRows.length === 1 ? "" : "s"}`}</button>
            </div>
          </div>
        </Modal>
      )}

      {createPlanOpen && (
        <Modal
          title="Create subscription plan"
          eyebrow="Reusable access blueprint"
          onClose={() => setCreatePlanOpen(false)}
          C={C}
          error={error}
        >
          <div className="space-y-4">
            <label className="text-xs font-bold" style={{ color: C.muted }}>
              Plan name
              <input
                autoFocus
                value={newPlanName}
                onChange={(e) => setNewPlanName(e.target.value)}
                placeholder="For example: Professional"
                className={`${fieldClass} mt-1.5`}
                style={inputStyle}
              />
            </label>
            <label className="text-xs font-bold" style={{ color: C.muted }}>
              Description
              <textarea
                value={newPlanDescription}
                onChange={(e) => setNewPlanDescription(e.target.value)}
                placeholder="Describe who this plan is for"
                className={`${fieldClass} mt-1.5 min-h-24`}
                style={inputStyle}
              />
            </label>
            <button
              onClick={createPlan}
              disabled={busy || !newPlanName.trim()}
              className={`${primary} w-full py-3`}
              style={{ background: C.cta, color: C.ctaText }}
            >
              <Plus className="w-4 h-4" style={{ color: "#ffffff" }} />
              {busy ? "Creating..." : "Create plan"}
            </button>
          </div>
        </Modal>
      )}

      {editPlan && (
        <Modal
          title="Edit plan details"
          eyebrow="Reusable access blueprint"
          onClose={() => {
            setEditPlan(null);
            setError("");
          }}
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
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setEditPlan(null);
                  setError("");
                }}
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

      {manageSub && (
        <Modal
          title={manageSub.students?.full_name || manageSub.students?.email}
          eyebrow="Subscriber workspace"
          onClose={() => setManageSub(null)}
          C={C}
          error={error}
          wide
        >
          <div className="space-y-6">
            <div className="grid sm:grid-cols-4 gap-3">
              {[
                ["Status", manageSub.status],
                ["Plan", manageSub.subscription_plans?.name],
                ["Expires", dateLabel(manageSub.current_period_end)],
                [
                  "Current terms",
                  `${manageSub.duration_months} mo - ${money(manageSub.currency, manageSub.amount)}`,
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl p-3"
                  style={{ background: C.page }}
                >
                  <p
                    className="text-[10px] uppercase tracking-wider font-bold"
                    style={{ color: C.faint }}
                  >
                    {label}
                  </p>
                  <p
                    className="text-sm font-bold mt-1 capitalize"
                    style={{ color: C.text }}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl p-5" style={{ background: C.page }}>
              <p className="font-bold" style={{ color: C.text }}>
                Change access blueprint
              </p>
              <p className="text-xs mt-1 mb-3" style={{ color: C.faint }}>
                Price, duration and expiry remain unchanged.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={changePlanId}
                  onChange={(e) => setChangePlanId(e.target.value)}
                  className={`${fieldClass} flex-1`}
                  style={inputStyle}
                >
                  {activePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={changePlan}
                  disabled={busy || changePlanId === manageSub.plan_id}
                  className={primary}
                  style={{ background: C.cta, color: C.ctaText }}
                >
                  Apply plan
                </button>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-bold" style={{ color: C.text }}>
                    Extend access
                  </p>
                  <p className="text-xs mt-1" style={{ color: C.faint }}>
                    Create a learner payment request or record a verified
                    renewal.
                  </p>
                </div>
              </div>
              <div
                className="inline-flex p-1 rounded-xl mb-4"
                style={{ background: C.pill }}
              >
                {(["request", "paid"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => { setRenewMode(mode); setPaidAttemptKey(""); }}
                    className="rounded-lg px-3 py-2 text-xs font-bold capitalize"
                    style={{
                      background: renewMode === mode ? C.card : "transparent",
                      color: renewMode === mode ? C.text : C.faint,
                    }}
                  >
                    {mode === "request" ? "Request payment" : "Already paid"}
                  </button>
                ))}
              </div>
              {TermsFields(renewMode === "request")}
              {renewMode === "paid" && (
                <div className="mt-3">
                  {ReferenceFields()}
                </div>
              )}
              <button
                onClick={() =>
                  renewMode === "request"
                    ? assignRequest(manageSub)
                    : savePaid(manageSub)
                }
                disabled={busy || Number(payment.amount) <= 0}
                className={`${primary} w-full mt-4`}
                style={{ background: C.cta, color: C.ctaText }}
              >
                {renewMode === "request"
                  ? "Send renewal request"
                  : "Record and extend access"}
              </button>
            </div>
            <div
              className="flex flex-wrap items-center justify-between gap-3 pt-5"
              style={{ borderTop: `1px solid ${C.divider}` }}
            >
              <button
                onClick={() => showHistory(manageSub)}
                className="inline-flex items-center gap-2 text-sm font-bold"
                style={{ color: C.cta }}
              >
                <History className="w-4 h-4" />
                Payment history
              </button>
              {manageSub.status === "active" && (
                <button
                  onClick={cancelSubscription}
                  className="text-sm font-bold"
                  style={{ color: C.deleteText }}
                >
                  Cancel and revoke access
                </button>
              )}
            </div>
          </div>
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
    </div>
  );
}
