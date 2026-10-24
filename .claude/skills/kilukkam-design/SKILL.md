---
name: kilukkam-design
description: The owner's design, copy and UX rules for Kilukkam's web client, as a checklist to apply while building and to review every screen against. Use whenever you add or change anything a player or conductor sees (screens, components, styles, copy, icons, motion, the pitch deck), and when reviewing UI screenshots.
---

# Kilukkam design rules

Kilukkam should feel like a game you pick up and play, not a course you read.
The first screen is the game. Phones first, then laptops and projectors.

## Hard rules (a violation blocks shipping)

1. **No em dashes**, anywhere: UI copy, docs, comments, commit messages. Use a
   colon, comma, semicolon or full stop. `npm run check:dashes` must pass.
2. **No visible borders or outlines.** Separation comes from surface colour,
   radius and soft shadow. Focus is `box-shadow: var(--ring)`, never a 1px line.
3. **Calls to action stay calm.** One solid accent pill per view for the main
   action, and the alternative as a text link. No full-width gradient buttons,
   no glow, no repeated CTAs: that reads like a download-bait page. The brand
   gradient is for small highlights only (hero word, wordmark, stat numbers).
4. **User text goes in through `textContent` or React children**, never
   `innerHTML` or `dangerouslySetInnerHTML`. Player names and codes are untrusted.
5. **Motion through GSAP** (`lib/anim`), short and soft, and it always honours
   `prefers-reduced-motion`.
6. **Tap targets are at least 64px**, safe areas are respected, nothing is
   hover-only, and the play surface prevents double-tap zoom.

## Look and feel

- Tokens only: `--bg --surface --sunk --text --muted --accent --accent-2
  --accent-3 --brand`, plus instrument hues `--violin --cello --flute --piano`.
  Light and dark both come from tokens; never hard-code a colour in a component.
- Type: Space Grotesk for display (tight tracking), Inter for body, Nupuram
  Calligraphy for the Malayalam wordmark കിലുക്കം. Give Malayalam enough line
  height and padding so its tall vowel signs are never clipped, especially
  under `background-clip: text`.
- Icons: Phosphor line icons (MIT, no duotone tint), vendored in `icons`; instrument glyphs are
  drawn on the same 256 grid. No emoji as UI icons.
- Avatars are the composer roster (real portraits in `public/composers`,
  credited in its CREDITS.md). Never generic emoji.
- Brand mark: the faceted handbell with ringing arcs on the sunset gradient
  (`public/icon.svg`). Footer credit: "Built by Dexters-Hub" with the GitHub
  link. No Buy Me a Coffee or Product Hunt badges.

## Copy

- Few words and big type. Explain by letting people play, not by paragraphs.
- Say "instrument", never "track". Say "conductor", "room", "code".
- Tagline, verbatim: "Kilukkam (കിലുക്കം) turns a room full of phones into an
  orchestra: one conductor, one entry code, and every tap plays the next note
  of any song, together."
- Never name the private inspiration projects in the repo or the UI.

## Real time

- The tap path never waits on React or the network: the gesture handler calls
  the audio engine directly, then sends `note_played` fire-and-forget.
- Live visuals (ripples, light show, room dots) run on refs and GSAP, not state.
- Re-render only when room state changes. Profile any screen that plays.

## Review checklist for a screenshot

- Does the main action read in one glance, and is there only one?
- Any border, outline, clipped Malayalam, emoji icon or em dash?
- Does it work at 390px wide in light and dark?
- Would a first-timer know what to tap in three seconds?
