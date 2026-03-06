// ============================================================
// EdenPro™ LinkedIn Prospector — Background Service Worker v2.0
// Handles Supabase writes, config, message storage
// ============================================================

var DEFAULT_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };

function getConfig() {
  return new Promise(function(resolve) {
    chrome.storage.sync.get(['genesis_config'], function(result) {
      resolve(result.genesis_config || DEFAULT_CONFIG);
    });
  });
}

function getTenantConfig() {
  return new Promise(function(resolve) {
    chrome.storage.sync.get(['tenant_config'], function(result) {
      resolve(result.tenant_config || null);
    });
  });
}

function supaFetch(config, path, opts) {
  var headers = {
    'apikey': config.supabaseAnonKey,
    'Authorization': 'Bearer ' + config.supabaseAnonKey,
    'Content-Type': 'application/json'
  };
  if (opts && opts.prefer) headers['Prefer'] = opts.prefer;
  return fetch(config.supabaseUrl + path, {
    method: (opts && opts.method) || 'GET',
    headers: headers,
    body: (opts && opts.body) ? JSON.stringify(opts.body) : undefined
  });
}

// --- Save prospect to pipeline (upsert) ---
async function saveToPipeline(record) {
  var config = await getConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey)
    return { success: false, error: 'Supabase not configured.' };

  try {
    var checkResp = await supaFetch(config,
      '/rest/v1/linkedin_prospects?linkedin_url=eq.' + encodeURIComponent(record.linkedin_url) + '&select=id',
    );
    var existing = await checkResp.json();

    var resp;
    if (existing && existing.length > 0) {
      record.updated_at = new Date().toISOString();
      resp = await supaFetch(config,
        '/rest/v1/linkedin_prospects?id=eq.' + existing[0].id,
        { method: 'PATCH', body: record, prefer: 'return=minimal' }
      );
    } else {
      resp = await supaFetch(config,
        '/rest/v1/linkedin_prospects',
        { method: 'POST', body: record, prefer: 'return=minimal' }
      );
    }

    if (resp.ok || resp.status === 201) return { success: true, updated: existing && existing.length > 0 };
    var errText = await resp.text();
    return { success: false, error: 'Supabase: ' + resp.status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// --- Save messages from a conversation thread ---
async function saveMessages(prospectName, messages) {
  var config = await getConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey)
    return { success: false, error: 'Supabase not configured.' };

  try {
    // Find prospect by name
    var findResp = await supaFetch(config,
      '/rest/v1/linkedin_prospects?name=ilike.*' + encodeURIComponent(prospectName.split(' ')[0]) + '*&select=id,name'
    );
    var prospects = await findResp.json();

    if (!prospects || prospects.length === 0) {
      // Try more specific match
      findResp = await supaFetch(config,
        '/rest/v1/linkedin_prospects?name=eq.' + encodeURIComponent(prospectName) + '&select=id,name'
      );
      prospects = await findResp.json();
    }

    if (!prospects || prospects.length === 0)
      return { success: false, error: 'Prospect "' + prospectName + '" not found in pipeline. Save their profile first.' };

    var prospectId = prospects[0].id;
    var saved = 0;

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];

      // Check for duplicate via hash
      var hashCheck = await supaFetch(config,
        '/rest/v1/prospect_messages?prospect_id=eq.' + prospectId + '&message_hash=eq.' + encodeURIComponent(msg.message_hash) + '&select=id'
      );
      var hashResult = await hashCheck.json();
      if (hashResult && hashResult.length > 0) continue; // skip duplicate

      var insertResp = await supaFetch(config,
        '/rest/v1/prospect_messages',
        {
          method: 'POST',
          body: {
            prospect_id: prospectId,
            sender: msg.sender,
            message_text: msg.message_text,
            message_hash: msg.message_hash,
            scraped_at: new Date().toISOString()
          },
          prefer: 'return=minimal'
        }
      );

      if (insertResp.ok || insertResp.status === 201) saved++;
    }

    // Update prospect's message stats
    if (saved > 0) {
      await supaFetch(config,
        '/rest/v1/linkedin_prospects?id=eq.' + prospectId,
        {
          method: 'PATCH',
          body: {
            last_message_at: new Date().toISOString(),
            messages_exchanged: messages.length,
            stale_flag: false
          },
          prefer: 'return=minimal'
        }
      );
    }

    return { success: true, saved: saved, prospect_id: prospectId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// --- Test connection ---
async function testSupabaseConnection(config) {
  try {
    var resp = await fetch(
      config.supabaseUrl + '/rest/v1/linkedin_prospects?select=count&limit=0',
      { headers: { 'apikey': config.supabaseAnonKey, 'Authorization': 'Bearer ' + config.supabaseAnonKey } }
    );
    if (resp.ok) return { success: true };
    return { success: false, error: 'HTTP ' + resp.status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// --- Message Router ---
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'savePipelineRecord') {
    saveToPipeline(message.record).then(sendResponse);
    return true;
  }
  if (message.action === 'saveMessages') {
    saveMessages(message.prospectName, message.messages).then(sendResponse);
    return true;
  }
  if (message.action === 'getConfig') {
    getConfig().then(sendResponse);
    return true;
  }
  if (message.action === 'saveConfig') {
    chrome.storage.sync.set({ genesis_config: message.config }, function() {
      sendResponse({ success: true });
    });
    return true;
  }
  if (message.action === 'testConnection') {
    testSupabaseConnection(message.config).then(sendResponse);
    return true;
  }
  if (message.action === 'getTenantConfig') {
    getTenantConfig().then(sendResponse);
    return true;
  }
  if (message.action === 'saveTenantConfig') {
    chrome.storage.sync.set({ tenant_config: message.config }, function() {
      sendResponse({ success: true });
    });
    return true;
  }
});
