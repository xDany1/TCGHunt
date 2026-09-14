import { combine, refKey, freeze, positiveInteger } from '@ptcg/core';
import type { StoreRef } from '@ptcg/core';
import { PersistenceFailure, stableKey } from '@ptcg/application';
import type { DecisionEvidence, EvidenceRepository } from '@ptcg/application';
import type { CatalogMetadata, StoreInstanceMetadata } from '@ptcg/application';
import { decode, encode } from './codec.js';
import { Database, integer, required, string } from './database.js';

export class SqliteEvidence implements EvidenceRepository {
  constructor(private readonly db: Database) { }
  recordEvaluation(e: DecisionEvidence): void {
    const encoded = encode(e);
    this.db.transaction(() => {
      const existing = this.db.get('SELECT snapshot FROM decision_evaluations WHERE id=?', e.evaluation.opportunity.id);
      if (existing) {
        if (existing['snapshot'] !== encoded) throw new PersistenceFailure('CONFLICT');
        return;
      }
      const run = required(this.db.get('SELECT * FROM monitor_runs WHERE id=?', e.command.runId));
      if (run['status'] !== 'RUNNING' || run['monitor_id'] !== e.command.monitorId || integer(run['revision']) !== e.command.revision || run['operation_id'] !== e.command.operationId) throw new PersistenceFailure('STALE_VERSION');
      const o = e.evaluation.observation;
      const ensureStore = (r: StoreRef<string>) => this.db.run('INSERT INTO store_instances VALUES(?) ON CONFLICT DO NOTHING', r.storeId);
      for (const r of [o.product.ref, o.variant.ref, o.listing.ref, o.offer.ref, o.offer.sellerRef]) ensureStore(r);
      this.db.run('INSERT INTO canonical_products VALUES(?,?) ON CONFLICT DO NOTHING', e.request.target.id, encode(e.request.target));
      if (required(this.db.get('SELECT snapshot FROM canonical_products WHERE id=?', e.request.target.id))['snapshot'] !== encode(e.request.target)) throw new PersistenceFailure('CONFLICT');
      this.db.run('INSERT INTO store_products VALUES(?,?,?) ON CONFLICT DO NOTHING', refKey(o.product.ref), o.product.ref.storeId, o.product.ref.externalId);
      this.db.run('INSERT INTO variants VALUES(?,?,?,?) ON CONFLICT DO NOTHING', refKey(o.variant.ref), o.variant.ref.storeId, o.variant.ref.externalId, refKey(o.variant.productRef));
      if (required(this.db.get('SELECT product_id FROM variants WHERE id=?', refKey(o.variant.ref)))['product_id'] !== refKey(o.variant.productRef)) throw new PersistenceFailure('CONFLICT');
      this.db.run('INSERT INTO listings VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING', refKey(o.listing.ref), o.listing.ref.storeId, o.listing.ref.externalId, refKey(o.listing.productRef), refKey(o.listing.variantRef));
      const listing = required(this.db.get('SELECT * FROM listings WHERE id=?', refKey(o.listing.ref)));
      if (listing['product_id'] !== refKey(o.listing.productRef) || listing['variant_id'] !== refKey(o.listing.variantRef)) throw new PersistenceFailure('CONFLICT');
      const sellerRefs = [o.offer.sellerRef, ...(o.seller.state === 'KNOWN' ? [o.seller.value.ref] : []), ...(o.fulfilledBy.state === 'KNOWN' ? [o.fulfilledBy.value] : [])];
      for (const r of sellerRefs) {
        ensureStore(r);
        this.db.run('INSERT INTO sellers VALUES(?,?,?) ON CONFLICT DO NOTHING', refKey(r), r.storeId, r.externalId);
      }
      this.db.run('INSERT INTO offers VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING', refKey(o.offer.ref), o.offer.ref.storeId, o.offer.ref.externalId, refKey(o.offer.listingRef), refKey(o.offer.variantRef), refKey(o.offer.sellerRef), o.offer.condition, o.offer.deliveryScope);
      const offer = required(this.db.get('SELECT * FROM offers WHERE id=?', refKey(o.offer.ref)));
      if (offer['listing_id'] !== refKey(o.offer.listingRef) || offer['variant_id'] !== refKey(o.offer.variantRef) || offer['seller_id'] !== refKey(o.offer.sellerRef) || offer['condition'] !== o.offer.condition || offer['delivery_scope'] !== o.offer.deliveryScope) throw new PersistenceFailure('CONFLICT');
      const mappingId = stableKey(e.request.mapping.canonicalId, refKey(e.request.mapping.variantRef), e.request.mapping.version);
      this.db.run('INSERT INTO product_mappings VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING', mappingId, e.request.mapping.canonicalId, refKey(e.request.mapping.variantRef), e.request.mapping.version, encode(e.request.mapping));
      if (required(this.db.get('SELECT snapshot FROM product_mappings WHERE id=?', mappingId))['snapshot'] !== encode(e.request.mapping)) throw new PersistenceFailure('CONFLICT');
      this.db.run('INSERT INTO listing_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
        o.id, refKey(o.offer.ref), o.identity.evidence.capturedAt, o.identity.evidence.receivedAt,
        o.unitPrice.state, o.unitPrice.state === 'KNOWN' ? o.unitPrice.value.minor : null, o.unitPrice.state === 'KNOWN' ? o.unitPrice.value.currency : null,
        o.shipping.state, o.shipping.state === 'KNOWN' ? o.shipping.value.minor : null, o.shipping.state === 'KNOWN' ? o.shipping.value.currency : null,
        o.stock.state === 'KNOWN' ? o.stock.value : o.stock.state, o.seller.state, encode(o));
      if (required(this.db.get('SELECT snapshot FROM listing_observations WHERE id=?', o.id))['snapshot'] !== encode(o)) throw new PersistenceFailure('CONFLICT');
      if (e.evaluation.catalog) {
        const metadata = e.evaluation.catalog;
        if (metadata.store.id !== o.offer.ref.storeId) throw new PersistenceFailure('CONFLICT');
        this.db.run('INSERT INTO store_metadata VALUES(?,?) ON CONFLICT DO NOTHING', metadata.store.id, encode(metadata.store));
        const old = decode<StoreInstanceMetadata>(required(this.db.get('SELECT snapshot FROM store_metadata WHERE store_id=?', metadata.store.id))['snapshot']);
        if (old.canonicalDomain !== metadata.store.canonicalDomain || old.accessPolicyRef !== metadata.store.accessPolicyRef || old.family !== metadata.store.family) throw new PersistenceFailure('CONFLICT');
        this.db.run('INSERT INTO observation_metadata VALUES(?,?) ON CONFLICT DO NOTHING', o.id, encode(metadata));
        if (required(this.db.get('SELECT snapshot FROM observation_metadata WHERE observation_id=?', o.id))['snapshot'] !== encode(metadata)) throw new PersistenceFailure('CONFLICT');
      }
      this.db.run('INSERT INTO observation_run_links VALUES(?,?)', o.id, e.command.runId);
      const result = combine(e.evaluation.simulation.checks);
      this.db.run('INSERT INTO decision_evaluations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', e.evaluation.opportunity.id, o.id, e.command.runId, e.request.target.id, mappingId,
        e.evaluation.opportunity.calculationVersion, result === 'PASS' ? 'ELIGIBLE' : result === 'FAIL' ? 'INELIGIBLE' : 'INDETERMINATE', e.evaluation.opportunity.status,
        e.evaluation.seller.result, e.evaluation.seller.policyVersion, e.evaluation.rules.policyVersion, e.command.now, encoded);
      if (this.db.run("UPDATE monitor_runs SET status='SUCCEEDED',version=version+1,finished_at=? WHERE id=? AND version=? AND status='RUNNING'", e.command.now, e.command.runId, integer(run['version'])) !== 1) throw new PersistenceFailure('STALE_VERSION');
    });
  }
  getEvaluation(evaluationId: string): DecisionEvidence {
    return decode<DecisionEvidence>(string(required(this.db.get('SELECT snapshot FROM decision_evaluations WHERE id=?', evaluationId))['snapshot']));
  }
  getStoreMetadata(storeId: import('@ptcg/core').Id<'store'>): StoreInstanceMetadata | null {
    const row = this.db.get('SELECT snapshot FROM store_metadata WHERE store_id=?', storeId);
    return row ? decode<StoreInstanceMetadata>(row['snapshot']) : null;
  }
  getObservationHistory(offer: StoreRef<'offer'>, limit = 50) {
    positiveInteger(limit);
    if (limit > 100) throw new PersistenceFailure('INVALID_INPUT');
    return freeze(this.db.all('SELECT o.snapshot,m.snapshot AS metadata FROM listing_observations o LEFT JOIN observation_metadata m ON o.id=m.observation_id WHERE o.offer_id=? ORDER BY o.captured_at DESC,o.id DESC LIMIT ?', refKey(offer), limit).map(row => ({
      observation: decode<import('@ptcg/core').ListingObservation>(row['snapshot']), catalog: row['metadata'] === null ? null : decode<CatalogMetadata>(row['metadata'])
    })));
  }
}
