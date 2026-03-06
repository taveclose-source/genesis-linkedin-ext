# Genesis Pipeline — LinkedIn Prospector

Chrome extension that scrapes LinkedIn profiles, generates personalized outreach messages, and logs prospects directly to your Supabase-backed sales pipeline.

## What It Does

When you visit a LinkedIn profile (`linkedin.com/in/...`), the extension:

1. **Scrapes** the profile — name, title, company, location, experience, about section
2. **Auto-classifies** — property type (HOA, Multifamily, Commercial, Mixed) and contact type (Decision Maker, Property Manager, Referral Source)
3. **Generates** a personalized connection message and follow-up message
4. **Lets you edit** — override any field, adjust the message, add notes
5. **Saves to Supabase** — one click logs the prospect into your `linkedin_prospects` table with full pipeline tracking

## Setup Instructions

### Step 1: Run the Supabase Migration

1. Open your Supabase dashboard: https://supabase.com/dashboard/project/oynuryauuglbxjunzcrj
2. Go to **SQL Editor**
3. Paste the contents of `supabase-migration.sql`
4. Click **Run**
5. This creates the `linkedin_prospects` table, activity log, views, and migrates your existing 7 contacts

### Step 2: Install the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `genesis-linkedin-ext` folder
5. The green "G" icon appears in your toolbar

### Step 3: Configure Supabase Connection

1. Click the Genesis Pipeline icon in your toolbar
2. Go to **Settings** tab
3. Enter your Supabase Project URL: `https://oynuryauuglbxjunzcrj.supabase.co`
4. Enter your Supabase Anon Key (from Settings → API in Supabase dashboard)
5. Click **Test Connection** — should show "Connected to Supabase!"
6. Click **Save Settings**

### Step 4: Start Prospecting

1. Go to any LinkedIn profile page (e.g., `linkedin.com/in/someone`)
2. The Genesis Pipeline panel appears on the right side
3. Review the scraped data and generated messages
4. Edit anything you want to customize
5. Click **Save to Pipeline**
6. Copy the connection message and paste it into LinkedIn's connection request

## File Structure

```
genesis-linkedin-ext/
├── manifest.json          # Chrome extension manifest (MV3)
├── content.js             # Profile scraper + UI panel (runs on LinkedIn)
├── content.css            # Panel styling
├── background.js          # Service worker — Supabase communication
├── popup.html             # Extension popup — dashboard + settings
├── supabase-migration.sql # Database schema + seed data
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Pipeline Stages

- **New Lead** — Just scraped/saved, no outreach yet
- **Active Discussion** — Engaged, conversations happening
- **Proposal Sent** — Formal proposal or water audit offered
- **Closed — Won** — New Genesis client
- **Closed — Lost** — Didn't convert (track for future)

## What's Next (Bubby / Claude Code Enhancements)

Once the base extension is running, use Claude Code to add:

1. **AI-powered message generation** — Call Claude API from the extension for truly personalized messages based on the full profile context
2. **Automated follow-up reminders** — Daily check of `next_action_date` with browser notifications
3. **Bulk LinkedIn search scraping** — Parse LinkedIn search results pages to identify new targets
4. **EdenPro integration** — When a prospect converts, auto-create them as a client in your EdenPro system
5. **Weekly digest email** — Supabase Edge Function that emails you a pipeline summary every Monday

## Notes

- LinkedIn changes their DOM structure periodically. If scraping breaks, the selectors in `content.js` may need updating.
- The extension uses LinkedIn's public profile data only — no API keys or automation that violates LinkedIn TOS.
- Messages are generated locally using templates. The Claude API integration (Step 1 above) makes them significantly better.
