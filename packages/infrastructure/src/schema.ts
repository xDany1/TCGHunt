/** Version 1: only local, simulated M2 data. No live ledger or order table. */
export const SCHEMA_VERSION = 4;
export const schema = `
CREATE TABLE database_metadata (id INTEGER PRIMARY KEY CHECK(id=1), data_kind TEXT NOT NULL CHECK(data_kind='M2_SIMULATION'), recovery_required INTEGER NOT NULL CHECK(recovery_required IN (0,1))) STRICT;
INSERT INTO database_metadata VALUES(1,'M2_SIMULATION',0);
CREATE TABLE store_instances (id TEXT PRIMARY KEY) STRICT;
CREATE TABLE canonical_products (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL CHECK(json_valid(snapshot) AND length(snapshot)<=262144)) STRICT;
CREATE TABLE store_products (id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES store_instances(id), external_id TEXT NOT NULL, UNIQUE(store_id,external_id)) STRICT;
CREATE TABLE variants (id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES store_instances(id), external_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES store_products(id), UNIQUE(store_id,external_id)) STRICT;
CREATE TABLE listings (id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES store_instances(id), external_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES store_products(id), variant_id TEXT NOT NULL REFERENCES variants(id), UNIQUE(store_id,external_id)) STRICT;
CREATE TABLE sellers (id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES store_instances(id), external_id TEXT NOT NULL, UNIQUE(store_id,external_id)) STRICT;
CREATE TABLE offers (id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES store_instances(id), external_id TEXT NOT NULL, listing_id TEXT NOT NULL REFERENCES listings(id), variant_id TEXT NOT NULL REFERENCES variants(id), seller_id TEXT NOT NULL REFERENCES sellers(id), condition TEXT NOT NULL CHECK(condition='NEW_SEALED'), delivery_scope TEXT NOT NULL, UNIQUE(store_id,external_id)) STRICT;
CREATE TABLE product_mappings (id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL REFERENCES canonical_products(id), variant_id TEXT NOT NULL REFERENCES variants(id), version TEXT NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), UNIQUE(canonical_id,variant_id,version)) STRICT;

CREATE TABLE monitors (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, current_revision INTEGER NOT NULL CHECK(current_revision>0), version INTEGER NOT NULL CHECK(version>0), status TEXT NOT NULL CHECK(status IN ('ACTIVE','PAUSED','ARCHIVED'))) STRICT;
CREATE TABLE monitor_revisions (monitor_id TEXT NOT NULL REFERENCES monitors(id), revision INTEGER NOT NULL CHECK(revision>0), definition TEXT NOT NULL CHECK(json_valid(definition) AND length(definition)<=262144), recorded_at INTEGER NOT NULL, PRIMARY KEY(monitor_id,revision)) STRICT;
CREATE TABLE monitor_runs (id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, revision INTEGER NOT NULL, operation_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED')), version INTEGER NOT NULL CHECK(version>0), command TEXT NOT NULL CHECK(json_valid(command)), reason TEXT, finished_at INTEGER, FOREIGN KEY(monitor_id,revision) REFERENCES monitor_revisions(monitor_id,revision)) STRICT;
CREATE UNIQUE INDEX one_running_revision ON monitor_runs(monitor_id,revision) WHERE status='RUNNING';
CREATE INDEX runs_by_monitor ON monitor_runs(monitor_id,revision);
CREATE TABLE monitor_audit (id INTEGER PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id), action TEXT NOT NULL, version INTEGER NOT NULL, occurred_at INTEGER NOT NULL, run_id TEXT REFERENCES monitor_runs(id)) STRICT;

CREATE TABLE listing_observations (
 id TEXT PRIMARY KEY, offer_id TEXT NOT NULL REFERENCES offers(id), captured_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
 price_state TEXT NOT NULL CHECK(price_state IN ('KNOWN','UNKNOWN','NOT_APPLICABLE')), price_minor INTEGER, price_currency TEXT,
 shipping_state TEXT NOT NULL CHECK(shipping_state IN ('KNOWN','UNKNOWN','NOT_APPLICABLE')), shipping_minor INTEGER, shipping_currency TEXT,
 stock_state TEXT NOT NULL, seller_state TEXT NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot) AND length(snapshot)<=262144),
 CHECK((price_state='KNOWN' AND price_minor IS NOT NULL AND price_currency IN ('MXN','USD')) OR (price_state!='KNOWN' AND price_minor IS NULL AND price_currency IS NULL)),
 CHECK((shipping_state='KNOWN' AND shipping_minor IS NOT NULL AND shipping_currency IN ('MXN','USD')) OR (shipping_state!='KNOWN' AND shipping_minor IS NULL AND shipping_currency IS NULL))
) STRICT;
CREATE INDEX observations_by_offer ON listing_observations(offer_id,captured_at);
CREATE TABLE observation_run_links (observation_id TEXT NOT NULL REFERENCES listing_observations(id), run_id TEXT NOT NULL REFERENCES monitor_runs(id), PRIMARY KEY(observation_id,run_id)) STRICT;
CREATE TABLE decision_evaluations (
 id TEXT PRIMARY KEY, observation_id TEXT NOT NULL REFERENCES listing_observations(id), run_id TEXT NOT NULL REFERENCES monitor_runs(id), canonical_id TEXT NOT NULL REFERENCES canonical_products(id), mapping_id TEXT NOT NULL REFERENCES product_mappings(id),
 calculation_version TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('ELIGIBLE','INELIGIBLE','INDETERMINATE')), arithmetic_status TEXT NOT NULL CHECK(arithmetic_status IN ('COMPLETE','INDETERMINATE')),
 seller_result TEXT NOT NULL CHECK(seller_result IN ('APPROVED','REJECTED','REVIEW_REQUIRED')), seller_policy_version TEXT NOT NULL, purchase_policy_version TEXT NOT NULL,
 evaluated_at INTEGER NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot) AND length(snapshot)<=262144)
) STRICT;

CREATE TABLE simulated_owners (owner_id TEXT PRIMARY KEY, current_version INTEGER NOT NULL CHECK(current_version>0), currency TEXT NOT NULL CHECK(currency IN ('MXN','USD')), timezone TEXT NOT NULL CHECK(timezone='UTC'), last_admitted_at INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TABLE simulated_limit_policies (owner_id TEXT NOT NULL REFERENCES simulated_owners(owner_id), version INTEGER NOT NULL CHECK(version>0), snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), recorded_at INTEGER NOT NULL, PRIMARY KEY(owner_id,version)) STRICT;
CREATE TABLE simulated_policy_audit (owner_id TEXT NOT NULL, version INTEGER NOT NULL, occurred_at INTEGER NOT NULL, action TEXT NOT NULL CHECK(action='SIMULATED_LIMIT_POLICY_CHANGED'), PRIMARY KEY(owner_id,version), FOREIGN KEY(owner_id,version) REFERENCES simulated_limit_policies(owner_id,version)) STRICT;
CREATE TABLE purchase_intents (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES simulated_owners(owner_id), cycle_id TEXT NOT NULL, campaign_id TEXT NOT NULL, canonical_id TEXT NOT NULL REFERENCES canonical_products(id), evaluation_id TEXT NOT NULL REFERENCES decision_evaluations(id),
 mode TEXT NOT NULL CHECK(mode='DRY_RUN'), state TEXT NOT NULL CHECK(state IN ('CREATED','VALIDATING','READY','IN_PROGRESS','SIMULATED','BLOCKED')), version INTEGER NOT NULL CHECK(version>=0),
 limit_version INTEGER NOT NULL, scope TEXT NOT NULL CHECK(json_valid(scope)), result TEXT CHECK(json_valid(result)),
 UNIQUE(owner_id,cycle_id), FOREIGN KEY(owner_id,limit_version) REFERENCES simulated_limit_policies(owner_id,version)
) STRICT;
CREATE TRIGGER immutable_intent_scope BEFORE UPDATE OF id,owner_id,cycle_id,campaign_id,canonical_id,evaluation_id,mode,limit_version,scope ON purchase_intents BEGIN SELECT RAISE(ABORT,'immutable intent scope'); END;
CREATE TRIGGER valid_intent_transition BEFORE UPDATE OF state,version ON purchase_intents WHEN NEW.version!=OLD.version+1 OR NOT (
 (OLD.state='CREATED' AND NEW.state='VALIDATING') OR (OLD.state='VALIDATING' AND NEW.state IN ('READY','BLOCKED')) OR
 (OLD.state='READY' AND NEW.state='IN_PROGRESS') OR (OLD.state='IN_PROGRESS' AND NEW.state='SIMULATED') OR (OLD.state='BLOCKED' AND NEW.state='VALIDATING')
) BEGIN SELECT RAISE(ABORT,'invalid intent transition'); END;
CREATE TABLE checkout_attempts (id TEXT PRIMARY KEY, intent_id TEXT NOT NULL UNIQUE REFERENCES purchase_intents(id), mode TEXT NOT NULL CHECK(mode='DRY_RUN'), state TEXT NOT NULL CHECK(state IN ('CREATED','READY','SIMULATED')), version INTEGER NOT NULL CHECK(version>=0)) STRICT;
CREATE TRIGGER immutable_attempt_scope BEFORE UPDATE OF id,intent_id,mode ON checkout_attempts BEGIN SELECT RAISE(ABORT,'immutable attempt scope'); END;
CREATE TRIGGER valid_attempt_transition BEFORE UPDATE OF state,version ON checkout_attempts WHEN NEW.version!=OLD.version+1 OR NOT (
 (OLD.state='CREATED' AND NEW.state='READY') OR (OLD.state='READY' AND NEW.state='SIMULATED')
) BEGIN SELECT RAISE(ABORT,'invalid attempt transition'); END;
CREATE TABLE simulated_product_guards (owner_id TEXT NOT NULL REFERENCES simulated_owners(owner_id), canonical_id TEXT NOT NULL REFERENCES canonical_products(id), intent_id TEXT NOT NULL UNIQUE REFERENCES purchase_intents(id), blocked_until INTEGER NOT NULL, PRIMARY KEY(owner_id,canonical_id)) STRICT;
CREATE TABLE simulated_operations (owner_id TEXT NOT NULL REFERENCES simulated_owners(owner_id), operation_id TEXT NOT NULL, subject TEXT NOT NULL, intent_id TEXT NOT NULL REFERENCES purchase_intents(id), PRIMARY KEY(owner_id,operation_id)) STRICT;
CREATE TABLE simulated_limit_buckets (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES simulated_owners(owner_id), kind TEXT NOT NULL CHECK(kind IN ('DAILY_SPEND','PRODUCT_QUANTITY','DAILY_ATTEMPTS')),
 currency TEXT CHECK(currency IN ('MXN','USD')), starts_at INTEGER, ends_at INTEGER, campaign_id TEXT, canonical_id TEXT REFERENCES canonical_products(id),
 held INTEGER NOT NULL DEFAULT 0 CHECK(held BETWEEN 0 AND 9000000000000000), consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed BETWEEN 0 AND 9000000000000000),
 CHECK(held+consumed<=9000000000000000),
 CHECK((kind='DAILY_SPEND' AND currency IS NOT NULL AND starts_at IS NOT NULL AND ends_at>starts_at) OR (kind='DAILY_ATTEMPTS' AND currency IS NULL AND starts_at IS NOT NULL AND ends_at>starts_at) OR (kind='PRODUCT_QUANTITY' AND currency IS NULL AND campaign_id IS NOT NULL AND canonical_id IS NOT NULL))
) STRICT;
CREATE TABLE simulated_reservations (intent_id TEXT PRIMARY KEY REFERENCES purchase_intents(id), mode TEXT NOT NULL CHECK(mode='DRY_RUN'), state TEXT NOT NULL CHECK(state IN ('HELD','CONSUMED')), upper_minor INTEGER NOT NULL CHECK(upper_minor BETWEEN 0 AND 9000000000000000), currency TEXT NOT NULL CHECK(currency IN ('MXN','USD')), quantity INTEGER NOT NULL CHECK(quantity>0), created_at INTEGER NOT NULL) STRICT;
CREATE TABLE simulated_reservation_lines (intent_id TEXT NOT NULL REFERENCES simulated_reservations(intent_id), bucket_id TEXT NOT NULL REFERENCES simulated_limit_buckets(id), held_units INTEGER NOT NULL CHECK(held_units>=0), PRIMARY KEY(intent_id,bucket_id)) STRICT;
CREATE TABLE simulated_consumption (intent_id TEXT NOT NULL, bucket_id TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>=0), released_units INTEGER NOT NULL CHECK(released_units>=0), occurred_at INTEGER NOT NULL, PRIMARY KEY(intent_id,bucket_id), FOREIGN KEY(intent_id,bucket_id) REFERENCES simulated_reservation_lines(intent_id,bucket_id)) STRICT;
CREATE TABLE audit_events (id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES purchase_intents(id), aggregate_id TEXT NOT NULL, aggregate_version INTEGER NOT NULL, action TEXT NOT NULL, occurred_at INTEGER NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot) AND length(snapshot)<=8192), UNIQUE(aggregate_id,aggregate_version,action)) STRICT;
CREATE INDEX audit_by_intent ON audit_events(intent_id,occurred_at);
CREATE TABLE event_outbox (
 event_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES purchase_intents(id), aggregate_version INTEGER NOT NULL, event_type TEXT NOT NULL, schema_version INTEGER NOT NULL,
 envelope TEXT NOT NULL CHECK(json_valid(envelope) AND length(envelope)<=8192), status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DELIVERED','DEAD_LETTER')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), next_attempt_at INTEGER NOT NULL, last_error TEXT CHECK(last_error IN ('HANDLER_FAILED','INCOMPATIBLE_EVENT')), UNIQUE(intent_id,aggregate_version,event_type)
) STRICT;
CREATE INDEX pending_outbox ON event_outbox(status,next_attempt_at);
CREATE TABLE handler_receipts (handler_id TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES event_outbox(event_id), recorded_at INTEGER NOT NULL, PRIMARY KEY(handler_id,event_id)) STRICT;
CREATE TABLE simulated_notifications (event_id TEXT PRIMARY KEY REFERENCES event_outbox(event_id), intent_id TEXT NOT NULL REFERENCES purchase_intents(id), action TEXT NOT NULL CHECK(action IN ('PurchaseWouldHaveExecuted','PurchaseBlocked'))) STRICT;
PRAGMA user_version=1;
`;

