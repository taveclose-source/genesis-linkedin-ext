-- ============================================================
-- Genesis Pipeline — LinkedIn Prospects Table
-- Run this in Supabase SQL Editor (oynuryauuglbxjunzcrj project)
-- ============================================================

-- Main prospects table
CREATE TABLE IF NOT EXISTS linkedin_prospects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Core profile data (scraped)
  linkedin_url TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  company TEXT,
  property_type TEXT DEFAULT 'Unknown',
  city TEXT,
  location_full TEXT,
  contact_type TEXT,
  about_snippet TEXT,
  experience_json JSONB DEFAULT '[]',
  profile_photo_url TEXT,
  
  -- Pipeline tracking
  source TEXT DEFAULT 'LinkedIn — Chrome Extension',
  opportunity_level TEXT DEFAULT 'New Lead',
  connection_sent BOOLEAN DEFAULT FALSE,
  date_connection_sent TIMESTAMPTZ,
  connection_accepted BOOLEAN DEFAULT FALSE,
  date_accepted TIMESTAMPTZ,
  followup_sent BOOLEAN DEFAULT FALSE,
  date_followup_sent TIMESTAMPTZ,
  engagement_level TEXT DEFAULT 'None',
  
  -- Generated messages
  connection_message TEXT,
  followup_message TEXT,
  
  -- Scoring
  influence_score INTEGER DEFAULT 0 CHECK (influence_score BETWEEN 0 AND 10),
  estimated_sites INTEGER DEFAULT 0,
  
  -- Notes & meta
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  
  -- Timestamps
  date_added TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_interaction_date TIMESTAMPTZ,
  next_action_date DATE,
  next_action TEXT,
  
  -- Outcome
  converted_to_client BOOLEAN DEFAULT FALSE,
  contract_value DECIMAL(10,2),
  date_converted TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_prospects_opportunity ON linkedin_prospects(opportunity_level);
CREATE INDEX IF NOT EXISTS idx_prospects_city ON linkedin_prospects(city);
CREATE INDEX IF NOT EXISTS idx_prospects_property_type ON linkedin_prospects(property_type);
CREATE INDEX IF NOT EXISTS idx_prospects_next_action ON linkedin_prospects(next_action_date) WHERE next_action_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_date_added ON linkedin_prospects(date_added DESC);

-- Enable RLS
ALTER TABLE linkedin_prospects ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations with anon key (since this is a private tool)
-- You can tighten this later with auth if needed
CREATE POLICY "Allow all for anon" ON linkedin_prospects
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_linkedin_prospects_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON linkedin_prospects
  FOR EACH ROW
  EXECUTE FUNCTION update_linkedin_prospects_timestamp();

-- ============================================================
-- Pipeline Activity Log (for tracking all interactions)
-- ============================================================

CREATE TABLE IF NOT EXISTS linkedin_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prospect_id UUID REFERENCES linkedin_prospects(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,  -- 'connection_sent', 'accepted', 'message_sent', 'engagement', 'status_change', 'note'
  description TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_prospect ON linkedin_activity_log(prospect_id);
CREATE INDEX IF NOT EXISTS idx_activity_date ON linkedin_activity_log(created_at DESC);

ALTER TABLE linkedin_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all activity for anon" ON linkedin_activity_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Useful Views
-- ============================================================

-- Pipeline summary by stage
CREATE OR REPLACE VIEW pipeline_summary AS
SELECT
  opportunity_level,
  COUNT(*) AS count,
  COUNT(*) FILTER (WHERE connection_accepted = true) AS connected,
  AVG(influence_score) FILTER (WHERE influence_score > 0) AS avg_influence,
  SUM(estimated_sites) AS total_estimated_sites
FROM linkedin_prospects
GROUP BY opportunity_level
ORDER BY 
  CASE opportunity_level
    WHEN 'Closed — Won' THEN 1
    WHEN 'Proposal Sent' THEN 2
    WHEN 'Active Discussion' THEN 3
    WHEN 'New Lead' THEN 4
    WHEN 'Closed — Lost' THEN 5
    ELSE 6
  END;

-- Overdue follow-ups
CREATE OR REPLACE VIEW overdue_actions AS
SELECT id, name, company, city, opportunity_level, next_action, next_action_date, linkedin_url
FROM linkedin_prospects
WHERE next_action_date < CURRENT_DATE
  AND opportunity_level NOT IN ('Closed — Won', 'Closed — Lost')
ORDER BY next_action_date ASC;

-- Weekly stats
CREATE OR REPLACE VIEW weekly_stats AS
SELECT
  DATE_TRUNC('week', date_added) AS week_start,
  COUNT(*) AS prospects_added,
  COUNT(*) FILTER (WHERE connection_sent = true) AS connections_sent,
  COUNT(*) FILTER (WHERE connection_accepted = true) AS accepted,
  COUNT(*) FILTER (WHERE opportunity_level = 'Active Discussion') AS active_discussions,
  COUNT(*) FILTER (WHERE converted_to_client = true) AS conversions
FROM linkedin_prospects
GROUP BY DATE_TRUNC('week', date_added)
ORDER BY week_start DESC;

-- ============================================================
-- Migrate existing spreadsheet data (7 records)
-- ============================================================

INSERT INTO linkedin_prospects (linkedin_url, name, title, company, property_type, city, source, connection_sent, date_connection_sent, connection_accepted, date_accepted, opportunity_level, date_added)
VALUES
  ('https://www.linkedin.com/in/kelly-wallis-b8a4321b', 'Kelly Wallis', 'Regional Property Manager', 'Madison Companies', 'Mixed', 'Tampa', 'LinkedIn', true, '2026-02-10', true, '2026-02-13', 'New Lead', '2026-02-10'),
  ('https://www.linkedin.com/in/r-scott-corbridge-mpm-83a02b21', 'R Scott Corbridge', 'Property Manager', 'Sarasota Management and Leasing', 'Mixed', 'Sarasota', 'LinkedIn', true, '2026-02-12', false, NULL, 'New Lead', '2026-02-12'),
  ('https://www.linkedin.com/in/mairead-smialek-clhms-gri-cws-41838280', 'Mairead Smialek', 'Property Manager', 'Sarasota Premier Property', 'Mixed', 'Sarasota', 'LinkedIn', true, '2026-02-17', false, NULL, 'New Lead', '2026-02-17'),
  ('https://www.linkedin.com/in/paul-rankin', 'Paul Rankin', 'Property Manager', 'Cushman & Wakefield', 'Commercial', 'Tampa', 'LinkedIn', true, '2026-02-17', false, NULL, 'New Lead', '2026-02-17'),
  ('https://www.linkedin.com/in/alexandra-bertrand-cam-231896173', 'Alexandra Bertrand', 'Multi-Site PM', 'WRH Realty', 'Mixed', 'Wesley Chapel', 'LinkedIn', true, '2026-02-17', true, '2026-02-18', 'Active Discussion', '2026-02-17'),
  ('https://www.linkedin.com/in/alison-blair-2b49b364', 'Alison Blair', 'Senior PM', 'Ian Black Real Estate', 'Commercial', 'Sarasota', 'LinkedIn', true, '2026-02-17', false, NULL, 'New Lead', '2026-02-17'),
  ('https://www.linkedin.com/in/gleinys-gores-62009878', 'Gleinys Gores', 'Senior PM', 'Asset Living', 'Multifamily', 'Ellenton', 'LinkedIn', true, '2026-02-17', false, NULL, 'New Lead', '2026-02-17')
ON CONFLICT (linkedin_url) DO NOTHING;
