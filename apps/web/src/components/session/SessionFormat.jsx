// SessionFormat — what kind of session this is, beside its title.
//
// Was TypeBadge. The word changed because "type" is the stored field name
// and "format" is what a reader is being told: a keynote, a workshop, a
// panel. A row states its format; it does not wear a badge.
//
// The shape lives in editorial/Tag.jsx — one tag shape for the whole site,
// so the directory, the updates feed, and the schedule cannot drift apart.
// It is not a pill: the fully rounded shape is a rejected pattern (design
// brief §2.4), and the radius is `--radius-base`, which the concentric
// radius rule keeps in step with everything else the theme draws (interface
// guidelines, User interface). Keynote emphasis is a flat tint plus the word
// itself — never a colored edge, and never color alone (§8.1).
import Tag from '../editorial/Tag.jsx';

/**
 * @param {{ format?: unknown }} props the session's stored `type` value
 */
export default function SessionFormat({ format }) {
  if (typeof format !== 'string' || !format) return null;
  // Session formats are CMS vocabulary — presented, never interpreted,
  // except the platform-level keynote emphasis token from config/theme
  // (spec §7.2).
  return <Tag tone={format === 'keynote' ? 'keynote' : 'default'}>{format}</Tag>;
}