/** M2 -> M3. Preserve existing IDs, foreign keys and critical state. */
export const migrateToM3 = `
CREATE TABLE offers_v2 (id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES store_instances(id), external_id TEXT NOT NULL, listing_id TEXT NOT NULL REFERENCES listings(id), variant_id TEXT NOT NULL REFERENCES variants(id), seller_id TEXT NOT NULL REFERENCES sellers(id), condition TEXT NOT NULL CHECK(condition IN ('NEW_SEALED','UNKNOWN')), delivery_scope TEXT NOT NULL, UNIQUE(store_id,external_id)) STRICT;
INSERT INTO offers_v2 SELECT * FROM offers;
DROP TABLE offers;
ALTER TABLE offers_v2 RENAME TO offers;
CREATE TABLE store_metadata (store_id TEXT PRIMARY KEY REFERENCES store_instances(id), snapshot TEXT NOT NULL CHECK(json_valid(snapshot) AND length(snapshot)<=8192)) STRICT;
CREATE TABLE observation_metadata (observation_id TEXT PRIMARY KEY REFERENCES listing_observations(id), snapshot TEXT NOT NULL CHECK(json_valid(snapshot) AND length(snapshot)<=65536)) STRICT;
CREATE TABLE read_quotas (scope TEXT PRIMARY KEY, next_at INTEGER NOT NULL CHECK(next_at>=0), blocked TEXT CHECK(blocked IN ('BLOCKED','AUTH_REQUIRED'))) STRICT;
PRAGMA user_version=2;
`;

