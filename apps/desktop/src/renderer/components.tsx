import type { FieldView, ObservationView, MonitoringAlertView } from '@ptcg/contracts';
import type { ReactNode } from 'react';

export const words = (value: string): string => value.replaceAll('_', ' ');
export const time = (value: number | null): string => value === null ? 'Not yet observed' : new Date(value).toLocaleString();
export const atDisplayTime = (value: ObservationView, now: number): ObservationView => ({ ...value, stale: now < value.sourceObservedAt || now >= value.expiresAt || now - value.sourceObservedAt > 60000 });
export function Chip({ value }: { readonly value: string; }) { return <span className={`chip ${['APPROVED', 'HEALTHY', 'ACTIVE', 'RUNNING'].includes(value) ? 'good' : ''}`}>{words(value)}</span>; }
export function Field({ field }: { readonly field: FieldView; }) { return <span title={field.reason ?? undefined} className={field.state === 'KNOWN' ? '' : 'unknown'}>{field.state === 'KNOWN' ? field.value : words(field.state)}{field.reason && <small>{words(field.reason)}</small>}</span>; }
export function Empty({ children }: { readonly children: ReactNode; }) { return <div className="empty">{children}</div>; }
export function Section({ title, children }: { readonly title: string; readonly children: ReactNode; }) { return <section className="panel"><h2>{title}</h2>{children}</section>; }
export function MonitoringAlerts({ alerts }: { readonly alerts: readonly MonitoringAlertView[]; }) {
  return <Section title="Monitoring alerts"><p>Historical stock events are separate from current monitoring state and purchase readiness. Delivery means saved to the local inbox, not read or acknowledged.</p>
    {!alerts.length ? <Empty>No qualified transitions yet. First observations establish baselines.</Empty> : alerts.map(a => <article className="observation" key={a.eventId}>
      <div className="row"><h3>{words(a.eventType)}</h3><Chip value={a.delivery} /></div>
      <strong>{a.title}</strong><p>{a.productId} · {a.storeId} · {a.provider}</p>
      <p>{a.previousState} → {a.currentState} · {a.purchaseMode} · Release: {a.releaseDate ?? 'UNKNOWN'}</p>
      <p>Observed: {time(a.observedAt)} · {a.stale ? 'Historical evidence — stale' : 'Fresh event evidence'}</p>
      <p>Opportunity: {a.opportunityStatus} / {a.arithmetic}</p><ul>{a.reasons.map(reason => <li key={reason}>{words(reason)}</li>)}</ul>
      <p>Purchase readiness: Not established · Execution: Not requested · DRY RUN</p>
      <details><summary>Event provenance</summary><p className="ids">{a.eventId}</p><p>Monitor: {a.monitorId} · {a.provenance}</p></details>
    </article>)}
  </Section>;
}
export function Observation({ value, open }: { readonly value: ObservationView; readonly open: (id: string) => void; }) {
  return <article className="observation"><div className="row"><h3>{value.title}</h3><Chip value={value.stale ? 'STALE' : 'OBSERVED'} /></div>
    <p>{value.variant} · SKU {value.sku ?? 'Unknown'} · <span className="muted">{value.basis}</span></p>
    <dl className="facts"><dt>Observed price</dt><dd><Field field={value.price} /></dd><dt>Stock / quantity</dt><dd><Field field={value.stock} /> / <Field field={value.quantity} /></dd>
      <dt>Sale availability</dt><dd>{value.saleAvailable === null ? 'Unknown' : value.saleAvailable ? 'Available for sale; quantity is separate' : 'Unavailable for sale'}</dd>
      <dt>Shipping</dt><dd><Field field={value.shipping} /></dd><dt>Tax</dt><dd><Field field={value.tax} /></dd><dt>Merchant evidence</dt><dd><Field field={value.seller} /></dd>
      <dt>Captured / received</dt><dd>{time(value.capturedAt)} / {time(value.receivedAt)}</dd><dt>Source observation / expires</dt><dd>{time(value.sourceObservedAt)} / {time(value.expiresAt)}</dd></dl>
    {value.source && <button onClick={() => open(value.offerId)}>Open approved product externally ↗</button>}
    <details><summary>Identity and evidence diagnostics</summary><dl className="facts ids">{Object.entries({ StoreInstance: value.storeId, StoreProduct: value.productId, Variant: value.variantId, Listing: value.listingId, Offer: value.offerId, Seller: value.sellerId, Observation: value.id, Source: value.source, Adapter: value.adapterVersion, Parser: value.parserVersion }).map(([key, v]) => <div key={key}><dt>{key}</dt><dd>{v ?? 'Unknown'}</dd></div>)}</dl></details>
  </article>;
}
