"use strict";

class Emitter {
  constructor() { this.listeners = new Map(); }
  on(name, listener) { const list = this.listeners.get(name) || new Set(); list.add(listener); this.listeners.set(name, list); return () => this.off(name, listener); }
  off(name, listener) { const list = this.listeners.get(name); if (!list) return; list.delete(listener); if (!list.size) this.listeners.delete(name); }
  emit(name, ...args) { for (const listener of [...(this.listeners.get(name) || [])]) listener(...args); }
  removeAllListeners() { this.listeners.clear(); }
}

module.exports = { Emitter };
