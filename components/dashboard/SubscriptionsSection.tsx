"use client";

// The Subscriptions page: data, page-level actions and the tab switch. Each tab, pop-up and menu
// lives in components/dashboard/subscriptions/.

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Plus, UserPlus, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { durationLabel } from "@/lib/pricing-offer";
import { describePlanContentResult, type PlanContentChange } from "@/lib/plan-content-request";
import { effectiveSubscriptionPrice } from "@/lib/subscription-discount";
import { DARK_C, type ThemeColors } from "@/lib/theme";
import { getPayments, postPayments, sendJson } from "@/components/dashboard/subscriptions/api";
import { AssignModal } from "@/components/dashboard/subscriptions/AssignModal";
import { BulkImportModal } from "@/components/dashboard/subscriptions/BulkImportModal";
import { CONTENT_TYPES, defaultCurrency, planDiscountFromRow, planIsReady, splitContentKey, startingPlanPrice } from "@/components/dashboard/subscriptions/drafts";
import { EditPlanModal } from "@/components/dashboard/subscriptions/EditPlanModal";
import { HistoryModal } from "@/components/dashboard/subscriptions/HistoryModal";
import { ManageSubscriberModal, type SubscriberAction } from "@/components/dashboard/subscriptions/ManageSubscriberModal";
import { AssignMenu, SubscriberMenu, menuPosition } from "@/components/dashboard/subscriptions/Menus";
import { OverviewTab } from "@/components/dashboard/subscriptions/OverviewTab";
import { PaymentsTab } from "@/components/dashboard/subscriptions/PaymentsTab";
import { PlanBuilderModal } from "@/components/dashboard/subscriptions/PlanBuilderModal";
import { planDiscountStatus } from "@/components/dashboard/subscriptions/PlanForm";
import { PlansTab } from "@/components/dashboard/subscriptions/PlansTab";
import { ReviewModal, type ReviewTarget } from "@/components/dashboard/subscriptions/ReviewModal";
import { SubscribersTab } from "@/components/dashboard/subscriptions/SubscribersTab";
import type { PlanSummary, SubsTab } from "@/components/dashboard/subscriptions/types";
import {
  DISPLAY_FONT, btnClass, btnStyle, daysRemaining, isLive, money, palette, pastDeadline, shortDate, subscriberBucket,
} from "@/components/dashboard/subscriptions/ui";
import { runPlanContentChanges, useClosePublicAsk } from "@/components/dashboard/subscriptions/planContent";

type Position = { top: number; right: number };

