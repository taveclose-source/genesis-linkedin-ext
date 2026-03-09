// ============================================================
// Genesis Pipeline Popup — Dashboard, Search Params, Settings
// ============================================================

var DEFAULT_SEARCH_PARAMS = {
  keywords: ['property manager', 'HOA board member', 'facilities manager', 'community association manager'],
  geography: 'Sarasota, Bradenton, Lakewood Ranch, Venice, North Port',
  industries: ['Property Management', 'HOA/Condo', 'Commercial Real Estate', 'Facilities Management'],
  connectionDegree: '2nd',
  minResults: 10,
  maxResults: 25,
};

// --- Search params state ---
var searchKeywords = [];
var searchIndustries = [];

function getKeywords() { return searchKeywords; }
function setKeywords(arr) { searchKeywords = arr; console.log('[popup] setKeywords called, now:', JSON.stringify(searchKeywords)); }
function getIndustries() { return searchIndustries; }
function setIndustries(arr) { searchIndustries = arr; console.log('[popup] setIndustries called, now:', JSON.stringify(searchIndustries)); }

// --- Tab switching ---
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    // Re-render tags when Search tab activates (belt and suspenders)
    if (tab.dataset.tab === 'search') {
      renderKeywordTags();
      renderIndustryTags();
    }
  });
});

// --- Tag rendering ---
function renderKeywordTags() {
  var container = document.getElementById('search-keywords-tags');
  if (!container) return;
  container.innerHTML = searchKeywords.map(function(item, i) {
    return '<span class="tag">' + item + '<span class="remove" data-idx="' + i + '">&times;</span></span>';
  }).join('');
  container.querySelectorAll('.remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.dataset.idx);
      searchKeywords = searchKeywords.filter(function(_, j) { return j !== idx; });
      console.log('[popup] Keyword removed, searchKeywords now:', JSON.stringify(searchKeywords));
      renderKeywordTags();
    });
  });
}

function renderIndustryTags() {
  var container = document.getElementById('search-industries-tags');
  if (!container) return;
  container.innerHTML = searchIndustries.map(function(item, i) {
    return '<span class="tag">' + item + '<span class="remove" data-idx="' + i + '">&times;</span></span>';
  }).join('');
  container.querySelectorAll('.remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.dataset.idx);
      searchIndustries = searchIndustries.filter(function(_, j) { return j !== idx; });
      console.log('[popup] Industry removed, searchIndustries now:', JSON.stringify(searchIndustries));
      renderIndustryTags();
    });
  });
}

// --- Tag input: keywords ---
(function() {
  var input = document.getElementById('search-keyword-input');
  if (!input) return;
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      var val = input.value.trim().replace(/,+$/, '').trim();
      if (val && searchKeywords.indexOf(val) === -1) {
        searchKeywords.push(val);
        console.log('[popup] Keyword added via push:', val, '— searchKeywords now:', JSON.stringify(searchKeywords));
        renderKeywordTags();
      }
      input.value = '';
    }
  });
})();

// --- Tag input: industries ---
(function() {
  var input = document.getElementById('search-industry-input');
  if (!input) return;
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      var val = input.value.trim().replace(/,+$/, '').trim();
      if (val && searchIndustries.indexOf(val) === -1) {
        searchIndustries.push(val);
        console.log('[popup] Industry added via push:', val, '— searchIndustries now:', JSON.stringify(searchIndustries));
        renderIndustryTags();
      }
      input.value = '';
    }
  });
})();

// --- Helper: get Supabase config from chrome.storage ---
function getSupabaseConfig(callback) {
  chrome.storage.sync.get(['genesis_config'], function(result) {
    var config = result.genesis_config;
    if (config && config.supabaseUrl && config.supabaseAnonKey) {
      callback(config);
    } else {
      callback(null);
    }
  });
}

