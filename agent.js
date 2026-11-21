import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import {
  checkWalletBalance,
  sendStkPush,
  checkPaymentStatus,
  createBackupLipwaLink,
  normalizePhone,
} from "./payhero.js";
import { saveOrder, getOrder, getAllOrders } from "./store.js";
import { sendPaymentLinkSms, buildWhatsAppShareUrl } from "./notify.js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MAX = Number(process.env.MAX_AMOUNT_KES || 100);
let lastPushAt = 0;

const noArgs = { type: "object", properties: {} };
const refArg = {
  type: "object",
  properties: {
    externalReference: { type: "string", description: "Order ID like ORD-123456" },
  },
  required: ["externalReference"],
};
const paymentArgs = {
  type: "object",
  properties: {
    phone: { type: "string", description: "Kenyan phone, e.g. 0712345678 or 0733123456" },
    amount: { type: "number", description: "Whole KES amount" },
    customerName: { type: "string" },
    itemDescription: { type: "string" },
  },
  required: ["phone", "amount"],
};

const toolDeclarations = [
  {
    name: "check_wallet_balance",
    description: "Checks the PayHero service wallet balance.",
    parametersJsonSchema: noArgs,
  },
  {
    name: "initiate_mpesa_payment",
    description: "Creates an order and sends a Safaricom M-Pesa STK Push prompt to the customer's phone.",
    parametersJsonSchema: paymentArgs,
  },
  {
    name: "create_multi_network_link",
    description: "Creates an order, generates a Lipwa checkout link for Airtel/T-Kash/PesaLink, sends an SMS to the customer, and prepares a WhatsApp share link.",
    parametersJsonSchema: paymentArgs,
  },
  {
    name: "check_order_status",
    description: "Checks live payment status of an order.",
    parametersJsonSchema: refArg,
  },
  {
    name: "generate_backup_link",
    description: "Creates a Lipwa fallback payment link for an existing order, sends it via SMS, and prepares a WhatsApp link.",
    parametersJsonSchema: refArg,
  },
  {
    name: "cancel_order",
    description: "Cancels an unpaid order locally so it will not be fulfilled, after verifying it has not already been paid.",
    parametersJsonSchema: refArg,
  },
  {
    name: "retry_order",
    description: "Retries a failed payment order by creating a fresh STK Push or multi-network link with the same phone and amount.",
    parametersJsonSchema: refArg,
  },
  {
    name: "list_all_orders",
    description: "Lists all orders and statuses.",
    parametersJsonSchema: noArgs,
  },
];

