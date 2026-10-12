import assert from 'node:assert/strict'
import { test } from 'vitest'
import { readFileSync } from 'node:fs'
import { houseBridge } from '@agentshouse/app-bridge'
import { createHouseBridgeTestHost } from '@agentshouse/app-bridge/test-host'
import { houseRuntime, type HouseRuntime } from '../src/house'

test('the official bridge supplies the exact client, reuses one connection, and retries failures', async () => {
  const held = globalThis as typeof globalThis & { houseBridge?: unknown }
  const previousBridge = Object.getOwnPropertyDescriptor(held, 'houseBridge')
  try {
    delete held.houseBridge
    await assert.rejects(houseRuntime(), TypeError)

    createHouseBridgeTestHost()
    Object.defineProperty(houseBridge(), 'runtime', { value: Promise.reject(new Error('Host runtime unavailable')) })
    await assert.rejects(houseRuntime(), /Host runtime unavailable/)

    const host = createHouseBridgeTestHost({ address: '/app/a_e.n' })
    assert.equal(Object.hasOwn(held, 'houseRuntime'), false, 'The host injects only the bridge')
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
  }
})

test('production uses the licensed bridge without a direct Runtime import or dependency', () => {
  const source = readFileSync('src/house.ts', 'utf8')
  assert.doesNotMatch(source, /@agentshouse\/mdruntime|connectMdRuntime|RuntimePort/)
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(pkg.dependencies['@agentshouse/app-bridge'], '0.1.0-ca4ec913df08d')
  assert.equal(pkg.dependencies['@agentshouse/mdruntime'], undefined)
  const bridge = JSON.parse(readFileSync('node_modules/@agentshouse/app-bridge/package.json', 'utf8'))
  assert.equal(bridge.license, 'MIT')
  assert.match(readFileSync('node_modules/@agentshouse/app-bridge/LICENSE', 'utf8'), /Permission is hereby granted/)
})
