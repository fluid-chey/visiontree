/**
 * VS Code Extension Mode - ElectronAPI Shim
 *
 * When the webapp runs inside a VS Code webview iframe (detected by ?vscodePath= URL param),
 * window.electronAPI doesn't exist. This shim provides a working implementation so the app
 * functions with feature parity to the Electron desktop app.
 *
 * Capabilities:
 * - Graph loading and live polling from backend /files endpoint
 * - Node editing → writes back to disk via /write-node
 * - Node deletion → deletes from disk via /delete-node
 * - Ask mode → uses backend /ask endpoint
 * - Node position saving (in-memory, reflected in YAML frontmatter on write)
 * - Undo history (basic)
 *
 * Must be imported BEFORE any code that accesses window.electronAPI.
 */

import type { Graph, GraphDelta, FSUpdate } from '@/pure/graph';
import * as O from 'fp-ts/lib/Option.js';

function getUrlParam(name: string): string | null {
    try {
        return new URLSearchParams(window.location.search).get(name);
    } catch {
        return null;
    }
}

const vscodePath = getUrlParam('vscodePath');
const backendPortParam = getUrlParam('backendPort');

// ============================================================================
// Module-level state
// ============================================================================
let _currentGraph: Graph | null = null;
let _graphUpdateCallback: ((delta: GraphDelta) => void) | null = null;
let _pollIntervalId: ReturnType<typeof setInterval> | null = null;
let _backendPort: number | null = null;
let _lastFileFingerprint = '';

// Undo stack (simple: store previous graph states)
const _undoStack: Graph[] = [];
const _redoStack: Graph[] = [];
const MAX_UNDO = 30;

function getCurrentGraph(): Graph {
    return _currentGraph ?? { nodes: {} } as Graph;
}

function getBaseUrl(): string {
    return `http://localhost:${_backendPort}`;
}

function getVoicetreePath(): string {
    return vscodePath!.endsWith('.voicetree') ? vscodePath! : `${vscodePath}/.voicetree`;
}

// ============================================================================
// Backend API helpers
// ============================================================================

async function backendWriteNode(filePath: string, content: string): Promise<boolean> {
    if (!_backendPort) return false;
    try {
        const resp = await fetch(`${getBaseUrl()}/write-node`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: filePath, content }),
        });
        return resp.ok;
    } catch (e) {
        console.error('[vscode-shim] write-node failed:', e);
        return false;
    }
}

async function backendDeleteNode(filePath: string): Promise<boolean> {
    if (!_backendPort) return false;
    try {
        const resp = await fetch(`${getBaseUrl()}/delete-node`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: filePath }),
        });
        return resp.ok;
    } catch (e) {
        console.error('[vscode-shim] delete-node failed:', e);
        return false;
    }
}

// ============================================================================
// Graph delta application — the core of feature parity
// ============================================================================

/**
 * Apply a GraphDelta: update local graph, write/delete files on disk, push UI update.
 * This replaces Electron's applyGraphDeltaToDBThroughMemAndUIExposed.
 */
async function applyGraphDelta(delta: GraphDelta): Promise<void> {
    if (!delta || delta.length === 0) return;

    // Save undo state
    if (_currentGraph) {
        _undoStack.push(structuredClone(_currentGraph));
        if (_undoStack.length > MAX_UNDO) _undoStack.shift();
        _redoStack.length = 0; // Clear redo on new action
    }

    // Lazy import for graph delta application and markdown serialization
    const { applyGraphDeltaToGraph } = await import('@/pure/graph/graphDelta/applyGraphDeltaToGraph');
    const { fromNodeToMarkdownContent } = await import('@/pure/graph/markdown-writing/node_to_markdown');

    // Apply delta to local graph
    const oldGraph = getCurrentGraph();
    _currentGraph = applyGraphDeltaToGraph(oldGraph, delta);

    // Write/delete files on disk
    for (const d of delta) {
        if (d.type === 'UpsertNode') {
            const node = d.nodeToUpsert;
            const filePath = node.absoluteFilePathIsID.endsWith('.md')
                ? node.absoluteFilePathIsID
                : `${node.absoluteFilePathIsID}.md`;
            const content = fromNodeToMarkdownContent(node);
            await backendWriteNode(filePath, content);
        } else if (d.type === 'DeleteNode') {
            const filePath = d.nodeId.endsWith('.md') ? d.nodeId : `${d.nodeId}.md`;
            await backendDeleteNode(filePath);
        }
    }

    // Push delta to UI so Cytoscape updates immediately
    if (_graphUpdateCallback) {
        _graphUpdateCallback(delta);
    }

    // Force next poll to pick up any backend-side changes
    _lastFileFingerprint = '';
}

