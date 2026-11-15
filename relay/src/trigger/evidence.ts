import {
  concat,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import { resolutionDomain, resolutionTypes } from "../signer";
import { DECISION, evaluate, statusOf, type Decision, type DecisionCode, type Sample, type SampleStatus } from "./engine";
import {
  conditionIdForTrigger,
  ENGINE_VERSION,
  modeCode,
  paramsAbi,
  paramsTuple,
  sideCode,
  type PotMode,
  type TriggerParams,
  type TriggerSide,
} from "./params";

/**
 * Evidence for one signer's trigger decision. Everything needed to recompute the decision is in
 * the record. Its canonical form is the Solidity ABI encoding of the tuple below (fixed field
 * order, integers only: prices and sizes in market units, times in ms, the average in micro
 * price units). evidenceHash = keccak256(canonical bytes).
 *
 * The vault does NOT verify evidence. The vault only checks the resolver's signature over
 * (potId, conditionId, outcome). The evidence makes a payout decision auditable by anyone,
 * not enforced on-chain.
 */
export type EvidenceRecord = {
  engineVersion: string;
  chainId: number;
  vault: Address;
  potId: bigint;
  conditionId: Hex;
  instrument: string;
  side: TriggerSide;
  mode: PotMode;
  params: TriggerParams;
  windowStart: number;
  windowEnd: number;
  samples: Sample[];
  validCount: number;
  averageMicro: bigint;
  decision: DecisionCode;
  dataSource: string;
  signer: Address;
};

const recordAbi = [
  {
    type: "tuple",
    components: [
      { name: "engineVersion", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "vault", type: "address" },
      { name: "potId", type: "uint256" },
      { name: "conditionId", type: "bytes32" },
      { name: "instrument", type: "string" },
      { name: "side", type: "uint8" },
      { name: "mode", type: "uint8" },
      { ...paramsAbi, name: "params" },
      { name: "windowStart", type: "uint64" },
      { name: "windowEnd", type: "uint64" },
      {
        name: "samples",
        type: "tuple[]",
        components: [
          { name: "t", type: "uint64" },
          { name: "dataT", type: "uint64" },
          { name: "bid", type: "uint256" },
          { name: "ask", type: "uint256" },
          { name: "bidSize", type: "uint256" },
          { name: "askSize", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
      { name: "validCount", type: "uint32" },
      { name: "averageMicro", type: "uint256" },
      { name: "decision", type: "uint8" },
      { name: "dataSource", type: "string" },
      { name: "signer", type: "address" },
    ],
  },
] as const;

/** The canonical bytes of a record. */
export function encodeRecord(r: EvidenceRecord): Hex {
  return encodeAbiParameters(recordAbi, [
    {
      engineVersion: r.engineVersion,
      chainId: BigInt(r.chainId),
      vault: getAddress(r.vault),
      potId: r.potId,
      conditionId: r.conditionId,
      instrument: r.instrument,
      side: sideCode(r.side),
      mode: modeCode(r.mode),
      params: paramsTuple(r.params),
      windowStart: BigInt(r.windowStart),
      windowEnd: BigInt(r.windowEnd),
      samples: r.samples.map((s) => ({ t: BigInt(s.t), dataT: BigInt(s.dataT), bid: s.bid, ask: s.ask, bidSize: s.bidSize, askSize: s.askSize, status: s.status })),
      validCount: r.validCount,
      averageMicro: r.averageMicro,
      decision: r.decision,
      dataSource: r.dataSource,
      signer: getAddress(r.signer),
    },
  ]);
}

export const evidenceHash = (r: EvidenceRecord): Hex => keccak256(encodeRecord(r));

/** Builds a signer's record from its own samples. */
export function buildRecord(input: {
  chainId: number;
  vault: Address;
  potId: bigint;
  instrument: string;
  side: TriggerSide;
  mode: PotMode;
  params: TriggerParams;
  samples: Sample[];
  windowEnd: number;
  dataSource: string;
  signer: Address;
}): { record: EvidenceRecord; decision: Decision } {
  const decision = evaluate(input.samples, input.params, input.side, input.windowEnd);
  const used = input.samples.filter((s) => s.t > decision.windowStart && s.t <= decision.windowEnd);
  const record: EvidenceRecord = {
    engineVersion: ENGINE_VERSION,
    chainId: input.chainId,
    vault: getAddress(input.vault),
    potId: input.potId,
    conditionId: conditionIdForTrigger({ instrument: input.instrument, side: input.side, mode: input.mode, params: input.params }),
    instrument: input.instrument,
    side: input.side,
    mode: input.mode,
    params: input.params,
    windowStart: decision.windowStart,
    windowEnd: decision.windowEnd,
    samples: used,
    validCount: decision.validCount,
    averageMicro: decision.averageMicro,
    decision: decision.code,
    dataSource: input.dataSource,
    signer: getAddress(input.signer),
  };
  return { record, decision };
}

export class EvidenceError extends Error {}

/**
 * Recomputes the decision from the record and rejects it unless every stored value follows from
 * the record's own data and rule: the conditionId commits to its parameters, every sample's
 * status matches, and the count, average and decision match a fresh evaluation.
 */
export function verifyRecord(r: EvidenceRecord): Decision {
  if (r.engineVersion !== ENGINE_VERSION) throw new EvidenceError(`unknown engine version ${r.engineVersion}`);
  if (r.windowEnd - r.windowStart !== r.params.windowMs) throw new EvidenceError("window does not match the parameters");
  const expectedCondition = conditionIdForTrigger({ instrument: r.instrument, side: r.side, mode: r.mode, params: r.params });
  if (expectedCondition !== r.conditionId) throw new EvidenceError("conditionId does not commit to these parameters");
  for (const [i, s] of r.samples.entries()) {
    if (s.t <= r.windowStart || s.t > r.windowEnd) throw new EvidenceError(`sample ${i} is outside the window`);
    const st = s.status === 7 ? 7 : statusOf(s, r.params); // off_tick samples keep their partial values
    if (st !== s.status) throw new EvidenceError(`sample ${i} status ${s.status} should be ${st}`);
  }
  const d = evaluate(r.samples, r.params, r.side, r.windowEnd);
  if (d.validCount !== r.validCount) throw new EvidenceError("validCount does not match the samples");
  if (d.averageMicro !== r.averageMicro) throw new EvidenceError("average does not match the samples");
  if (d.code !== r.decision) throw new EvidenceError("decision does not match the rule");
  return d;
}

// ------------------------------------------------------------------ JSON form (proof page, storage)

type Json = Record<string, unknown>;

/** A JSON view with every integer as a decimal string, in canonical field order. */
export function recordToJson(r: EvidenceRecord): Json {
  return {
    engineVersion: r.engineVersion,
    chainId: String(r.chainId),
    vault: getAddress(r.vault),
    potId: r.potId.toString(),
    conditionId: r.conditionId,
    instrument: r.instrument,
    side: r.side,
    mode: r.mode,
    params: Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, String(v)])),
    windowStart: String(r.windowStart),
    windowEnd: String(r.windowEnd),
    samples: r.samples.map((s) => ({ t: String(s.t), dataT: String(s.dataT), bid: s.bid.toString(), ask: s.ask.toString(), bidSize: s.bidSize.toString(), askSize: s.askSize.toString(), status: String(s.status) })),
    validCount: String(r.validCount),
    averageMicro: r.averageMicro.toString(),
    decision: String(r.decision),
    dataSource: r.dataSource,
    signer: getAddress(r.signer),
  };
}

export function recordFromJson(j: Json): EvidenceRecord {
  const p = j.params as Record<string, string>;
  const n = (v: unknown) => {
    const x = Number(v);
    if (!Number.isSafeInteger(x)) throw new EvidenceError(`not an integer: ${String(v)}`);
    return x;
  };
  return {
    engineVersion: String(j.engineVersion),
    chainId: n(j.chainId),
    vault: getAddress(String(j.vault)),
    potId: BigInt(String(j.potId)),
    conditionId: String(j.conditionId) as Hex,
    instrument: String(j.instrument),
    side: j.side as TriggerSide,
    mode: j.mode as PotMode,
    params: {
      thresholdBps: n(p.thresholdBps),
      windowMs: n(p.windowMs),
      intervalMs: n(p.intervalMs),
      minValidSamples: n(p.minValidSamples),
      maxSpreadUnits: n(p.maxSpreadUnits),
      minSizeUnits: n(p.minSizeUnits),
      maxStalenessMs: n(p.maxStalenessMs),
      priceDecimals: n(p.priceDecimals),
      sizeDecimals: n(p.sizeDecimals),
    },
    windowStart: n(j.windowStart),
    windowEnd: n(j.windowEnd),
    samples: (j.samples as Record<string, string>[]).map((s) => ({
      t: n(s.t),
      dataT: n(s.dataT),
      bid: BigInt(s.bid!),
      ask: BigInt(s.ask!),
      bidSize: BigInt(s.bidSize!),
      askSize: BigInt(s.askSize!),
      status: n(s.status) as SampleStatus,
    })),
    validCount: n(j.validCount),
    averageMicro: BigInt(String(j.averageMicro)),
    decision: n(j.decision) as DecisionCode,
    dataSource: String(j.dataSource),
    signer: getAddress(String(j.signer)),
  };
}

// ------------------------------------------------------------------ attestation

export const attestationTypes = {
  TriggerAttestation: [
    { name: "potId", type: "uint256" },
    { name: "conditionId", type: "bytes32" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "averageMicro", type: "uint256" },
    { name: "windowStart", type: "uint64" },
    { name: "windowEnd", type: "uint64" },
  ],
} as const;

export const attestationDomain = (chainId: number, vault: Address) => ({ name: "HonorCat Trigger", version: "1", chainId, verifyingContract: getAddress(vault) }) as const;

const attestationMessage = (r: EvidenceRecord) => ({
  potId: r.potId,
  conditionId: r.conditionId,
  evidenceHash: evidenceHash(r),
  averageMicro: r.averageMicro,
  windowStart: BigInt(r.windowStart),
  windowEnd: BigInt(r.windowEnd),
});

const resolutionMessage = (r: EvidenceRecord) => ({ potId: r.potId, conditionId: r.conditionId, outcome: true });

export type SignedTrigger = { record: EvidenceRecord; attestation: Hex; resolution: Hex };

/**
 * A signer signs two things, only when its own record says "triggered": the vault result in the
 * existing EIP-712 Resolution format (outcome = true) and the TriggerAttestation over its evidence.
 */
export async function signTrigger(signer: LocalAccount, record: EvidenceRecord): Promise<SignedTrigger> {
  const d = verifyRecord(record);
  if (!d.triggered) throw new EvidenceError("this record does not trigger");
  if (getAddress(signer.address) !== record.signer) throw new EvidenceError("record belongs to another signer");
  const attestation = await signer.signTypedData({
    domain: attestationDomain(record.chainId, record.vault),
    types: attestationTypes,
    primaryType: "TriggerAttestation",
    message: attestationMessage(record),
  });
  const resolution = await signer.signTypedData({
    domain: resolutionDomain(record.chainId, record.vault),
    types: resolutionTypes,
    primaryType: "Resolution",
    message: resolutionMessage(record),
  });
  return { record, attestation, resolution };
}

export type Expected = { chainId: number; vault: Address; potId: bigint; conditionId: Hex; signers: Address[]; threshold: number };

export type Aggregate =
  | {
      ok: true;
      evidenceRoot: Hex;
      /** Accepted signers, ascending, exactly `threshold` of them. */
      signers: Address[];
      evidenceHashes: Hex[];
      /** MultisigResolver signature: `threshold` resolution signatures in ascending signer order. */
      resolverSignature: Hex;
      resolutionDigest: Hex;
      rejected: { signer: string; reason: string }[];
    }
  | { ok: false; reason: string; accepted: number; rejected: { signer: string; reason: string }[] };

/** keccak256(abi.encode(bytes32[])) of the evidence hashes in ascending signer order. */
export const evidenceRootOf = (hashesInSignerOrder: Hex[]): Hex => keccak256(encodeAbiParameters([{ type: "bytes32[]" }], [hashesInSignerOrder]));

/**
 * Checks each signer's submission independently and triggers only if at least `threshold`
 * distinct, authorised signers each have a record that passes its own rule and says
 * "triggered", with valid attestation and resolution signatures. Missing or failing signers
 * cannot be made up by others.
 */
export async function aggregate(subs: SignedTrigger[], ex: Expected): Promise<Aggregate> {
  const allowed = new Set(ex.signers.map((s) => getAddress(s)));
  const accepted = new Map<Address, { hash: Hex; resolution: Hex }>();
  const rejected: { signer: string; reason: string }[] = [];
  for (const s of subs) {
    const who = String(s.record.signer);
    try {
      const r = s.record;
      const signer = getAddress(r.signer);
      if (!allowed.has(signer)) throw new EvidenceError("not an authorised signer");
      if (accepted.has(signer)) throw new EvidenceError("duplicate signer");
      if (r.chainId !== ex.chainId || getAddress(r.vault) !== getAddress(ex.vault) || r.potId !== ex.potId || r.conditionId !== ex.conditionId) {
        throw new EvidenceError("record is for another pot");
      }
      const d = verifyRecord(r);
      if (!d.triggered) throw new EvidenceError("record does not trigger");
      const a = await recoverTypedDataAddress({
        domain: attestationDomain(r.chainId, r.vault),
        types: attestationTypes,
        primaryType: "TriggerAttestation",
        message: attestationMessage(r),
        signature: s.attestation,
      });
      if (getAddress(a) !== signer) throw new EvidenceError("attestation signature does not match");
      const v = await recoverTypedDataAddress({
        domain: resolutionDomain(r.chainId, r.vault),
        types: resolutionTypes,
        primaryType: "Resolution",
        message: resolutionMessage(r),
        signature: s.resolution,
      });
      if (getAddress(v) !== signer) throw new EvidenceError("resolution signature does not match");
      accepted.set(signer, { hash: evidenceHash(r), resolution: s.resolution });
    } catch (err) {
      rejected.push({ signer: who, reason: (err as Error).message });
    }
  }
  if (accepted.size < ex.threshold) return { ok: false, reason: `${accepted.size} of ${ex.threshold} required signers triggered`, accepted: accepted.size, rejected };
  const chosen = [...accepted.keys()].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1)).slice(0, ex.threshold);
  const hashes = chosen.map((s) => accepted.get(s)!.hash);
  return {
    ok: true,
    evidenceRoot: evidenceRootOf(hashes),
    signers: chosen,
    evidenceHashes: hashes,
    resolverSignature: concat(chosen.map((s) => accepted.get(s)!.resolution)),
    resolutionDigest: hashTypedData({
      domain: resolutionDomain(ex.chainId, ex.vault),
      types: resolutionTypes,
      primaryType: "Resolution",
      message: { potId: ex.potId, conditionId: ex.conditionId, outcome: true },
    }),
    rejected,
  };
}

export { DECISION };
