import "dotenv/config";
import express from "express";
import { runPesaPilotAgent } from "./agent.js";
import { checkPaymentStatus, createBackupLipwaLink } from "./payhero.js";
import { getOrder, saveOrder, getAllOrders, markReceiptIfNew } from "./store.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    res.json(await runPesaPilotAgent(message));
  } catch (err) {
    console.error("Agent error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/orders", (req, res) => res.json({ orders: getAllOrders() }));

app.post("/api/payhero/callback", async (req, res) => {
  console.log("[Callback]", JSON.stringify(req.body));
  try {
    const r = req.body.response;
    if (!r) return res.status(200).json({ status: "ignored" });
    const order = getOrder(r.ExternalReference);
    if (!order) return res.status(200).json({ status: "ignored" });

    if (r.Status === "Success" && r.ResultCode === 0) {
      // Callbacks are unsigned, so confirm with PayHero directly
      const v = await checkPaymentStatus(order.payheroReference);
      if (v?.status === "SUCCESS") {
        const receipt = r.MpesaReceiptNumber || v.provider_reference;
        if (markReceiptIfNew(receipt)) {
          order.status = "PAID";
          order.receiptNumber = receipt;
          order.updatedAt = new Date().toISOString();
          saveOrder(order);
        }
      }
    } else {
      order.status = "FAILED_FALLBACK_READY";
      order.failureReason = r.ResultDesc || "Cancelled by user";
      order.fallbackLink = createBackupLipwaLink(order);
      order.updatedAt = new Date().toISOString();
      saveOrder(order);
    }
  } catch (err) {
    console.error("Callback error:", err);
  }
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PesaPilot on http://localhost:${PORT}`));