/**
 * Save node positions: update the local graph's node positions.
 * Positions are written to YAML frontmatter next time the node is saved.
 */
function saveNodePositions(cyNodes: Array<{ data: { id: string }; position?: { x: number; y: number } }>): void {
    if (!_currentGraph) return;
    const graph = { ..._currentGraph, nodes: { ..._currentGraph.nodes } };

    for (const cyNode of cyNodes) {
        const nodeId = cyNode.data.id;
        const pos = cyNode.position;
        if (!pos || !graph.nodes[nodeId]) continue;

        const node = graph.nodes[nodeId];
        graph.nodes[nodeId] = {
            ...node,
            nodeUIMetadata: {
                ...node.nodeUIMetadata,
                position: O.some({ x: pos.x, y: pos.y }),
            },
        };
    }
    _currentGraph = graph as Graph;
}

// ============================================================================
// Undo / Redo
// ============================================================================

// Flag to suppress polling during undo/redo operations
let _suppressPolling = false;

async function performUndo(): Promise<void> {
    if (_undoStack.length === 0) return;
    _suppressPolling = true;
    const prev = _undoStack.pop()!;
    const beforeGraph = _currentGraph;
    if (_currentGraph) _redoStack.push(structuredClone(_currentGraph));
    _currentGraph = prev;
    await pushFullGraphToUI(beforeGraph);
    // Allow polling again after a short delay to prevent immediate override
    setTimeout(() => { _suppressPolling = false; }, 5000);
}

async function performRedo(): Promise<void> {
    if (_redoStack.length === 0) return;
    _suppressPolling = true;
    const next = _redoStack.pop()!;
    const beforeGraph = _currentGraph;
    if (_currentGraph) _undoStack.push(structuredClone(_currentGraph));
    _currentGraph = next;
    await pushFullGraphToUI(beforeGraph);
    setTimeout(() => { _suppressPolling = false; }, 5000);
}

/**
 * Push the full current graph to the UI.
 * If previousGraph is provided, also sends DeleteNode deltas for nodes that were removed.
 */
async function pushFullGraphToUI(previousGraph?: Graph | null): Promise<void> {
    if (!_currentGraph || !_graphUpdateCallback) return;
    const { mapNewGraphToDelta } = await import('@/pure/graph');
    const upsertDeltas = mapNewGraphToDelta(_currentGraph);

    // Build DeleteNode deltas for nodes removed between previousGraph and current
    const deleteDeltas: Array<{ type: 'DeleteNode'; nodeId: string }> = [];
    if (previousGraph) {
        const currentNodeIds = new Set(Object.keys(_currentGraph.nodes));
        for (const nodeId of Object.keys(previousGraph.nodes)) {
            if (!currentNodeIds.has(nodeId)) {
                deleteDeltas.push({ type: 'DeleteNode', nodeId });
            }
        }
    }

    const fullDelta = [...deleteDeltas, ...upsertDeltas] as unknown as GraphDelta;
    _graphUpdateCallback(fullDelta);
    _lastFileFingerprint = '';
}

// ============================================================================
// Ask mode
// ============================================================================