// --- Load search params from Supabase tenant_linkedin_config ---
function loadSearchParams() {
  console.log('[popup] loadSearchParams called');
  getSupabaseConfig(function(supa) {
    if (!supa) {
      console.log('[popup] No Supabase config — using defaults');
      applySearchParams(DEFAULT_SEARCH_PARAMS);
      return;
    }
    // Read discovery_searches from tenant_linkedin_config
    var url = supa.supabaseUrl + '/rest/v1/tenant_linkedin_config?active=eq.true&limit=1';
    fetch(url, {
      headers: {
        'apikey': supa.supabaseAnonKey,
        'Authorization': 'Bearer ' + supa.supabaseAnonKey,
      },
    })
    .then(function(resp) { return resp.json(); })
    .then(function(rows) {
      console.log('[popup] tenant_linkedin_config response:', JSON.stringify(rows, null, 2));
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log('[popup] No tenant config row — using defaults');
        applySearchParams(DEFAULT_SEARCH_PARAMS);
        return;
      }
      var row = rows[0];
      var searches = row.discovery_searches || [];
      // Transform discovery_searches array into flat format for UI
      var keywords = [];
      var locations = [];
      searches.forEach(function(s) {
        if (s.query && keywords.indexOf(s.query) === -1) {
          keywords.push(s.query);
        }
        (s.locations || []).forEach(function(loc) {
          if (locations.indexOf(loc) === -1) locations.push(loc);
        });
      });
      var params = {
        keywords: keywords.length > 0 ? keywords : DEFAULT_SEARCH_PARAMS.keywords,
        geography: locations.length > 0 ? locations.join(', ') : DEFAULT_SEARCH_PARAMS.geography,
        industries: DEFAULT_SEARCH_PARAMS.industries, // industries not in discovery_searches schema
        connectionDegree: row.connection_degree || DEFAULT_SEARCH_PARAMS.connectionDegree,
        minResults: row.min_results || DEFAULT_SEARCH_PARAMS.minResults,
        maxResults: row.daily_action_limit || DEFAULT_SEARCH_PARAMS.maxResults,
      };
      applySearchParams(params);
    })
    .catch(function(err) {
      console.error('[popup] Error loading from Supabase:', err);
      applySearchParams(DEFAULT_SEARCH_PARAMS);
    });
  });
}

// --- Apply search params to the UI ---
function applySearchParams(params) {
  console.log('[popup] applySearchParams:', JSON.stringify(params, null, 2));

  // Set arrays BEFORE rendering tags
  searchKeywords = (params.keywords && params.keywords.length > 0) ? params.keywords.slice() : DEFAULT_SEARCH_PARAMS.keywords.slice();
  searchIndustries = (params.industries && params.industries.length > 0) ? params.industries.slice() : DEFAULT_SEARCH_PARAMS.industries.slice();

  // Set form fields
  var geoEl = document.getElementById('search-geography');
  var degEl = document.getElementById('search-connection-degree');
  var minEl = document.getElementById('search-min-results');
  var maxEl = document.getElementById('search-max-results');

  if (geoEl) geoEl.value = (params.geography != null && params.geography !== '') ? params.geography : DEFAULT_SEARCH_PARAMS.geography;
  if (degEl) degEl.value = params.connectionDegree || DEFAULT_SEARCH_PARAMS.connectionDegree;
  if (minEl) minEl.value = (params.minResults != null) ? params.minResults : DEFAULT_SEARCH_PARAMS.minResults;
  if (maxEl) maxEl.value = (params.maxResults != null) ? params.maxResults : DEFAULT_SEARCH_PARAMS.maxResults;

  // Render tags (critical: must happen AFTER arrays are set)
  renderKeywordTags();
  renderIndustryTags();

  console.log('[popup] Tags rendered — keywords:', searchKeywords.length, 'industries:', searchIndustries.length);
}

// --- Save search params to Supabase tenant_linkedin_config ---
document.getElementById('btn-save-search').addEventListener('click', function() {
  var el = document.getElementById('search-status');
  console.log('[popup] SAVE clicked — searchKeywords at save time:', JSON.stringify(searchKeywords));
  console.log('[popup] SAVE clicked — searchIndustries at save time:', JSON.stringify(searchIndustries));
  var geoString = document.getElementById('search-geography').value.trim();
  console.log('[popup] SAVE clicked — geography value:', geoString);
  var locations = geoString.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });

  // Transform flat keywords + locations into discovery_searches array
  // Each keyword becomes a search entry with all locations
  var discoverySearches = searchKeywords.map(function(keyword) {
    return { query: keyword, locations: locations };
  });

  console.log('[popup] discovery_searches payload to PATCH:', JSON.stringify(discoverySearches, null, 2));

  getSupabaseConfig(function(supa) {
    if (!supa) {
      el.textContent = 'Configure Supabase in Settings first';
      el.className = 'status-msg status-error';
      setTimeout(function() { el.textContent = ''; }, 3000);
      return;
    }

    el.textContent = 'Saving to server...';
    el.className = 'status-msg';

    // PATCH the tenant_linkedin_config row with updated discovery_searches
    var url = supa.supabaseUrl + '/rest/v1/tenant_linkedin_config?active=eq.true';
    fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': supa.supabaseAnonKey,
        'Authorization': 'Bearer ' + supa.supabaseAnonKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ discovery_searches: discoverySearches }),
    })
    .then(function(resp) {
      console.log('[popup] PATCH response status:', resp.status, resp.statusText);
      return resp.text().then(function(body) {
        console.log('[popup] PATCH response body:', body);
        if (resp.ok) {
          el.textContent = 'Search parameters saved to server!';
          el.className = 'status-msg status-success';
        } else {
          throw new Error('HTTP ' + resp.status + ': ' + body);
        }
      });
    })
    .catch(function(err) {
      console.error('[popup] Save error:', err);
      el.textContent = 'Save failed: ' + err.message;
      el.className = 'status-msg status-error';
    })
    .finally(function() {
      setTimeout(function() { el.textContent = ''; }, 3000);
    });
  });
});

