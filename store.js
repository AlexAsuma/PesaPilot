import fs from "fs";
const FILE = "./db.json";

const load = () =>
  fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { orders: {}, receipts: [] };
const save = (db) => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));

export function saveOrder(order) {
  const db = load();
  db.orders[order.externalReference] = order;
  save(db);
}
export const getOrder = (id) => load().orders[id] || null;
export const getAllOrders = () => Object.values(load().orders).reverse();

// true only the first time a receipt is seen, so duplicate webhooks can't double-fulfil
export function markReceiptIfNew(receipt) {
  const db = load();
  if (!receipt || db.receipts.includes(receipt)) return false;
  db.receipts.push(receipt);
  save(db);
  return true;
}
