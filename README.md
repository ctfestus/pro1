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

Application form definitions are stored in Supabase. Publishing a form creates a separate Google spreadsheet for that form inside the staff-only Drive folder configured by `GOOGLE_APPLICATION_RESPONSES_FOLDER_ID`. The folder must be shared with `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and both the Google Sheets API and Google Drive API must be enabled for the service account project.

Apply migration `216_application_forms_database_and_response_index.sql` before deploying this version. To copy forms and responses from the legacy `ApplicationForms`, `ApplicationSubmissions`, and `ApplicationAudit` tabs without changing those backup tabs, run:

`npm run migrate:application-storage`
