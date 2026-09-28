<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/00125239-a7fa-44fb-bbe3-c1f8ac87e889

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
# Required scheduled jobs

Scheduled routes are registered outside the repository in the Upstash QStash console. The individual-subscription access model requires an hourly POST schedule (`0 * * * *`) targeting `/api/cron/subscription-expiry-sweep`. Without that schedule, expired subscriptions remain active. Verify the schedule in every deployed environment before enabling subscription sales.

## Application form response storage

Application form definitions, responses, review notes, status history, and email records are stored in Supabase. Applicant files upload directly to the private `application-uploads` Supabase Storage bucket through short-lived signed upload tokens. The bucket allows files up to 10 MB; the Supabase project-wide upload limit must also allow 10 MB. The application validates file type, size, and ownership before accepting a response. File-upload sessions require the existing Upstash Redis configuration for rate limiting. Assigned reviewers open files through the authenticated review panel. Application submissions can be exported as CSV. Google Sheets and Google Drive credentials are not needed for applications (other platform features may still use them).

Apply migrations `216_application_forms_database_and_response_index.sql`, `217_harden_application_sheet_storage.sql`, and `218_application_responses_supabase.sql` before deploying this version. Migration 218 is a clean cutover and does not copy old Google responses or remove Google files.