/** M4 adds only operator metadata and scheduling. M1/M2 critical records stay intact. */
export const migrateToM4 = `
CREATE TABLE desktop_schedule (monitor_id TEXT PRIMARY KEY REFERENCES monitors(id), cadence_seconds INTEGER NOT NULL CHECK(cadence_seconds BETWEEN 60 AND 86400), next_due_at INTEGER NOT NULL CHECK(next_due_at>=0)) STRICT;
CREATE INDEX desktop_due ON desktop_schedule(next_due_at);
CREATE TABLE desktop_settings (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version>0), refresh_seconds INTEGER NOT NULL CHECK(refresh_seconds BETWEEN 5 AND 60), store_enabled INTEGER NOT NULL CHECK(store_enabled IN (0,1)), live_reads_used INTEGER NOT NULL CHECK(live_reads_used BETWEEN 0 AND 6), last_failure_at INTEGER, last_failure TEXT) STRICT;
INSERT INTO desktop_settings VALUES(1,1,15,0,0,NULL,NULL);
CREATE TABLE desktop_settings_audit (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, occurred_at INTEGER NOT NULL, refresh_seconds INTEGER NOT NULL, store_enabled INTEGER NOT NULL) STRICT;
CREATE INDEX desktop_evaluations_time ON decision_evaluations(evaluated_at);
CREATE INDEX desktop_observations_time ON listing_observations(captured_at);
PRAGMA user_version=3;
`;

