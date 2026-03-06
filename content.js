// ============================================================
// content.js  (v2.2)
// Main content script — runs on ALL linkedin.com/* pages
// Fixes: CSP inline onclick violations + correct Supabase key
// ============================================================

const SUPABASE_URL = 'https://mzvonofxmqnanyuebudg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16dm9ub2Z4bXFuYW55dWVidWRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NDMzNjEsImV4cCI6MjA4MjAxOTM2MX0.jq0O01oTtprM8Jfj8Z4-hZNXVjybi4A1j_GR9w9uPRI';

// ----------------------------------------------------------------
// BOOT
// ----------------------------------------------------------------
(async function boot() {
  if (!document.getElementById('edenpro-sidebar')) {
    injectSidebarShell();
  }
  await handleNavigation();
  LinkedInContext.watchNavigation(async (scrapeData) => {
    await handleNavigation(scrapeData);
  });
})();

// ----------------------------------------------------------------
// NAVIGATION HANDLER
// ----------------------------------------------------------------
async function handleNavigation(scrapeData = null) {
  try {
    showSidebarLoading();
    if (!scrapeData) {
      await sleep(800);
      scrapeData = await LinkedInContext.scrape();
    }
    const { type } = LinkedInContext.getPageType();
    switch (type) {
      case 'PROFILE':   await handleProfilePage(scrapeData);   break;
      case 'MESSAGING': await handleMessagingPage(scrapeData); break;
      case 'POST':      await handlePostPage(scrapeData);      break;
      default:          renderSidebarIdle(type);
    }
  } catch (err) {
    console.error('[EdenPro] Navigation handler error:', err);
    renderSidebarError(err.message);
  }
}

// ----------------------------------------------------------------
// PAGE HANDLERS
// ----------------------------------------------------------------
async function handleProfilePage(scrapeData) {
  const handle = scrapeData.linkedin_handle;
  if (!handle) return renderSidebarError('Could not detect profile handle.');

  let prospect = await getProspect(handle);
  const { suppress, reason } = ActionEngine.shouldSuppressProspect(prospect || {}, scrapeData);

  if (suppress) {
    if (prospect) {
      await updateProspect(handle, {
        suppressed: true, suppress_reason: reason,
        requeue_trigger: 'new_post_or_profile_update',
        last_scraped_at: scrapeData.scraped_at
      });
    }
    renderSidebarSuppressed(scrapeData, reason);
    return;
  }

  const wasSuppressed = prospect?.suppressed;
  const hasPosts = (scrapeData.recent_posts || []).length > 0;
  if (wasSuppressed && hasPosts) {
    await updateProspect(handle, { suppressed: false, suppress_reason: null });
  }

  prospect = await upsertProspect(handle, scrapeData, prospect);
  const action = ActionEngine.getNextAction(prospect || {}, scrapeData);
  renderSidebarProfile(prospect, scrapeData, action);
}

async function handleMessagingPage(scrapeData) {
  const handle = scrapeData.linkedin_handle;
  let prospect = null;
  if (handle) {
    prospect = await getProspect(handle);
    if (prospect) {
      await updateProspect(handle, {
        last_message_text: scrapeData.last_message?.text || null,
        last_message_direction: scrapeData.last_sender || null,
        message_count: scrapeData.message_count || 0,
        last_scraped_at: scrapeData.scraped_at
      });
    }
  }
  renderSidebarMessaging(prospect, scrapeData);
}

async function handlePostPage(scrapeData) {
  const handle = scrapeData.linkedin_handle;
  let prospect = null;
  if (handle) {
    prospect = await getProspect(handle);
    if (prospect) {
      await updateProspect(handle, {
        last_post_viewed_url: scrapeData.post_url,
        last_scraped_at: scrapeData.scraped_at
      });
    }
  }
  renderSidebarPostView(prospect, scrapeData);
}

