import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { studentAccountCreatedEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { addToResendAudience } from '@/lib/resend-audience';
import { markAdmissionsProvisioned, markExistingAccountAdmitted } from '@/lib/account-state-server';

const resend = new Resend(process.env.RESEND_API_KEY);

function temporaryPassword() {
  return `${randomBytes(32).toString('base64url')}Aa1!`;
}

export async function provisionIndividualStudent(
  db: SupabaseClient,
  input: { email: string; fullName?: string | null; notify?: boolean; claimModel?: boolean },
) {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName?.trim() || null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email is required.');

  const { data: existing, error: existingError } = await db
    .from('students')
    .select('id, role, full_name, account_provisioned_at')
    .eq('email', email)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing && existing.role !== 'student') throw new Error('This email belongs to a staff account.');

  let studentId = existing?.id as string | undefined;
  let createdUserId: string | null = null;
  try {
    if (!studentId) {
      const { data, error } = await db.auth.admin.createUser({
        email,
        password: temporaryPassword(),
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : {},
      });
      if (error || !data.user) throw error ?? new Error('Could not create student account.');
      studentId = data.user.id;
      createdUserId = data.user.id;

      const now = new Date().toISOString();
      const { error: profileError } = await db.from('students').upsert({
        id: studentId,
        email,
        full_name: fullName,
        role: 'student',
        cohort_id: null,
        account_provisioned_at: now,
        updated_at: now,
      }, { onConflict: 'id' });
      if (profileError) throw profileError;
    } else {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (fullName && !existing?.full_name) patch.full_name = fullName;
      if (!existing?.account_provisioned_at) patch.account_provisioned_at = new Date().toISOString();
      const { error } = await db.from('students').update(patch).eq('id', studentId);
      if (error) throw error;
    }

    if (input.claimModel !== false) {
      const { error: claimError } = await db.rpc('claim_student_enrollment_model', {
        p_student_id: studentId,
        p_requested_model: 'individual',
      });
      if (claimError) throw claimError;
    }

    if (createdUserId) await markAdmissionsProvisioned(db, studentId);
    else await markExistingAccountAdmitted(db, studentId);

    if (input.notify !== false) {
      const tenant = await getTenantSettings();
      const appUrl = (process.env.APP_URL || tenant.appUrl || '').replace(/\/$/, '');
      if (!appUrl) throw new Error('APP_URL or platform App URL must be configured.');
      const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'recovery', email });
      if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error('Could not generate setup link.');
      const setupUrl = `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery`;

      if (!process.env.RESEND_API_KEY) throw new Error('Account created, but RESEND_API_KEY is not configured.');
      const from = process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`;
      const { error: emailError } = await resend.emails.send({
        from,
        to: email,
        subject: `Your ${tenant.appName} account is ready`,
        html: studentAccountCreatedEmail({
          name: fullName || existing?.full_name || 'there',
          cohortName: 'individual subscription',
          setupUrl,
          branding: { appName: tenant.appName, appUrl, logoUrl: tenant.logoUrl, emailBannerUrl: tenant.emailBannerUrl, teamName: tenant.teamName },
        }),
      });
      if (emailError) throw new Error(emailError.message);

      await db.from('students').update({ setup_email_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', studentId);
      if (createdUserId) await addToResendAudience({ email, name: fullName });
    }
    return { ok: true, studentId, isNewAccount: Boolean(createdUserId) };
  } catch (error) {
    if (createdUserId) await db.auth.admin.deleteUser(createdUserId).catch(() => {});
    throw error;
  }
}
