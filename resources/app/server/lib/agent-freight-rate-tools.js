'use strict';
const { object, string, array } = require('./agent-capability-contract');
const { error } = require('./agent-office-store');
const artifacts = require('./agent-artifact-store');
const positive = maximum => ({ type: 'number', minimum: 0.000000001, maximum });
const rate = { ...object({ id: string(40), mode: { enum: ['air', 'seaAir'] }, label: { ...string(80), minLength: 1 }, rate: positive(1000) }), required: ['id', 'mode', 'label', 'rate'] };
const freight = { ...object({ rates: { ...array(rate, 20), minItems: 1 }, volumetricFactor: positive(1000), landedMultiplier: positive(10),
  carton: { ...object({ cartonL: positive(1000), cartonH: positive(1000), cartonW: positive(1000) }), required: ['cartonL', 'cartonH', 'cartonW'] } }), required: ['rates', 'volumetricFactor', 'landedMultiplier', 'carton'] };
const publicFreight={...freight,properties:{...freight.properties,rates:array({...rate,properties:{...rate.properties,rate:{type:'number'}}},20),volumetricFactor:{type:'number'},landedMultiplier:{type:'number'},carton:object({cartonL:{type:'number'},cartonH:{type:'number'},cartonW:{type:'number'}})}};
const count = { type: 'integer', minimum: 0 }, fingerprint = { ...string(64), pattern: '^[a-f0-9]{64}$' };
function registerFreightRateTools(registry, deps) {
  const base = { module: 'shipping', areas: [], anyAreas: ['shipping', 'source'], agentAreas: [], agentAnyAreas: ['shipping', 'source'],
    dataScope: 'native shared freight settings; calculation impact uses only the current owner Shipping store' };
  registry.registerCapability({ ...base, id: 'shipping.freight.settings.read', operation: 'READ', risk: 'read',
    label: { tr: 'Ortak navlun ayarlarını oku', en: 'Read shared freight settings' }, inputSchema: object({}),
    outputSchema: { ...object({ verified: { enum: [true] }, data: object({ freight:publicFreight, revision: count }) }), required: ['verified', 'data'] },
    read: (_args, ctx) => deps.service.snapshot(ctx) });
  const mutate = (ctx, work) => { if (!deps.withAgentMutation) throw error('OFFICE_APPROVAL_REQUIRED', 403); return deps.withAgentMutation(ctx, work); };
  registry.registerCapability({ ...base, areas: ['shipping'], anyAreas: undefined, agentAreas: ['shipping'], agentAnyAreas: undefined,
    id: 'shipping.freight.settings.update', operation: 'UPDATE', risk: 'write', permissions: ['manageBusinessRules'],
    label: { tr: 'Navlun ayarlarını etki analiziyle revize et', en: 'Revise freight settings with impact analysis' },
    inputSchema: { ...object({ freight }), required: ['freight'] },
    outputSchema: { ...object({ verified: { enum: [true] }, data: object({ revision: count, routes: count, shared: { enum: [true] } }),
      rollbackToken: { ...object({ artifactId: { ...string(32), pattern: '^[a-f0-9]{32}$' }, expected: { ...object({ revision: count, fingerprint }), required: ['revision', 'fingerprint'] } }), required: ['artifactId', 'expected'] } }), required: ['verified', 'data', 'rollbackToken'] },
    read: (args, ctx) => deps.service.preview(args.freight, ctx),
    apply: async (args, ctx, preview) => {
      const backup = await artifacts.put(ctx.profile, Buffer.from(JSON.stringify(preview.freight)), 'freight-settings-backup.json', 'freight-settings-backup');
      await deps.beforeBackup?.(ctx);
      return mutate(ctx, async () => {
        const receipt = await deps.service.replace(args.freight, preview, ctx);
        await deps.changed?.(ctx.profile, receipt);
        return { verified: true, data: { revision: receipt.revision, routes: receipt.freight.rates.length, shared: true },
          rollbackToken: { artifactId: backup.id, expected: { revision: receipt.revision, fingerprint: receipt.fingerprint } } };
      });
    },
    restore: (token, ctx) => mutate(ctx, async () => {
      const { buffer } = artifacts.read(ctx.profile, token.artifactId, 'freight-settings-backup');
      const receipt = await deps.service.restore(JSON.parse(buffer), token.expected, ctx);
      await deps.changed?.(ctx.profile, receipt);
      return { verified: true, revision: receipt.revision };
    }) });
}
module.exports = { registerFreightRateTools };