// ----------------------------------------------------------------
// SUPABASE HELPERS
// ----------------------------------------------------------------
async function getProspect(linkedin_handle) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/prospects?linkedin_handle=eq.${encodeURIComponent(linkedin_handle)}&limit=1`,
      { headers: supabaseHeaders() }
    );
    const data = await res.json();
    return data[0] || null;
  } catch { return null; }
}

async function upsertProspect(linkedin_handle, scrapeData, existing) {
  const payload = {
    linkedin_handle,
    name: scrapeData.name || existing?.name,
    headline: scrapeData.headline || existing?.headline,
    location: scrapeData.location || existing?.location,
    linkedin_url: scrapeData.linkedin_url,
    connection_status: scrapeData.connection_status,
    current_employer: scrapeData.current_employer || existing?.current_employer,
    recent_posts: JSON.stringify(scrapeData.recent_posts || []),
    last_scraped_at: scrapeData.scraped_at,
    suppressed: false
  };
  if (!existing) {
    payload.stage = 'discovered';
    payload.created_at = scrapeData.scraped_at;
    payload.last_interaction_at = scrapeData.scraped_at;
    payload.last_interaction_date = scrapeData.scraped_at;
    payload.interaction_log = JSON.stringify([]);
  }
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/prospects`, {
      method: 'POST',
      headers: { ...supabaseHeaders(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(payload)
    });
    return await getProspect(linkedin_handle);
  } catch (err) {
    console.error('[EdenPro] Upsert failed:', err);
    return existing || payload;
  }
}

