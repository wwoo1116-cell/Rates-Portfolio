# Product

## Register

product

## Users

Internal trading-desk users (traders and quants) at a Korean financial institution, pricing and revaluing KRW Interest Rate Swaps (IRS) intraday. The primary workflow is: register one or more swap positions (start/maturity/notional/fixed rate/direction), pick a market data source (fetched "True Data" snapshot or a hand-typed CCP discount curve), compute NPV/DV01/par-rate, then read the P&L breakdown across the book and its historical evolution. Speed-to-decision matters — this is consulted repeatedly through a trading session, not a one-time report.

## Product Purpose

A production-grade KRW IRS pricing and risk-management tool. It exists to give the desk a single place to price new trades, mark-to-market booked trades, and see portfolio-level NPV/DV01 without leaving the browser or waiting on a quant to run a script. Success looks like: a trader can enter a position and trust the number on screen within seconds, and a quant can audit any number back to its inputs (valuation date, curve snapshot, schedule).

## Brand Personality

정밀·신뢰·절제 (institutional precision, trustworthy, restrained). Voice is terse and numeric, not marketing copy — Korean field labels, English financial abbreviations (NPV, DV01, MTM) left as-is since that's the desk's actual vocabulary. Reference: Coinbase's product surfaces (not their marketing site) — flat surfaces, hairline borders, tabular numerals, a single confident accent color, no decoration for decoration's sake.

## Anti-references

- Generic "AI-generated SaaS dashboard" look: every section boxed in its own bordered/shadowed card regardless of relationship ("nested cards", nested boxes-in-boxes).
- Tiny uppercase tracked "eyebrow" label glued above every section as reflexive scaffolding rather than deliberate hierarchy.
- Gradient backgrounds or gradient text anywhere — this is a numbers tool, not a landing page.
- Heavy/glowing drop shadows on anything that isn't a genuine floating overlay (popover, tooltip).
- Equal-weight KPI tiles that hide the actual relationship between numbers (e.g. Net/Payer/Receiver NPV shown as three identical boxes instead of a headline + supporting detail).
- Playful color, illustration, or motion for its own sake — any color used must encode meaning (positive/negative P&L, selected state), never decoration.

## Design Principles

- **The number is the interface.** Every screen exists to get a trader to a trustworthy NPV/DV01/par-rate as fast as possible; layout and typography exist to serve legibility of that number, not to look designed.
- **Hierarchy over boxes.** Relationships between values (a total and its breakdown, a headline stat and its supporting detail) are shown through typographic weight, size, and whitespace — not by wrapping each in an identical bordered card.
- **Korean-first, numerals-first.** UI copy is Korean; all monetary and rate values are tabular numerals so columns of numbers align and scan at a glance.
- **Quiet by default, color with meaning.** The palette stays restrained (neutrals + one accent) so that when color does appear — positive/negative P&L, an active toggle — it's immediately legible as signal, not just brand decoration.
- **Every state is real.** Loading, error, and "not yet computed" states are designed with the same care as the happy path, since a trader acting on a stale or ambiguous number is a real financial risk, not just a UX rough edge.

## Accessibility & Inclusion

WCAG AA. Body text ≥ 4.5:1 contrast against its background (including muted-gray text on tinted surfaces — verify, don't assume). Numeric/status color coding (positive/negative NPV) must not be the only signal — pair with a leading `+`/sign and, where compact, an explicit label, not color alone. Respect `prefers-reduced-motion` for any future chart/transition work.
