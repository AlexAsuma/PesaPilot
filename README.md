# PesaPilot — Autonomous Multi-Network Payment Agent

**PesaPilot** is an agentic payment orchestration platform built for Kenyan mobile money and multi-network checkouts. It turns natural-language payment commands into verified payment actions—combining pre-flight wallet checks, Safaricom M-Pesa STK Push initiation, Lipwa checkout links for Airtel Money / T-Kash / PesaLink, SMS/WhatsApp link handoff, order status verification, retries, and cancellations.

---

## Key Features

* **Natural-Language Payment Orchestration:** Accepts plain-language commands (such as initiating an STK Push, generating a multi-network payment link, checking wallet balance, verifying an order, retrying a failed prompt, or cancelling an unpaid order).
* **Multi-Network Routing:** Initiates M-Pesa STK Push prompts for Safaricom numbers and routes Airtel / multi-network requests to **PayHero Lipwa** checkout links instead of firing failed STK prompts.
* **SMS & WhatsApp Handoff:** Automatically dispatches payment links via **Africa's Talking SMS** (when configured, with a safe simulated fallback when offline or unconfigured) and generates pre-filled `https://wa.me/...` WhatsApp share links.
* **Operational Guardrails:** Enforces transaction amount caps (`MAX_AMOUNT_KES`), a 15-second cooldown between STK pushes to prevent duplicate prompts, and strict distinction between `QUEUED` prompts and verified `PAID` orders.
* **LLM Provider Failover:** Uses **Groq** as primary agent reasoning with automatic fallback to **Google Gemini** (`@google/genai`), preserving created order references if a provider fails mid-turn.
* **Modular Customer-Friendly Frontend:** Built with native browser ES modules (`<script type="module">`)—separating API calls, reactive state, UI rendering, and event orchestration—with live order/KPI polling, human-friendly error mapping, one-click retries, and a collapsible activity trace.

---

## Project Structure

```text
pesapilot/
├── agent.js              # Agentic tool runner, guardrails, Groq + Gemini orchestration
├── payhero.js            # PayHero wallet, STK Push, status check, Lipwa link & phone helpers
├── notify.js             # Africa's Talking SMS sender & WhatsApp share URL builder
├── store.js              # Order & receipt persistence helpers (db.json)
├── server.js             # Express server, API routes (/api/chat, /api/orders) & callbacks
├── db.json               # Local JSON store for orders and receipts
├── .env                  # Environment variables (not committed)
└── public/
    ├── index.html        # Dark-theme customer payment console layout & styles
    └── js/
        ├── api.js        # Backend HTTP client & friendly error formatter
        ├── state.js      # Reactive pub/sub state store & KPI calculator
        ├── components.js # Safe HTML escaping, order cards & activity trace templates
        └── main.js       # DOM bindings, command execution & live order sync
