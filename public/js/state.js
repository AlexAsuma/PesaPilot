class AppStore {
  #state = {
    orders: [],
    trace: [],
    status: "IDLE",
    provider: "READY",
  };
  #listeners = new Set();

  getState() {
    return {
      ...this.#state,
      kpis: this.#computeKpis(this.#state.orders),
    };
  }

  setState(patch) {
    this.#state = { ...this.#state, ...patch };
    const snapshot = this.getState();
    this.#listeners.forEach((fn) => fn(snapshot));
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.getState());
    return () => this.#listeners.delete(listener);
  }

  #computeKpis(orders) {
    let paid = 0;
    let open = 0;
    for (const o of orders) {
      if (o.status === "PAID") paid += Number(o.amount || 0);
      else if (o.status !== "CANCELLED") open += 1;
    }
    return { total: orders.length, paid, open };
  }
}

export const store = new AppStore();