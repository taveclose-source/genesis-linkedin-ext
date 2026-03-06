// Tab switching
document.getElementById('tab-btn-dashboard').addEventListener('click', function() {
  document.getElementById('tab-btn-dashboard').classList.add('active');
  document.getElementById('tab-btn-settings').classList.remove('active');
  document.getElementById('tab-dashboard').classList.add('active');
  document.getElementById('tab-settings').classList.remove('active');
});

document.getElementById('tab-btn-settings').addEventListener('click', function() {
  document.getElementById('tab-btn-settings').classList.add('active');
  document.getElementById('tab-btn-dashboard').classList.remove('active');
  document.getElementById('tab-settings').classList.add('active');
  document.getElementById('tab-dashboard').classList.remove('active');
});

// Load saved config
chrome.runtime.sendMessage({ action: 'getConfig' }, function(config) {
  if (config && config.supabaseUrl) {
    document.getElementById('supabase-url').value = config.supabaseUrl;
    document.getElementById('supabase-key').value = config.supabaseAnonKey;
    loadDashboardStats(config);
  }
});

// Save settings
document.getElementById('btn-save').addEventListener('click', function() {
  var config = {
    supabaseUrl: document.getElementById('supabase-url').value.trim().replace(/\/$/, ''),
    supabaseAnonKey: document.getElementById('supabase-key').value.trim(),
  };
  chrome.runtime.sendMessage({ action: 'saveConfig', config: config }, function(resp) {
    var el = document.getElementById('settings-status');
    if (resp && resp.success) {
      el.textContent = 'Settings saved!';
      el.className = 'status-msg status-success';
      loadDashboardStats(config);
    } else {
      el.textContent = 'Failed to save';
      el.className = 'status-msg status-error';
    }
    setTimeout(function() { el.textContent = ''; }, 3000);
  });
});

// Test connection
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

// Load dashboard stats
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

      // This week
      var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      var thisWeek = all.filter(function(r) { return r.date_added > weekAgo; });
      document.getElementById('stat-week').textContent = thisWeek.length;

      // Connected
      var connected = all.filter(function(r) { return r.connection_sent === true; });
      document.getElementById('stat-connected').textContent = connected.length;

      // Active discussions
      var active = all.filter(function(r) { return r.opportunity_level === 'Active Discussion'; });
      document.getElementById('stat-active').textContent = active.length;

      // Recent list
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
