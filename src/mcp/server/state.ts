/**
 * MCP Server — shared singleton state.
 *
 * This module owns the SINGLE source of truth for the MCP server's
 * module-level singletons: the live `Server`/`StdioServerTransport`
 * handles plus the stored `Config`/workspace-root/`WorkspaceContext`.
 *
 * `lifecycle.ts` mutates these THROUGH the accessors/mutators exported
 * here so there is exactly one shared instance. `state.ts` must NOT import
 * `lifecycle.ts` (no circular import); the dependency only runs the other
 * way.
 *
 * The public getters/setters (`getStoredWorkspaceRoot`, `getStoredContext`,
 * `getStoredConfig`, `setStoredWorkspaceRoot`, `setStoredConfig`) keep their
 * original names so `src/mcp/tools/*` and tests import them unchanged via
 * the `./server` barrel.
 */

import { randomUUID } from 'crypto';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Config } from '../../core/config-types';
import {
    initWorkspaceContext,
    type WorkspaceContext,
} from '../../application/workspace-context';

// ============================================================================
// Singleton handles (low-level — owned here, mutated via accessors)
// ============================================================================

/** MCP server instance */
let server: Server | null = null;

/** Server transport (retained to keep the live handle from being GC'd; not read) */
let _transport: StdioServerTransport | null = null;

/** Server configuration (passed from extension) */
let serverConfig: Config | null = null;

/** Workspace root for lazy artifact initialization */
let storedWorkspaceRoot: string | null = null;

/** Stored config for tools that need configuration (artifact paths, etc.) */
let storedConfig: Config | null = null;

/**
 * Loop 04: memoized `WorkspaceContext` for tools. The MCP server processes
 * one workspace per `startServer` call; the context is built lazily on
 * the first tool that calls `getStoredContext()` and reset on
 * `stopServer()` / `setStoredWorkspaceRoot(null)`.
 */
let storedContext: WorkspaceContext | null = null;

// ============================================================================
// Low-level handle accessors (used by lifecycle.ts only)
// ============================================================================

export function getServer(): Server | null {
    return server;
}

export function setServer(next: Server | null): void {
    server = next;
}

export function setTransport(next: StdioServerTransport | null): void {
    _transport = next;
}

export function setServerConfig(next: Config | null): void {
    serverConfig = next;
}

export function getServerConfigState(): Config | null {
    return serverConfig;
}

// ============================================================================
// Public stored-state accessors (imported by tools/* via the barrel)
// ============================================================================

/**
 * Get the stored workspace root for lazy initialization
 */
export function getStoredWorkspaceRoot(): string {
    if (!storedWorkspaceRoot) {
        throw new Error('Workspace root not set. Call startServer first.');
    }
    return storedWorkspaceRoot;
}

/**
 * Loop 04: build (and memoize) a `WorkspaceContext` for the stored
 * workspace root. Tools that take per-call `workspaceRoot` arguments
 * call `assertWorkspaceRootMatch(workspaceRoot)` first, then call this
 * to share the server-side context.
 *
 * The cache is invalidated on `setStoredWorkspaceRoot(null)` and
 * `stopServer()` so test runs that swap workspaces do not reuse a stale
 * context.
 */
export async function getStoredContext(): Promise<WorkspaceContext> {
    if (!storedContext) {
        storedContext = await initWorkspaceContext({
            workspaceRoot: getStoredWorkspaceRoot(),
            configOverrides: { ...getStoredConfig() },
        });
    }
    return storedContext;
}

/**
 * Get the stored Config for tools (e.g. artifact root paths).
 * Throws if the server has not been initialized.
 */
export function getStoredConfig(): Config {
    if (!storedConfig) {
        throw new Error('Config not set. Call startServer first.');
    }
    return storedConfig;
}

/**
 * Set the stored workspace root directly (for testing only). Loop 04:
 * also resets the memoized `WorkspaceContext` so a follow-up
 * `getStoredContext()` rebuilds against the new root.
 */
export function setStoredWorkspaceRoot(root: string | null): void {
    storedWorkspaceRoot = root;
    storedContext = null;
}

/**
 * Set the stored config directly (for testing only). Loop 04: also
 * invalidates the memoized context so configuration overrides take
 * effect on the next access.
 */
export function setStoredConfig(config: Config | null): void {
    storedConfig = config;
    storedContext = null;
}

/**
 * Clear the memoized `WorkspaceContext` (used by `stopServer()` on
 * shutdown). Kept distinct from `setStoredWorkspaceRoot(null)` so the
 * lifecycle can reset every singleton explicitly.
 */
export function clearStoredContext(): void {
    storedContext = null;
}

// ============================================================================
// Review session tokens (C6, 2026-07-13)
// ============================================================================
//
// Phase-1 `review` issues a token per (path, ruleset); phase-2
// `report_review` must present it. This makes two failure modes structural
// rather than conventional: fabricating a phase-2 report without ever
// running phase-1 (R-1), and reporting under a different ruleset than was
// recalled (R-4 — the ruleset is part of the key, so a mismatch never
// verifies). Re-running phase-1 REPLACES the token, so a stale phase-2
// from before the re-run is rejected too.

const reviewTokens = new Map<string, string>();

const reviewTokenKey = (path: string, ruleset: string): string =>
    JSON.stringify([path, ruleset]);

/** Issue (and store, replacing any prior) the token for one review session. */
export function issueReviewToken(path: string, ruleset: string): string {
    const token = randomUUID();
    reviewTokens.set(reviewTokenKey(path, ruleset), token);
    return token;
}

/** True iff `token` is the CURRENT token for (path, ruleset). */
export function verifyReviewToken(path: string, ruleset: string, token: string): boolean {
    return reviewTokens.get(reviewTokenKey(path, ruleset)) === token;
}

/** Reset all review sessions (server shutdown / tests). */
export function clearReviewTokens(): void {
    reviewTokens.clear();
}
