# Ticket resource grant contract

Issue #555 defines the private data contract for #326. `shared/ticketAccess`
validates it. #556 owns claim/refund recomputation; #557 owns enforcement,
operator migration and activation. Existing deployments continue the full-event
MVP described in ADR 0004 until those steps are delivered and approved.

Each policy has schemaVersion 1, a positive immutable revision, one provider and
eventId, lifetime `current-policy`, classes and explicit provider-class mappings.
An operator publication deliberately changes the current revision. #556 must
recompute the complete current valid claimed set before the new revision becomes
effective, retaining explicit admin revocation precedence and separate admin
approvals. Policy edits never rewrite purchased order descriptions or amounts.
The private derived result records the policy revision. No retry queue is added.
The validator checks data, not the publisher's identity or a storage transaction;
the publication boundary must enforce operator authority and revision comparison.

The provider/event scope comes from trusted server configuration and records.
Every class has a stable lowercase ID within that event. Stripe's source class
is its existing ticketTypeId. Eventbrite's source class is ticket_class_id;
manual/CSV imports have a separate ticketClassId column. The display ticketClass
remains a label. The [official Eventbrite reference](https://www.eventbrite.com/platform/new/api)
documents the class and event IDs separately from the class name.

A class's closed resources map contains:

| Field | Meaning |
| --- | --- |
| sessions.all | Full event-session membership; individual selectors must be empty |
| sessions.dayIds | Membership for sessions on these canonical event days |
| sessions.sessionIds | Additional canonical sessions, such as a workshop or awards session |
| directory | Contribution to existing attendee-only directory access |
| attendeeUpdates | Contribution to existing attendee-only updates access |
| interactions | Contribution to existing protected attendee interactions; existing feature and audience gates still apply |
| protectedMaterials | Fixed `existing-embargo`; tickets create no early-material privilege |

Day and session selectors combine as a union. Server validators receive canonical
day/session IDs loaded for this event, never browser-supplied membership. Request
checks in #557 resolve a session's current canonical day; callers cannot submit a
day to acquire access to another session. Policy size, class count, mapping count
and selector counts are bounded to keep the private contract finite.

Admin and staff/operator access continues through the existing current bootstrap
role checks. Speaker access continues through verified speaker ownership; the
material exception applies only to that speaker's sessions. A class cannot grant
a role, override a revoked registration, expand a feature audience, change public
visibility or override embargo review. Current approved material contents become
public after their session; public schedules, speakers, consented profiles,
aggregates and public calendar/PDF exports stay public.

Paid, free and sponsor classes use the same model. An operator-issued comp uses
its selected class; the operator's own privilege never transfers to its recipient.
An explicit admin approval is a separate source, preserved through ticket refunds.
Combined ownership will union contributions in #556. Pending, cancelled and
refunded tickets contribute nothing there; class resolution alone does not decide
ticket validity, claim ownership or registration approval.

Unknown, absent or malformed class/event identities have no contribution in
granular access. There is no label matching or unknown-to-full fallback. Before
#557 activation, an operator must inventory historical rows and backfill exact
event/class IDs from authoritative provider records or an approved import. A
mapping review must cover free, sponsor and comp classes too. Existing ticket
document/claim IDs and provider evidence remain intact. The current full-event
deployment policy stays deliberate until that inventory and enforcement are
verified; it is not inferred from missing fields.

Only operator-owned policy data may supply grants. Checkout continues to accept
ticket selections and assignments; submitted grant, role, material or price fields
are rejected. Imported IDs select a server-owned class definition and carry no
inline grants. Policy and derived grants stay private and never enter public
projections, generated site files, purchaser records or public exports.
