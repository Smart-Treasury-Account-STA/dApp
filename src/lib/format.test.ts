import { describe, expect, it } from 'vitest'

import {
  describeSimulationFailure,
  explainContractError,
  explainSmartAccountError,
} from './format'

describe('describeSimulationFailure', () => {
  it('attributes a contract error code to the contract, with its meaning', () => {
    const result = describeSimulationFailure(
      'HostError: Error(Contract, #2006)\n  0: [Diagnostic Event] ...'
    )

    expect(result.rejectedByContract).toBe(true)
    expect(result.detail).toMatch(/Policy version changed/)
  })

  it('still attributes an unmapped contract code to the contract', () => {
    const result = describeSimulationFailure(
      'HostError: Error(Contract, #9999)'
    )

    expect(result.rejectedByContract).toBe(true)
    expect(result.detail).toMatch(/#9999/)
  })

  it('does not blame the contract for a malformed-argument host error', () => {
    const result = describeSimulationFailure(
      'HostError: Error(Object, InvalidInput)\n  data:"ScMap was not sorted by key for conversion to host object"'
    )

    expect(result.rejectedByContract).toBe(false)
    // Must not read as an enforcement decision the way the old copy did
    // ("The testnet policy engine rejected this payment").
    expect(result.detail).not.toMatch(
      /policy engine rejected|rejected this payment/i
    )
    expect(result.detail).toMatch(/could not be encoded/i)
    expect(result.detail).toMatch(/client-side fault/i)
  })

  it('does not blame the contract for a client-side response parse failure', () => {
    const result = describeSimulationFailure('Bad union switch: 1')

    expect(result.rejectedByContract).toBe(false)
    expect(result.detail).toMatch(/could not read|response/i)
  })

  it('classifies a missing-authorization error as authorization, not a client fault', () => {
    // Simulating execute_transfer_payment without the SmartAccount custom auth
    // entries is expected to fail this way during preflight. It is neither a
    // policy rejection nor a bug.
    const result = describeSimulationFailure(
      'HostError: Error(Auth, InvalidAction)'
    )

    expect(result.kind).toBe('authorization')
    expect(result.rejectedByContract).toBe(false)
    expect(result.detail).toMatch(/authoriz/i)
  })

  it('labels an encoding fault distinctly from an authorization one', () => {
    expect(
      describeSimulationFailure('HostError: Error(Object, InvalidInput)').kind
    ).toBe('encoding')
  })

  it('reports an archived-state hint when the response cannot be parsed', () => {
    const result = describeSimulationFailure('Bad union switch: 1')

    expect(result.detail).toMatch(/archiv/i)
  })
})

describe('explainContractError — Stellar Asset Contract codes', () => {
  // These four were reproduced against the live testnet SAC. The token raises
  // them from a range no contract in this project uses, and before they were
  // mapped an operator saw only "Contract rejected with code #11", which says
  // nothing about what to do.
  it('explains a deauthorized trustline (#11) rather than echoing the number', () => {
    const result = explainContractError('HostError: Error(Contract, #11)')

    expect(result).toMatch(/trustline/i)
    expect(result).toMatch(/not authorized/i)
    expect(result).not.toMatch(/code #11/)
  })

  it('explains an insufficient balance (#10)', () => {
    expect(explainContractError('HostError: Error(Contract, #10)')).toMatch(
      /balance/i
    )
  })

  it('explains a missing trustline (#13)', () => {
    expect(explainContractError('HostError: Error(Contract, #13)')).toMatch(
      /no trustline/i
    )
  })

  it('explains a negative amount (#8)', () => {
    expect(explainContractError('HostError: Error(Contract, #8)')).toMatch(
      /positive/i
    )
  })

  it('still falls back to the raw code for an asset error that was not verified', () => {
    // Guessing at an unreproduced code risks showing a confidently wrong
    // explanation, which is worse than showing the number.
    expect(explainContractError('HostError: Error(Contract, #9)')).toBe(
      'Contract rejected with code #9.'
    )
  })
})

describe('explainSmartAccountError', () => {
  it("resolves #3007 to smart_account's own DuplicateSigner meaning, not intent_registry's collision at the same code", () => {
    // intent_registry's IntentRegistryError also defines #3007 ("execution
    // window is not open yet") -- explainContractError's map (scoped to
    // payment/schedule flows) uses that meaning. This is a *different*
    // function specifically so a signer-management error never picks up
    // the wrong contract's explanation for the same numeric code.
    const message =
      'HostError: Error(Contract, #3007)\n  ...data:[1, [Delegated, GB2K...]]'

    expect(explainSmartAccountError(message)).toMatch(/already a signer/i)
  })

  it('falls back to a generic message for a mapped-range code without specific copy', () => {
    expect(explainSmartAccountError('HostError: Error(Contract, #3001)')).toBe(
      'Contract rejected with code #3001.'
    )
  })

  it('returns null for a message with no contract error code', () => {
    expect(explainSmartAccountError('Connect a wallet first.')).toBeNull()
  })
})
