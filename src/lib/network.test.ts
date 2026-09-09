import { Networks } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'

import { describeNetwork } from './network'

describe('describeNetwork', () => {
  it("names the SDK's public network mainnet", () => {
    const network = describeNetwork(Networks.PUBLIC)
    expect(network.id).toBe('mainnet')
    expect(network.name).toBe('mainnet')
    expect(network.label).toBe('Stellar mainnet')
  })

  it("names the SDK's test network testnet", () => {
    expect(describeNetwork(Networks.TESTNET).id).toBe('testnet')
  })

  it("names the SDK's future network futurenet", () => {
    expect(describeNetwork(Networks.FUTURENET).id).toBe('futurenet')
  })

  it('tolerates surrounding whitespace, which env files pick up easily', () => {
    expect(describeNetwork(`  ${Networks.PUBLIC}\n`).id).toBe('mainnet')
  })

  it('describes a local network as custom instead of throwing', () => {
    const network = describeNetwork(Networks.STANDALONE)
    expect(network.id).toBe('custom')
    expect(network.label).toBe('a custom Stellar network')
  })

  it('does not mistake a near-miss passphrase for a known network', () => {
    expect(
      describeNetwork('Public Global Stellar Network ; September 2016').id
    ).toBe('custom')
  })
})
