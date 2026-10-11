import assert from 'node:assert/strict'
import { test } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHouseBridgeTestHost } from '@agentshouse/app-bridge/test-host'
import { houseRuntime, type HouseRuntime } from '../src/house'

test('the official bridge supplies the exact client, reuses one connection, and retries failures', async () => {
  const held = globalThis as typeof globalThis & { houseBridge?: unknown; houseRuntime?: unknown }
  const previousBridge = Object.getOwnPropertyDescriptor(held, 'houseBridge')
  const previousRuntime = Object.getOwnPropertyDescriptor(held, 'houseRuntime')
  try {
    delete held.houseBridge
    delete held.houseRuntime
    await assert.rejects(houseRuntime(), /house_bridge_absent/)

    const rejectedHost = createHouseBridgeTestHost()
    held.houseBridge = rejectedHost.port
    held.houseRuntime = Promise.reject(new Error('Host runtime unavailable'))
    await assert.rejects(houseRuntime(), /Host runtime unavailable/)

    const host = createHouseBridgeTestHost({ address: '/app/a_e.n' })
    held.houseBridge = host.port
    held.houseRuntime = host.runtime
    const client = {} as HouseRuntime
    const first = houseRuntime()
    assert.equal(first, houseRuntime(), 'Reuse a pending connection')
    let resolved = false
    void first.then(() => { resolved = true })
    await Promise.resolve()
    assert.equal(resolved, false, 'Wait for the host client instead of constructing one')
    host.attachRuntime(client)
    assert.equal(await first, client, 'Preserve the exact host-provided client')
    assert.equal(await houseRuntime(), client, 'Reuse the connected client')
    assert.deepEqual(host.tabs, [{ title: 'Retro Board' }])
  } finally {
    if (previousBridge) Object.defineProperty(held, 'houseBridge', previousBridge)
    else delete held.houseBridge
    if (previousRuntime) Object.defineProperty(held, 'houseRuntime', previousRuntime)
    else delete held.houseRuntime
  }
})

test('production uses the licensed bridge without a direct Runtime import or dependency', () => {
  const source = readFileSync('src/house.ts', 'utf8')
  assert.doesNotMatch(source, /@agentshouse\/mdruntime|connectMdRuntime|RuntimePort/)
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(pkg.dependencies['@agentshouse/app-bridge'], '0.1.0-ce524f6608238')
  assert.equal(pkg.dependencies['@agentshouse/mdruntime'], undefined)
  const bridge = JSON.parse(readFileSync('node_modules/@agentshouse/app-bridge/package.json', 'utf8'))
  assert.equal(bridge.license, 'MIT')
  assert.match(readFileSync('node_modules/@agentshouse/app-bridge/LICENSE', 'utf8'), /Permission is hereby granted/)
})
