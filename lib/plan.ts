// Momentum Breakout Radar — lib/plan.ts
//
// A protocol's farm plan: five steps, each an action with what it costs and how
// long it takes, derived from the protocol's own record (category, chains, TVL,
// momentum band, age) — never from a hand-written list of names.
//
// The breakout clock sets the hold: a BREAKOUT protocol is being discovered
// now, so its snapshots come sooner and a short, dense hold counts; a COOLING
// protocol needs a longer presence before its next snapshot round. Capital is
// sized to the protocol's TVL tier so a small early protocol never asks for a
// whale position. Every step names its cost and its time in the same sentence,
// so the board's farm_steps strings (20..600 characters each) are the plan.

import type { MomentumBand, SnapshotProtocol } from './model.ts';

/** One farm step before it is flattened into a single string. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL tier. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  if (p.tvl_usd >= 25_000_000) return 75;
  return 40;
}

/** How long to hold, from the momentum band: hot breakouts snapshot sooner. */
export function holdDaysFor(band: MomentumBand): number {
  if (band === 'BREAKOUT') return 21;
  if (band === 'RISING') return 30;
  if (band === 'STEADY') return 45;
  if (band === 'COOLING') return 60;
  return 45;
}

/** How fast to open the position, from the momentum band. */
function openWindowFor(band: MomentumBand): string {
  if (band === 'BREAKOUT') return 'within 48 hours, while the surge is fresh';
  if (band === 'RISING') return 'this week, before the next leg up';
  if (band === 'COOLING') return 'when the next weekly candle turns, not while it slides';
  return 'in the next few days';
}

/** The category's one breakout action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC on ${name} (${chain}) and leave the supply earning.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP tokens.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and leave it compounding.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds in its app.`;
  }
  if (c.includes('restak') || c.includes('liquid staking')) {
    return `Restake $${capital} of the chain's staking asset through ${name} and hold the receipt token.`;
  }
  if (c.includes('staking')) {
    return `Stake $${capital} of the chain's asset through ${name} and keep the staking receipt.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and take one position in an open market.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('launchpad')) {
    return `Commit $${capital} to ${name}'s next launch pool on ${chain} and complete its entry tasks.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly cadence action for the category: the repeatable qualifying move. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'a supply top-up, a borrow, or a repay';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'a swap, a liquidity add, or a reward claim';
  if (c.includes('bridge')) return 'a bridge transfer or a swap on the destination chain';
  if (c.includes('staking') || c.includes('restak')) return 'a stake top-up or a reward restake';
  if (c.includes('perpetual') || c.includes('derivative')) return 'one small trade or a margin top-up';
  if (c.includes('prediction')) return 'one market position or a settlement claim';
  if (c.includes('rwa') || c.includes('stable')) return 'a mint, a redeem, or a holding top-up';
  return 'a deposit, a swap, or a governance vote';
}

/**
 * A protocol's farm plan: five steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * momentum band, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, band: MomentumBand): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(band);
  const window = openWindowFor(band);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyFor(p);
  const gas = capital >= 200 ? 9 : capital >= 100 ? 6 : 4;
  const ageNote =
    age === null
      ? 'its track record is not dated, so keep the position small'
      : age < 90
        ? 'it is young, so size the position as an early bet, not a core hold'
        : age >= 365
          ? 'it has run a year or more with no token recorded, so the breakout is the news'
          : 'it is finding its feet, so farm steadily rather than all at once';
  return [
    {
      text: `Set up a fresh wallet that holds only this farm's funds, keep its seed phrase offline, and bridge gas to ${chain} first.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `${action} Open the position ${window}.`,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action every week — ${weekly} — so the wallet shows a live pattern, not a single deposit. Note that ${ageNote}.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot round, and do not churn it in and out.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes; never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** A protocol's farm plan as the board's flat strings. */
export function farmPlan(p: SnapshotProtocol, age: number | null, band: MomentumBand): string[] {
  return farmSteps(p, age, band).map(stepText);
}
