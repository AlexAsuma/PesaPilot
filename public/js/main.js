import { PesaApi } from "./api.js";
import { store } from "./state.js";
import {
  createBubbleElement,
  renderTraceList,
  renderOrdersList,
} from "./components.js";

const dom = {
  stream: document.getElementById("stream"),
  steps: document.getElementById("stepsList"),
  orders: document.getElementById("ordersList"),
  form: document.getElementById("cmdForm"),
  input: document.getElementById("cmdInput"),
  runBtn: document.getElementById("runBtn"),
  status: document.getElementById("modeStatus"),
  badge: document.getElementById("modelBadge"),
  stepCount: document.getElementById("stepCount"),
  sOrders: document.getElementById("sOrders"),
  sPaid: document.getElementById("sPaid"),
  sOpen: document.getElementById("sOpen"),
  syncBtn: document.getElementById("syncBtn"),
};

function setText(el, value) {
  if (el) el.textContent = String(value ?? "");
}

function setHtml(el, html) {
  if (el) el.innerHTML = html;
}

function appendChat(text, kind) {
  if (!dom.stream) return;
  dom.stream.appendChild(createBubbleElement(text, kind));
  dom.stream.scrollTop = dom.stream.scrollHeight;
}

store.subscribe(({ orders, trace, status, provider, kpis }) => {
  setText(dom.status, status);
  setText(dom.badge, provider);
  setText(dom.stepCount, trace.length);
  setText(dom.sOrders, kpis.total);
  setText(dom.sPaid, kpis.paid.toLocaleString());
  setText(dom.sOpen, kpis.open);
  setHtml(dom.steps, renderTraceList(trace));
  setHtml(dom.orders, renderOrdersList(orders));
});

async function syncOrders() {
  try {
    const { orders = [] } = await PesaApi.fetchOrders();
    store.setState({ orders });
  } catch {
    // Ignore transient polling failures
  }
}

async function executeCommand(message) {
  appendChat(message, "me");
  if (dom.runBtn) dom.runBtn.disabled = true;
  store.setState({ status: "Processing..." });

  try {
    const data = await PesaApi.sendCommand(message);
    const isErrReply = /failed|error|inactive|refused/i.test(data.reply || "");
    appendChat(data.reply || "Done.", isErrReply ? "err" : "agent");
    store.setState({
      status: "Ready",
      provider: "Assistant Ready",
      trace: Array.isArray(data.trace) ? data.trace : [],
    });
  } catch (err) {
    appendChat(err.message, "err");
    store.setState({ status: "Attention Needed", trace: [] });
  } finally {
    if (dom.runBtn) dom.runBtn.disabled = false;
    await syncOrders();
  }
}

dom.form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = dom.input?.value.trim() || "";
  if (!text) return;
  dom.input.value = "";
  executeCommand(text);
});

dom.syncBtn?.addEventListener("click", syncOrders);

document.querySelectorAll(".preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!dom.input) return;
    dom.input.value = btn.dataset.text || "";
    dom.input.focus();
  });
});

dom.orders?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cmd]");
  if (btn) executeCommand(btn.dataset.cmd);
});

setInterval(syncOrders, 3000);
syncOrders();