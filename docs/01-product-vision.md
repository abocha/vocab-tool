# ESL Vocab Tool — Product Vision

**Audience:** ESL teachers and independent learners.  
**MVP Goal:** A lightweight, browser-based practice tool that renders exercises from prebuilt CSV packs. No backend; low cost; fast iteration.

## Core Principles

- **Teacher-first:** quick review/edit/export loops; transparent data.
- **Deterministic by default:** corpus heuristics first; LLM enrichments optional.
- **Portable data:** CSV/JSON packs are the interface; keep formats stable.
- **Legal & ethical:** preserve attribution (CC BY-SA) and source provenance.

## Near-Term Capabilities

- Load CSV packs per level (A1–B2).
- Render four exercise types: Gap-fill, Matching, MCQ, Scramble.
- Track progress locally; export packs easily; simple licensing footer.

## Mid-Term Capabilities

- “Cards-first” authoring model; adapters: Corpus→Cards, WordList→Cards.
- Validators (watchdogs) to gate quality.
- Optional enrichments (definitions, distractors) via LLM with caching.
- Pack Inspector UI (teacher controls).

## Success Criteria

- A teacher can prepare a 20–50 item session in <10 minutes using existing packs.
- Learners complete a session smoothly on desktop/mobile with clear feedback.
- Data and formats remain stable as we add the cards layer on top.
