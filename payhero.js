import "dotenv/config";

const BASE_URL = "https://backend.payhero.co.ke";
const token = (process.env.PAYHERO_BASIC_TOKEN || "").replace(/^Basic\s+/i, "").trim();
const headers = { Authorization: `Basic ${token}`, "Content-Type": "application/json" };

// One place that normalizes Kenyan phones. Returns { local: "07XXXXXXXX", intl: "2547XXXXXXXX" }
export function normalizePhone(input) {
  const digits = String(input).replace(/\D/g, "");
  let core = digits;
  if (digits.startsWith("254")) core = digits.slice(3);
  else if (digits.startsWith("0")) core = digits.slice(1);
  if (!/^[17]\d{8}$/.test(core)) throw new Error("Invalid Kenyan phone number");
  return { local: `0${core}`, intl: `254${core}` };
}

async function call(path, options) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  console.log(`[PayHero] ${options.method} ${path} ->`, res.status, JSON.stringify(data));
  return data;
}

export const checkWalletBalance = () =>
  call("/api/v2/wallets?wallet_type=service_wallet", { method: "GET" });

export function sendStkPush({ phone, amount, externalReference, customerName }) {
  return call("/api/v2/payments", {
    method: "POST",
    body: JSON.stringify({
      amount: Math.round(Number(amount)),
      phone_number: normalizePhone(phone).local,
      channel_id: Number(process.env.PAYHERO_CHANNEL_ID),
      provider: "m-pesa",
      external_reference: externalReference,
      customer_name: customerName || "Customer",
      callback_url: `${process.env.PUBLIC_BASE_URL}/api/payhero/callback`,
    }),
  });
}

export const checkPaymentStatus = (ref) =>
  call(`/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`, { method: "GET" });

export function createBackupLipwaLink(order) {
  const params = new URLSearchParams({
    amount: String(order.amount),
    phone: normalizePhone(order.phone).intl,
    name: order.customerName || "Customer",
    channel_id: String(process.env.PAYHERO_CHANNEL_ID),
    reference: order.externalReference,
    success_url: `${process.env.PUBLIC_BASE_URL}/?status=success`,
    failed_url: `${process.env.PUBLIC_BASE_URL}/?status=failed`,
  });
  return `${process.env.PAYHERO_LIPWA_BASE_URL}?${params}`;
}
