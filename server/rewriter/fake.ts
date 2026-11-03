import type { Rewriter, RewriteInput, RewriteResult } from './types.js';

/**
 * A local, free stand in for the AI. Simple rules, no network.
 * It only removes or softens words and never adds facts, but it is nowhere near
 * as good as a real model, so scores against it say nothing about real quality.
 */

const THREAT = [
  /\bi('?ll| will| am going to|'?m going to|'?m gonna| am gonna) (kill|hurt|beat|hit|smash|ruin|destroy|burn|stab|shoot)\b/i,
  /\b(kill|hurt|beat|hit|stab|shoot|choke) (you|your)\b/i,
  /\byou('?ll| will) (regret|pay for|be sorry)\b/i,
  /\bmake you (regret|pay|sorry)\b/i,
  /\bwatch your back\b/i,
  /\bi know where you (live|work|sleep)\b/i,
  /\bi('?ll| will) (find|come for|get) you\b/i,
  /\bor else\b.*\b(hurt|pay|regret)\b/i,
];

const DANGER = [
  /\b(kill|hurt|harm) myself\b/i,
  /\bend (it all|my life)\b/i,
  /\bnot (want|going) to (live|be here)\b/i,
  /\bi('?ll| will) (kill|hurt)\b/i,
  /\bkill you\b/i,
];

const REPLACEMENTS: [RegExp, string][] = [
  [/\bwhat the (hell|heck|fuck)\b/gi, 'what'],
  [/\byou('re| are) (such )?(an? )?(complete |total |absolute )?(idiot|moron|fool|jerk|loser|liar|joke|pig|clown)s?\b/gi, ''],
  [/\byou('re| are) (so |really |just )?(stupid|dumb|useless|pathetic|selfish|lazy|irresponsible)\b/gi, ''],
  [/\b(you )?(idiots?|morons?|fools?|jerks?|losers?|clowns?)\b/gi, ''],
  [/\b(stupid|idiotic|moronic|pathetic|useless|dumb)\b/gi, ''],
  [/\bshut (up|your mouth)\b/gi, 'please let me finish'],
  [/\bi (really )?hate it when\b/gi, 'I find it hard when'],
  [/\bi hate\b/gi, 'I really dislike'],
  [/\bi('m| am) (sick|tired) of\b/gi, 'I am finding it hard with'],
  [/\byou always\b/gi, 'it often seems like you'],
  [/\byou never\b/gi, 'it rarely seems like you'],
  [/\byou (need|have|got) to\b/gi, "I'd like you to"],
  [/\byou must\b/gi, "I'd like you to"],
  [/\b(fucking|fuckin|freaking|bloody|goddamn|damn|damned)\b/gi, ''],
  [/\b(fuck|shit|bullshit|crap|bs|hell|ass|asshole|bastard)\b/gi, ''],
];

const hasWordsLeft = (s: string) => s.replace(/[^a-z0-9$€£]/gi, ' ').trim().split(/\s+/).filter(Boolean).length;

function tidy(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  // ALL CAPS words (3+ letters) to lower case
  t = t.replace(/\b[A-Z]{3,}\b/g, (w) => w.toLowerCase());
  for (const [re, to] of REPLACEMENTS) t = t.replace(re, to);
  // exclamation and question pileups
  t = t.replace(/!+/g, '.').replace(/\?{2,}/g, '?').replace(/\.{2,}/g, '.');
  // remove dangling punctuation left by deletions
  t = t.replace(/\s+([,.;:?])/g, '$1').replace(/([,;:])\s*([.?])/g, '$2').replace(/,\s*,/g, ',');
  t = t.replace(/(^|[.?]\s+)[,;:]+\s*/g, '$1').replace(/\s+/g, ' ').trim();
  // sentences: drop empty ones and capitalise
  const parts = t.split(/(?<=[.?])\s+/).map((s) => s.trim()).filter((s) => hasWordsLeft(s) > 0);
  const out = parts.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  return /[.?]$/.test(out) || out === '' ? out : `${out}.`;
}

export class FakeRewriter implements Rewriter {
  readonly name = 'fake';

  async rewrite({ original }: RewriteInput): Promise<RewriteResult> {
    if (/\[\[fake-fail\]\]/.test(original)) throw new Error('fake rewriter failure');

    if (DANGER.some((re) => re.test(original))) {
      return {
        outcome: 'stopped',
        reason: 'This looks like it may involve someone being in danger, so it was not sent.',
        showSupport: true,
      };
    }
    if (THREAT.some((re) => re.test(original))) {
      return {
        outcome: 'stopped',
        reason: 'This reads as a threat. Threats are not sent, and polite wording would not fix them.',
        showSupport: true,
      };
    }

    const text = tidy(original);
    if (hasWordsLeft(text) < 3) {
      return {
        outcome: 'needs_clarity',
        reason: 'There was no clear point left once the anger was taken out. What do you actually want to say or ask for?',
      };
    }
    return { outcome: 'rewritten', text };
  }
}
