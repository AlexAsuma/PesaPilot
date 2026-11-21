function formatFriendlyError(rawMessage, status = 0) {
  const msg = String(rawMessage || "");
  if (status === 403 || /403|inactive|forbidden/i.test(msg)) {
    return "Merchant account or payment channel is not active yet. Please verify your PayHero account status or use a payment link.";
  }
  if (/wait 15 seconds|rate limit/i.test(msg)) {
    return "Please wait 15 seconds before sending another M-Pesa prompt to avoid duplicate requests.";
  }
  if (/exceeds the limit/i.test(msg)) {
    return msg;
  }
  if (/invalid kenyan phone/i.test(msg)) {
    return "Please enter a valid Kenyan phone number (e.g., 0712345678 or 254712345678).";
  }
  if (status === 429 || status === 503 || /429|503|overloaded|high demand|all providers failed/i.test(msg)) {
    return "Our payment assistant is temporarily busy. Please wait a few seconds and click Retry.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Cannot reach the PesaPilot server. Check that your local server is running and try again.";
  }
  return msg || "Something went wrong while processing your payment. Please try again.";
}

async function request(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(formatFriendlyError(data.error || `HTTP ${res.status}`, res.status));
    }
    return data;
  } catch (err) {
    throw new Error(formatFriendlyError(err.message));
  }
}

export const PesaApi = {
  sendCommand: (message) =>
    request("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  fetchOrders: () => request("/api/orders"),
};