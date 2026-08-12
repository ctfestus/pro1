import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('fresh schema individual subscriptions', () => {
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
  const migration = readFileSync(join(process.cwd(), 'migrations/166_individual_subscriptions.sql'), 'utf8');
  const planMigration = readFileSync(join(process.cwd(), 'migrations/167_reusable_subscription_plans.sql'), 'utf8');
  const planChangeMigration = readFileSync(join(process.cwd(), 'migrations/168_subscription_plan_changes.sql'), 'utf8');
  const confirmationMigration = readFileSync(join(process.cwd(), 'migrations/169_subscription_payment_confirmations.sql'), 'utf8');
  const planDeletionMigration = readFileSync(join(process.cwd(), 'migrations/170_delete_unused_subscription_plans.sql'), 'utf8');
  const safeTransitionsMigration = readFileSync(join(process.cwd(), 'migrations/173_safe_enrollment_transitions.sql'), 'utf8');

  it('contains the discriminator and reusable-plan subscription tables', () => {
    expect(schema).toMatch(/enrollment_model\s+text/);
    expect(schema).toContain('CREATE TABLE public.subscription_plans');
    expect(schema).toContain('CREATE TABLE public.individual_subscriptions');
    expect(schema).toContain('CREATE TABLE public.subscription_payments');
    expect(schema).toContain('CREATE TABLE public.subscription_plan_content');
  });

  it('contains every transactional or enforcement function', () => {
    for (const name of [
      'claim_student_enrollment_model',
      'enforce_student_cohort_model_claim',
      'create_individual_subscription_plan',
      'release_student_from_bootcamp',
      'change_individual_subscription_plan',
      'purchase_or_renew_individual_subscription',
      'close_individual_subscription',
      'add_months_clamped',
      'toggle_content_cohort_tag',
      'approve_subscription_payment_confirmation',
      'submit_subscription_payment_confirmation',
      'reject_subscription_payment_confirmation',
      'cancel_subscription_payment_request',
      'delete_unused_subscription_plan',
      'create_individual_subscription_payment_request',
    ]) {
      expect(schema).toContain(`FUNCTION public.${name}`);
    }
    expect(migration).toContain('FUNCTION public.claim_student_enrollment_model');
    expect(migration).toContain('FUNCTION public.toggle_content_cohort_tag');
    expect(planMigration).toContain('FUNCTION public.create_individual_subscription_plan');
    expect(planMigration).toContain('FUNCTION public.release_student_from_bootcamp');
    expect(planChangeMigration).toContain('FUNCTION public.change_individual_subscription_plan');
  });

  it('only deletes never-used plans and cleans their access tags transactionally', () => {
    expect(planDeletionMigration).toContain('FUNCTION public.delete_unused_subscription_plan');
    expect(planDeletionMigration).toContain('FROM public.individual_subscriptions WHERE plan_id = p_plan_id');
    expect(planDeletionMigration).toContain('FROM public.subscription_payments WHERE plan_id = p_plan_id');
    expect(planDeletionMigration).toContain('FROM public.subscription_payment_requests WHERE plan_id = p_plan_id');
    expect(planDeletionMigration).toContain('FROM public.subscription_plan_changes');
    expect(planDeletionMigration).toContain('toggle_content_cohort_tag');
    expect(planDeletionMigration).toContain('DELETE FROM public.cohorts');
    expect((planDeletionMigration.match(/\bBEGIN;/g) ?? [])).toHaveLength(1);
    expect((planDeletionMigration.match(/\bCOMMIT;/g) ?? [])).toHaveLength(1);
  });

  it('keeps subscription payment requests separate and activates only during approval', () => {
    expect(schema).toContain('CREATE TABLE public.subscription_payment_requests');
    expect(schema).toContain('CREATE TABLE public.subscription_payment_confirmations');
    expect(confirmationMigration).not.toContain('REFERENCES public.bootcamp_enrollments');
    expect(confirmationMigration).not.toContain('REFERENCES public.student_payment_confirmations');
    const submitFunction = confirmationMigration.slice(
      confirmationMigration.indexOf('FUNCTION public.submit_subscription_payment_confirmation'),
      confirmationMigration.indexOf('FUNCTION public.reject_subscription_payment_confirmation'),
    );
    expect(submitFunction).not.toContain('purchase_or_renew_individual_subscription');
    const approvalFunction = confirmationMigration.slice(
      confirmationMigration.indexOf('FUNCTION public.approve_subscription_payment_confirmation'),
      confirmationMigration.indexOf('FUNCTION public.submit_subscription_payment_confirmation'),
    );
    expect(approvalFunction).toContain('purchase_or_renew_individual_subscription');
    expect(approvalFunction).toContain("v_confirmation.status <> 'pending'");
    expect(confirmationMigration).toContain('confirmed amount must equal the assigned subscription amount');
    expect(confirmationMigration).toContain('idx_subscription_payment_requests_open_student');
    expect((confirmationMigration.match(/\bBEGIN;/g) ?? [])).toHaveLength(1);
    expect((confirmationMigration.match(/\bCOMMIT;/g) ?? [])).toHaveLength(1);
  });

  it('changes plan access without rewriting billing terms', () => {
    expect(planChangeMigration).toContain('CREATE TABLE public.subscription_plan_changes');
    const update = planChangeMigration.slice(
      planChangeMigration.indexOf('UPDATE public.individual_subscriptions'),
      planChangeMigration.indexOf('WHERE id = p_subscription_id;', planChangeMigration.indexOf('UPDATE public.individual_subscriptions')),
    );
    expect(update).toContain('plan_id = p_new_plan_id');
    expect(update).toContain('cohort_id = v_new_cohort_id');
    expect(update).not.toContain('amount');
    expect(update).not.toContain('duration_months');
    expect(update).not.toContain('current_period_end');
    expect((planChangeMigration.match(/\bBEGIN;/g) ?? [])).toHaveLength(1);
    expect((planChangeMigration.match(/\bCOMMIT;/g) ?? [])).toHaveLength(1);
  });

  it('keeps the migration in one transaction and preserves cancellation time', () => {
    expect((migration.match(/\bBEGIN;/g) ?? [])).toHaveLength(1);
    expect((migration.match(/\bCOMMIT;/g) ?? [])).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).toContain("COALESCE(cancelled_at, now())");
    expect((planMigration.match(/\bBEGIN;/g) ?? [])).toHaveLength(1);
    expect((planMigration.match(/\bCOMMIT;/g) ?? [])).toHaveLength(1);
    expect(planMigration.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('keeps deployed migration 166 historical and upgrades through 167', () => {
    expect(migration).toContain('CREATE TABLE public.subscription_content');
    expect(migration).not.toContain('CREATE TABLE public.subscription_plans');
    expect(planMigration).toContain('CREATE TABLE public.subscription_plans');
    expect(planMigration).toContain('ALTER TABLE public.subscription_content RENAME TO subscription_plan_content');
    expect(planMigration).not.toMatch(/SELECT\s+p,\s*c\.is_individual\s+INTO\s+v_plan,/);
    expect(schema).not.toMatch(/SELECT\s+p,\s*c\.is_individual\s+INTO\s+v_plan,/);
  });

  it('exposes subscription tables as select-only through RLS', () => {
    expect(schema).toContain('"subscription_plan_content: instructor select"');
    expect(schema).not.toContain('"subscription_plan_content: instructor all"');
    expect(schema).not.toContain('"individual_subscriptions: instructor all"');
  });

  it('allows safe model transitions without losing released enrollment history', () => {
    expect(safeTransitionsMigration).toContain('FUNCTION public.claim_student_enrollment_model');
    expect(safeTransitionsMigration).toContain('released_at = COALESCE(released_at, now())');
    expect(safeTransitionsMigration).toContain("v_current = 'bootcamp' AND p_requested_model = 'individual'");
    expect(safeTransitionsMigration).toContain("v_current = 'individual' AND p_requested_model = 'bootcamp'");
    expect(safeTransitionsMigration).toContain("status = 'active'");
    expect(safeTransitionsMigration).toContain("status IN ('pending', 'confirmation_submitted')");
    expect(safeTransitionsMigration).toContain('FUNCTION public.create_individual_subscription_payment_request');
    expect(safeTransitionsMigration).toContain("PERFORM public.claim_student_enrollment_model(p_student_id, 'individual')");
    expect(safeTransitionsMigration).toContain("v_plan_kind NOT IN ('legacy_individual', 'subscription_plan')");
    expect((safeTransitionsMigration.match(/\bBEGIN;/g) ?? [])).toHaveLength(1);
    expect((safeTransitionsMigration.match(/\bCOMMIT;/g) ?? [])).toHaveLength(1);
  });
});
