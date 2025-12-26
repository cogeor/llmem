/**
 * Python Call Resolver
 *
 * Resolves call sites to their definitions using:
 * 1. Local function/class definitions within the same file
 * 2. Import bindings from import statements
 * 3. Marks unresolved calls as external
 */

import * as path from 'path';
import { CallSite } from '../types';
import { ImportBinding } from './imports';

export interface LocalDefinition {
    name: string;
    kind: 'function' | 'class' | 'method';
    /** Fully qualified name including class prefix for methods */
    qualifiedName: string;
}

export class PythonCallResolver {
    private localDefs: Map<string, LocalDefinition> = new Map();
    private importBindings: Map<string, ImportBinding> = new Map();
    private fileId: string = '';
    private workspaceRoot: string = '';

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Initialize resolver with context for a file.
     */
    public initialize(
        fileId: string,
        localDefs: Map<string, LocalDefinition>,
        importBindings: Map<string, ImportBinding>
    ): void {
        this.fileId = fileId;
        this.localDefs = localDefs;
        this.importBindings = importBindings;
    }

    /**
     * Resolve a callee name to its definition.
     * Returns the resolved file and name, or null if external/unresolved.
     */
    public resolve(calleeName: string): { file: string; name: string } | undefined {
        // Handle method calls: obj.method() → try to resolve "obj"
        const parts = calleeName.split('.');
        const baseName = parts[0];
        const methodName = parts.length > 1 ? parts[parts.length - 1] : null;

        // 1. Check local definitions first
        if (this.localDefs.has(calleeName)) {
            return {
                file: this.fileId,
                name: calleeName
            };
        }

        // For method calls, check if base is a local class
        if (methodName && this.localDefs.has(baseName)) {
            const def = this.localDefs.get(baseName)!;
            if (def.kind === 'class') {
                // Method on local class
                return {
                    file: this.fileId,
                    name: `${baseName}.${methodName}`
                };
            }
        }

        // 2. Check import bindings
        if (this.importBindings.has(baseName)) {
            const binding = this.importBindings.get(baseName)!;

            // Resolve module path to file path
            const resolvedPath = this.resolveModulePath(binding);

            if (resolvedPath) {
                const targetName = methodName
                    ? `${binding.importedName}.${methodName}`
                    : binding.importedName;

                return {
                    file: resolvedPath,
                    name: targetName
                };
            }

            // Even if we can't resolve the path, return module info
            return {
                file: binding.modulePath,
                name: methodName || binding.importedName
            };
        }

        // 3. Check if it's a Python builtin
        if (this.isBuiltin(baseName)) {
            return {
                file: '<builtin>',
                name: calleeName
            };
        }

        // 4. Unresolved - likely external or dynamic
        return undefined;
    }

    /**
     * Try to resolve a Python module path to a file path.
     */
    private resolveModulePath(binding: ImportBinding): string | null {
        if (binding.isRelative) {
            // Relative import: resolve based on current file location
            const currentDir = path.dirname(this.fileId);
            const dotsUp = binding.relativeDots - 1; // One dot means current dir

            let targetDir = currentDir;
            for (let i = 0; i < dotsUp; i++) {
                targetDir = path.dirname(targetDir);
            }

            // Remove leading dots from module path
            const modulePart = binding.modulePath.replace(/^\.+/, '');
            if (modulePart) {
                // from ..foo import bar → ../foo.py or ../foo/__init__.py
                const possiblePath = path.join(targetDir, ...modulePart.split('.'));
                return possiblePath.replace(/\\/g, '/') + '.py';
            } else {
                // from . import bar → current package
                return targetDir.replace(/\\/g, '/') + '/__init__.py';
            }
        }

        // Absolute import - try to resolve if it looks like a workspace path
        // Convert dot notation to file path (e.g., src.db.models.ticker → src/db/models/ticker.py)
        if (binding.modulePath && !binding.modulePath.startsWith('.')) {
            // Check if this might be a workspace import (starts with common package names)
            // or contains multiple segments suggesting it's not a stdlib/external package
            const parts = binding.modulePath.split('.');

            // If it has path-like structure (multiple parts), convert to file path
            if (parts.length >= 2) {
                const filePath = parts.join('/') + '.py';
                return filePath;
            }
        }

        // External package or single-level import - return module name as-is
        return null;
    }

    /**
     * Check if a name is a Python builtin.
     */
    private isBuiltin(name: string): boolean {
        const builtins = new Set([
            // Functions
            'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray',
            'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex',
            'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec',
            'filter', 'float', 'format', 'frozenset', 'getattr', 'globals',
            'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance',
            'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max',
            'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow',
            'print', 'property', 'range', 'repr', 'reversed', 'round', 'set',
            'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super',
            'tuple', 'type', 'vars', 'zip',
            // Exceptions (commonly called as constructors)
            'Exception', 'BaseException', 'ValueError', 'TypeError', 'KeyError',
            'IndexError', 'AttributeError', 'RuntimeError', 'StopIteration',
            'FileNotFoundError', 'IOError', 'OSError', 'ImportError', 'NameError',
            'ZeroDivisionError', 'AssertionError', 'NotImplementedError'
        ]);

        return builtins.has(name);
    }
}
