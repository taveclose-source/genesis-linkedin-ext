// ============================================================
// linkedin-context.js
// Detects current LinkedIn page type and scrapes relevant data
// Drop this into your extension's js/ folder and import in content.js
// ============================================================

const LinkedInContext = (() => {

  // -----------------------------------------------------------
  // PAGE TYPE DETECTION
  // -----------------------------------------------------------
  const PAGE_TYPES = {
    PROFILE:   /linkedin\.com\/in\/([^/?#]+)/,
    MESSAGING: /linkedin\.com\/messaging\/(thread\/([^/?#]+))?/,
    POST:      /linkedin\.com\/posts\/([^/?#]+)/,
    FEED:      /linkedin\.com\/feed\//,
    SEARCH:    /linkedin\.com\/search\//,
    COMPANY:   /linkedin\.com\/company\/([^/?#]+)/,
    OTHER:     /.*/
  };

  function getPageType(url = window.location.href) {
    for (const [type, pattern] of Object.entries(PAGE_TYPES)) {
      const match = url.match(pattern);
      if (match) return { type, match };
    }
    return { type: 'OTHER', match: null };
  }

  // -----------------------------------------------------------
  // HELPER: wait for an element to appear in the DOM
  // -----------------------------------------------------------
  function waitForElement(selector, timeout = 3000) {
    return new Promise(resolve => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  // -----------------------------------------------------------
  // PROFILE PAGE SCRAPER
  // -----------------------------------------------------------
  async function scrapeProfile() {
    const data = {};

    // Name — wait for the profile h1 to render (LinkedIn lazy-loads it)
    const NAME_SELECTORS = [
      'h1.text-heading-xlarge',
      'h1.inline.t-24.v-align-middle.break-words',
      '.pv-top-card h1',
      'section.artdeco-card h1'
    ];
    let nameEl = null;
    for (const sel of NAME_SELECTORS) {
      nameEl = document.querySelector(sel);
      if (nameEl?.innerText?.trim()) break;
    }
    if (!nameEl?.innerText?.trim()) {
      nameEl = await waitForElement(NAME_SELECTORS[0], 3000);
    }
    data.name = nameEl?.innerText?.trim() || null;

    // Headline
    const headlineEl = document.querySelector('.text-body-medium.break-words, [class*="headline"]');
    data.headline = headlineEl?.innerText?.trim() || null;

    // Location
    const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words');
    data.location = locationEl?.innerText?.trim() || null;

    // LinkedIn URL / handle
    const urlMatch = window.location.href.match(/linkedin\.com\/in\/([^/?#]+)/);
    data.linkedin_handle = urlMatch ? urlMatch[1] : null;
    data.linkedin_url = `https://www.linkedin.com/in/${data.linkedin_handle}`;

    // Connection degree
    const degreeEl = document.querySelector('[class*="dist-value"]');
    data.connection_degree = degreeEl?.innerText?.trim() || null;

    // Mutual connections
    const mutualEl = document.querySelector('[class*="member-insights"] span, a[href*="facetConnectionOf"]');
    data.mutual_connections = mutualEl?.innerText?.trim() || null;

    // Connect / Message / Pending button state
    data.connection_status = detectConnectionStatus();

    // Recent posts
    data.recent_posts = scrapeRecentPosts();

    // Current employer from experience section
    const experienceEl = document.querySelector('#experience ~ .pvs-list__container li:first-child .t-bold span[aria-hidden="true"]');
    data.current_employer = experienceEl?.innerText?.trim() || null;

    data.scraped_at = new Date().toISOString();
    data.page_type = 'PROFILE';

    return data;
  }

  // -----------------------------------------------------------
  // CONNECTION STATUS DETECTION
  // -----------------------------------------------------------
  function detectConnectionStatus() {
    // Check for "Message" button = already connected
    const msgBtn = document.querySelector('a[href*="/messaging/"], button[aria-label*="Message"]');
    if (msgBtn) return 'CONNECTED';

    // Check for "Pending" = request sent
    const pendingBtn = document.querySelector('button[aria-label*="Pending"], button span');
    if (pendingBtn) {
      const allButtons = [...document.querySelectorAll('button span')];
      if (allButtons.some(b => b.innerText?.trim() === 'Pending')) return 'PENDING';
    }

    // Check for "Connect" = not connected
    const connectBtn = document.querySelector('button[aria-label*="Connect"]');
    if (connectBtn) return 'NOT_CONNECTED';

    // Check for "Follow" only = out of network or company page
    const followBtn = document.querySelector('button[aria-label*="Follow"]');
    if (followBtn) return 'FOLLOW_ONLY';

    return 'UNKNOWN';
  }

  // -----------------------------------------------------------
  // RECENT POSTS SCRAPER (from profile page)
  // -----------------------------------------------------------
  function scrapeRecentPosts() {
    const posts = [];
    // Posts appear in the activity section
    const postEls = document.querySelectorAll('[data-urn*="activity"], .feed-shared-update-v2, [class*="occludable-update"]');

    postEls.forEach((el, i) => {
      if (i >= 5) return; // limit to 5 most recent

      const post = {};

      // Post text
      const textEl = el.querySelector('[class*="feed-shared-text"], .break-words span[aria-hidden="true"]');
      post.text = textEl?.innerText?.trim()?.slice(0, 500) || null;

      // Post date (LinkedIn uses relative time like "2d", "1w")
      const timeEl = el.querySelector('time, [class*="time-ago"], span[class*="visually-hidden"]');
      post.relative_time = timeEl?.innerText?.trim() || null;

      // Post URL
      const linkEl = el.querySelector('a[href*="/posts/"], a[href*="activity"]');
      post.url = linkEl?.href || null;

      // Post type (article, image, text, award/celebration)
      post.type = detectPostType(el);

      // Has Claude already liked this?
      post.already_liked = detectIfLiked(el);

      // Engagement counts
      const reactionEl = el.querySelector('[class*="social-details-social-counts"] span');
      post.reaction_count = reactionEl?.innerText?.trim() || null;

      if (post.text || post.url) posts.push(post);
    });

    return posts;
  }

  function detectPostType(el) {
    const text = el.innerText?.toLowerCase() || '';
    if (text.includes('award') || text.includes('honored') || text.includes('excited to share') || text.includes('proud')) return 'ACHIEVEMENT';
    if (el.querySelector('img[class*="ivm-view-attr"]')) return 'IMAGE';
    if (el.querySelector('[class*="article"]')) return 'ARTICLE';
    if (text.includes('new position') || text.includes('started a new') || text.includes('job')) return 'JOB_CHANGE';
    return 'TEXT';
  }

  function detectIfLiked(el) {
    // LinkedIn marks active reactions with aria-pressed="true" or specific classes
    const reactionBtn = el.querySelector('button[aria-label*="React Like"], button[aria-label*="Like"]');
    if (!reactionBtn) return false;
    return reactionBtn.getAttribute('aria-pressed') === 'true' ||
           reactionBtn.classList.contains('active') ||
           reactionBtn.querySelector('[class*="--active"]') !== null;
  }

  // -----------------------------------------------------------
  // MESSAGING PAGE SCRAPER
  // -----------------------------------------------------------
  function scrapeMessagingThread() {
    const data = { page_type: 'MESSAGING' };

    // Who is this conversation with?
    const nameEl = document.querySelector('.msg-conversation-listitem__participant-names, h2[class*="conversation-header"]');
    data.contact_name = nameEl?.innerText?.trim() || null;

    // Their profile link from the thread header
    const profileLink = document.querySelector('a[href*="/in/"]');
    const handleMatch = profileLink?.href?.match(/\/in\/([^/?#]+)/);
    data.linkedin_handle = handleMatch ? handleMatch[1] : null;

    // Messages in thread
    const messages = [];
    const msgEls = document.querySelectorAll('.msg-s-message-list__event, [class*="message-container"]');

    msgEls.forEach(el => {
      const msg = {};
      const textEl = el.querySelector('.msg-s-event-listitem__body, [class*="message-text"]');
      msg.text = textEl?.innerText?.trim() || null;

      const timeEl = el.querySelector('time, [class*="message-timestamp"]');
      msg.time = timeEl?.getAttribute('datetime') || timeEl?.innerText?.trim() || null;

      // Is this sent by us or by them?
      msg.direction = el.classList.contains('msg-s-message-list__event--other') ||
                      el.querySelector('[class*="--other"]') ? 'RECEIVED' : 'SENT';

      if (msg.text) messages.push(msg);
    });

    data.messages = messages;
    data.message_count = messages.length;
    data.last_message = messages[messages.length - 1] || null;
    data.last_sender = data.last_message?.direction || null;
    data.scraped_at = new Date().toISOString();

    return data;
  }

  // -----------------------------------------------------------
  // POST PAGE SCRAPER (when user clicks into a specific post)
  // -----------------------------------------------------------
  function scrapePostPage() {
    const data = { page_type: 'POST' };

    // Post author
    const authorEl = document.querySelector('[class*="update-components-actor__name"] span[aria-hidden="true"]');
    data.author_name = authorEl?.innerText?.trim() || null;

    // Author profile link
    const authorLink = document.querySelector('[class*="update-components-actor__meta-link"]');
    const handleMatch = authorLink?.href?.match(/\/in\/([^/?#]+)/);
    data.linkedin_handle = handleMatch ? handleMatch[1] : null;

    // Post content
    const textEl = document.querySelector('[class*="feed-shared-text"] span[aria-hidden="true"]');
    data.post_text = textEl?.innerText?.trim()?.slice(0, 1000) || null;

    // Like state
    const likeBtn = document.querySelector('button[aria-label*="React Like"], button[aria-label*="Like"]');
    data.already_liked = likeBtn
      ? (likeBtn.getAttribute('aria-pressed') === 'true')
      : false;

    data.post_url = window.location.href;
    data.scraped_at = new Date().toISOString();

    return data;
  }

  // -----------------------------------------------------------
  // MAIN SCRAPE DISPATCHER
  // Called by content.js on every page load / navigation
  // -----------------------------------------------------------
  async function scrape() {
    const { type } = getPageType();
    switch (type) {
      case 'PROFILE':   return await scrapeProfile();
      case 'MESSAGING': return scrapeMessagingThread();
      case 'POST':      return scrapePostPage();
      default:          return { page_type: type, scraped_at: new Date().toISOString() };
    }
  }

  // -----------------------------------------------------------
  // OBSERVE DOM CHANGES (LinkedIn is a SPA — URL changes without reload)
  // -----------------------------------------------------------
  function watchNavigation(callback) {
    let lastUrl = window.location.href;

    // MutationObserver catches SPA navigations that don't trigger popstate
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        setTimeout(async () => callback(await scrape()), 1200); // wait for DOM to settle
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Also catch browser back/forward
    window.addEventListener('popstate', () => {
      setTimeout(async () => callback(await scrape()), 1200);
    });
  }

  return { scrape, getPageType, watchNavigation };
})();

// Export for use in content.js
if (typeof module !== 'undefined') module.exports = LinkedInContext;
