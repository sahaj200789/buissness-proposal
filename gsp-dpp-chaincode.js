/**
 * Green Steel Passport — DPP Smart Contract
 * Hyperledger Fabric chaincode (Node.js contract API)
 *
 * Implements Section 3.1 of the solution report:
 *   - On-chain store: Heat ID, DPP events, content hashes of off-chain
 *     evidence, model version, access policies, ZK proof reference.
 *   - Smart contracts enforce who may write a DPP event (only known,
 *     enrolled mill organizations — never an anonymous public write).
 *   - Off-chain evidence (images, furnace logs, certificates, lab
 *     reports) is never stored here — only its SHA-256 content hash.
 *
 * Deploy on a Fabric test network (e.g. test-network in
 * fabric-samples) as the "gsp-dpp" chaincode on a channel whose
 * members are the participating mills, an auditor org, and (optionally)
 * a regulator org — matching the permissioned model in the report.
 *
 * npm deps: fabric-contract-api, fabric-shim
 */

'use strict';

const { Contract } = require('fabric-contract-api');

// Org MSP IDs allowed to write a new DPP event. In a real deployment
// this list would be maintained via a channel config / endorsement
// policy rather than hardcoded — this constant documents the same
// intent for demo/reference purposes.
const AUTHORIZED_MILL_MSPS = ['MillAMSP', 'MillBMSP'];

class GreenSteelPassportContract extends Contract {

  /**
   * Idempotent ledger bootstrap. Called once after chaincode install.
   */
  async InitLedger(ctx) {
    return;
  }

  /**
   * CreateDPPEvent — the only way a new per-heat record enters the
   * ledger. Mirrors "smart contracts enforce who may write a DPP
   * event" from the report: a mill cannot unilaterally rewrite its
   * own carbon history, and only enrolled mill identities may write
   * at all.
   *
   * @param {Context} ctx
   * @param {string} heatId
   * @param {string} steelGrade        CV-derived scrap grade classification
   * @param {string} evidenceHash      SHA-256 hex digest of the off-chain
   *                                   evidence bundle (images, furnace
   *                                   logs, certs, lab reports) — the
   *                                   evidence itself is never written here
   * @param {string} modelVersion      version string of the CV + regression
   *                                   pipeline that produced this record
   * @param {string} accessPolicyJSON  JSON string: which orgs may read
   *                                   which fields (off-chain retrieval
   *                                   policy)
   */
  async CreateDPPEvent(ctx, heatId, steelGrade, evidenceHash, modelVersion, accessPolicyJSON) {
    const mspId = ctx.clientIdentity.getMSPID();
    if (!AUTHORIZED_MILL_MSPS.includes(mspId)) {
      throw new Error(
        `Identity from org ${mspId} is not authorized to write a DPP event. ` +
        `Only enrolled mill organizations may create heat records.`
      );
    }

    const exists = await this._exists(ctx, heatId);
    if (exists) {
      // Immutability: a heat's record cannot be overwritten once
      // written — a mill "cannot unilaterally rewrite its own history".
      throw new Error(`DPP event for Heat ID ${heatId} already exists and cannot be overwritten.`);
    }

    const txTimestamp = ctx.stub.getTxTimestamp();
    const record = {
      docType: 'dppEvent',
      heatId,
      steelGrade,
      evidenceHash,
      modelVersion,
      accessPolicy: JSON.parse(accessPolicyJSON || '{}'),
      writerMSP: mspId,
      txId: ctx.stub.getTxID(),
      timestamp: new Date(txTimestamp.seconds.low * 1000).toISOString(),
      // populated later by SubmitVerification once a ZK claim has
      // been proven against this record off-chain
      verifications: [],
    };

    await ctx.stub.putState(heatId, Buffer.from(JSON.stringify(record)));

    ctx.stub.setEvent('DPPEventCreated', Buffer.from(JSON.stringify({ heatId, writerMSP: mspId })));

    return JSON.stringify(record);
  }

  /**
   * SubmitVerification — attaches the result of an off-chain ZK proof
   * (e.g. "carbon intensity below threshold X") to a heat's record,
   * without ever storing the underlying carbon-intensity value or
   * process data on-chain. Any enrolled org may submit a verification
   * (auditors and regulators, not just mills), since verifying a claim
   * is not the same privileged action as writing the original record.
   *
   * @param {string} heatId
   * @param {string} claim        human-readable claim text, e.g. "carbon_intensity <= 310"
   * @param {boolean} verified    the boolean result of the off-chain ZK proof check
   * @param {string} proofRef     pointer/identifier for the off-chain proof artifact
   */
  async SubmitVerification(ctx, heatId, claim, verified, proofRef) {
    const record = await this._getRecord(ctx, heatId);
    record.verifications.push({
      claim,
      verified: verified === 'true' || verified === true,
      proofRef,
      verifierMSP: ctx.clientIdentity.getMSPID(),
      txId: ctx.stub.getTxID(),
    });
    await ctx.stub.putState(heatId, Buffer.from(JSON.stringify(record)));
    return JSON.stringify(record);
  }

  /**
   * ReadDPPEvent — public read path. Anyone on the channel (including
   * a read-only auditor/regulator org) can look up a heat's on-chain
   * record: Heat ID, grade, evidence hash, model version, and any
   * attached verifications. Off-chain evidence retrieval is handled
   * outside the chaincode, gated by accessPolicy.
   */
  async ReadDPPEvent(ctx, heatId) {
    const record = await this._getRecord(ctx, heatId);
    return JSON.stringify(record);
  }

  /**
   * VerifyEvidenceIntegrity — recomputes nothing on-chain (hashing
   * happens off-chain against the retrieved evidence bundle); this
   * simply returns the stored hash so a client can compare it against
   * a freshly computed SHA-256 of whatever evidence bundle it retrieved
   * from off-chain storage. A mismatch means the off-chain data has
   * been altered since the DPP event was written.
   */
  async GetEvidenceHash(ctx, heatId) {
    const record = await this._getRecord(ctx, heatId);
    return record.evidenceHash;
  }

  async _exists(ctx, heatId) {
    const data = await ctx.stub.getState(heatId);
    return !!data && data.length > 0;
  }

  async _getRecord(ctx, heatId) {
    const data = await ctx.stub.getState(heatId);
    if (!data || data.length === 0) {
      throw new Error(`No DPP event found for Heat ID ${heatId}`);
    }
    return JSON.parse(data.toString());
  }
}

module.exports.contracts = [GreenSteelPassportContract];
