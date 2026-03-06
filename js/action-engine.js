// ============================================================
// action-engine.js
// Given a prospect record + fresh scrape data, returns the
// recommended next action and suggested message copy.
// ============================================================

const ActionEngine = (() => {

  // -----------------------------------------------------------
  // STAGE DEFINITIONS
  // Maps to your 6-stage Supabase funnel
  // -----------------------------------------------------------
  const STAGES = {
    DISCOVERED:   'discovered',    // Scraped, not yet acted on
    LIKED:        'liked',         // Liked a post
    COMMENTED:    'commented',     // Commented on a post
    CONNECTED:    'connected',     // Connection accepted
    MESSAGED:     'messaged',      // First message sent
    NURTURING:    'nurturing',     // Active back-and-forth
    QUALIFIED:    'qualified',     // Expressed interest
    CLOSED:       'closed'         // Converted or archived
  };

  // Days to wait between touches at each stage
  const STAGE_CADENCE = {
    discovered:   0,    // Act immediately if trigger exists
    liked:        1,    // Wait 1 day after like before commenting
    commented:    2,    // Wait 2 days after comment before connecting
    connected:    3,    // Wait 3 days after connect before messaging
    messaged:     7,    // Wait 7 days if no reply before nudge
    nurturing:    0,    // Respond promptly
  };

  // -----------------------------------------------------------
  // DUPLICATE / SUPPRESS LOGIC
  // R. Scott Corbridge rule: pending + no posts = suppress
  // -----------------------------------------------------------
  function shouldSuppressProspect(prospect, scrapeData) {
    const status = scrapeData.connection_status || prospect.connection_status;
    const posts = scrapeData.recent_posts || [];
    const hasActionablePosts = posts.some(p => !p.already_liked && p.text);

    if (status === 'PENDING' && !hasActionablePosts) {
      return {
        suppress: true,
        reason: 'Pending connection with no recent posts — no action available.',
        requeue_trigger: 'New post detected OR profile update'
      };
    }

    return { suppress: false };
  }

  // -----------------------------------------------------------
  // NEXT ACTION RESOLVER
  // Core logic — returns what EdenPro should suggest
  // -----------------------------------------------------------
  function getNextAction(prospect, scrapeData) {

    const suppression = shouldSuppressProspect(prospect, scrapeData);
    if (suppression.suppress) return { type: 'SUPPRESS', ...suppression };

    const status = scrapeData.connection_status || prospect.connection_status;
    const stage  = prospect.stage || STAGES.DISCOVERED;
    const posts  = scrapeData.recent_posts || [];
    const lastInteractionDays = daysSince(
      prospect.last_interaction_at || prospect.last_interaction_date ||
      prospect.last_scraped_at || prospect.created_at
    );

    // --- CONNECTED: look for engagement opportunities first ---
    if (status === 'CONNECTED' || stage === STAGES.CONNECTED ||
        stage === STAGES.MESSAGED || stage === STAGES.NURTURING) {

      // Unliked achievement post = high-priority touch
      const achievementPost = posts.find(p => p.type === 'ACHIEVEMENT' && !p.already_liked);
      if (achievementPost) {
        return {
          type: 'LIKE_AND_COMMENT',
          priority: 'HIGH',
          post: achievementPost,
          suggested_comment: generateComment(achievementPost, prospect),
          reasoning: 'Achievement post — high engagement signal, personal touch lands well.'
        };
      }

      // Any unliked recent post
      const unlikedPost = posts.find(p => !p.already_liked && p.text);
      if (unlikedPost) {
        return {
          type: 'LIKE_POST',
          priority: 'MEDIUM',
          post: unlikedPost,
          reasoning: 'Stay visible without pressure. Like first, comment optional.'
        };
      }

      // No post activity — is it time to message?
      if (stage === STAGES.CONNECTED && lastInteractionDays >= STAGE_CADENCE.connected) {
        return {
          type: 'SEND_MESSAGE',
          priority: 'MEDIUM',
          suggested_message: generateFirstMessage(prospect, scrapeData),
          reasoning: `${lastInteractionDays} days since connecting — time to open the conversation.`
        };
      }

      // Messaged, no reply, wait time exceeded
      if (stage === STAGES.MESSAGED && lastInteractionDays >= STAGE_CADENCE.messaged) {
        return {
          type: 'FOLLOW_UP_MESSAGE',
          priority: 'LOW',
          suggested_message: generateFollowUp(prospect, scrapeData),
          reasoning: `No reply in ${lastInteractionDays} days — light value-add nudge.`
        };
      }

      return {
        type: 'WAIT',
        priority: 'NONE',
        reasoning: `In nurture. Last touch ${lastInteractionDays} days ago. No action needed yet.`
      };
    }

    // --- PENDING: only action is engaging with posts ---
    if (status === 'PENDING') {
      const unlikedPost = posts.find(p => !p.already_liked && p.text);
      if (unlikedPost) {
        return {
          type: 'LIKE_POST',
          priority: 'MEDIUM',
          post: unlikedPost,
          reasoning: 'Request pending — liking their post keeps you visible while they decide.'
        };
      }
      return {
        type: 'WAIT',
        priority: 'NONE',
        reasoning: 'Pending connection, no recent posts. Monitor for new activity.'
      };
    }

    // --- NOT CONNECTED: warm up first ---
    if (status === 'NOT_CONNECTED') {
      const achievementPost = posts.find(p => p.type === 'ACHIEVEMENT' && !p.already_liked);
      const anyPost = posts.find(p => !p.already_liked);

      if (achievementPost) {
        return {
          type: 'LIKE_AND_COMMENT',
          priority: 'HIGH',
          post: achievementPost,
          suggested_comment: generateComment(achievementPost, prospect),
          reasoning: 'Engage with their post before sending connection request — warmer intro.'
        };
      }
      if (anyPost) {
        return {
          type: 'LIKE_POST',
          priority: 'MEDIUM',
          post: anyPost,
          reasoning: 'Like first. Connect after 24–48 hrs for warmer acceptance rate.'
        };
      }
      return {
        type: 'CONNECT',
        priority: 'MEDIUM',
        connection_note: generateConnectionNote(prospect, scrapeData),
        reasoning: 'No posts to warm up with — send connection request with a personal note.'
      };
    }

    return { type: 'NO_ACTION', reasoning: 'Unable to determine status.' };
  }

  // -----------------------------------------------------------
  // MESSAGE GENERATORS
  // Positioned as EXPERT, not lead-fisher
  // -----------------------------------------------------------
  function generateFirstMessage(prospect, scrapeData) {
    const name = (prospect.name || '').split(' ')[0];
    const title = prospect.headline || '';
    const isPropertyManager = /property|HOA|manager|real estate|community|association/i.test(title);
    const isRealtor = /realtor|realty|broker|agent|coldwell|keller|century/i.test(title);

    if (isPropertyManager) {
      return `Hey ${name} — glad to be connected. I work with a lot of property managers in the Sarasota-Bradenton area on irrigation and water management. One thing that comes up constantly is controllers not talking to rain sensors properly after software updates. Happy to share what we've found if it's ever relevant to your portfolio.`;
    }

    if (isRealtor) {
      return `Hey ${name} — appreciate the connection. I manage irrigation systems for about 3,400 properties in the area, so I end up knowing a lot of what's wrong with a property's water systems before it hits inspection. If that's ever useful to you on a listing, happy to take a look.`;
    }

    return `Hey ${name} — good to be connected. I run Genesis Sprinklers & Water Management here in the Sarasota area. If you ever run into irrigation or water management questions on a property, feel free to reach out — happy to point you in the right direction.`;
  }

  function generateFollowUp(prospect, scrapeData) {
    const name = (prospect.name || '').split(' ')[0];
    return `Hey ${name} — just circling back. Came across something this week about [relevant topic] that made me think of you. No agenda — just thought it might be worth a look. Hope things are going well on your end.`;
  }

  function generateComment(post, prospect) {
    if (post.type === 'ACHIEVEMENT') {
      return `Congratulations — well earned! That kind of recognition doesn't happen without a lot of consistent work behind the scenes. Well done.`;
    }
    if (post.type === 'JOB_CHANGE') {
      return `Congratulations on the new role! Exciting next chapter — wishing you a strong start.`;
    }
    return `Great perspective — this is the kind of insight that gets overlooked but makes a real difference. Appreciate you sharing it.`;
  }

  function generateConnectionNote(prospect, scrapeData) {
    const name = (prospect.name || '').split(' ')[0];
    return `Hi ${name} — came across your profile and thought it would be worth connecting. I manage irrigation systems for a large portfolio of properties in the Sarasota-Bradenton area — figured our worlds probably overlap. Hope to connect.`;
  }

  // -----------------------------------------------------------
  // UTILITIES
  // -----------------------------------------------------------
  function daysSince(isoDateString) {
    if (!isoDateString) return 999;
    const then = new Date(isoDateString);
    const now  = new Date();
    return Math.floor((now - then) / (1000 * 60 * 60 * 24));
  }

  // -----------------------------------------------------------
  // POST-ACTION HANDLER
  // Call this when user marks a task complete
  // Returns the updated prospect object to save to Supabase
  // -----------------------------------------------------------
  function recordCompletedAction(prospect, action, result = {}) {
    const now = new Date().toISOString();

    const stageProgression = {
      LIKE_POST:          STAGES.LIKED,
      LIKE_AND_COMMENT:   STAGES.COMMENTED,
      CONNECT:            STAGES.DISCOVERED,  // still pending until accepted
      SEND_MESSAGE:       STAGES.MESSAGED,
      FOLLOW_UP_MESSAGE:  STAGES.MESSAGED,
    };

    const nextActionDelay = {
      LIKE_POST:          1,
      LIKE_AND_COMMENT:   2,
      CONNECT:            3,
      SEND_MESSAGE:       7,
      FOLLOW_UP_MESSAGE:  7,
    };

    const nextActionDate = new Date();
    nextActionDate.setDate(nextActionDate.getDate() + (nextActionDelay[action.type] || 3));

    return {
      ...prospect,
      stage: stageProgression[action.type] || prospect.stage,
      last_interaction_at: now,
      last_action_type: action.type,
      next_action_date: nextActionDate.toISOString(),
      interaction_log: [
        ...(prospect.interaction_log || []),
        {
          action: action.type,
          completed_at: now,
          post_url: action.post?.url || null,
          message_sent: result.message || null,
          notes: action.reasoning || null
        }
      ]
    };
  }

  return { getNextAction, shouldSuppressProspect, recordCompletedAction, STAGES };
})();

if (typeof module !== 'undefined') module.exports = ActionEngine;
