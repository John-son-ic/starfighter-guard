import type { Server } from 'node:http';
/** Typed adapter for the existing, tested JavaScript static server. */
export function createReleaseServer(rootDirectory?: string): Server;
