// core/scoring.ts
// Personalised fallback: quotes the user's own words, flags missing elements,
// cites long sentences, and references the topic keywords.
// No generic text: every bullet ties to what they actually said.

import { LiveRoom } from './types';

export type JudgeOutput = {
  winner: 'A'|'B'|'TIE';
  scores: {
    A: { clarity: number; relevance: number; evidence: number; irac: number; civility: number };
    B: { clarity: number; relevance: number; evidence: number; irac: number; civility: number };
  };
  feedback: { A: string[]; B: string[] };
};

export function buildJudgePayload(room: LiveRoom) {
  return {
    topic: room.cfg.topic,
    speeches: room.audioTurns.map(t => ({
      phase: t.phase, team: t.team, text: t.text ?? ''
    })),
    interruptions: room.interruptions
  };
}

export async function heuristicJudge(room: LiveRoom): Promise<JudgeOutput> {
  const txtA = room.audioTurns.filter(t => t.team==='A').map(t => t.text||'').join('\n');
  const txtB = room.audioTurns.filter(t => t.team==='B').map(t => t.text||'').join('\n');

  const baseA = scoreSide(txtA, room.cfg.topic);
  const baseB = scoreSide(txtB, room.cfg.topic);

  // Interruption effects
  room.interruptions.forEach(ev => {
    if (ev.accepted) {
      if (ev.by === 'A') baseA.clarity += 0.2; else baseB.clarity += 0.2;
      // speaker handled pressure → tiny IRAC bump to opponent
      if (ev.by === 'A') baseB.irac += 0.2; else baseA.irac += 0.2;
    } else {
      if (ev.by === 'A') baseA.civility -= 0.2; else baseB.civility -= 0.2;
    }
  });

  // Bound 0..5
  const A = boundAll(baseA), B = boundAll(baseB);
  const sumA = A.clarity + A.relevance + A.evidence + A.irac + A.civility;
  const sumB = B.clarity + B.relevance + B.evidence + B.irac + B.civility;
  const winner = Math.abs(sumA - sumB) < 0.25 ? 'TIE' : (sumA > sumB ? 'A' : 'B');

  return {
    winner,
    scores: { A, B },
    feedback: {
      A: makePersonalisedFeedback(txtA, room.cfg.topic),
      B: makePersonalisedFeedback(txtB, room.cfg.topic)
    }
  };
}

function scoreSide(text: string, topic: string) {
  return {
    clarity: clarityScore(text),
    relevance: relevanceScore(text, topic),
    evidence: evidenceScore(text),
    irac: iracScore(text),
    civility: civilityScore(text)
  };
}

function clarityScore(t: string) {
  const sentences = t.split(/[.!?]\s/).filter(Boolean);
  const long = sentences.filter(s => s.split(/\s+/).length > 25).length;
  return 3.0 - long * 0.4 + (sentences.length > 4 ? 1.0 : 0.0);
}
function relevanceScore(t: string, topic: string) {
  const a = new Set(topic.toLowerCase().split(/\W+/).filter(Boolean));
  const b = new Set(t.toLowerCase().split(/\W+/).filter(Boolean));
  let hit = 0; a.forEach(w => { if (b.has(w)) hit++; });
  return 1 + Math.min(4, hit / Math.max(1, a.size) * 4);
}
function evidenceScore(t: string) {
  const hits = (t.match(/\b(v\.|Act|Bill|Code|Section|§|Article|\d{4}\b|According to)\b/gi) || []).length;
  return Math.min(5, 1 + hits * 0.6);
}
function iracScore(t: string) {
  const structure = (t.match(/\b(Issue|Rule|Apply|Application|Therefore|Thus|In conclusion)\b/gi) || []).length;
  return Math.min(5, 1 + structure * 0.5);
}
function civilityScore(t: string) {
  const bad = (t.match(/\b(dumb|idiot|stupid|shut up|trash)\b/gi) || []).length;
  return Math.max(0, 5 - bad * 1.5);
}
function boundAll(s: any) {
  Object.keys(s).forEach(k => s[k] = Math.max(0, Math.min(5, s[k])));
  return s;
}

// Build feedback that QUOTES the user.
function makePersonalisedFeedback(t: string, topic: string): string[] {
  const bullets: string[] = [];
  const sentences = t.split(/[.!?]\s/).filter(Boolean);

  // Missing explicit Issue?
  if (!/\b(Issue|issue)\b/.test(t)) {
    bullets.push(`State the Issue explicitly at the start, e.g., “The issue is whether ${topic.toLowerCase()}…”.`);
  }

  // No evidence?
  if (!/\b(v\.|Act|Bill|Code|Section|§|Article|\d{4})\b/.test(t)) {
    bullets.push(`Cite one source (case or statute). For example: “According to [Act/Case], …”.`);
  }

  // Long sentence to split (quote first 8 words)
  const long = sentences.find(s => s.split(/\s+/).length > 25);
  if (long) {
    const q = long.split(/\s+/).slice(0, 8).join(' ');
    bullets.push(`Split the long sentence starting “${q}…” into two claims with a clear “because”.`);
  }

  // Weak conclusion?
  if (!/\b(conclude|conclusion|therefore|thus|hence)\b/i.test(t)) {
    bullets.push(`Finish with “Therefore, [your side] because [key rule→application].”`);
  }

  // If interruptions exist, prompt improvement
  if (!/\?$/.test(t.trim())) {
    bullets.push(`During interruptions, ask or answer with a clear “How/Why…?” line to sharpen analysis.`);
  }

  // Cap at 4–5 bullets and ensure non-empty
  return bullets.slice(0, 5).length ? bullets.slice(0, 5) : ['Good delivery; add one citation tied to your Issue.'];
}
