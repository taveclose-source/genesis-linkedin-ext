# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Genesis Pipeline LinkedIn Prospector — a Chrome extension (Manifest V3) for Genesis Sprinklers & Water Management. It scrapes LinkedIn profiles, auto-classifies prospects, generates personalized outreach messages, and saves them to a Supabase-backed sales pipeline. The business targets property managers, HOAs, multifamily, and commercial properties in the Sarasota-Bradenton, FL area.

## Architecture

**Chrome Extension (MV3)** with no build step — plain JavaScript, no bundler or framework.

### Content Script Pipeline (runs on linkedin.com)
Scripts are injected in order (defined in `manifest.json`):
1. `js/linkedin-context.js` — `LinkedInContext` module (IIFE). Detects page type (PROFILE, MESSAGING, POST, FEED, SEARCH, COMPANY) via URL regex, scrapes DOM for profile data, posts, messages. Watches for SPA navigations via MutationObserver since LinkedIn doesn't do full page reloads.
2. `js/action-engine.js` — `ActionEngine` module (IIFE). Pure decision logic: given a prospect record + scrape data, returns the recommended next action (LIKE_POST, LIKE_AND_COMMENT, CONNECT, SEND_MESSAGE, FOLLOW_UP_MESSAGE, WAIT, SUPPRESS). Manages an 8-stage funnel (discovered → liked → commented → connected → messaged → nurturing → qualified → closed) with configurable cadence delays between touches.
3. `content.js` — Main orchestrator. Boots the sidebar UI, calls `LinkedInContext.scrape()`, feeds results through `ActionEngine`, renders the sidebar with action cards, and handles Supabase reads/writes directly via REST API.

### Background Service Worker
`background.js` — Handles Supabase communication via `chrome.runtime.onMessage`. Supports: savePipelineRecord (upsert by linkedin_url), saveMessages (with dedup via message_hash), testConnection, config get/save, tenant config.

### Popup
`popup.html` + `popup.js` — Extension toolbar popup with dashboard (stats, recent prospects) and settings tab (Supabase URL/key configuration).

### Styling
- `sidebar.css` — Injected by manifest into LinkedIn pages (the only CSS in `content_scripts`)
- `content.css` — Additional styles, but **not auto-injected** by manifest; must be loaded manually if needed

### Database
Supabase tables defined in `supabase-migration.sql`:
- `linkedin_prospects` — Main prospect records with pipeline tracking, scoring, generated messages
- `linkedin_activity_log` — Interaction history per prospect
- Views: `pipeline_summary`, `overdue_actions`, `weekly_stats`

## Key Technical Details

- **Two Supabase interaction patterns coexist**: `content.js` talks to Supabase directly (hardcoded URL/key constants at top of file) using a `prospects` table. `background.js` uses config from `chrome.storage.sync` and targets the `linkedin_prospects` table. These are different tables/schemas — unifying them is a pending task.
- **Two different Supabase project URLs**: `content.js` and `manifest.json` use `mzvonofxmqnanyuebudg.supabase.co`. The README references `oynuryauuglbxjunzcrj.supabase.co` (an older project). The active one is `mzvonofxmqnanyuebudg`.
- **CSP compliance**: Sidebar uses `addEventListener` instead of inline `onclick` handlers (LinkedIn's CSP blocks inline scripts). The `attachSidebarListeners()` function must be called after every `setContent()` call.
- **SPA navigation handling**: LinkedIn is a SPA, so the extension uses MutationObserver on `document.body` + popstate listener with 1200ms debounce to detect route changes.
- **Message generation is template-based**: `ActionEngine` generates messages locally using string templates tailored to property managers vs. realtors vs. general contacts. No AI API calls yet.
- **Suppression logic**: Prospects with PENDING connection status and no actionable posts are suppressed and re-queued for when new activity is detected.

## Development

No build tools, package manager, or test framework. To develop:
1. Load the extension unpacked at `chrome://extensions/` with Developer Mode enabled
2. Edit files directly; click the reload button on the extensions page (or Ctrl+R on the extension card) to pick up changes
3. Content script changes require refreshing the LinkedIn tab after reloading the extension

## LinkedIn DOM Selectors

Selectors in `linkedin-context.js` are fragile — LinkedIn frequently changes their DOM structure. Key selectors to watch:
- Profile name: `h1.text-heading-xlarge, h1[class*="heading"]`
- Headline: `.text-body-medium.break-words, [class*="headline"]`
- Location: `.text-body-small.inline.t-black--light.break-words`
- Posts: `[data-urn*="activity"], .feed-shared-update-v2`
- Messages: `.msg-s-message-list__event`

## Known Issues

### Chrome Extension — Name Scraping
- Prospect name shows "Unknown" instead of scraping the actual name from DOM
- `linkedin-context.js` `scrapeProfile()` does extract the name — issue likely in how `content.js` maps scrape data to the prospect record or Supabase upsert

### Chrome Extension — Last Touch Date
- Action engine shows "Last touch 999 days ago" for all prospects
- Likely a date field mismatch between what's stored in Supabase and what `action-engine.js` reads (check `last_action_date` vs `last_touch` field names)