export function SubscriptionsSection({ C: theme }: { C: ThemeColors }) {
  // This page uses the dark-mode blue for buttons and selection controls in both modes. Text and
  // icons never use it: they stay in the neutral text colours.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const [tab, setTab] = useState<SubsTab>("overview");
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
  const [collected, setCollected] = useState<{ currency: string; online: number; recorded: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");

  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [planContent, setPlanContent] = useState<any[]>([]);
  const [selectedContentKeys, setSelectedContentKeys] = useState<string[]>([]);
  const [contentOptions, setContentOptions] = useState<any[]>([]);
  const [showArchivedPlans, setShowArchivedPlans] = useState(false);
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const planContentTicket = useRef(0);

  // What is open. Each pop-up keeps its own form state and is gone when it closes.
  const [assignMenu, setAssignMenu] = useState<Position | null>(null);
  const [subscriberMenu, setSubscriberMenu] = useState<{ sub: any; position: Position } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [bulkPlan, setBulkPlan] = useState<any>(null);
  const [manage, setManage] = useState<{ sub: any; action: SubscriberAction } | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [historySub, setHistorySub] = useState<any>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<any>(null);
  const { askToClosePublic, dialog: closePublicDialog } = useClosePublicAsk(C);

  async function loadPlanContent(id: string) {
    const ticket = ++planContentTicket.current;
    const data = await getPayments(`action=subscription-plan-content&planId=${id}`, "Failed to load plan content");
    // Clicking between plans quickly: only the latest plan's answer may fill the picker.
    if (ticket !== planContentTicket.current) return;
    setPlanContent(data.content ?? []);
    setSelectedContentKeys((data.content ?? []).map((item: any) => `${item.content_table}:${item.content_id}`));
  }

  async function load(preferredPlanId?: string) {
    setLoading(true);
    setError("");
    try {
      const [listData, plansData, requestsData, reviewData] = await Promise.all([
        getPayments("action=subscription-list", "Failed to load subscriptions"),
        // Archived plans come down with the rest and are filtered for display, so the toggle
        // does not need a round trip and the counts stay honest.
        getPayments("action=subscription-plans&includeArchived=true", "Failed to load plans"),
        getPayments("action=subscription-payment-requests", "Failed to load payment requests"),
        // Deliberately not fatal. The review list is a safety net, and failing to load it must not
        // take down the page an admin uses to run subscriptions.
        getPayments("action=payment-review", "").catch(() => null),
      ]);
      if (reviewData) {
        setReviewQueue(reviewData.items ?? []);
        setSweepHeartbeat(reviewData.heartbeat ?? null);
      }
      setSubscriptions(listData.subscriptions ?? []);
      setCollected(listData.collected ?? []);
      setEligibleStudents(listData.eligibleStudents ?? []);
      setPlans(plansData.plans ?? []);
      setPaymentRequests(requestsData.requests ?? []);
      setOpenCarts(requestsData.carts ?? []);
      const next =
        (plansData.plans ?? []).find((p: any) => p.id === preferredPlanId) ??
        (selectedPlan && (plansData.plans ?? []).find((p: any) => p.id === selectedPlan.id)) ??
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

  // Published content, once: Create plan and the Plans tab both choose from it.
  async function loadContentOptions() {
    const results = await Promise.all(
      CONTENT_TYPES.map((type) =>
        supabase
          .from(type.value)
          // available_to_everyone comes too. Without it this screen cannot tell which items are
          // open to everyone, so it could not warn before closing that, and could not ask.
          .select("id,title,available_to_everyone")
          .eq("status", "published")
          .order("title"),
      ),
    );
    const failed = results.find((result) => result.error);
    if (failed) setError(`Could not load the content list: ${failed.error?.message}`);
    setContentOptions(results.flatMap((result, index) =>
      (result.data ?? []).map((item) => ({ ...item, content_table: CONTENT_TYPES[index].value }))));
  }

  useEffect(() => {
    load();
    loadContentOptions();
    // This initial load intentionally uses the mount-time selection state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A page-level action: one at a time, with its outcome in the banner. */
  async function run(task: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const message = await task();
      if (message) setSuccess(message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** A pop-up finished: show what it did and reload. */
  function finished(message: string, planId?: string, nextTab?: SubsTab) {
    setError("");
    setSuccess(message);
    if (nextTab) setTab(nextTab);
    load(planId);
  }

  const resolveIncident = (item: any) => {
    const resolutionNote = window.prompt("Optional resolution note", "");
    if (resolutionNote === null) return;
    run(async () => {
      await postPayments({ action: "resolve-paystack-incident", incidentId: item.id, resolutionNote }, "Failed to resolve payment incident");
      setReviewQueue((current) => current.filter((row) => row.id !== item.id));
      return "Payment incident marked as resolved.";
    });
  };

  const cancelRequest = (id: string) => {
    if (!confirm("Cancel this payment request and close any pending confirmation?")) return;
    run(async () => {
      await postPayments({ action: "cancel-subscription-payment-request", requestId: id }, "Failed to cancel request");
      await load();
      return "Payment request cancelled.";
    });
  };

  // Clearing a learner's unfinished checkout for them. The server asks Paystack whether anything
  // was collected before it clears anything, so this cannot free somebody to pay a second time for
  // what they already bought.
  const clearCart = (cart: any) => {
    if (!confirm(`Clear the unfinished ${cart.plan_name} checkout for ${cart.students?.full_name || "this learner"}? They will be free to start a new payment.`)) return;
    run(async () => {
      await postPayments({ action: "clear-student-cart", reference: cart.reference }, "Failed to clear checkout");
      await load();
      return "Unfinished checkout cleared.";
    });
  };

  const cancelSubscription = (sub: any) => {
    setSubscriberMenu(null);
    if (!confirm("Cancel this subscription and revoke access immediately?")) return;
    run(async () => {
      await postPayments({ action: "cancel-subscription", subscriptionId: sub.id }, "Failed to cancel subscription");
      await load();
      return "Subscription cancelled and access revoked.";
    });
  };

  const deleteSubscriberAccount = (sub: any) => {
    setSubscriberMenu(null);
    const label = sub.students?.full_name || sub.students?.email || "this learner";
    if (!confirm(`Permanently delete "${label}"? This removes their login and student account, cancels open subscription access and payment requests, and cannot be undone. Completed financial history will be retained without the student identity.`)) return;
    run(async () => {
      await sendJson("/api/admin/delete-user", "DELETE", { userId: sub.student_id }, "Failed to delete student account");
      await load();
      return `${label} was permanently deleted.`;
    });
  };

  const togglePlan = (plan: any) => {
    setPlanMenuOpen(false);
    const status = plan.status === "active" ? "inactive" : "active";
    if (status === "active" && !planIsReady(plan)) {
      setError("Add at least one active price and one published content item before activating this plan.");
      return;
    }
    if (status === "inactive" && !confirm("Deactivate this plan? Existing access continues.")) return;
    run(async () => {
      await postPayments({ action: "update-subscription-plan", planId: plan.id, status }, "Failed to update plan");
      await load(plan.id);
    });
  };

  /**
   * Puts a finished plan out of the way, or brings it back.
   *
   * A plan with any history cannot be deleted -- that would orphan the record of what people
   * paid -- so archiving is the only way this list ever gets shorter.
   */
  const setPlanArchived = (plan: any, archived: boolean) => {
    setPlanMenuOpen(false);
    run(async () => {
      await postPayments({ action: "set-subscription-plan-archived", planId: plan.id, archived }, "Failed to archive plan");
      await load();
      return archived
        ? `"${plan.name}" archived. Its history is kept, and you can bring it back at any time.`
        : `"${plan.name}" is back in the list, still switched off.`;
    });
  };

  /**
   * Which plan the pricing page puts in front of visitors: first after the free tier, badged,
   * and led with in the hero. At most one, so marking a new one clears the old.
   */
  const setPlanRecommended = (plan: any, recommended: boolean) => {
    setPlanMenuOpen(false);
    run(async () => {
      await postPayments({ action: "set-subscription-plan-recommended", planId: plan.id, recommended }, "Failed to update the recommended plan");
      await load();
      return recommended
        ? `"${plan.name}" is now the best value plan on the pricing page.`
        : `"${plan.name}" is no longer marked best value.`;
    });
  };

  const deletePlan = (plan: any) => {
    setPlanMenuOpen(false);
    if (!confirm(`Permanently delete "${plan.name}"? This is only allowed when the plan has never been used.`)) return;
    run(async () => {
      await postPayments({ action: "delete-subscription-plan", planId: plan.id }, "Failed to delete plan");
      if (selectedPlan?.id === plan.id) {
        setSelectedPlan(null);
        setPlanContent([]);
        setSelectedContentKeys([]);
      }
      await load();
      return "Unused subscription plan permanently deleted.";
    });
  };

  const savePlanContentSelection = () => {
    if (!selectedPlan) return;
    run(async () => {
      const current = new Set(planContent.map((item) => `${item.content_table}:${item.content_id}`));
      const desired = new Set(selectedContentKeys);
      // Which endpoint action each of these becomes is the shared module's business, not this
      // screen's. Naming it here is what let one caller carry a rule the others did not.
      const toChange = (key: string, add: boolean): PlanContentChange => {
        const { contentTable, contentId } = splitContentKey(key);
        return { planId: selectedPlan.id, contentTable: contentTable as PlanContentChange["contentTable"], contentId, add };
      };
      const result = await runPlanContentChanges([
        ...selectedContentKeys.filter((key) => !current.has(key)).map((key) => toChange(key, true)),
        ...[...current].filter((key) => !desired.has(key)).map((key) => toChange(key, false)),
      ], contentOptions, askToClosePublic);
      // Cancelled at the confirmation. Nothing was sent, so say nothing happened.
      if (!result) return;

      // Re-read before reporting. Each change was its own request, so the stored answer is the
      // only honest account of where this plan ended up.
      await loadPlanContent(selectedPlan.id);
      const message = describePlanContentResult(result.summary, result.total);
      if (result.summary.failed.length || result.summary.needsPrivate.length) throw new Error(message);
      return result.summary.warnings.length ? `${message} Some learners could not be emailed.` : "Plan content updated for every subscriber.";
    });
  };

  const selectPlan = (plan: any) => {
    setPlanMenuOpen(false);
    setSelectedPlan(plan);
    loadPlanContent(plan.id).catch((err) => setError(err.message));
  };

  function openBulkImport(plan?: any) {
    setAssignMenu(null);
    setPlanMenuOpen(false);
    const next = plan?.id ? plan : activePlans[0];
    if (!next) setError("Create or activate a subscription plan before adding learners.");
    else setBulkPlan(next);
  }

  const openPopup = (open: () => void) => {
    setError("");
    open();
  };

  const currency = defaultCurrency(plans);
  const activePlans = plans.filter((p) => p.status === "active");
  const active = subscriptions.filter(isLive);
  const awaitingReview = paymentRequests.filter((r) => r.status === "confirmation_submitted");
  const awaitingStudent = paymentRequests.filter((r) => r.status === "pending");
  const lateRequests = awaitingStudent.filter((r) => pastDeadline(r.due_date));
  const actionCount = reviewQueue.length + awaitingReview.length + lateRequests.length;
  const paymentHistory = paymentRequests.filter((r) => !["pending", "confirmation_submitted"].includes(r.status));
  const expiring = active
    .filter((s) => daysRemaining(s.current_period_end) <= 30)
    .sort((a, b) => +new Date(a.current_period_end) - +new Date(b.current_period_end));
  const filtered = useMemo(
    () =>
      subscriptions.filter((sub) => {
        const term = `${sub.students?.full_name || ""} ${sub.students?.email || ""}`.toLowerCase();
        return (
          (!search || term.includes(search.toLowerCase())) &&
          (statusFilter === "all" || subscriberBucket(sub) === statusFilter) &&
          (planFilter === "all" || sub.plan_id === planFilter)
        );
      }),
    [subscriptions, search, statusFilter, planFilter],
  );
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

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* The dashboard hides its own section title here, so this is the page heading. */}
          <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Subscriptions</h1>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Plans, subscribers and payments in one place.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => openPopup(() => setBuilderOpen(true))} className={btnClass} style={btnStyle("sec", C)}>
            <Plus className="w-4 h-4" />
            Create plan
          </button>
          <button
            type="button"
            onClick={(event) => setAssignMenu(assignMenu ? null : menuPosition(event.currentTarget, 140))}
            className={btnClass}
            style={{ ...btnStyle("pri", C), boxShadow: `0 6px 16px ${C.cta}24` }}
            aria-expanded={Boolean(assignMenu)}
            aria-haspopup="menu"
          >
            <UserPlus className="w-4 h-4" />
            Assign subscription
            <ChevronDown className={`w-4 h-4 transition-transform ${assignMenu ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* The same section switch as Payments: white, the open section in the selection blue. */}
      <div role="tablist" aria-label="Subscriptions sections" className="inline-flex max-w-full overflow-x-auto gap-1 p-1 rounded-2xl" style={{ background: C.card }}>
        {([
          ["overview", "Overview"],
          ["subscribers", "Subscribers"],
          ["payments", "Payments"],
          ["plans", "Plans"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-[10px] text-sm font-semibold whitespace-nowrap"
            style={tab === id ? { background: palette(C).sel, color: palette(C).onSel } : { color: C.muted }}
          >
            {label}
            {id === "payments" && actionCount > 0 && (
              <span className="w-2 h-2 rounded-full" style={{ background: tab === id ? "#FFFFFF" : palette(C).bad }} aria-label={`${actionCount} need your action`} />
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          <XCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 rounded-2xl animate-pulse" style={{ background: C.card }} />)}
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
              onReview={(request) => setReviewTarget({ request, decision: "approve" })}
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
              onMenu={(event, sub) => {
                event.stopPropagation();
                setSubscriberMenu(subscriberMenu?.sub.id === sub.id ? null : { sub, position: menuPosition(event.currentTarget, 390) });
              }}
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
              onReview={(request, decision) => setReviewTarget({ request, decision })}
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
              menuOpen={planMenuOpen}
              setMenuOpen={setPlanMenuOpen}
              onCreate={() => openPopup(() => setBuilderOpen(true))}
              onEdit={(plan) => openPopup(() => { setPlanMenuOpen(false); setEditPlan(plan); })}
              onToggle={togglePlan}
              onBulk={openBulkImport}
              onRecommend={setPlanRecommended}
              onArchive={setPlanArchived}
              onDelete={deletePlan}
              planContent={planContent}
              contentOptions={contentOptions}
              selectedContentKeys={selectedContentKeys}
              setSelectedContentKeys={setSelectedContentKeys}
              onSaveContent={savePlanContentSelection}
            />
          )}
        </>
      )}

      {assignMenu && (
        <AssignMenu
          position={assignMenu}
          onClose={() => setAssignMenu(null)}
          onOne={() => { setAssignMenu(null); openPopup(() => setAssignOpen(true)); }}
          onMany={() => openBulkImport()}
          manyDisabled={activePlans.length === 0}
          C={C}
        />
      )}
      {subscriberMenu && (
        <SubscriberMenu
          sub={subscriberMenu.sub}
          position={subscriberMenu.position}
          onClose={() => setSubscriberMenu(null)}
          onAction={(action) => { setSubscriberMenu(null); openPopup(() => setManage({ sub: subscriberMenu.sub, action })); }}
          onHistory={() => { setSubscriberMenu(null); setHistorySub(subscriberMenu.sub); }}
          onRevoke={() => cancelSubscription(subscriberMenu.sub)}
          onDelete={() => deleteSubscriberAccount(subscriberMenu.sub)}
          C={C}
        />
      )}

      {assignOpen && (
        <AssignModal
          eligibleStudents={eligibleStudents}
          activePlans={activePlans}
          currency={currency}
          onClose={() => setAssignOpen(false)}
          onDone={(message, nextTab, planId) => { setAssignOpen(false); finished(message, planId, nextTab); }}
          C={C}
        />
      )}
      {bulkPlan && (
        <BulkImportModal
          initialPlan={bulkPlan}
          activePlans={activePlans}
          currency={currency}
          onClose={() => setBulkPlan(null)}
          onImported={(message, planId) => finished(message, planId)}
          C={C}
        />
      )}
      {manage && (
        <ManageSubscriberModal
          sub={manage.sub}
          action={manage.action}
          activePlans={activePlans}
          currency={currency}
          onClose={() => setManage(null)}
          onDone={(message, nextTab) => { setManage(null); finished(message, undefined, nextTab); }}
          C={C}
        />
      )}
      {reviewTarget && (
        <ReviewModal
          target={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onDone={(message) => { setReviewTarget(null); finished(message); }}
          C={C}
        />
      )}
      {historySub && <HistoryModal sub={historySub} onClose={() => setHistorySub(null)} C={C} />}
      {builderOpen && (
        <PlanBuilderModal
          contentOptions={contentOptions}
          currency={currency}
          askToClosePublic={askToClosePublic}
          onClose={() => setBuilderOpen(false)}
          onChanged={(planId) => load(planId)}
          onSaved={(message, planId) => { setBuilderOpen(false); finished(message, planId); }}
          C={C}
        />
      )}
      {editPlan && (
        <EditPlanModal
          plan={editPlan}
          currency={currency}
          onClose={() => setEditPlan(null)}
          onSaved={(message, planId) => { setEditPlan(null); finished(message, planId); }}
          C={C}
        />
      )}
      {closePublicDialog}
    </div>
  );
}
