/**
 * Every error and refusal in plain language, with what happens next. Raw texts come from the relay,
 * the browser (passkeys, wallets) and the pot contract's revert names; anything not listed is shown
 * as it is, with its first letter capitalised and a full stop.
 */
const RULES: [RegExp, string][] = [
  // The market and its price
  [/too thin|order book allows|depth in time|AboveCap/i, "The market is too thin for this right now. Put in less, pick a busier market, or try again in a minute."],
  [/did not return this market's order book|unknown market|not a Gemini instrument/i, "Gemini is not showing this market's order book right now. Pick another market, or try again in a minute."],
  [/closes too soon/i, "This market closes too soon. Pick one that runs for at least another 15 minutes."],
  [/OutsideBand/i, "The price moved out of the agreed band before the join was priced, so nobody paid anything. Try again at today's price."],
  [/no price|did not agree|could not be priced|InvalidAttestation/i, "The samplers could not agree on a price, so nothing moved. You can ask again in two minutes; otherwise the final result decides."],
  // Timing
  [/Cooldown|try again in \d+ s/i, "An exit window just failed to price. You can ask again in two minutes; nothing has moved."],
  [/TooLate|last minutes before the market's close|Too close to the market's close/i, "Exits are closed in the last minutes before the market's close. The final result decides."],
  [/TooEarly/i, "Arc's clock is a few seconds behind; the relay tries again on its own. Nothing is needed from you."],
  [/WrongState|not waiting for a second side|only while the pot is live|already open/i, "This pot has moved on since you opened the page (someone joined, left or it settled). The page now shows where it stands."],
  [/offer expired|ExpiredSignature/i, "That offer has expired. Offer again at today's price."],
  // Accounts and money
  [/Could not add test money|test-money pool|out of test money/i, "HonorCat's test money is used up for the moment. It refills by itself; or get test USDC from Circle's faucet (see below)."],
  [/daily limit|withdrawal limit|enough for today/i, "Today's limit is reached. Try again tomorrow, or invite a friend to play."],
  [/insufficient|exceeds balance|TransferMismatch/i, "Your account does not hold enough test USDC for this. Put in less, or add test money from the account page."],
  [/NotOwner|unknown passkey account/i, "This account does not hold that side of the pot. Sign in with the passkey or wallet you played with."],
  [/stale account nonce/i, "Two actions crossed. Press the button again; nothing was sent twice."],
  // Circle smart accounts
  [/entity config/i, "Circle smart accounts are not switched on for this site yet. Use a passkey or a wallet for now."],
  // The browser
  [/cancelled|NotAllowedError|denied|rejected/i, "You cancelled the confirmation, so nothing was sent. Press the button again when you are ready."],
  [/does not use P-256|does not expose the passkey/i, "This passkey cannot sign on Arc. Try another device or password manager, or use a wallet instead."],
  [/transaction failed on Arc/i, "The transaction failed on Arc, so nothing moved. Try again in a moment."],
  [/Failed to fetch|NetworkError|network error|timed? ?out/i, "HonorCat could not be reached. Check your connection; nothing was sent if no transaction is shown."],
];

export function plainMessage(raw: string): string {
  for (const [re, text] of RULES) if (re.test(raw)) return text;
  const s = raw.split("\n")[0]!.trim().replace(/^(Error: )+/, "");
  if (!s) return "Something went wrong and nothing was sent. Try again in a moment.";
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`.replace(/[.;:]?$/, ".");
}

export const plainError = (e: unknown) => plainMessage(e instanceof Error ? e.message : String(e));