async function updateProspect(linkedin_handle, updates) {
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/prospects?linkedin_handle=eq.${encodeURIComponent(linkedin_handle)}`,
      { method: 'PATCH', headers: supabaseHeaders(), body: JSON.stringify(updates) }
    );
  } catch (err) {
    console.error('[EdenPro] Update failed:', err);
  }
}

function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
  };
}

// ----------------------------------------------------------------
// SIDEBAR SHELL
// ----------------------------------------------------------------
function injectSidebarShell() {
  const div = document.createElement('div');
  div.id = 'edenpro-sidebar';
  div.innerHTML = `
    <div id="edenpro-header">
      <span class="edenpro-logo">⚡ EdenPro</span>
      <button id="edenpro-toggle" title="Minimize">−</button>
    </div>
    <div id="edenpro-body">
      <div id="edenpro-content">Loading...</div>
    </div>
  `;
  document.body.appendChild(div);
  document.getElementById('edenpro-toggle').addEventListener('click', () => {
    const body = document.getElementById('edenpro-body');
    const btn  = document.getElementById('edenpro-toggle');
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? 'block' : 'none';
    btn.textContent = collapsed ? '−' : '+';
  });
}

function setContent(html) {
  const el = document.getElementById('edenpro-content');
  if (el) el.innerHTML = html;
}

// ----------------------------------------------------------------
// FIX: attach event listeners after setContent instead of onclick
// ----------------------------------------------------------------
function attachSidebarListeners() {
  // Copy buttons — data-copy-id points to the element to copy
  document.querySelectorAll('#edenpro-content .edenpro-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-copy-id');
      const el = document.getElementById(targetId);
      if (!el) return;
      navigator.clipboard.writeText(el.innerText).then(() => {
        el.style.background = '#d4edda';
        setTimeout(() => el.style.background = '', 1500);
      });
    });
  });

  // Complete buttons — data-action and data-handle
  document.querySelectorAll('#edenpro-content .edenpro-complete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const actionType = btn.getAttribute('data-action');
      const handle = btn.getAttribute('data-handle');
      markActionComplete(actionType, handle);
    });
  });

  // Stage override dropdown
  const stageSelect = document.getElementById('edenpro-stage-select');
  if (stageSelect) {
    stageSelect.addEventListener('change', () => {
      const handle = stageSelect.getAttribute('data-handle');
      const newStage = stageSelect.value;
      overrideStage(handle, newStage);
    });
  }

  // Skip 30 days button
  const skip30Btn = document.getElementById('edenpro-skip30-btn');
  if (skip30Btn) {
    skip30Btn.addEventListener('click', () => {
      const handle = skip30Btn.getAttribute('data-handle');
      skipProspect30Days(handle);
    });
  }
}

// ----------------------------------------------------------------
// SIDEBAR RENDERERS
// ----------------------------------------------------------------
function showSidebarLoading() { setContent(`<div class="edenpro-loading">Scanning...</div>`); }
function renderSidebarError(msg) { setContent(`<div class="edenpro-error">⚠️ ${msg}</div>`); }
function renderSidebarIdle(pageType) { setContent(`<div class="edenpro-idle">📋 ${pageType} page — no actions available.</div>`); }

function renderSidebarSuppressed(scrapeData, reason) {
  setContent(`
    <div class="edenpro-section">
      <div class="edenpro-name">${scrapeData.name || 'Unknown'}</div>
      <div class="edenpro-badge badge-suppressed">⏸ Suppressed</div>
      <div class="edenpro-reason">${reason}</div>
      <div class="edenpro-small">Will re-queue when: new post or profile update detected.</div>
    </div>
  `);
}

function renderSidebarProfile(prospect, scrapeData, action) {
  const name = scrapeData.name || prospect?.name || 'Unknown';
  const stage = prospect?.stage || 'discovered';
  const connectionStatus = scrapeData.connection_status || 'UNKNOWN';
  const posts = scrapeData.recent_posts || [];
  const handle = prospect?.linkedin_handle || '';

  let actionHtml = '';
  if (action.type === 'SUPPRESS') {
    actionHtml = `<div class="edenpro-action action-none">⏸ ${action.reason}</div>`;
  } else if (action.type === 'WAIT') {
    actionHtml = `<div class="edenpro-action action-wait">⏳ ${action.reasoning}</div>`;
  } else if (action.type === 'LIKE_POST' || action.type === 'LIKE_AND_COMMENT') {
    const post = action.post;
    actionHtml = `
      <div class="edenpro-action action-engage">
        <div class="action-label">
          ${action.type === 'LIKE_AND_COMMENT' ? '💬 Like + Comment' : '👍 Like Post'}
          <span class="priority-${(action.priority||'').toLowerCase()}">${action.priority}</span>
        </div>
        <div class="edenpro-post-preview">"${(post?.text || '').slice(0, 120)}..."</div>
        ${action.suggested_comment ? `
          <div class="edenpro-suggested-label">Suggested comment:</div>
          <div class="edenpro-message-box" id="suggested-comment">${action.suggested_comment}</div>
          <button class="edenpro-copy-btn" data-copy-id="suggested-comment">Copy</button>
        ` : ''}
        ${post?.url ? `<a class="edenpro-link" href="${post.url}" target="_blank">Open post →</a>` : ''}
        <button class="edenpro-complete-btn" data-action="${action.type}" data-handle="${handle}">✓ Mark Complete</button>
      </div>
    `;
  } else if (action.type === 'SEND_MESSAGE' || action.type === 'FOLLOW_UP_MESSAGE') {
    actionHtml = `
      <div class="edenpro-action action-message">
        <div class="action-label">✉️ ${action.type === 'FOLLOW_UP_MESSAGE' ? 'Follow-Up' : 'First Message'}</div>
        <div class="edenpro-suggested-label">Suggested message:</div>
        <div class="edenpro-message-box" id="suggested-message">${action.suggested_message}</div>
        <button class="edenpro-copy-btn" data-copy-id="suggested-message">Copy</button>
        <button class="edenpro-complete-btn" data-action="${action.type}" data-handle="${handle}">✓ Sent</button>
      </div>
    `;
  } else if (action.type === 'CONNECT') {
    actionHtml = `
      <div class="edenpro-action action-connect">
        <div class="action-label">🔗 Send Connection Request</div>
        <div class="edenpro-message-box" id="connection-note">${action.connection_note}</div>
        <button class="edenpro-copy-btn" data-copy-id="connection-note">Copy</button>
        <button class="edenpro-complete-btn" data-action="CONNECT" data-handle="${handle}">✓ Sent</button>
      </div>
    `;
  }

  const postsHtml = posts.length
    ? posts.slice(0, 3).map(p => `
        <div class="edenpro-post-item ${p.already_liked ? 'already-liked' : ''}">
          ${p.already_liked ? '✅' : '○'} <span class="post-type-badge">${p.type}</span>
          <span class="post-snippet">${(p.text || '').slice(0, 80)}...</span>
        </div>
      `).join('')
    : '<div class="edenpro-small">No recent posts found.</div>';

  const MANUAL_STAGES = ['discovered','monitoring','first_touch','cooldown','connection','nurture'];
  const stageOptions = MANUAL_STAGES.map(s =>
    `<option value="${s}" ${s === stage ? 'selected' : ''}>${s.replace('_',' ').toUpperCase()}</option>`
  ).join('');

  setContent(`
    <div class="edenpro-section">
      <div class="edenpro-name">${name}</div>
      <div class="edenpro-headline">${scrapeData.headline || ''}</div>
      <div class="edenpro-meta">
        <span class="badge badge-${connectionStatus.toLowerCase()}">${connectionStatus}</span>
        <span class="badge badge-stage">${stage.toUpperCase()}</span>
      </div>
      <div class="edenpro-stage-override">
        <select id="edenpro-stage-select" data-handle="${handle}">${stageOptions}</select>
        <button id="edenpro-skip30-btn" class="edenpro-skip30-btn" data-handle="${handle}">Skip 30d</button>
      </div>
    </div>
    <div class="edenpro-section">
      <div class="edenpro-section-title">NEXT ACTION</div>
      ${actionHtml}
      <div class="edenpro-reasoning">${action.reasoning || ''}</div>
    </div>
    <div class="edenpro-section">
      <div class="edenpro-section-title">RECENT POSTS</div>
      ${postsHtml}
    </div>
    ${prospect?.interaction_log ? renderInteractionLog(prospect.interaction_log) : ''}
  `);

  attachSidebarListeners();
}

function renderSidebarMessaging(prospect, scrapeData) {
  const name = scrapeData.contact_name || prospect?.name || 'Unknown';
  const messages = scrapeData.messages || [];
  const lastMsg = scrapeData.last_message;

  let replyHtml = '';
  if (lastMsg?.direction === 'RECEIVED' && prospect) {
    const action = ActionEngine.getNextAction(prospect, {
      ...scrapeData, connection_status: 'CONNECTED', recent_posts: []
    });
    if (action.suggested_message) {
      replyHtml = `
        <div class="edenpro-section">
          <div class="edenpro-section-title">SUGGESTED REPLY</div>
          <div class="edenpro-message-box" id="suggested-reply">${action.suggested_message}</div>
          <button class="edenpro-copy-btn" data-copy-id="suggested-reply">Copy</button>
        </div>
      `;
    }
  }

  setContent(`
    <div class="edenpro-section">
      <div class="edenpro-name">💬 ${name}</div>
      <div class="edenpro-meta">${messages.length} messages in thread</div>
      ${lastMsg ? `
        <div class="edenpro-small">
          Last: <strong>${lastMsg.direction === 'SENT' ? 'You' : name}</strong> —
          "${(lastMsg.text || '').slice(0, 100)}..."
        </div>
      ` : ''}
    </div>
    ${replyHtml}
    ${prospect ? `<div class="edenpro-small">Stage: ${prospect.stage?.toUpperCase()}</div>` : ''}
  `);

  attachSidebarListeners();
}

function renderSidebarPostView(prospect, scrapeData) {
  const name = scrapeData.author_name || prospect?.name || 'Unknown';
  const liked = scrapeData.already_liked;
  const handle = prospect?.linkedin_handle || '';

  setContent(`
    <div class="edenpro-section">
      <div class="edenpro-name">📄 Post by ${name}</div>
      <div class="edenpro-meta">${liked ? '✅ Already liked' : '○ Not yet liked'}</div>
      <div class="edenpro-small">${(scrapeData.post_text || '').slice(0, 200)}...</div>
    </div>
    ${!liked ? `
      <div class="edenpro-action action-engage">
        <div class="edenpro-suggested-label">Suggested comment:</div>
        <div class="edenpro-message-box" id="post-comment">Congratulations — well earned! That kind of recognition doesn't happen without consistent work behind the scenes.</div>
        <button class="edenpro-copy-btn" data-copy-id="post-comment">Copy</button>
        <button class="edenpro-complete-btn" data-action="LIKE_AND_COMMENT" data-handle="${handle}">✓ Liked + Commented</button>
      </div>
    ` : '<div class="edenpro-action action-wait">✅ Already liked this post.</div>'}
  `);

  attachSidebarListeners();
}

function renderInteractionLog(log) {
  if (!log || !log.length) return '';
  const parsed = typeof log === 'string' ? JSON.parse(log) : log;
  const recent = parsed.slice(-3).reverse();
  return `
    <div class="edenpro-section">
      <div class="edenpro-section-title">HISTORY</div>
      ${recent.map(entry => `
        <div class="edenpro-history-item">
          <span class="history-action">${entry.action}</span>
          <span class="history-date">${formatDate(entry.completed_at)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ----------------------------------------------------------------
// ACTION COMPLETION
// ----------------------------------------------------------------
window.markActionComplete = async function(actionType, linkedin_handle) {
  if (!linkedin_handle) return;
  const prospect = await getProspect(linkedin_handle);
  if (!prospect) return;
  const updated = ActionEngine.recordCompletedAction(prospect, { type: actionType });
  await updateProspect(linkedin_handle, {
    stage: updated.stage,
    last_interaction_at: updated.last_interaction_at,
    last_interaction_date: updated.last_interaction_at,
    last_action_type: updated.last_action_type,
    next_action_date: updated.next_action_date,
    interaction_log: JSON.stringify(updated.interaction_log)
  });
  const scrapeData = await LinkedInContext.scrape();
  const freshProspect = await getProspect(linkedin_handle);
  const nextAction = ActionEngine.getNextAction(freshProspect, scrapeData);
  renderSidebarProfile(freshProspect, scrapeData, nextAction);
};

// ----------------------------------------------------------------
// STAGE OVERRIDE
// ----------------------------------------------------------------
async function overrideStage(linkedin_handle, newStage) {
  if (!linkedin_handle || !newStage) return;
  const now = new Date().toISOString();
  await updateProspect(linkedin_handle, {
    stage: newStage,
    last_interaction_at: now,
    last_interaction_date: now
  });
  const scrapeData = await LinkedInContext.scrape();
  const freshProspect = await getProspect(linkedin_handle);
  const nextAction = ActionEngine.getNextAction(freshProspect, scrapeData);
  renderSidebarProfile(freshProspect, scrapeData, nextAction);
}

// ----------------------------------------------------------------
// SKIP 30 DAYS (suppress without archiving)
// ----------------------------------------------------------------
async function skipProspect30Days(linkedin_handle) {
  if (!linkedin_handle) return;
  const resumeDate = new Date();
  resumeDate.setDate(resumeDate.getDate() + 30);
  await updateProspect(linkedin_handle, {
    suppressed: true,
    suppress_reason: 'Manual skip — 30 day cooldown',
    next_action_date: resumeDate.toISOString(),
    requeue_trigger: 'date_reached'
  });
  const scrapeData = await LinkedInContext.scrape();
  renderSidebarSuppressed(scrapeData, 'Manual skip — will re-appear after ' + resumeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '.');
}

// ----------------------------------------------------------------
// UTILITIES
// ----------------------------------------------------------------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
