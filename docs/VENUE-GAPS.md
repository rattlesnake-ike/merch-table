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
   to a sale. A venue/promoter/label all normally hold some.
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

NOT YET ANSWERED
Whether any of this is acceptable to a VENUE. Deep research into door
operations, guest lists and holds, settlement, the venue's cut, exclusive
contracts and compliance was commissioned 2026-09-26 and had not returned
when this was written. The gaps above are what the CODE lacks; they are not
the same as what a venue would require.
