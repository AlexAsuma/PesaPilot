import "dotenv/config";
import { normalizePhone } from "./payhero.js";

function getMsisdnString(rawPhone) {
  const res = normalizePhone(rawPhone);
  if (typeof res === "string") return res;
  if (res && typeof res === "object") {
    return String(res.phone || res.msisdn || res.normalized || res.number || "");
  }
  return String(rawPhone ?? "").replace(/\D/g, "");
}

export function buildWhatsAppShareUrl(order, paymentLink) {
  const normalized = getMsisdnString(order.phone); // e.g. "254759848126"
  const text = `Hi ${order.customerName || "Customer"}, complete your payment of KES ${order.amount} for ${order.itemDescription || "your order"} (Ref: ${order.externalReference}) using this link: ${paymentLink}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

export async function sendPaymentLinkSms(order, paymentLink) {
  const normalized = getMsisdnString(order.phone);
  const to = `+${normalized}`;
  const message = `PesaPilot: Pay KES ${order.amount} for ${order.itemDescription || "Order"} (${order.externalReference}) via ${paymentLink}`;

  const apiKey = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME;

  if (!apiKey || !username) {
    console.log(`[SMS Simulated -> ${to}] ${message}`);
    return {
      sent: false,
      simulated: true,
      to,
      note: "SMS simulated (set AT_API_KEY and AT_USERNAME in .env for live Africa's Talking SMS).",
    };
  }

  const endpoint =
    username === "sandbox"
      ? "https://api.sandbox.africastalking.com/version1/messaging"
      : "https://api.africastalking.com/version1/messaging";

  const body = new URLSearchParams({
    username,
    to,
    message,
    ...(process.env.AT_SENDER_ID ? { from: process.env.AT_SENDER_ID } : {}),
  });

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        apiKey,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    const recipient = data?.SMSMessageData?.Recipients?.[0];
    const ok = res.ok && recipient?.statusCode === 101;
    return {
      sent: ok,
      to,
      status: recipient?.status || `HTTP ${res.status}`,
      messageId: recipient?.messageId || "",
    };
  } catch (err) {
    return { sent: false, to, error: err.message };
  }
}