// --- Reset to defaults ---
document.getElementById('btn-reset-search').addEventListener('click', function() {
  applySearchParams(DEFAULT_SEARCH_PARAMS);
  var el = document.getElementById('search-status');
  el.textContent = 'Reset to defaults (not saved yet)';
  el.className = 'status-msg';
  setTimeout(function() { el.textContent = ''; }, 3000);
});

// --- Load saved Supabase config + dashboard (direct chrome.storage read) ---
chrome.storage.sync.get(['genesis_config'], function(result) {
  var config = result.genesis_config;
  if (config && config.supabaseUrl) {
    document.getElementById('supabase-url').value = config.supabaseUrl;
    document.getElementById('supabase-key').value = config.supabaseAnonKey;
    loadDashboardStats(config);
  }
});

// --- Save Supabase settings ---
document.getElementById('btn-save').addEventListener('click', function() {
  var config = {
    supabaseUrl: document.getElementById('supabase-url').value.trim().replace(/\/$/, ''),
    supabaseAnonKey: document.getElementById('supabase-key').value.trim(),
  };
  chrome.storage.sync.set({ genesis_config: config }, function() {
    var el = document.getElementById('settings-status');
    if (chrome.runtime.lastError) {
      el.textContent = 'Save failed: ' + chrome.runtime.lastError.message;
      el.className = 'status-msg status-error';
    } else {
      el.textContent = 'Settings saved!';
      el.className = 'status-msg status-success';
      loadDashboardStats(config);
    }
    setTimeout(function() { el.textContent = ''; }, 3000);
  });
});

// --- Test Supabase connection ---
document.getElementById('btn-test').addEventListener('click', function() {
  var config = {
    supabaseUrl: document.getElementById('supabase-url').value.trim().replace(/\/$/, ''),
    supabaseAnonKey: document.getElementById('supabase-key').value.trim(),
  };
  var el = document.getElementById('settings-status');
  el.textContent = 'Testing...';
  el.className = 'status-msg';

  chrome.runtime.sendMessage({ action: 'testConnection', config: config }, function(resp) {
    if (resp && resp.success) {
      el.textContent = 'Connected to Supabase!';
      el.className = 'status-msg status-success';
    } else {
      el.textContent = (resp && resp.error) || 'Connection failed';
      el.className = 'status-msg status-error';
    }
  });
});

// --- Load dashboard stats ---
function loadDashboardStats(config) {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return;
  var headers = {
    'apikey': config.supabaseAnonKey,
    'Authorization': 'Bearer ' + config.supabaseAnonKey,
  };
  var base = config.supabaseUrl + '/rest/v1/linkedin_prospects';

  fetch(base + '?select=id,name,company,opportunity_level,date_added,connection_sent', { headers: headers })
    .then(function(resp) { return resp.json(); })
    .then(function(all) {
      if (!Array.isArray(all)) return;

      document.getElementById('stat-total').textContent = all.length;

      var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      var thisWeek = all.filter(function(r) { return r.date_added > weekAgo; });
      document.getElementById('stat-week').textContent = thisWeek.length;

      var connected = all.filter(function(r) { return r.connection_sent === true; });
      document.getElementById('stat-connected').textContent = connected.length;

      var active = all.filter(function(r) { return r.opportunity_level === 'Active Discussion'; });
      document.getElementById('stat-active').textContent = active.length;

      var recent = all.sort(function(a, b) {
        return (b.date_added || '').localeCompare(a.date_added || '');
      }).slice(0, 5);

      var listEl = document.getElementById('recent-list');
      if (recent.length === 0) {
        listEl.innerHTML = '<div style="color:#888;font-size:12px;text-align:center;padding:20px 0;">No prospects yet. Visit a LinkedIn profile to start.</div>';
      } else {
        listEl.innerHTML = recent.map(function(r) {
          return '<div class="recent-item">' +
            '<div class="recent-avatar">' + ((r.name || '?')[0].toUpperCase()) + '</div>' +
            '<div>' +
            '<div class="recent-name">' + (r.name || 'Unknown') + '</div>' +
            '<div class="recent-co">' + (r.company || '\u2014') + '</div>' +
            '</div></div>';
        }).join('');
      }
    })
    .catch(function(err) {
      console.error('Dashboard load error:', err);
    });
}

// --- Init ---
loadSearchParams();
