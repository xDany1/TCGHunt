import { ContractFailure, validateCommand } from '@ptcg/contracts';
import type { Command, Inputs } from '@ptcg/contracts';
export const APP_URL = 'astra://app/index.html';
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export const WEB_PREFERENCES = { contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, sandbox: true, webSecurity: true, webviewTag: false, devTools: false } as const;
export interface SenderIdentity { readonly trustedContents: boolean; readonly topFrame: boolean; readonly frameUrl: string | null; }
export class IpcGuard {
  private since = 0; private count = 0;
  validate<K extends Command>(name: K, payload: unknown, sender: SenderIdentity, now: number): Inputs[K] {
    if (!sender.trustedContents || !sender.topFrame || sender.frameUrl !== APP_URL) throw new ContractFailure('UNTRUSTED_SENDER');
    if (now - this.since >= 60000 || now < this.since) { this.since = now; this.count = 0; }
    if (++this.count > 120) throw new ContractFailure('RATE_LIMITED');
    return validateCommand(name, payload);
  }
}