async function executeTool(name, args) {
  try {
    if (name === "check_wallet_balance") return await checkWalletBalance();

    if (name === "initiate_mpesa_payment" || name === "create_multi_network_link") {
      const amount = Math.round(Number(args.amount));
      if (!Number.isFinite(amount) || amount < 1) return { error: "Invalid amount." };
      if (amount > MAX) return { error: `Refused: amount exceeds the limit of KES ${MAX}.` };
      normalizePhone(args.phone);

      const externalReference = `ORD-${Date.now().toString().slice(-6)}`;
      const baseOrder = {
        externalReference,
        payheroReference: "",
        phone: args.phone,
        amount,
        customerName: args.customerName || "Customer",
        itemDescription: args.itemDescription || "Payment",
        fallbackLink: "",
        whatsappLink: "",
        receiptNumber: "",
        updatedAt: new Date().toISOString(),
      };

      if (name === "create_multi_network_link") {
        const paymentLink = createBackupLipwaLink(baseOrder);
        const whatsappLink = buildWhatsAppShareUrl(baseOrder, paymentLink);
        const smsDelivery = await sendPaymentLinkSms(baseOrder, paymentLink);

        saveOrder({
          ...baseOrder,
          status: "AIRTEL_LIPWA_LINK_SENT",
          fallbackLink: paymentLink,
          whatsappLink,
          smsStatus: smsDelivery.sent ? "SENT" : smsDelivery.simulated ? "SIMULATED" : "FAILED",
        });

        return { externalReference, paymentLink, whatsappLink, smsDelivery };
      }

      if (Date.now() - lastPushAt < 15000) {
        return { error: "Rate limit: wait 15 seconds between STK pushes." };
      }
      lastPushAt = Date.now();

      const result = await sendStkPush({ ...args, amount, externalReference });
      saveOrder({
        ...baseOrder,
        payheroReference: result.reference || "",
        status: result.reference ? "QUEUED" : "FAILED_TO_QUEUE",
      });
      return { externalReference, payheroResponse: result };
    }

    if (name === "check_order_status") {
      const order = getOrder(args.externalReference);
      if (!order) return { error: "Order not found." };
      if (order.status === "CANCELLED") return { error: "Order is CANCELLED.", order };
      if (!order.payheroReference) return { order, message: "No STK reference on this order yet." };

      const s = await checkPaymentStatus(order.payheroReference);
      if (s?.status === "SUCCESS") {
        order.status = "PAID";
        order.receiptNumber = s.provider_reference || s.third_party_reference || "";
        order.updatedAt = new Date().toISOString();
        saveOrder(order);
      }
      return { order, payheroStatus: s };
    }

    if (name === "generate_backup_link") {
      const order = getOrder(args.externalReference);
      if (!order) return { error: "Order not found." };
      if (order.status === "PAID") return { error: "Order is already PAID." };
      if (order.status === "CANCELLED") return { error: "Order is CANCELLED." };

      const fallbackLink = createBackupLipwaLink(order);
      const whatsappLink = buildWhatsAppShareUrl(order, fallbackLink);
      const smsDelivery = await sendPaymentLinkSms(order, fallbackLink);

      order.fallbackLink = fallbackLink;
      order.whatsappLink = whatsappLink;
      order.smsStatus = smsDelivery.sent ? "SENT" : smsDelivery.simulated ? "SIMULATED" : "FAILED";
      order.status = "FALLBACK_LINK_SENT";
      order.updatedAt = new Date().toISOString();
      saveOrder(order);

      return {
        externalReference: order.externalReference,
        fallbackLink,
        whatsappLink,
        smsDelivery,
      };
    }

    if (name === "cancel_order") {
      const order = getOrder(args.externalReference);
      if (!order) return { error: "Order not found." };
      if (order.status === "PAID") return { error: "Refused: order is already PAID." };
      if (order.status === "CANCELLED") return { cancelled: true, message: "Order is already CANCELLED.", order };

      if (order.payheroReference) {
        const live = await checkPaymentStatus(order.payheroReference);
        if (live?.status === "SUCCESS") {
          order.status = "PAID";
          order.receiptNumber = live.provider_reference || live.third_party_reference || "";
          order.updatedAt = new Date().toISOString();
          saveOrder(order);
          return { error: "Refused: payment already succeeded with PayHero.", order };
        }
      }

      order.status = "CANCELLED";
      order.failureReason = "Cancelled by operator";
      order.fallbackLink = "";
      order.whatsappLink = "";
      order.updatedAt = new Date().toISOString();
      saveOrder(order);
      return { cancelled: true, order };
    }

    if (name === "retry_order") {
      const old = getOrder(args.externalReference);
      if (!old) return { error: "Original order not found." };
      if (old.status === "PAID") return { error: "This order is already paid—no retry needed." };

      if (old.payheroReference) {
        const live = await checkPaymentStatus(old.payheroReference);
        if (live?.status === "SUCCESS") {
          old.status = "PAID";
          old.receiptNumber = live.provider_reference || live.third_party_reference || "";
          old.updatedAt = new Date().toISOString();
          saveOrder(old);
          return { error: "Payment already went through! Receipt confirmed.", order: old };
        }
      }

      const isLipwa = old.status === "AIRTEL_LIPWA_LINK_SENT";
      return await executeTool(isLipwa ? "create_multi_network_link" : "initiate_mpesa_payment", {
        phone: old.phone,
        amount: old.amount,
        customerName: old.customerName,
        itemDescription: old.itemDescription,
      });
    }

    if (name === "list_all_orders") return { orders: getAllOrders() };
    return { error: `Unknown tool: ${name}` };
  } catch (err) {
    return { error: err.message };
  }
}

