const STATUS_LABELS = {
  QUEUED: "Prompt Sent",
  PAID: "Paid",
  AIRTEL_LIPWA_LINK_SENT: "Payment Link Ready",
  FALLBACK_LINK_SENT: "Backup Link Ready",
  FAILED_FALLBACK_READY: "Payment Not Completed",
  FAILED_TO_QUEUE: "Prompt Failed",
  CANCELLED: "Cancelled",
};

const FAILED_STATUSES = new Set(["FAILED_TO_QUEUE", "FAILED_FALLBACK_READY"]);

export function escapeHtml(value) {
  const el = document.createElement("span");
  el.textContent = String(value ?? "");
  return el.innerHTML;
}

function linkify(escapedText) {
  // Strip LLM angle brackets around URLs (&lt;https://...&gt;)
  const cleaned = escapedText
    .replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$2");

  return cleaned.replace(/(https?:\/\/[^\s<>"']+)/g, (url) => {
    const label = url.includes("wa.me/")
      ? "Send via WhatsApp &rarr;"
      : "Open Payment Page &rarr;";
    return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
  });
}

function buildFallbackWhatsAppUrl(order) {
  if (order.whatsappLink) return order.whatsappLink;
  if (!order.fallbackLink || !order.phone) return "";
  const digits = String(order.phone).replace(/\D/g, "");
  const normalized = digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
  const text = `Hi ${order.customerName || "Customer"}, complete your payment of KES ${order.amount} (Ref: ${order.externalReference}) here: ${order.fallbackLink}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

function friendlyFailureNote(reason, status) {
  const text = String(reason || "");
  if (/cancel/i.test(text) && status !== "CANCELLED") {
    return "The M-Pesa prompt was cancelled or timed out on the phone.";
  }
  if (/insufficient/i.test(text)) {
    return "Insufficient M-Pesa balance on the customer's phone.";
  }
  if (!text && status === "FAILED_TO_QUEUE") {
    return "Could not deliver the M-Pesa prompt. You can retry or use a payment link.";
  }
  return text;
}

export function createBubbleElement(text, kind) {
  const div = document.createElement("div");
  div.className = `bubble ${kind}`;
  div.innerHTML = linkify(escapeHtml(text));
  return div;
}

export function renderTraceList(trace) {
  if (!trace.length) {
    return '<div class="item">No background actions were needed for this message.</div>';
  }
  return trace
    .map(
      (t, i) => `
      <div class="item">
        <strong>Step ${i + 1}: ${escapeHtml(t.tool)}</strong>
        <pre>${escapeHtml(JSON.stringify(t.args))}\n${escapeHtml(JSON.stringify(t.output))}</pre>
      </div>`
    )
    .join("");
}

export function renderOrdersList(orders) {
  if (!orders.length) {
    return '<div class="item">No payments yet. Start a payment on the left to see it here.</div>';
  }
  return orders
    .map((o) => {
      const ref = escapeHtml(o.externalReference);
      const label = STATUS_LABELS[o.status] || o.status;
      const canCancel = o.status !== "PAID" && o.status !== "CANCELLED";
      const canRetry = FAILED_STATUSES.has(o.status);
      const note = friendlyFailureNote(o.failureReason, o.status);
      const waUrl = buildFallbackWhatsAppUrl(o);

      return `
        <div class="item ${escapeHtml(o.status)}">
          <div class="item-top">
            <strong>KES ${escapeHtml(o.amount)} &middot; ${escapeHtml(o.phone)}</strong>
            <span class="badge">${escapeHtml(label)}</span>
          </div>
          <div style="color: var(--sub); font-size: 12px;">
            Ref: ${ref}${o.receiptNumber ? ` &middot; Receipt: <strong>${escapeHtml(o.receiptNumber)}</strong>` : ""}${
              o.smsStatus ? ` &middot; SMS: <strong>${escapeHtml(o.smsStatus)}</strong>` : ""
            }
          </div>
          ${note ? `<div style="color: #fca5a5; font-size: 12px; margin-top: 3px;">${escapeHtml(note)}</div>` : ""}
          <div class="row-actions">
            ${
              canRetry
                ? `<button type="button" class="mini primary" data-cmd="Retry order ${ref}">Retry Payment</button>`
                : `<button type="button" class="mini" data-cmd="Check status of order ${ref}">Verify Payment</button>`
            }
            ${
              canCancel
                ? `<button type="button" class="mini" data-cmd="Generate backup link for order ${ref}">Get Link</button>
                   <button type="button" class="mini danger" data-cmd="Cancel order ${ref}">Cancel</button>`
                : ""
            }
            ${
              o.fallbackLink
                ? `<a href="${escapeHtml(o.fallbackLink)}" target="_blank" rel="noopener">Pay via Link &rarr;</a>`
                : ""
            }
            ${
              waUrl
                ? `<a href="${escapeHtml(waUrl)}" target="_blank" rel="noopener" style="color: #34d399;">Send via WhatsApp &rarr;</a>`
                : ""
            }
          </div>
        </div>`;
    })
    .join("");
}