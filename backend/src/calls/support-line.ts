/**
 * Support-line rules that need no database or network, so they can be tested
 * on their own: which dialled numbers are support lines, and what happens to
 * the caller when the AI operator's leg ends.
 */

export interface SupportConfig {
  /** The AI operator answers support numbers first. Off = the usual menu. */
  aiEnabled: boolean;
  /** Dialled numbers that count as the support line. */
  numbers: string[];
  companyName: string;
  /** Spoken word for word when the AI picks up. Empty = the platform default. */
  greeting: string;
  /** What the AI knows: products, hours, policies. */
  instructions: string;
}

/** Digits only, without the international prefix, so +1…, 001… and 1… match. */
export function bareNumber(value?: string | null): string {
  return (value ?? '').replace(/\D/g, '').replace(/^00/, '');
}

export function isSupportNumber(numbers: string[], dialled?: string | null): boolean {
  const target = bareNumber(dialled);
  if (!target) return false;
  return numbers.some((n) => bareNumber(n) === target);
}

export type AfterAi =
  /** The caller is finished: end their leg too. */
  | { action: 'hangup' }
  /** Ring a person: the one asked for by name, otherwise the operator. */
  | { action: 'person'; person?: string }
  /** Nothing to do: the caller has already gone. */
  | { action: 'none' };

/**
 * What to do with the caller once the AI operator's leg has ended.
 *
 * Only an explicit "hangup" from the AI ends the call. Everything else —
 * a transfer request, an AI that never answered, an AI that died mid-call —
 * rings a person, so a caller is never dropped in silence.
 */
export function afterAiLeg(
  metadata: Record<string, any> | null | undefined,
  opts: { aiAnswered: boolean },
): AfterAi {
  if (metadata?.callerGone) return { action: 'none' };
  if (!opts.aiAnswered) return { action: 'person' };
  const handoff = metadata?.handoff;
  if (handoff?.action === 'hangup') return { action: 'hangup' };
  return { action: 'person', person: handoff?.person || undefined };
}

/** Loose match of a spoken name against the team: "ravi" finds "Ravi Kumar". */
export function matchPerson<T extends { name: string }>(people: T[], spoken?: string): T | null {
  const wanted = (spoken ?? '').trim().toLowerCase();
  if (wanted.length < 2) return null;
  const exact = people.filter((p) => p.name.trim().toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  const partial = people.filter((p) => {
    const name = p.name.trim().toLowerCase();
    return name.split(/\s+/).includes(wanted) || name.startsWith(wanted);
  });
  // Two people with the same first name: let the operator sort it out.
  return partial.length === 1 ? partial[0] : null;
}