async function askQuery(question: string, topK: number = 10): Promise<unknown> {
    if (!_backendPort) return { relevant_nodes: [] };
    try {
        const resp = await fetch(`${getBaseUrl()}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: question, top_k: topK }),
        });
        if (!resp.ok) return { relevant_nodes: [] };
        return await resp.json();
    } catch {
        return { relevant_nodes: [] };
    }
}

// ============================================================================
// Install the shim
// ============================================================================

export function installVscodeElectronShim(): boolean {
    if (vscodePath === null) return false;
    if (window.electronAPI !== undefined) return false;

    _backendPort = backendPortParam ? parseInt(backendPortParam, 10) : null;
    const projectName = vscodePath.split(/[/\\]/).pop() ?? 'Workspace';
    const voicetreePath = getVoicetreePath();

    const shim: Record<string, unknown> = {
        main: new Proxy({} as Record<string, unknown>, {
            get(_target: Record<string, unknown>, prop: string): unknown {

                // ---- Backend port ----
                if (prop === 'getBackendPort') {
                    return async () => _backendPort;
                }

                // ---- File watching ----
                if (prop === 'getWatchStatus') {
                    return async () => ({ isWatching: true, directory: vscodePath });
                }
                if (prop === 'startFileWatching') {
                    return async () => ({ success: true, directory: vscodePath });
                }
                if (prop === 'stopFileWatching') {
                    return async () => ({ success: true });
                }

                // ---- Settings (persisted to .voicetree/settings.json) ----
                if (prop === 'loadSettings') {
                    return async () => {
                        const { DEFAULT_SETTINGS } = await import('@/pure/settings/DEFAULT_SETTINGS');
                        try {
                            const saved = await settingsBridge.load();
                            if (saved) {
                                return { ...DEFAULT_SETTINGS, ...saved, darkMode: true };
                            }
                        } catch (e) {
                            console.warn('[vscode-shim] Failed to load settings from disk:', e);
                        }
                        return { ...DEFAULT_SETTINGS, agentPermissionModeChosen: true, darkMode: true };
                    };
                }
                if (prop === 'saveSettings') {
                    return async (settings: unknown) => {
                        try {
                            await settingsBridge.save(settings as Record<string, unknown>);
                        } catch (e) {
                            console.warn('[vscode-shim] Failed to save settings:', e);
                        }
                        return {};
                    };
                }

                // ---- Graph state ----
                if (prop === 'getGraph') {
                    return async () => getCurrentGraph();
                }
                if (prop === 'getNode') {
                    return async (nodeId: string) => getCurrentGraph().nodes[nodeId];
                }

                // ---- Graph mutation (the big ones) ----
                if (prop === 'applyGraphDeltaToDBThroughMemAndUIExposed' ||
                    prop === 'applyGraphDeltaToDBThroughMemUIAndEditorExposed') {
                    return async (delta: GraphDelta) => {
                        await applyGraphDelta(delta);
                    };
                }

                // ---- Node positions ----
                if (prop === 'saveNodePositions') {
                    return (cyNodes: Array<{ data: { id: string }; position?: { x: number; y: number } }>) => {
                        saveNodePositions(cyNodes);
                    };
                }

                // ---- Undo / Redo ----
                if (prop === 'performUndo') {
                    return async () => { await performUndo(); };
                }
                if (prop === 'performRedo') {
                    return async () => { await performRedo(); };
                }

                // ---- Ask mode ----
                if (prop === 'askQuery') {
                    return async (question: string, topK: number) => askQuery(question, topK);
                }
                if (prop === 'askModeCreateAndSpawn') {
                    // Ask mode creates a context node and spawns a terminal — in VS Code
                    // we just return the search results without terminal spawning
                    return async (nodePaths: string[], question: string) => {
                        console.log('[vscode-shim] askModeCreateAndSpawn', { nodePaths, question });
                        return { success: true, message: 'Ask mode results available (terminal not available in VS Code)' };
                    };
                }

                // ---- Vault/path management ----
                if (prop === 'getVaultPaths') {
                    return async () => [voicetreePath];
                }
                if (prop === 'getReadPaths') {
                    return async () => [voicetreePath];
                }
                if (prop === 'getWritePath') {
                    return async () => ({ _tag: 'Some', value: `${voicetreePath}/voice` });
                }
                if (prop === 'getAvailableFoldersForSelector') {
                    return async () => [{
                        name: projectName,
                        path: vscodePath,
                        isVoicetreeFolder: true,
                    }];
                }
                if (prop === 'setWritePath' || prop === 'addReadPath' || prop === 'removeReadPath') {
                    return async () => ({ success: true });
                }
                if (prop === 'showFolderPicker') {
                    return async () => null; // No folder picker in VS Code webview
                }

                // ---- Microphone permissions ----
                if (prop === 'checkMicrophonePermission') {
                    return async () => 'granted';
                }
                if (prop === 'requestMicrophonePermission') {
                    return async () => true;
                }
                if (prop === 'openMicrophoneSettings') {
                    return async () => {};
                }

                // ---- Project management ----
                if (prop === 'loadProjects') {
                    return async () => [];
                }
                if (prop === 'saveProject') {
                    return async () => {};
                }
                if (prop === 'initializeProject') {
                    return async () => vscodePath;
                }
                if (prop === 'markFrontendReady') {
                    return async () => {};
                }
                if (prop === 'getAppSupportPath') {
                    return async () => '';
                }

                // ---- Metrics ----
                if (prop === 'getMetrics') {
                    return async () => ({});
                }

                // ---- Terminal-related (agent spawning) ----
                if (prop === 'spawnTerminalWithContextNode') {
                    return async (taskNodeId: string, command: string, terminalCount?: number) => {
                        console.log(`[vscode-shim] spawnTerminalWithContextNode: ${taskNodeId}, command: ${command}`);
                        return await spawnTerminalInGraph(taskNodeId, command, terminalCount ?? 0);
                    };
                }
                if (prop === 'spawnPlainTerminalWithNode' ||
                    prop === 'spawnPlainTerminal') {
                    return async (nodeId?: string, terminalCount?: number) => {
                        console.log(`[vscode-shim] ${prop}: opening plain terminal in graph`);
                        if (nodeId) {
                            return await spawnTerminalInGraph(nodeId, '', terminalCount ?? 0);
                        }
                        // No node → open VS Code terminal as fallback
                        postToVSCode({
                            type: 'voicetree-spawn-terminal',
                            command: '',
                            name: 'Voicetree Terminal',
                            nodeId: '',
                            env: {},
                        });
                        return null;
                    };
                }
                if (prop === 'runAgentOnSelectedNodes') {
                    return async () => {
                        console.warn(`[vscode-shim] runAgentOnSelectedNodes not yet supported in VS Code mode`);
                        return null;
                    };
                }
                if (prop === 'removeTerminalFromRegistry' ||
                    prop === 'updateTerminalPinned' ||
                    prop === 'updateTerminalActivityState' ||
                    prop === 'updateTerminalIsDone') {
                    return async () => {};
                }

                // ---- Images ----
                if (prop === 'readImageAsDataUrl') {
                    return async () => null;
                }
                if (prop === 'saveClipboardImage') {
                    return async () => null;
                }

                // ---- MCP integration ----
                if (prop === 'setMcpIntegration') {
                    return async () => {};
                }

                // ---- Project scanning (not needed in VS Code) ----
                if (prop === 'getDefaultSearchDirectories' || prop === 'scanForProjects') {
                    return async () => [];
                }

                // Default: async no-op with warning
                return async (..._args: unknown[]) => {
                    console.warn(`[vscode-shim] Unimplemented electronAPI.main.${prop} called`);
                    return null;
                };
            },
        }),

        // ---- Graph subscription API ----
        graph: {
            onGraphUpdate: (callback: (delta: GraphDelta) => void): (() => void) => {
                _graphUpdateCallback = callback;
                setTimeout(() => { void loadAndPushGraph(); }, 1000);
                startGraphPolling();
                return () => {
                    _graphUpdateCallback = null;
                    stopGraphPolling();
                };
            },
            onGraphClear: (_callback: () => void): (() => void) => {
                return () => {};
            },
        },

        // ---- Terminal API (bridged to VS Code extension via postMessage) ----
        terminal: {
            spawn: async (terminalData: unknown) => {
                return await terminalBridge.spawn(terminalData);
            },
            write: async (terminalId: string, data: string) => {
                postToVSCode({ type: 'voicetree-terminal-write', terminalId, data });
                return { success: true };
            },
            resize: async (terminalId: string, cols: number, rows: number) => {
                postToVSCode({ type: 'voicetree-terminal-resize', terminalId, cols, rows });
                return { success: true };
            },
            kill: async (terminalId: string) => {
                postToVSCode({ type: 'voicetree-terminal-kill', terminalId });
                return { success: true };
            },
            onData: (callback: (terminalId: string, data: string) => void) => {
                terminalBridge.onDataCallback = callback;
            },
            onExit: (callback: (terminalId: string, code: number) => void) => {
                terminalBridge.onExitCallback = callback;
            },
        },

        // ---- Event listener stubs ----
        onWatchingStarted: (_callback: unknown) => () => {},
        onBackendLog: (_callback: unknown) => {},
        removeAllListeners: (_channel: string) => {},
        invoke: async () => null,
        on: () => {},
        off: () => {},
    };

    (window as unknown as Record<string, unknown>).electronAPI = shim;
    console.log(`[vscode-shim] Installed electronAPI shim (backendPort=${_backendPort}, path=${vscodePath})`);

    // ── Keyboard event forwarding ──────────────────────────────────────
    // When the webapp iframe has focus, keyboard events are swallowed and
    // never reach VS Code's webview host.  Forward modifier-key combos to
    // the parent so VS Code shortcuts (Cmd+Shift+P, Cmd+P, Cmd+B, etc.)
    // still work.
    //
    // We listen on the *capture* phase so we see the event before the
    // webapp's own handlers (HotkeyManager, CodeMirror, xterm) can
    // stopPropagation.  We do NOT call preventDefault — the webapp still
    // processes the event normally.
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (!(e.metaKey || e.ctrlKey)) return;           // only modifier combos
        if (e.key === 'Meta' || e.key === 'Control') return; // ignore bare modifier
        try {
            window.parent.postMessage({
                type: 'voicetree-keydown',
                key:      e.key,
                code:     e.code,
                keyCode:  e.keyCode,
                metaKey:  e.metaKey,
                ctrlKey:  e.ctrlKey,
                shiftKey: e.shiftKey,
                altKey:   e.altKey,
            }, '*');
        } catch { /* iframe cross-origin safety */ }
    }, true);

    document.addEventListener('keyup', (e: KeyboardEvent) => {
        if (!(e.metaKey || e.ctrlKey) &&
            e.key !== 'Meta' && e.key !== 'Control') return;
        try {
            window.parent.postMessage({
                type: 'voicetree-keyup',
                key:      e.key,
                code:     e.code,
                keyCode:  e.keyCode,
                metaKey:  e.metaKey,
                ctrlKey:  e.ctrlKey,
                shiftKey: e.shiftKey,
                altKey:   e.altKey,
            }, '*');
        } catch { /* iframe cross-origin safety */ }
    }, true);

    return true;
}

// ============================================================================
// Settings persistence bridge — reads/writes .voicetree/settings.json
// ============================================================================

const settingsBridge = {
    _pending: new Map<string, { resolve: (v: unknown) => void }>(),

    async load(): Promise<Record<string, unknown> | null> {
        return new Promise((resolve) => {
            const id = `settings-load-${Date.now()}`;
            this._pending.set(id, { resolve });
            postToVSCode({ type: 'voicetree-settings-load', requestId: id });
            // Short timeout — fall back to defaults quickly so the UI isn't blocked
            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    resolve(null);
                }
            }, 500);
        });
    },

    async save(settings: Record<string, unknown>): Promise<void> {
        // Fire-and-forget with short timeout
        return new Promise((resolve) => {
            const id = `settings-save-${Date.now()}`;
            this._pending.set(id, { resolve: () => resolve() });
            postToVSCode({ type: 'voicetree-settings-save', requestId: id, settings });
            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    resolve();
                }
            }, 1000);
        });
    },

    handleMessage(msg: Record<string, unknown>): void {
        const id = msg.requestId as string;
        const pending = this._pending.get(id);
        if (pending) {
            this._pending.delete(id);
            pending.resolve(msg.settings ?? msg.result ?? null);
        }
    },
};

// Listen for settings responses from extension host
if (typeof window !== 'undefined') {
    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg && typeof msg.type === 'string' &&
            (msg.type === 'voicetree-settings-loaded' || msg.type === 'voicetree-settings-saved')) {
            settingsBridge.handleMessage(msg);
        }
    });
}

// ============================================================================
// VS Code terminal bridge via postMessage
// ============================================================================

/**
 * Post a message to the VS Code extension host via the iframe→parent bridge.
 */
function postToVSCode(msg: Record<string, unknown>): void {
    try {
        window.parent.postMessage(msg, '*');
    } catch (e) {
        console.error('[vscode-shim] Failed to postMessage to parent:', e);
    }
}

/**
 * Terminal bridge — manages terminal I/O between xterm.js in the graph
 * and processes running in the VS Code extension host.
 */
const terminalBridge = {
    onDataCallback: null as ((terminalId: string, data: string) => void) | null,
    onExitCallback: null as ((terminalId: string, code: number) => void) | null,
    _pendingSpawns: new Map<string, { resolve: (r: { success: boolean; terminalId?: string; error?: string }) => void }>(),

    async spawn(terminalData: unknown): Promise<{ success: boolean; terminalId?: string; error?: string }> {
        const td = terminalData as Record<string, unknown>;
        const terminalId = (td.terminalId as string) || `term-${Date.now().toString(36)}`;
        const command = td.initialCommand as string || '';
        const executeCommand = td.executeCommand as boolean ?? true;
        const envVars = td.initialEnvVars as Record<string, string> || {};
        const cwd = td.initialSpawnDirectory as string || '';

        return new Promise((resolve) => {
            this._pendingSpawns.set(terminalId, { resolve });

            postToVSCode({
                type: 'voicetree-terminal-spawn',
                terminalId,
                command: executeCommand ? command : '',
                env: envVars,
                cwd,
            });

            // Timeout fallback
            setTimeout(() => {
                if (this._pendingSpawns.has(terminalId)) {
                    this._pendingSpawns.delete(terminalId);
                    resolve({ success: true, terminalId }); // Optimistically succeed
                }
            }, 3000);
        });
    },

    handleMessage(msg: Record<string, unknown>): void {
        if (msg.type === 'voicetree-terminal-data') {
            const terminalId = msg.terminalId as string;
            const data = msg.data as string;
            this.onDataCallback?.(terminalId, data);
        } else if (msg.type === 'voicetree-terminal-exit') {
            const terminalId = msg.terminalId as string;
            const code = (msg.code as number) ?? 0;
            this.onExitCallback?.(terminalId, code);
        } else if (msg.type === 'voicetree-terminal-spawned') {
            const terminalId = msg.terminalId as string;
            const pending = this._pendingSpawns.get(terminalId);
            if (pending) {
                this._pendingSpawns.delete(terminalId);
                pending.resolve({ success: true, terminalId });
            }
        }
    },
};

// Listen for messages from the VS Code extension (via iframe parent)
if (typeof window !== 'undefined') {
    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg && typeof msg.type === 'string' && msg.type.startsWith('voicetree-terminal-')) {
            terminalBridge.handleMessage(msg);
        }
    });
}

/**
 * Spawn a floating terminal in the graph (like the desktop app).
 * Creates a context node, prepares terminal data, and calls launchTerminalOntoUI.
 */
async function spawnTerminalInGraph(
    taskNodeId: string,
    command: string,
    terminalCount: number
): Promise<{ terminalId: string; contextNodeId: string }> {
    const graph = getCurrentGraph();
    const taskNode = graph.nodes[taskNodeId];

    const { getNodeTitle } = await import('@/pure/graph/markdown-parsing');
    const title = taskNode ? getNodeTitle(taskNode) : 'Agent Task';

    // Build env vars for the terminal
    const voicetreePath = getVoicetreePath();
    const agentName = `agent-${Date.now().toString(36)}`;
    const env: Record<string, string> = {
        VOICETREE_VAULT_PATH: voicetreePath,
        ALL_MARKDOWN_READ_PATHS: voicetreePath,
        CONTEXT_NODE_PATH: taskNodeId,
        TASK_NODE_PATH: taskNodeId,
        AGENT_NAME: agentName,
    };

    // Expand AGENT_PROMPT from settings
    try {
        const { DEFAULT_SETTINGS } = await import('@/pure/settings/DEFAULT_SETTINGS');
        const agentPrompt = typeof DEFAULT_SETTINGS.INJECT_ENV_VARS.AGENT_PROMPT === 'string'
            ? DEFAULT_SETTINGS.INJECT_ENV_VARS.AGENT_PROMPT : '';
        let expandedPrompt = agentPrompt;
        for (const [key, value] of Object.entries(env)) {
            expandedPrompt = expandedPrompt.replace(new RegExp(`\\$${key}`, 'g'), value);
        }
        env.AGENT_PROMPT = expandedPrompt;
    } catch {
        env.AGENT_PROMPT = `Task: ${title}`;
    }

    // Determine command (default to first agent)
    let finalCommand = command;
    if (!finalCommand) {
        const { DEFAULT_SETTINGS } = await import('@/pure/settings/DEFAULT_SETTINGS');
        finalCommand = DEFAULT_SETTINGS.agents?.[0]?.command ?? '';
    }

    // Create terminal data using the proper factory
    const { createTerminalData } = await import('@/shell/edge/UI-edge/floating-windows/types');
    const terminalData = createTerminalData({
        terminalId: agentName as import('@/shell/edge/UI-edge/floating-windows/types').TerminalId,
        attachedToNodeId: taskNodeId,
        terminalCount,
        title,
        anchoredToNodeId: taskNodeId,
        initialCommand: finalCommand,
        executeCommand: true,
        initialSpawnDirectory: vscodePath || '',
        initialEnvVars: env,
        isPinned: true,
        agentName,
        parentTerminalId: null,
    });

    // Launch the floating terminal in the graph
    const { launchTerminalOntoUI } = await import(
        '@/shell/edge/UI-edge/floating-windows/terminals/launchTerminalOntoUI'
    );
    await launchTerminalOntoUI(taskNodeId, terminalData);

    return { terminalId: agentName, contextNodeId: taskNodeId };
}

// ============================================================================
// Graph loading & polling
// ============================================================================

async function loadAndPushGraph(): Promise<boolean> {
    if (!_backendPort) return false;
    if (_suppressPolling) return false;

    try {
        const baseUrl = getBaseUrl();

        // Ensure directory is loaded on first call
        if (!_currentGraph && vscodePath) {
            await fetch(`${baseUrl}/load-directory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory_path: getVoicetreePath() }),
            }).catch(() => {});
        }

        const resp = await fetch(`${baseUrl}/files`);
        if (!resp.ok) return false;
        const data = await resp.json() as { files: Array<{ path: string; content: string }> };
        if (!data.files) return false;

        // Fingerprint to detect changes
        const fingerprint = data.files.map(f => `${f.path}:${f.content.length}:${f.content.slice(0, 200)}`).join('|');
        if (fingerprint === _lastFileFingerprint) return false;
        _lastFileFingerprint = fingerprint;

        if (data.files.length === 0) {
            _currentGraph = { nodes: {} } as Graph;
            return false;
        }

        const { createEmptyGraph } = await import('@/pure/graph/createGraph');
        const { addNodeToGraphWithEdgeHealingFromFSEvent } = await import(
            '@/pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
        );
        const { applyGraphDeltaToGraph } = await import('@/pure/graph/graphDelta/applyGraphDeltaToGraph');

        // Build graph progressively
        let graph = createEmptyGraph();
        const allDeltas: GraphDelta[number][] = [];

        for (const file of data.files) {
            const fsEvent: FSUpdate = {
                absolutePath: file.path,
                content: file.content,
                eventType: 'Added',
            };
            const delta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, graph);
            if (delta.length > 0) {
                graph = applyGraphDeltaToGraph(graph, delta);
                allDeltas.push(...delta);
            }
        }

        // Preserve positions from previous graph when rebuilding
        if (_currentGraph) {
            const prevNodes = _currentGraph.nodes;
            const newNodes = { ...graph.nodes };
            for (const nodeId of Object.keys(newNodes)) {
                const prevPos = prevNodes[nodeId]?.nodeUIMetadata?.position;
                if (prevPos && O.isSome(prevPos)) {
                    newNodes[nodeId] = {
                        ...newNodes[nodeId],
                        nodeUIMetadata: {
                            ...newNodes[nodeId].nodeUIMetadata,
                            position: prevPos,
                        },
                    };
                }
            }
            graph = { ...graph, nodes: newNodes } as Graph;
        }

        _currentGraph = graph;

        if (allDeltas.length > 0 && _graphUpdateCallback) {
            _graphUpdateCallback(allDeltas as GraphDelta);
        }

        return allDeltas.length > 0;
    } catch (err) {
        console.error('[vscode-shim] Error loading graph:', err);
        return false;
    }
}

// refreshGraphFromBackend can be called to force a full refresh
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function refreshGraphFromBackend(): Promise<void> {
    _lastFileFingerprint = '';
    await loadAndPushGraph();
}

function startGraphPolling(): void {
    if (_pollIntervalId) return;
    _pollIntervalId = setInterval(() => { void loadAndPushGraph(); }, 3000);
}

function stopGraphPolling(): void {
    if (_pollIntervalId) {
        clearInterval(_pollIntervalId);
        _pollIntervalId = null;
    }
}
