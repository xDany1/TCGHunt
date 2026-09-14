import { contextBridge, ipcRenderer } from 'electron';
import { COMMANDS } from '@ptcg/contracts';
// Each closure fixes one approved channel. Neither ipcRenderer nor a generic invoke is exposed.
contextBridge.exposeInMainWorld('astra', Object.freeze(Object.fromEntries(COMMANDS.map(command => [command, (input: unknown) => ipcRenderer.invoke(`astra:v1:${command}`, input)]))));
