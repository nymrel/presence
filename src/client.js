/**
 * What an agent actually calls.
 *
 * The shape that matters: pause() returns as soon as the gate is OPEN, not when
 * the human is done. The agent gets a ticket and is free to end its turn.
 * Human latency is unknown and often long; holding a lane open across it is the
 * expensive mistake this design exists to avoid.
 *
 *   const gate = await presence.pause({...})   // returns in ms
 *   // ... agent ends its turn, sleeps, gets rescheduled ...
 *   const s = await presence.poll(gate.id)     // cheap, returns immediately
 *   if (s.state === 'released') { ...agent re-reads the live page itself... }
 *
 * Note what poll() does NOT return: any value the human produced. The agent
 * learns only that a human acted. It then re-reads the live page itself and
 * discovers the new state the same way it would have if it had done the step.
 * There is no channel through which an answer travels.
 */

const DEFAULT_BASE = process.env.PRESENCE_URL || 'http://127.0.0.1:8787';

export class Presence {
  constructor(base = DEFAULT_BASE) { this.base = base.replace(/\/$/, ''); }

  async health() {
    const r = await fetch(`${this.base}/health`);
    if (!r.ok) throw new Error('relay not reachable');
    return r.json();
  }

  /**
   * Open a gate. Returns:
   * {
   *   id, state, human_required, approval_profile,
   *   mode, console_url, pager_url, mode_forced
   * }.
   *
   * A server configured with `bypass_tool_approvals` returns a terminal
   * `retired` state only when trusted host code supplied a fresh capability
   * bound to the exact tool invocation. A generic `tool_approval` request still
   * prompts, and the requesting agent cannot select or override the profile.
   *
   * @param {object} o
   * @param {'attach'|'yield'} o.mode        requested; policy may force yield
   * @param {string} o.gate_kind             see GATE_KINDS
   * @param {string} o.host                  hostname only
   * @param {string} o.task                  what the agent was doing
   * @param {string} o.instruction           the one thing the human must do
   * @param {string} [o.handoff_url]         where the human should go (yield mode)
   * @param {string} [o.frame_base64]        what the agent is looking at
   * @param {string} [o.resume_hint]         what the agent will do next, for the ticket
   */
  async pause(o) {
    const r = await fetch(`${this.base}/agent/gate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(o),
    });
    if (!r.ok) throw new Error(`pause failed: ${await r.text()}`);
    return r.json();
  }

  async pushFrame(id, frame_base64) {
    await fetch(`${this.base}/agent/gate/${id}/frame`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frame_base64 }),
    });
  }

  /** Cheap, immediate. Never blocks a lane. */
  async poll(id) {
    const r = await fetch(`${this.base}/agent/gate/${id}`);
    if (!r.ok) throw new Error(`poll failed: ${await r.text()}`);
    return r.json();
  }

  /**
   * Convenience for a foreground demo only. Real lanes should sleep and poll
   * across turns rather than hold a process open.
   */
  async waitForHuman(id, { timeoutMs = 10 * 60 * 1000, intervalMs = 1500, onTick } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = await this.poll(id);
      if (['released', 'abandoned', 'timeout', 'refused', 'retired'].includes(s.state)) return s;
      if (onTick) await onTick(s);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { id, state: 'timeout' };
  }
}

export default new Presence();