const systemInstruction = `You are PesaPilot, a multi-network Kenyan payment agent.
1. Before a new payment, call check_wallet_balance.
2. If the user says they are paying with Airtel (or T-Kash/PesaLink) or gives an Airtel prefix (such as 073x, 0750-0756, 078x, or 010x), DO NOT call initiate_mpesa_payment. Call create_multi_network_link instead.
3. For Safaricom M-Pesa numbers, call initiate_mpesa_payment. QUEUED means only that the prompt was sent—never say an order is paid unless check_order_status confirms it.
4. Never retry an STK push for the same request. If it fails or the user wants a backup, call generate_backup_link.
5. If the user asks to cancel or void an order, call cancel_order with the Order Reference.
6. If the user asks to retry a failed order, call retry_order with the Order Reference.
7. Always include the Order Reference, plain https:// payment/backup URL (never wrap URLs in angle brackets < > or markdown), SMS delivery status, and WhatsApp share URL when generated. Keep replies short and clear.`;

async function generateWithRetry(params, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      const retryable = /503|UNAVAILABLE|429|overloaded|high demand/i.test(String(err.message));
      if (!retryable || i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

const tools = toolDeclarations.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parametersJsonSchema },
}));

async function callGroq(messages, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data.choices[0].message;
    const retryable = res.status === 429 || res.status >= 500;
    console.log("[Groq error]", res.status, JSON.stringify(data));
    if (!retryable || i === tries - 1) throw new Error(data?.error?.message || `Groq error ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
}

async function runGroqAgent(userMessage, trace) {
  const messages = [
    { role: "system", content: systemInstruction },
    { role: "user", content: userMessage },
  ];
  for (let step = 0; step < 6; step++) {
    const msg = await callGroq(messages);
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: msg.content || "(no reply)" };
    }
    messages.push(msg);
    for (const call of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {}
      const output = await executeTool(call.function.name, args);
      trace.push({ tool: call.function.name, args, output });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return { reply: "Stopped: too many reasoning steps." };
}

async function runGeminiAgent(userMessage, trace) {
  const contents = [{ role: "user", parts: [{ text: userMessage }] }];
  for (let step = 0; step < 6; step++) {
    const response = await generateWithRetry({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents,
      config: { systemInstruction, tools: [{ functionDeclarations: toolDeclarations }] },
    });
    if (!response.functionCalls || response.functionCalls.length === 0) {
      return { reply: response.text };
    }
    contents.push(response.candidates[0].content);
    const parts = [];
    for (const call of response.functionCalls) {
      const output = await executeTool(call.name, call.args || {});
      trace.push({ tool: call.name, args: call.args || {}, output });
      parts.push({ functionResponse: { name: call.name, response: { output } } });
    }
    contents.push({ role: "user", parts });
  }
  return { reply: "Stopped: too many reasoning steps." };
}

export async function runPesaPilotAgent(userMessage) {
  const providers = [
    ["groq", runGroqAgent],
    ["gemini", runGeminiAgent],
  ];
  const failures = [];

  for (const [name, run] of providers) {
    const trace = [];
    try {
      const result = await run(userMessage, trace);
      return { ...result, provider: name, trace };
    } catch (err) {
      console.log(`[Agent] ${name} failed:`, err.message);
      failures.push(`${name}: ${err.message}`);

      const paid = trace.find(
        (t) => t.tool === "initiate_mpesa_payment" && t.output?.externalReference && !t.output?.error
      );
      if (paid) {
        return {
          reply: `The assistant hit an error after sending the payment prompt. Order ${paid.output.externalReference} was created. Check its status in the orders panel and do not resend.`,
          provider: name,
          trace,
        };
      }
    }
  }
  return { reply: `All providers failed. ${failures.join(" | ")}`, trace: [] };
}