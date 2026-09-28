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

Application form definitions are stored in Supabase. Publishing a form creates a separate folder for that form inside the staff-only Google Workspace Shared Drive folder configured by `GOOGLE_APPLICATION_RESPONSES_FOLDER_ID`. The folder contains that form's response spreadsheet and its applicant uploads. File answers are uploaded to Google Drive, and their Drive links are written to the response spreadsheet. A normal My Drive folder will not work because service accounts have no Drive storage quota. Add `GOOGLE_SERVICE_ACCOUNT_EMAIL` to the Shared Drive as a Content manager, and enable both the Google Sheets API and Google Drive API for the service account project.

Apply migrations `216_application_forms_database_and_response_index.sql` and `217_harden_application_sheet_storage.sql` before deploying this version.
