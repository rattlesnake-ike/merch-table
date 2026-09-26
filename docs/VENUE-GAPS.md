MEASURED GAPS between what the template does and what a room needs
(measured 2026-09-26 against the code, not assumed)

FIXED 2026-09-26
- Door scan cost: was up to 1000 sequential KV reads + an HMAC per ticket per
  scan (~4-9s at a 600-cap show). Now one read. A test counts the reads and
  fails if it is ever more than one.
- Headcount: the door now shows "63 in the room of 120" per show, counted from
  the check-ins so it cannot drift. Gap 3 below is closed.

STILL OPEN — measured against the code, not yet built
1. The door needs a live connection. There is no service worker and no cached
   manifest, so with no signal at the door nobody gets checked in at all. The
   FAN's ticket survives offline (they save the page); the DOOR does not.
   A basement room is exactly where this fails.
2. No guest list, comps or holds. Nothing in products.json or the admin
   expresses "20 on the list", who owns those spots, or a hold that converts
   to a sale. A venue/promoter/label all normally hold some. This is now the
   biggest remaining gap: comps reduce sellable capacity AND count against a
   door-deal draw, so they are a money question, not only a list question.
4. No settlement report. No manifest, no scanned-vs-sold, no split of the door
   by deal terms. The band sees orders; the venue sees nothing.
5. Codes are typed, not scanned. No QR/barcode on the ticket page and no
   camera scan at the door. Throughput at doors-open is a typed 8-character
   code per person.
6. No re-entry, no ID/age marking. admit() is one-way (plus an undo); nothing
   models stepping outside, or 21+ wristbands at an all-ages show.
7. Capacity is per-product, not per-show. Two ticket types for the same night
   (advance/door, GA/balcony) each carry their own capacity with nothing
   summing them against the room's legal limit.

WHAT THE RESEARCH SAID (2026-09-26)
The venue's objection is not primarily money. A ticket is three things at
once: a financial instrument, a legal headcount, and a settlement
denominator. The box office must close

    unsold + comps + sold = the room

and a ticket sold outside that count is a body with no row in it. Verified
consequences: a fire marshal can demand the live headcount and liability
policies commonly exclude a night over capacity; settlement starts from the
DROP count (who walked in), not the number sold.

The demonstrated failure mode is not hypothetical. Four businesses sold
tickets to one Fort Worth show with no shared count; ~2,000 turned up to a
1,670-cap room, the fire marshal shut it down, and people who had paid in
advance never got in. (CBS News, verified directly.)

On contracts: a standard AXS agreement requires the client to place THE
ENTIRE MANIFEST on the platform and forbids any third-party system for the
sale or issuance of tickets. Its carve-outs are the venue's own box office
and comps, and they lapse the moment a ticket is sold for value. There is
no artist carve-out. (Read the filed contract directly, not a summary.)
BUT: no exclusive contract was found for any room at 50-600 cap. That
section describes large venues and should not be extended downward.

THEREFORE the design changed 2026-09-26. The band does not sell "the room".
It sells an ALLOCATION the venue has already subtracted from its own
manifest — the mechanism an artist presale allocation has always used, and
the one path that violates none of the venue's constraints. `show.allocation`
replaced `show.capacity` (which still reads, for older stores), and the
setup check now asks the band what the ROOM holds and how their names reach
the venue's door list.

STILL NOT ANSWERED
No venue operator, in their own words, on artist-sold tickets. The research
could not reach practitioner forums at all (Reddit returned 403 throughout).
The objections above are inference from verified contract, fire-code and
settlement mechanics — strong inference, but not testimony. Isaac knows
people who run rooms; one real conversation would be worth more than
another day of search.