/** M5.3: additive read-only transition aggregates; never reference/create a purchase intent. */
export const migrateToM5_3 = `
CREATE TABLE restock_scopes (scope_key TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(json_valid(scope)), state TEXT NOT NULL CHECK(json_valid(state) AND length(state)<=262144)) STRICT;
CREATE TABLE restock_samples (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL REFERENCES restock_scopes(scope_key), input_id TEXT NOT NULL, fingerprint TEXT NOT NULL CHECK(json_valid(fingerprint) AND length(fingerprint)<=262144), sample TEXT NOT NULL CHECK(json_valid(sample)), decision TEXT NOT NULL CHECK(json_valid(decision) AND length(decision)<=262144)) STRICT;
CREATE INDEX restock_samples_scope ON restock_samples(scope_key);
CREATE TABLE restock_events (event_id TEXT PRIMARY KEY, scope_key TEXT NOT NULL REFERENCES restock_scopes(scope_key), sample_id TEXT NOT NULL REFERENCES restock_samples(id), envelope TEXT NOT NULL CHECK(json_valid(envelope) AND json_extract(envelope,'$.mode')='DRY_RUN' AND length(envelope)<=65536)) STRICT;
CREATE INDEX restock_events_scope ON restock_events(scope_key);
CREATE TABLE restock_outbox (event_id TEXT PRIMARY KEY REFERENCES restock_events(event_id), status TEXT NOT NULL CHECK(status IN ('PENDING','DELIVERED','DEAD_LETTER')), attempts INTEGER NOT NULL CHECK(attempts BETWEEN 0 AND 3), next_at INTEGER NOT NULL) STRICT;
CREATE INDEX restock_pending ON restock_outbox(status,next_at);
CREATE TABLE restock_receipts (handler_id TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES restock_events(event_id), recorded_at INTEGER NOT NULL, PRIMARY KEY(handler_id,event_id)) STRICT;
PRAGMA user_version=4;
`;
