// ============================================================
// MOCK MODERATION — temporary stand-in for Meetali's service.
//
// When her real /moderate endpoint (port 3003) is ready, you do
// NOT change anything here. You change ONE line in the controller
// (see controllers/chatController.js — the `moderate()` call).
//
// The agreed contract is:
//   request:  { text: "the message" }
//   response: { score: 0.0-1.0, decision: "allow" | "warn" | "block" }
//
// This mock returns the same shape so the rest of the code never
// has to know whether it's talking to the mock or the real thing.
// ============================================================

function mockModerate(text) {
  const lower = text.toLowerCase();

  // crude keyword rules just so you can SEE warn/block behaviour
  // while building the UI. Real scoring comes from Meetali's model.
  if (lower.includes('idiot') || lower.includes('hate') || lower.includes('stupid')) {
    return { score: 0.92, decision: 'block' };
  }
  if (lower.includes('shut up') || lower.includes('dumb') || lower.includes('ugly')) {
    return { score: 0.55, decision: 'warn' };
  }
  return { score: 0.05, decision: 'allow' };
}

module.exports = { mockModerate };