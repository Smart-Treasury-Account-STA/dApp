import { describe, expect, it } from 'vitest'

import { validationFailure } from './simulationResult'

describe('validationFailure', () => {
  it('returns null when the draft is valid, so the caller proceeds', () => {
    expect(validationFailure(() => {})).toBeNull()
  })

  it("surfaces the validator's own message verbatim", () => {
    // Client-side validators exist precisely to say what is wrong. Routing
    // their message through the network-error classifier replaces it with a
    // generic "could not be completed", which tells the operator nothing.
    const result = validationFailure(() => {
      throw new Error('End ledger must be greater than start ledger.')
    })

    expect(result?.ok).toBe(false)
    expect(result?.detail).toBe('End ledger must be greater than start ledger.')
    expect(result?.detail).not.toMatch(/network or client fault/i)
  })

  it('handles a thrown non-Error without losing the value', () => {
    const result = validationFailure(() => {
      throw 'intent id is malformed'
    })

    expect(result?.detail).toBe('intent id is malformed')
  })
})
