// Inbound keyword → Flow trigger.
//
// When someone texts the WABA number with one of the configured keywords,
// the webhook processor fires the matching Flow back as an interactive
// message. Same Flow we attach to CTWA ads — different entry point.
//
// This unlocks:
//   - Click-to-WhatsApp from anywhere (wa.me/?text=40s links from IG,
//     email signatures, the website, etc.)
//   - Instagram comment/DM autoreply → wa.me link → keyword match → Flow
//   - Coach manually telling a prospect "text 40s to +91 89765 63971"
//
// Config is in-code for now — small enough that a DB table would be
// over-engineering. Once we have many concurrent campaigns, promote to
// a Supabase table with status/scheduled-end columns (mirror the
// ig_keyword_flows shape in ochre-followup).

import { logger } from '../../logger.js';

const RULES = [
  {
    name: '40s-decade-jun11',
    // Keywords match against the FULL lowercased trimmed message text.
    // Multi-word keywords are matched as a substring (so "tell me about 40s"
    // matches "40s"). Anchor with word boundaries via the substring check
    // below so "abc40s" doesn't trigger.
    keywords: ['40s', '40s decade', 'decade', 'workshop', '40s workshop'],
    flow: {
      id: '2486049711910777',
      token: '40s-decade-jun11',
      cta: 'Save my spot',
      header: '40s: The Decade No One Prepared You For',
      body:
        "Hey 👋 thanks for reaching out!\n\n" +
        "Tap below to open the form — just a few quick questions and I'll send you the registration link.",
      footer: '11 June · 7 PM IST · ₹199',
    },
  },
];

/**
 * Returns the first matching rule for a text inbound, or null. Match is
 * a whole-word containment check on the lowercased text — "40s" matches
 * "tell me about 40s" but not "abc40sxyz".
 */
export function matchKeyword(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.toLowerCase().trim();
  if (!text) return null;
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      const k = kw.toLowerCase();
      // Whole-word match: the keyword must be flanked by non-alphanum
      // characters (or string boundaries). Lets "40s." or " 40s" match
      // but rejects "abc40s".
      const re = new RegExp(
        `(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`,
        'i',
      );
      if (re.test(text)) {
        logger.info({ keyword: k, rule: rule.name }, 'keyword matched');
        return rule;
      }
    }
  }
  return null;
}

/** For tests/inspection: list the live rules. */
export function listKeywordRules() {
  return RULES.map((r) => ({ name: r.name, keywords: r.keywords, flow_id: r.flow.id }));
}
