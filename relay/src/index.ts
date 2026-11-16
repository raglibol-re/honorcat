export { vaultAbi } from "./abi";
export { getConfig, type Config } from "./config";
export { publicClient, resolverAccount, arcTestnet } from "./chain";
export { getDb, getState, memoryDb, type Db } from "./db";
export { conditionIdFor, registerCondition, getCondition, type Condition } from "./conditions";
export { ManualSource } from "./sources/manual";
export { GeminiSource, parseGeminiKey, outcomeFromContract, type GeminiEvent } from "./sources/gemini";
export type { ResultSource } from "./sources/types";
export { signResolution, resolutionDomain, resolutionTypes } from "./signer";
export { ingestLogs, decodeVaultLogs, projectPot, type RawLog } from "./indexer/ingest";
export { pollLogs, blockTimeFromRpc } from "./indexer/rpcPoller";
export { verifyStreamsSignature, decodeBody, extractStreamsLogs, extractBatchRange, STREAMS_FILTER_TEMPLATE } from "./indexer/quicknode";
export { recordBatch, streamsOverview } from "./streams";
export { runTick, buildSources, type TickReport } from "./tick";
export { listPots, getPotDetail, listPayments, type PotDto, type PaymentDto } from "./api";
export { ARC_USDC, ARC_MIN_BASE_FEE, NATIVE_PER_USDC_UNIT, nativeToUsdcUnits, arcFees, usdcDomain, usdcBalances } from "./arc";
export { sendVaultTx, revertName, type TxKind } from "./txs";
export {
  prepareGasless,
  submitGaslessFund,
  submitGaslessCreate,
  fundNonce,
  createNonce,
  potParamsHash,
  authorizationTypedData,
  receiveWithAuthorizationTypes,
  GaslessError,
  type PotParams,
  type SignedAuthorization,
} from "./gasless";
export { relayStatus, potRelayCost } from "./status";
export { scopeToVault } from "./db";
export { ARC_MEMO, ARC_MULTICALL3_FROM } from "./arc";
export { memoIdFor, memoIdText, decodeMemoBody, encodeMemoBody, memoCall, type MemoBody } from "./memo";
export { sendRelayCalls, decodeRevert, multicall3FromAbi, type RelayCall } from "./txs";
export {
  TEMPLATES,
  conditionKeyFor,
  validateTerms,
  prepareGuarantee,
  createGuarantee,
  joinGuarantee,
  joinMessage,
  prepareWithdraw,
  submitWithdraw,
  listGuarantees,
  guaranteeDetail,
  accountGuarantees,
  type Template,
  type GuaranteeTerms,
  type GuaranteeDto,
  type GuaranteeDetail,
  type JoinProof,
} from "./guarantees";
export { guaranteeBookAbi, batchGuardAbi, merkleBookAbi } from "./abi";
export {
  verifyAssertion,
  executeDigest as passkeyExecuteDigest,
  registerPasskey,
  getPasskey,
  verifyPasskeyJoin,
  joinChallenge,
  preparePasskeyWithdraw,
  submitPasskeyWithdraw,
  rpIdHashOf,
  passkeyAccountAbi,
  passkeyFactoryAbi,
  type WebAuthnAssertion,
  type PasskeyRecord,
} from "./passkeys";

export {
  prepareEarly,
  createEarly,
  joinEarly,
  earlyJoinMessage,
  armedPots,
  submitEarlySignature,
  submitEarlySamples,
  processEarly,
  recordEarlyOutcome,
  listEarly,
  earlyDetail,
  earlyConditionId,
  requireEarly,
  type EarlyTerms,
  type EarlyDto,
  type ArmedPot,
  type SamplerSubmission,
} from "./early";

// Early-payout probability trigger (docs/price-and-evidence.md)
export * as trigger from "./trigger";

export { Sampler, WsBookSource, RestBookSource, fetchMarketState, httpIo, type SamplerIo, type BookSource } from "./sampler";
export { runAppSampler } from "./samplerHost";
export * as catalog from "./catalog";
export type { CatalogRow, Quality, BookStats, CategorySummary, Profile } from "./catalog";
export { readBook, depthSnapshot, DepthStream, GEMINI_REST, type RawBook, type MarketState } from "./gemini";

export * as pots from "./pots";
export { PotSampler, potsHttpIo, type PotsIo, type PotsWork } from "./potsSampler";
export { preparePasskeyPotCall, submitPasskeyPotCall, forwardPotCall, afterPotTx } from "./potsActions";
export { potsAbi } from "./potsAbi";
